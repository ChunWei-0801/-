"""Actual API/DB owner scopes, durable imports and explicit duplicate review."""
from uuid import uuid4
from datetime import date
from decimal import Decimal
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from app.models import Group, GroupMember, Transaction, Category
from app.models.transaction_details import BillingProfile, StatementImportBatch, TransactionDetails
from app.routers.ledger.statement_import import router
from app.toolkit import crud, db
from app.toolkit.config import settings
from tests.routes.conftest import user, login, ledger_of, categories, family_of, now

@pytest.fixture()
def client():
    original = str(db.engine.url)
    db.use_database('sqlite://');db.create_all()
    app = FastAPI();app.include_router(router, prefix='/api')
    with TestClient(app) as result: yield result
    db.drop_all();db.use_database(original)

def count(model):
    with db.SessionLocal() as session:return session.scalar(select(func.count()).select_from(model))

def setup():return user('owner@example.test', '自己'), categories()['餐飲']
def item(category, **changes):
    return {'rowIndex':2,'date':'2026-10-01','amount':'120.50','kind':'expense','cat':str(category.id),'merchant':'全家','note':'午餐',**changes}
def body(cat, *, confirm=False, **changes):
    result={'provider':'我的信用卡','paymentMethod':'credit_card','statementId':'a'*64,'items':[item(cat)],**changes}
    if confirm:result['idempotencyKey']=str(uuid4())
    return result

def test_preview_readonly_and_confirm_creates_private_group(client):
    me,cat=setup();friend=user('friend@example.test','朋友');shared=ledger_of(me,friend,name='共同旅行')
    value=body(cat,items=[item(cat,buyerTaxId='12345678')])
    r=client.post('/api/statement-import/preview',headers=login(me),json=value)
    assert r.status_code==200 and r.json()['importable']==1,r.text
    assert count(Group)==1 and count(Transaction)==0
    r=client.post('/api/statement-import/confirm',headers=login(me),json={**value,'idempotencyKey':str(uuid4())})
    assert r.status_code==200 and r.json()['createdCount']==1,r.text
    tx=crud.get(Transaction,int(r.json()['created'][0]['id']))
    assert tx.group_id!=shared.id and tx.user_id==me.id and tx.source=='import' and tx.amount==Decimal('120.50')
    details=crud.get(TransactionDetails,tx.id)
    assert details.buyer_tax_id=='12345678' and details.payment_method=='credit_card'
    assert [m.user_id for m in crud.find(GroupMember,{'group_id':tx.group_id})]==[me.id]

def test_idempotency_replay_and_cross_key_skip_and_external_conflict(client):
    me,cat=setup();value=body(cat,confirm=True,items=[item(cat,externalId='official-1')])
    first=client.post('/api/statement-import/confirm',headers=login(me),json=value)
    assert first.status_code==200,first.text
    again=client.post('/api/statement-import/confirm',headers=login(me),json=value)
    assert again.json()['replayed'] and again.json()['created']==first.json()['created']
    second=client.post('/api/statement-import/confirm',headers=login(me),json={**value,'idempotencyKey':str(uuid4())})
    assert second.json()['createdCount']==0 and second.json()['skippedCount']==1
    changed={**value,'items':[item(cat,externalId='official-1',amount='121.00')]}
    assert client.post('/api/statement-import/confirm',headers=login(me),json=changed).status_code==409
    assert client.post('/api/statement-import/confirm',headers=login(me),json={**changed,'idempotencyKey':str(uuid4())}).status_code==409
    assert count(Transaction)==1 and count(StatementImportBatch)==2

def test_same_file_row_changed_amount_conflicts(client):
    me,cat=setup();value=body(cat,confirm=True)
    assert client.post('/api/statement-import/confirm',headers=login(me),json=value).status_code==200
    changed={**value,'idempotencyKey':str(uuid4()),'items':[item(cat,amount='999.00')]}
    preview=client.post('/api/statement-import/preview',headers=login(me),json={k:v for k,v in changed.items() if k!='idempotencyKey'})
    assert preview.json()['items'][0]['identityConflict']
    assert client.post('/api/statement-import/confirm',headers=login(me),json=changed).status_code==409
    assert count(Transaction)==1

def test_identical_purchases_partial_selections_and_different_file(client):
    me,cat=setup();value=body(cat,confirm=True,items=[item(cat,rowIndex=7),item(cat,rowIndex=20)])
    r=client.post('/api/statement-import/confirm',headers=login(me),json=value)
    assert r.status_code==200 and r.json()['createdCount']==2,r.text
    partial={**value,'idempotencyKey':str(uuid4()),'items':[item(cat,rowIndex=20)]}
    r=client.post('/api/statement-import/confirm',headers=login(me),json=partial)
    assert r.status_code==200 and r.json()['skippedCount']==1,r.text
    alternate=body(cat,confirm=True,statementId='b'*64)
    assert client.post('/api/statement-import/confirm',headers=login(me),json=alternate).status_code==409
    alternate['items'][0]['allowPossibleDuplicate']=True
    assert client.post('/api/statement-import/confirm',headers=login(me),json=alternate).json()['createdCount']==1
    assert count(Transaction)==3

def test_no_source_id_is_only_possible_duplicate(client):
    me,cat=setup();value=body(cat,confirm=True,statementId=None)
    assert client.post('/api/statement-import/confirm',headers=login(me),json=value).status_code==200
    value['idempotencyKey']=str(uuid4())
    p=client.post('/api/statement-import/preview',headers=login(me),json={k:v for k,v in value.items() if k!='idempotencyKey'}).json()
    assert p['items'][0]['possibleDuplicate'] and not p['items'][0]['exactDuplicate']
    assert client.post('/api/statement-import/confirm',headers=login(me),json=value).status_code==409
    value['items'][0]['allowPossibleDuplicate']=True
    assert client.post('/api/statement-import/confirm',headers=login(me),json=value).json()['createdCount']==1

def test_manual_duplicate_is_owner_scoped(client):
    me,cat=setup();other=user('other@example.test','別人');g=ledger_of(me);otherg=ledger_of(other)
    attrs={'category_id':cat.id,'kind':'expense','amount':Decimal('120.50'),'occurred_on':date(2026,10,1),'merchant':'全家','source':'manual'}
    crud.save(Transaction,{'user_id':other.id,'group_id':otherg.id,**attrs})
    p=client.post('/api/statement-import/preview',headers=login(me),json=body(cat)).json()
    assert not p['items'][0]['possibleDuplicate'] and p['items'][0]['matchingTransactionIds']==[]
    tx=crud.save(Transaction,{'user_id':me.id,'group_id':g.id,**attrs})
    p=client.post('/api/statement-import/preview',headers=login(me),json=body(cat)).json()
    assert p['items'][0]['possibleDuplicate'] and p['items'][0]['matchingTransactionIds']==[str(tx.id)]

def test_scope_errors_roll_back_whole_batch(client):
    me,cat=setup();other=user('other@example.test','別人');theirs=ledger_of(other)
    value=body(cat,confirm=True,items=[item(cat),item(cat,rowIndex=3,groupId=str(theirs.id))])
    assert client.post('/api/statement-import/confirm',headers=login(me),json=value).status_code==404
    assert count(Transaction)==0 and count(Group)==1
    f=family_of((other,'parent'));wrong=crud.save(Category,{'name':'私有','kind':'expense','color':'cat-other','family_id':f.id})
    value=body(cat,confirm=True,items=[item(cat),item(cat,rowIndex=3,cat=str(wrong.id))])
    assert client.post('/api/statement-import/confirm',headers=login(me),json=value).status_code==400
    assert count(Transaction)==0 and count(TransactionDetails)==0 and count(StatementImportBatch)==0
    closed=ledger_of(me,archived_at=now())
    assert client.post('/api/statement-import/preview',headers=login(me),json=body(cat,items=[item(cat,groupId=str(closed.id))])).status_code==409

def test_billing_profile_private_default_clear_and_guards(client,monkeypatch):
    me,cat=setup();other=user('other@example.test','別人');admin=user('admin@example.test','管理員',is_platform_admin=True)
    assert client.get('/api/billing/profile').status_code==401
    assert client.get('/api/billing/profile',headers=login(admin)).status_code==403
    assert client.get('/api/billing/profile',headers=login(me)).json()=={'buyerTaxId':None,'companyName':''}
    assert count(BillingProfile)==0
    r=client.put('/api/billing/profile',headers=login(me),json={'buyerTaxId':'00000000','companyName':' 常用公司 '})
    assert r.status_code==200 and r.json()=={'buyerTaxId':'00000000','companyName':'常用公司'}
    assert client.get('/api/billing/profile',headers=login(other)).json()['buyerTaxId'] is None
    assert client.put('/api/billing/profile',headers=login(me),json={'buyerTaxId':None,'companyName':''}).json()=={'buyerTaxId':None,'companyName':''}
    monkeypatch.setattr(settings,'require_email_verification',True)
    assert client.post('/api/statement-import/preview',headers=login(me),json=body(cat)).status_code==403

@pytest.mark.parametrize('change',[
 {'amount':1.5},{'amount':'0'},{'amount':'1.001'},{'amount':'NaN'},{'amount':'-1'},
 {'date':'2026-02-30'},{'date':'2026-1-01'},{'kind':'transfer'},{'currency':'USD'},
 {'buyerTaxId':'１２３４５６７８'},{'buyerTaxId':'1234567'},{'buyerTaxId':'123456789'},
 {'cat':'9223372036854775808'},{'groupId':'0'},{'merchant':'evil\nrow'},{'externalId':'a'*161},
 {'rowIndex':True},{'allowPossibleDuplicate':'yes'},{'source':'manual'}])
def test_bad_rows_rejected_without_writes(client,change):
    me,cat=setup();r=client.post('/api/statement-import/confirm',headers=login(me),json=body(cat,confirm=True,items=[item(cat,**change)]))
    assert r.status_code==422,r.text
    assert count(Transaction)==0 and count(StatementImportBatch)==0

def test_limits_duplicate_indices_and_colliding_external_reference(client):
    me,cat=setup()
    assert client.post('/api/statement-import/preview',headers=login(me),json=body(cat,items=[item(cat,rowIndex=i) for i in range(501)])).status_code==422
    assert client.post('/api/statement-import/confirm',headers=login(me),json=body(cat,confirm=True,items=[item(cat,rowIndex=i) for i in range(201)])).status_code==422
    assert client.post('/api/statement-import/preview',headers=login(me),json=body(cat,items=[item(cat),item(cat)])).status_code==422
    rows=[item(cat,externalId='same'),item(cat,rowIndex=3,externalId='same',amount='99.00')]
    assert client.post('/api/statement-import/confirm',headers=login(me),json=body(cat,confirm=True,items=rows)).status_code==409
    assert count(Transaction)==0 and count(Group)==0


def test_large_preview_batches_duplicate_and_scope_reads(client):
    from sqlalchemy import event
    me,cat=setup();statements=[]
    def record(_connection,_cursor,statement,_params,_context,_many):
        if statement.lstrip().upper().startswith('SELECT'):statements.append(statement)
    event.listen(db.engine,'before_cursor_execute',record)
    try:
        rows=[item(cat,rowIndex=i,amount=str(i+1)+'.00') for i in range(500)]
        r=client.post('/api/statement-import/preview',headers=login(me),json=body(cat,items=rows))
    finally:event.remove(db.engine,'before_cursor_execute',record)
    assert r.status_code==200 and len(r.json()['items'])==500,r.text
    assert len(statements)<12,'Preview must batch duplicate lookups and repeated scope checks'
    assert count(Transaction)==0 and count(Group)==0
