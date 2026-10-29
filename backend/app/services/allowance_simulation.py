"""Append-only educational records; never bank payments or real ledger entries.

領域：家庭

An existing audit row stores a private, namespaced simulation payload. The legacy
admin audit response only projects the outer ``note`` field, which remains empty.
Authorizing and locking the issuer serializes retries on PostgreSQL. No schema or
change to real allowances, transactions, balances or household totals is needed.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models import AuditLog, Guardianship, User
from app.schemas.allowance_simulation import IssueAllowanceSimulation
from app.toolkit import errors

ACTION = "allowance_simulation_issue"
PAGE_SIZE = 50


def _iso(value: datetime) -> str:
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _item(row: AuditLog, names: dict[int, str]) -> dict:
    detail = (row.meta_json or {}).get("simulation", {})
    return {"id": str(row.id), "guardianId": str(row.actor_id), "wardId": str(row.target_id),
            "guardianName": names.get(row.actor_id, "原發放者"),
            "wardName": names.get(row.target_id, "原收款者"),
            "amount": str(detail.get("amount", "")), "note": str(detail.get("note", "")),
            "createdAt": _iso(row.created_at)}


def _names(db: Session, rows: list[AuditLog]) -> dict[int, str]:
    ids = {value for row in rows for value in (row.actor_id, row.target_id) if value is not None}
    return dict(db.execute(select(User.id, User.display_name).where(User.id.in_(ids))).all()) if ids else {}


def listing(db: Session, me: User, before_id: int | None = None) -> dict:
    # Only the two participants may view the records, even after a relationship
    # ends. Sharing a family, activity or summary grant never grants this access.
    query = select(AuditLog).where(AuditLog.action == ACTION, AuditLog.target_type == "user",
                                  or_(AuditLog.actor_id == me.id, AuditLog.target_id == me.id))
    if before_id is not None:
        query = query.where(AuditLog.id < before_id)
    rows = list(db.scalars(query.order_by(AuditLog.id.desc()).limit(PAGE_SIZE + 1)))
    more = len(rows) > PAGE_SIZE
    rows = rows[:PAGE_SIZE]
    recipients_query = (select(User.id, User.display_name).join(Guardianship, Guardianship.ward_id == User.id)
                        .where(Guardianship.guardian_id == me.id, Guardianship.ended_at.is_(None),
                               User.suspended_at.is_(None), User.id != me.id)
                        .distinct().order_by(User.id).limit(101))
    recipients = list(db.execute(recipients_query))
    names = _names(db, rows)
    return {"simulation": True,
            "recipients": [{"id": str(uid), "name": name} for uid, name in recipients[:100]],
            "recipientsTruncated": len(recipients) > 100,
            "items": [_item(row, names) for row in rows],
            "truncated": more, "nextBeforeId": str(rows[-1].id) if more and rows else None}


def issue(db: Session, me: User, body: IssueAllowanceSimulation) -> dict:
    # Every writer locks the same existing owner row before checking the JSON key.
    # READ COMMITTED sees a preceding request's committed audit row after waiting.
    owner = db.scalar(select(User).where(User.id == me.id).with_for_update().execution_options(populate_existing=True))
    if owner is None or owner.suspended_at is not None:
        raise errors.forbidden("目前無法使用模擬零用錢")
    expected = {"key": str(body.idempotencyKey), "amount": str(body.amount), "note": body.note}
    previous = db.scalar(select(AuditLog).where(
        AuditLog.actor_id == me.id, AuditLog.action == ACTION, AuditLog.target_type == "user",
        AuditLog.meta_json["simulation"]["key"].as_string() == expected["key"]))
    if previous is not None:
        if previous.target_id != int(body.wardId) or (previous.meta_json or {}).get("simulation") != expected:
            raise errors.conflict("這次操作編號已使用，請重新確認發放內容")
        return {"simulation": True, "item": _item(previous, _names(db, [previous])), "replayed": True}

    # Lock the relationship as well: a concurrent revocation is serialized with
    # this new issuance, rather than trusting a previously loaded recipient list.
    relation = db.scalar(select(Guardianship).where(
        Guardianship.guardian_id == me.id, Guardianship.ward_id == int(body.wardId),
        Guardianship.ended_at.is_(None)).order_by(Guardianship.id).with_for_update())
    recipient = db.get(User, int(body.wardId)) if relation is not None else None
    if recipient is None or recipient.suspended_at is not None or recipient.id == me.id:
        raise errors.forbidden("只能發放給目前由你照看的成員，請先確認家庭監管關係")

    row = AuditLog(actor_id=me.id, action=ACTION, target_type="user", target_id=recipient.id,
                   meta_json={"simulation": expected})
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"simulation": True, "item": _item(row, {me.id: me.display_name, recipient.id: recipient.display_name}),
            "replayed": False}
