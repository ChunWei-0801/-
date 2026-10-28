"""Resolve explicit activities or the owner's private income/expense ledger.

領域：記帳

An omitted destination must never select the first shared activity. The legacy
schema requires every transaction to reference a Group, so private entries use
an owner-only underlying group without exposing it as a selectable activity.
"""
from __future__ import annotations

from sqlalchemy import select

from app.models import Group, GroupMember, User
from app.toolkit import errors


def private_group(db, me, *, create=False, lock=False):
    # Serialize first-use creation across manual, NLP and statement imports.
    # Caller owns the transaction; never commit a new group independently.
    if create:
        db.scalar(select(User).where(User.id == me.id).with_for_update())
    other_members = select(GroupMember.group_id).where(GroupMember.user_id != me.id)
    query = select(Group).where(
        Group.created_by == me.id, Group.name.in_(("個人帳本", "收支明細")),
        Group.kind == "standing",
        Group.id.in_(select(GroupMember.group_id).where(GroupMember.user_id == me.id)),
        Group.removed_at.is_(None), Group.archived_at.is_(None), Group.settled_at.is_(None),
        ~Group.id.in_(other_members),
    ).order_by(Group.id)
    if lock:
        query = query.with_for_update()
    group = db.scalars(query).first()
    if group is None and create:
        group = Group(name="收支明細", kind="standing", created_by=me.id, family_id=None)
        db.add(group)
        db.flush()
        db.add(GroupMember(group_id=group.id, user_id=me.id))
        db.flush()
    return group


def write_group(db, me, group_id, *, create=False, lock=False):
    if not group_id:
        return private_group(db, me, create=create, lock=lock)
    value = int(str(group_id)) if str(group_id).isdigit() else 0
    query = select(Group).join(GroupMember, GroupMember.group_id == Group.id).where(
        Group.id == value, GroupMember.user_id == me.id, Group.removed_at.is_(None))
    if lock:
        query = query.with_for_update()
    group = db.scalar(query)
    if group is None:
        raise errors.not_found("找不到這個活動")
    if group.settled_at is not None or group.archived_at is not None:
        raise errors.conflict("活動已結算或封存，請選擇可記帳的活動")
    return group
