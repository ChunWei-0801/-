"""活動朋友邀請：不加入或改變家庭，不取得活動以外的私人帳務。

領域：記帳
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.guards import block_admin
from app.models import AuditLog, Group, GroupInvite, GroupMember, User
from app.schemas.group import GroupInviteCodeIn, GroupInviteIn, GroupJoinIn
from app.toolkit import crud, errors, family, password_reset
from app.toolkit.db import get_db

router = APIRouter(prefix="/groups", tags=["活動邀請"])
OWNER = "記帳"


def _number(value: str) -> int:
    if not value.isascii() or not value.isdigit() or len(value) > 19:
        return 0
    number = int(value)
    return number if number <= 9223372036854775807 else 0


def _utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return _utc(value).isoformat().replace("+00:00", "Z") if value else None


def _activity(gid: int, db: Session, *, owner: User | None = None, lock: bool = False, open_only: bool = True) -> Group:
    statement = select(Group).where(Group.id == gid, Group.removed_at.is_(None))
    if lock:
        statement = statement.with_for_update()
    group = db.scalar(statement.execution_options(populate_existing=True))
    if group is None:
        raise errors.not_found("找不到這個活動")
    if owner is not None and group.created_by != owner.id:
        raise errors.forbidden("只有活動建立者可以邀請朋友")
    if open_only and (group.archived_at is not None or group.settled_at is not None):
        raise errors.conflict("活動已封存或結算，不能再變更邀請")
    return group


def _audit(me: User, action: str, group_id: int | None, db: Session) -> None:
    # No email, invitation code, code hash or account/financial snapshot in audit metadata.
    db.add(AuditLog(actor_id=me.id, action=action, target_type="group", target_id=group_id, meta_json={}))


def _limit(me: User, action: str, db: Session, maximum: int = 10) -> None:
    now = datetime.now(timezone.utc)
    # Serialize attempts from this account, including failed code guesses. Share
    # the existing family exact-email lookup budget by using action=lookup_user.
    db.scalar(select(User).where(User.id == me.id).with_for_update())
    recent = crud.count(AuditLog, {"actor_id": me.id, "action": action,
                                  "created_at__gte": now - timedelta(minutes=1)}, db=db)
    if recent >= maximum:
        raise HTTPException(status_code=429, detail="操作太頻繁，請一分鐘後再試")
    _audit(me, action, None, db)
    db.commit()


def _available_inviter(invite: GroupInvite, group: Group, db: Session) -> None:
    inviter = db.get(User, invite.inviter_id)
    if (inviter is None or inviter.suspended_at is not None or inviter.is_platform_admin
            or group.created_by != invite.inviter_id
            or not crud.exists(GroupMember, {"group_id": group.id, "user_id": inviter.id}, db=db)):
        raise errors.conflict("邀請已無效，請活動建立者重新邀請")


def _metadata(rows: list[GroupInvite], db: Session) -> list[dict]:
    if not rows:
        return []
    people = {row.inviter_id for row in rows} | {row.invitee_id for row in rows if row.invitee_id is not None}
    names = {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_(people)))}
    groups = {g.id: g.name for g in db.scalars(select(Group).where(Group.id.in_({row.group_id for row in rows})))}
    return [{"id": str(row.id), "groupId": str(row.group_id), "groupName": groups.get(row.group_id, ""),
             "inviterId": str(row.inviter_id), "inviterName": names.get(row.inviter_id, ""),
             "inviteeId": str(row.invitee_id) if row.invitee_id is not None else None,
             "inviteeName": names.get(row.invitee_id) if row.invitee_id is not None else None,
             "label": row.label, "status": row.status, "expiresAt": _iso(row.expires_at),
             "createdAt": _iso(row.created_at), "isCode": row.code_hash is not None} for row in rows]


def _target(group: Group, user_id: int, db: Session) -> User:
    target = db.get(User, user_id)
    if target is None:
        raise errors.not_found("找不到這個帳號")
    if target.is_platform_admin or target.suspended_at is not None:
        raise errors.bad_request("這個帳號目前不能邀請")
    if crud.exists(GroupMember, {"group_id": group.id, "user_id": user_id}, db=db):
        raise errors.conflict("對方已經是活動成員")
    return target


def _consume(invite: GroupInvite, group: Group, me: User, db: Session) -> dict:
    _available_inviter(invite, group, db)
    now = datetime.now(timezone.utc)
    try:
        family.require_joinable(invite.status, _utc(invite.expires_at), now)
    except ValueError:
        raise errors.bad_request("邀請已使用、過期或取消，請重新取得邀請") from None
    if crud.exists(GroupMember, {"group_id": group.id, "user_id": me.id}, db=db):
        raise errors.conflict("你已經是活動成員")
    changed = db.execute(update(GroupInvite).where(
        GroupInvite.id == invite.id, GroupInvite.status == "pending", GroupInvite.expires_at > now,
    ).values(status="accepted", responded_at=now, invitee_id=me.id).execution_options(synchronize_session=False))
    if changed.rowcount != 1:
        db.rollback()
        raise errors.conflict("邀請已經使用，請重新取得邀請")
    db.add(GroupMember(group_id=group.id, user_id=me.id, independent=True))
    _audit(me, "join_group_invitation", group.id, db)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise errors.conflict("你已經是活動成員，請重新整理") from None
    return {"group": {"id": str(group.id), "name": group.name}, "status": "accepted"}


@router.get("/lookup", summary="用完整 email 找活動朋友")
@block_admin
def lookup_group_friend(me: User, groupId: str, email: str | None = None, db: Session = Depends(get_db)):
    """用完整 email 找活動朋友

    只有活動建立者可查完整 email；每帳號每分鐘至多十次，與家庭查找共用額度。
    回傳最少姓名／頭像與邀請狀態，不回傳家庭角色或財務資料。
    """
    group = _activity(_number(groupId), db, owner=me)
    _limit(me, "lookup_user", db)
    try:
        mail = password_reset.normalize_email(email)
    except ValueError:
        raise errors.bad_request("請輸入完整的 email") from None
    target = db.scalar(select(User).where(User.email == mail))
    if target is None:
        raise errors.not_found("找不到這個帳號")
    now = datetime.now(timezone.utc)
    if target.is_platform_admin or target.suspended_at is not None:
        status = "unavailable"
    elif crud.exists(GroupMember, {"group_id": group.id, "user_id": target.id}, db=db):
        status = "member"
    elif crud.exists(GroupInvite, {"group_id": group.id, "invitee_id": target.id,
                                   "status": "pending", "expires_at__gt": now}, db=db):
        status = "invited"
    else:
        status = "available"
    return {"user": {"id": str(target.id), "name": target.display_name,
                      "avatar": target.display_name[-1:], "avatarUrl": None}, "status": status}


@router.get("/invites", summary="我收到的活動邀請")
@block_admin
def list_received_group_invites(me: User, db: Session = Depends(get_db)):
    """我收到的活動邀請

    登入後僅回本人尚未回覆且尚可加入的活動邀請，不擴張家庭範圍。
    回傳 received 陣列，不包含邀請碼或雜湊。
    """
    now = datetime.now(timezone.utc)
    rows = list(db.scalars(select(GroupInvite).join(Group, GroupInvite.group_id == Group.id).join(
        User, GroupInvite.inviter_id == User.id,
    ).where(GroupInvite.invitee_id == me.id, GroupInvite.status == "pending", GroupInvite.expires_at > now,
            Group.removed_at.is_(None), Group.archived_at.is_(None), Group.settled_at.is_(None),
            Group.created_by == GroupInvite.inviter_id, User.suspended_at.is_(None), User.is_platform_admin.is_(False))
                          .order_by(GroupInvite.created_at.desc(), GroupInvite.id.desc()).limit(100)))
    return {"received": _metadata(rows, db)}


@router.post("/join", summary="使用邀請碼加入活動")
@block_admin
def join_group_by_code(body: GroupJoinIn, me: User, db: Session = Depends(get_db)):
    """使用邀請碼加入活動

    登入後提交 code，使用七天內有效且未使用的邀請碼；每分鐘限制十次嘗試。
    只新增該活動獨立成員資格，不修改家庭或角色；回傳 group 與 accepted 狀態。
    """
    _limit(me, "group_code_attempt", db)
    normalized = family.normalize_code(body.code)
    if len(normalized) != 8 or any(ch not in family.CODE_ALPHABET for ch in normalized):
        raise errors.bad_request("邀請碼格式不正確")
    invite = db.scalar(select(GroupInvite).where(GroupInvite.code_hash == family.hash_code(normalized)))
    if invite is None:
        raise errors.not_found("找不到有效的活動邀請碼")
    group = _activity(invite.group_id, db, lock=True)
    invite = db.scalar(select(GroupInvite).where(GroupInvite.id == invite.id).with_for_update()
                       .execution_options(populate_existing=True))
    return _consume(invite, group, me, db)


@router.post("/invites/{invite_id}/accept", summary="接受活動邀請")
@block_admin
def accept_group_invite(invite_id: str, me: User, db: Session = Depends(get_db)):
    """接受活動邀請

    只有被邀請本人能接受，家庭成員資格不是前提；邀請須有效且活動仍開放。
    回傳 group 與 accepted 狀態；僅增加活動成員資格。
    """
    invite = db.scalar(select(GroupInvite).where(GroupInvite.id == _number(invite_id), GroupInvite.invitee_id == me.id,
                                                GroupInvite.code_hash.is_(None)))
    if invite is None:
        raise errors.not_found("找不到這個活動邀請")
    group = _activity(invite.group_id, db, lock=True)
    invite = db.scalar(select(GroupInvite).where(GroupInvite.id == invite.id).with_for_update()
                       .execution_options(populate_existing=True))
    return _consume(invite, group, me, db)


@router.delete("/invites/{invite_id}", summary="婉拒收到的活動邀請")
@block_admin
def decline_group_invite(invite_id: str, me: User, db: Session = Depends(get_db)):
    """婉拒收到的活動邀請

    只有被邀請本人能婉拒尚未回覆的帳號邀請。
    回傳 id 與 declined 狀態，不影響既有家庭或活動。
    """
    invite = db.scalar(select(GroupInvite).where(GroupInvite.id == _number(invite_id), GroupInvite.invitee_id == me.id,
                                                GroupInvite.code_hash.is_(None)))
    if invite is None:
        raise errors.not_found("找不到這個活動邀請")
    _activity(invite.group_id, db, lock=True, open_only=False)
    invite = db.scalar(select(GroupInvite).where(GroupInvite.id == invite.id).with_for_update()
                       .execution_options(populate_existing=True))
    if invite.status != "pending":
        raise errors.conflict("邀請已經回覆或取消")
    invite.status = "declined"
    invite.responded_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": str(invite.id), "status": "declined"}


@router.get("/{gid}/invites", summary="活動建立者查看送出的邀請")
@block_admin
def list_sent_group_invites(gid: str, me: User, db: Session = Depends(get_db)):
    """活動建立者查看送出的邀請

    僅活動建立者可查看該活動未過期的待處理邀請。
    回傳 sent 陣列；明碼／雜湊不出現在清單。
    """
    group = _activity(_number(gid), db, owner=me, open_only=False)
    rows = list(db.scalars(select(GroupInvite).where(GroupInvite.group_id == group.id, GroupInvite.status == "pending",
                                                     GroupInvite.expires_at > datetime.now(timezone.utc))
                          .order_by(GroupInvite.created_at.desc(), GroupInvite.id.desc()).limit(100)))
    return {"sent": _metadata(rows, db)}


@router.post("/{gid}/invite-codes", status_code=201, summary="產生活動邀請碼")
@block_admin
def create_group_invite_code(gid: str, body: GroupInviteCodeIn, me: User, db: Session = Depends(get_db)):
    """產生活動邀請碼

    活動建立者提供用途 label，產生七天單次邀請碼；活動須仍開放。
    回傳 id、code、expiresAt、label、status，明碼只在此回應出現一次。
    """
    group = _activity(_number(gid), db, owner=me, lock=True)
    label = " ".join(body.label.split())
    if not label:
        raise errors.bad_request("請填寫邀請碼用途")
    now = datetime.now(timezone.utc)
    if crud.count(GroupInvite, {"group_id": group.id, "status": "pending", "expires_at__gt": now}, db=db) >= 100:
        raise errors.conflict("待處理邀請過多，請先取消不再使用的邀請")
    code = family.new_code()
    invite = GroupInvite(group_id=group.id, inviter_id=me.id, code_hash=family.hash_code(code), label=label,
                         expires_at=family.expires_at(now, days=7))
    db.add(invite)
    _audit(me, "create_group_invite_code", group.id, db)
    db.commit()
    return {"id": str(invite.id), "code": code, "expiresAt": _iso(invite.expires_at), "label": label, "status": "pending"}


@router.post("/{gid}/invites", status_code=201, summary="用帳號邀請活動朋友")
@block_admin
def send_group_invite(gid: str, body: GroupInviteIn, me: User, db: Session = Depends(get_db)):
    """用帳號邀請活動朋友

    活動建立者提供查到的 userId；可邀請其他家庭的使用者，須由對方明確接受。
    回傳 id 與 pending 狀態；不直接加入成員或改變家庭。
    """
    group = _activity(_number(gid), db, owner=me, lock=True)
    target = _target(group, _number(body.userId), db)
    now = datetime.now(timezone.utc)
    if crud.exists(GroupInvite, {"group_id": group.id, "invitee_id": target.id,
                                "status": "pending", "expires_at__gt": now}, db=db):
        raise errors.conflict("已經邀請過了，請等待對方回覆")
    invite = GroupInvite(group_id=group.id, inviter_id=me.id, invitee_id=target.id, expires_at=family.expires_at(now, days=7))
    db.add(invite)
    _audit(me, "send_group_invite", group.id, db)
    db.commit()
    return {"id": str(invite.id), "status": "pending"}


@router.delete("/{gid}/invites/{invite_id}", summary="取消活動邀請或邀請碼")
@block_admin
def cancel_group_invite(gid: str, invite_id: str, me: User, db: Session = Depends(get_db)):
    """取消活動邀請或邀請碼

    只有活動建立者可取消該活動尚未回覆的邀請。
    回傳 id 與 cancelled 狀態，取消後不能再接受或使用。
    """
    group = _activity(_number(gid), db, owner=me, lock=True, open_only=False)
    invite = db.scalar(select(GroupInvite).where(GroupInvite.id == _number(invite_id), GroupInvite.group_id == group.id)
                       .with_for_update().execution_options(populate_existing=True))
    if invite is None:
        raise errors.not_found("找不到這個活動邀請")
    if invite.status != "pending":
        raise errors.conflict("邀請已經回覆或取消")
    invite.status = "cancelled"
    invite.responded_at = datetime.now(timezone.utc)
    _audit(me, "cancel_group_invite", group.id, db)
    db.commit()
    return {"id": str(invite.id), "status": "cancelled"}
