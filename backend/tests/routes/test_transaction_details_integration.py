"""Exercise actual manual, patch and search handlers rather than teaching examples."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.toolkit import db, crud
from app.models.transaction_details import TransactionDetails
from app.routers.ledger.transactions import router
from tests.routes.conftest import user, login, ledger_of, categories, spend, now

@pytest.fixture()
def client():
    original = str(db.engine.url)
    db.use_database('sqlite://'); db.create_all()
    app = FastAPI(); app.include_router(router, prefix='/api')
    with TestClient(app) as c: yield c
    db.drop_all(); db.use_database(original)

def setup():
    owner = user('metadata-owner@example.test', '自己')
    category = categories()['餐飲']; group = ledger_of(owner)
    payload = dict(date='2026-10-01', amount=65, kind='expense', cat=str(category.id), groupId=str(group.id), merchant='早餐店')
    return owner, category, group, payload

def test_manual_metadata_roundtrip_partial_update_clear_and_search(client):
    owner, cat, group, payload = setup(); headers = login(owner)
    r = client.post('/api/transactions', headers=headers, json={**payload, 'buyerTaxId':'00123456', 'paymentMethod':'credit_card'})
    assert r.status_code == 201, r.text
    tx = r.json(); assert tx['buyerTaxId'] == '00123456' and tx['paymentMethod'] == 'credit_card'
    result = client.get('/api/transactions?q=00123456', headers=headers).json()
    assert [v['id'] for v in result['transactions']] == [tx['id']]
    r = client.patch('/api/transactions/'+tx['id'], headers=headers, json={'buyerTaxId':'87654321'})
    assert r.status_code == 200, r.text
    assert r.json()['paymentMethod'] == 'credit_card' and r.json()['buyerTaxId'] == '87654321'
    r = client.patch('/api/transactions/'+tx['id'], headers=headers, json={'paymentMethod':None})
    assert r.status_code == 200 and r.json()['buyerTaxId'] == '87654321' and r.json()['paymentMethod'] == ''
    r = client.patch('/api/transactions/'+tx['id'], headers=headers, json={'buyerTaxId':None})
    assert r.status_code == 200 and r.json()['buyerTaxId'] == ''
    assert client.get('/api/transactions?q=87654321',headers=headers).json()['total'] == 0

@pytest.mark.parametrize('bad', ['123','１２３４５６７８','123456789','1e123456','<script>'])
def test_invalid_tax_never_creates_or_changes_a_record(client,bad):
    owner,cat,group,payload=setup();headers=login(owner)
    assert client.post('/api/transactions',headers=headers,json={**payload,'buyerTaxId':bad}).status_code==422
    tx=spend(owner,group,cat,65)
    assert client.patch('/api/transactions/'+str(tx.id),headers=headers,json={'buyerTaxId':bad}).status_code==422
    assert crud.get(TransactionDetails,tx.id) is None

def test_metadata_guard_settlement_and_provenance(client):
    owner,cat,group,payload=setup();other=user('metadata-other@example.test','別人');tx=spend(owner,group,cat,65)
    crud.save(TransactionDetails,dict(transaction_id=tx.id,user_id=owner.id,provider='Credit',external_id='source-1',fingerprint='f'*64,payment_method='credit_card'),upsert=True)
    path='/api/transactions/'+str(tx.id)
    assert client.patch(path,headers=login(other),json={'buyerTaxId':'12345678'}).status_code in (403,404)
    assert client.get('/api/transactions?q=12345678',headers=login(other)).json()['total']==0
    r=client.patch(path,headers=login(owner),json={'buyerTaxId':'12345678'});assert r.status_code==200,r.text
    detail=crud.get(TransactionDetails,tx.id);assert detail.external_id=='source-1' and detail.fingerprint=='f'*64
    crud.save(type(group),{'id':group.id,'settled_at':now()})
    assert client.patch(path,headers=login(owner),json={'buyerTaxId':None}).status_code==409
    assert crud.get(TransactionDetails,tx.id).buyer_tax_id=='12345678'
