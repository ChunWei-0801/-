# 領域：記帳
"""Owner-scoped reviewed imports: server-derived provenance and atomic idempotency.

Missing external IDs use the file SHA256 and original row index in the fingerprint. This
preserves two identical purchases and keeps partial selections stable. A changed
file layout may therefore need a human similarity decision, never a silent drop.
"""
from __future__ import annotations
import hashlib
import json
import re
import unicodedata
from datetime import date
from decimal import Decimal
from sqlalchemy import or_, select, tuple_
from sqlalchemy.exc import IntegrityError
from app.models import Category, Group, GroupMember, Guardianship, Notification, Transaction, User
from app.models.transaction_details import BillingProfile, StatementImportBatch, TransactionDetails
from app.schemas.statement_import import StatementConfirmIn, StatementPreviewIn
from app.services.transaction_destination import write_group as _group
from app.toolkit import errors, notify
from app.models._types import utcnow

PAYMENT_METHODS = ('cash', 'credit_card', 'bank_transfer', 'jkopay', 'line_pay', 'easycard', 'other')


def _canonical(value):
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(',', ':'))


def _digest(value):
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _normal_text(value):
    return ' '.join(unicodedata.normalize('NFKC', value or '').casefold().split())


def fingerprint(provider, method, item, statement_id=None):
    identity = ['statement-v1', _normal_text(provider), method]
    if item.externalId:
        identity += ['reference', item.externalId]
    elif statement_id:
        identity += ['file-row', statement_id, item.rowIndex]
    else:
        return None  # Without a source reference, similarity is never proof of identity.
    return _digest(identity)


def _content_signature(item):
    return (str(item.occurred_on) if hasattr(item, 'occurred_on') else item.date,
            format(Decimal(item.amount), '.2f'), item.kind, _normal_text(item.merchant))


def save_transaction_details(db, tx, *, payment_method=None, buyer_tax_id=None):
    """Metadata-only update inside the caller's transaction; preserves provenance."""
    if payment_method not in (None, '', *PAYMENT_METHODS):
        raise errors.unprocessable('不支援的付款方式')
    if buyer_tax_id not in (None, '') and not re.fullmatch(r'[0-9]{8}', str(buyer_tax_id)):
        raise errors.unprocessable('買方統一編號請填8碼數字')
    value = db.get(TransactionDetails, tx.id)
    if value is None and not payment_method and not buyer_tax_id:
        return None
    if value is None:
        value = TransactionDetails(transaction_id=tx.id, user_id=tx.user_id)
        db.add(value)
    if value.user_id != tx.user_id:
        raise errors.conflict('付款資料與明細不一致')
    value.payment_method = payment_method or None
    value.buyer_tax_id = buyer_tax_id or None
    return value


def transaction_metadata(db, transaction_ids):
    ids = list(transaction_ids)
    if not ids:
        return {}
    return {str(row.transaction_id): {'paymentMethod': row.payment_method or '',
                                     'buyerTaxId': row.buyer_tax_id or ''}
            for row in db.scalars(select(TransactionDetails).where(TransactionDetails.transaction_id.in_(ids)))}


def billing_profile(db, me):
    value = db.get(BillingProfile, me.id)
    return {'buyerTaxId': value.buyer_tax_id if value else None,
            'companyName': value.company_name or '' if value else ''}


def _category(db, me, item, *, required):
    if not item.cat:
        if required:
            raise errors.unprocessable('每筆匯入明細都必須選擇分類')
        return None
    category = db.scalar(select(Category).where(
        Category.id == int(item.cat),
        or_(Category.family_id.is_(None), Category.family_id == me.family_id)))
    if category is None:
        raise errors.bad_request('找不到這個分類')
    if category.kind != item.kind:
        raise errors.bad_request('分類與這筆的收支方向不一致')
    return category


def _candidate_key(item):
    return (date.fromisoformat(item.date), Decimal(item.amount), item.kind)


def _similarity_candidates(db, me, items):
    # One bounded tuple query instead of one round trip per statement row.
    keys = {_candidate_key(item) for item in items}
    candidates = {key: [] for key in keys}
    query = select(Transaction).where(Transaction.user_id == me.id,
        tuple_(Transaction.occurred_on, Transaction.amount, Transaction.kind).in_(list(keys)))
    for tx in db.scalars(query):
        candidates[(tx.occurred_on, tx.amount, tx.kind)].append(tx)
    return candidates


def preview_import(db, me, body: StatementPreviewIn, *, require_categories=False, lock=False):
    """Validate scopes without inserts; exact and possible duplicates stay distinct."""
    candidates = _similarity_candidates(db, me, body.items)
    keys = [fingerprint(body.provider, item.paymentMethod or body.paymentMethod, item, body.statementId) for item in body.items]
    existing = {row.fingerprint: row for row in db.scalars(select(TransactionDetails).where(
        TransactionDetails.user_id == me.id, TransactionDetails.fingerprint.in_([key for key in keys if key])))}
    seen, checked_categories, checked_groups = {}, set(), set()
    results = []
    for item, key in zip(body.items, keys):
        category_key = (item.cat, item.kind)
        if category_key not in checked_categories:
            _category(db, me, item, required=require_categories)
            checked_categories.add(category_key)
        if item.groupId not in checked_groups:
            _group(db, me, item.groupId, create=False, lock=lock)
            checked_groups.add(item.groupId)
        exact = existing.get(key)
        repeated = key is not None and key in seen
        existing_transaction = db.get(Transaction, exact.transaction_id) if exact is not None else None
        identity_conflict = bool(exact is not None and existing_transaction is not None
                                 and _content_signature(existing_transaction) != _content_signature(item))
        if repeated and seen[key][1] != _content_signature(item):
            identity_conflict = True
        matches = [str(tx.id) for tx in candidates[_candidate_key(item)]
                   if _normal_text(tx.merchant) == _normal_text(item.merchant)]
        possible = bool(matches) and exact is None
        payload = item.model_dump(mode='json')
        payload['amount'] = format(Decimal(item.amount), '.2f')
        payload['paymentMethod'] = item.paymentMethod or body.paymentMethod
        payload.update({'exactDuplicate': exact is not None or repeated,
                        'possibleDuplicate': possible, 'identityConflict': identity_conflict,
                        'matchingTransactionIds': matches,
                        'requiresCategory': not bool(item.cat),
                        'eligible': exact is None and not repeated and not identity_conflict and bool(item.cat)
                                    and (not possible or item.allowPossibleDuplicate)})
        if exact is not None:
            payload['duplicateTransactionId'] = str(exact.transaction_id)
        elif repeated:
            payload['duplicateRowIndex'] = seen[key][0]
        if key is not None:
            seen.setdefault(key, (item.rowIndex, _content_signature(item)))
        results.append(payload)
    return {'items': results, 'total': len(results),
            'exactDuplicates': sum(row['exactDuplicate'] for row in results),
            'possibleDuplicates': sum(row['possibleDuplicate'] for row in results),
            'importable': sum(row['eligible'] for row in results)}


def _notifications(db, me, transaction, guardians, members):
    for user_id, reason in notify.recipients_for(transaction, guardians, members):
        db.add(Notification(recipient_id=user_id, actor_id=me.id, transaction_id=transaction.id,
                            type='ward_transaction' if reason == notify.GUARDIAN else 'group_transaction',
                            payload_json={'reason': reason}))


def confirm_import(db, me, body: StatementConfirmIn):
    # Serialize independent imports for this owner. The DB uniqueness constraints
    # are the final guard; SQLite tests omit row locking but retain uniqueness.
    db.scalar(select(User).where(User.id == me.id).with_for_update())
    key = str(body.idempotencyKey)
    payload_hash = _digest(body.model_dump(mode='json', exclude={'idempotencyKey'}))
    old = db.scalar(select(StatementImportBatch).where(
        StatementImportBatch.user_id == me.id, StatementImportBatch.idempotency_key == key))
    if old is not None:
        if old.payload_sha256 != payload_hash:
            raise errors.conflict('這個匯入識別碼已用於不同內容，請重新核對')
        return {**old.result_json, 'replayed': True}
    preview = preview_import(db, me, body, require_categories=True, lock=True)
    if any(row['identityConflict'] for row in preview['items']):
        raise errors.conflict('同一來源交易識別碼的內容不同，請檢查原有明細，不會覆寫或新增')
    if any(row['possibleDuplicate'] and not row['allowPossibleDuplicate'] and not row['exactDuplicate']
           for row in preview['items']):
        raise errors.conflict('發現可能重複的明細，請先確認是否仍要匯入')
    result = {'created': [], 'skipped': [], 'createdCount': 0, 'skippedCount': 0, 'replayed': False}
    in_batch, groups, group_members = {}, {}, {}
    guardians = list(db.scalars(select(Guardianship).where(Guardianship.ward_id == me.id,
                                                         Guardianship.ended_at.is_(None))))
    try:
        for item, reviewed in zip(body.items, preview['items']):
            row_key = fingerprint(body.provider, item.paymentMethod or body.paymentMethod, item, body.statementId)
            existing_id = reviewed.get('duplicateTransactionId') or (in_batch.get(row_key) if row_key is not None else None)
            if existing_id is not None:
                result['skipped'].append({'rowIndex': item.rowIndex, 'reason': 'exact_duplicate', 'id': str(existing_id)})
                continue
            if item.groupId not in groups:
                groups[item.groupId] = _group(db, me, item.groupId, create=True, lock=True)
            group = groups[item.groupId]
            transaction = Transaction(user_id=me.id, group_id=group.id, family_id=me.family_id,
                                      category_id=int(item.cat), kind=item.kind, amount=Decimal(item.amount),
                                      occurred_on=date.fromisoformat(item.date), merchant=item.merchant or None,
                                      note=item.note or None, source='import')
            db.add(transaction)
            db.flush()
            details = save_transaction_details(db, transaction,
                payment_method=item.paymentMethod or body.paymentMethod, buyer_tax_id=item.buyerTaxId)
            details.provider = body.provider
            details.external_id = item.externalId or None
            details.fingerprint = row_key
            if group.id not in group_members:
                group_members[group.id] = list(db.scalars(select(GroupMember).where(GroupMember.group_id == group.id)))
            _notifications(db, me, transaction, guardians, group_members[group.id])
            if row_key is not None:
                in_batch[row_key] = transaction.id
            result['created'].append({'rowIndex': item.rowIndex, 'id': str(transaction.id)})
        result['createdCount'], result['skippedCount'] = len(result['created']), len(result['skipped'])
        db.add(StatementImportBatch(user_id=me.id, idempotency_key=key,
                                   payload_sha256=payload_hash, result_json=result))
        db.commit()
    except IntegrityError:
        db.rollback()
        # A separate worker may have committed this exact idempotency key.
        old = db.scalar(select(StatementImportBatch).where(
            StatementImportBatch.user_id == me.id, StatementImportBatch.idempotency_key == key))
        if old is not None and old.payload_sha256 == payload_hash:
            return {**old.result_json, 'replayed': True}
        raise errors.conflict('匯入資料已更新，請重新檢查重複項目') from None
    except Exception:
        db.rollback()
        raise
    return result
