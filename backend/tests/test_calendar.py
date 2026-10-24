"""Calendar isolation, one-tap shift semantics and timezone-aware reminders."""
from datetime import datetime,timedelta,timezone
import os
os.environ.setdefault('DATABASE_URL','sqlite://')
os.environ.setdefault('JWT_SECRET','calendar-test-secret-at-least-thirty-two-bytes')
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.toolkit import db
from app.toolkit.config import settings

@pytest.fixture()
def api(monkeypatch):
    previous=str(db.engine.url);monkeypatch.setattr(settings,'app_env','development');monkeypatch.setattr(settings,'require_email_verification',False);db.use_database('sqlite://');db.create_all()
    try:
        with TestClient(app) as client:yield client
    finally:db.drop_all();db.use_database(previous)

def account(api,name):
    r=api.post('/api/auth/register',json={'name':name,'email':name+'@example.test','password':'test1234'});assert r.status_code==201,r.text
    return {'Authorization':'Bearer '+r.json()['accessToken']}


def test_calendar_private_crud_and_strict_payloads(api):
    a=account(api,'calendar-a');b=account(api,'calendar-b');base='/api/lifestyle/calendar'
    assert api.get(base+'/events?start=2026-10-01&end=2026-10-31').status_code==401
    r=api.post(base+'/events',headers=a,json={'date':'2026-10-24','title':'家人聚餐','time':'18:30','reminderMinutes':30,'memo':'帶點心'});assert r.status_code==201,r.text
    row=r.json();assert row['startsAt'].startswith('2026-10-24T10:30');assert row['remindAt'].startswith('2026-10-24T10:00')
    path=base+'/events/'+str(row['id'])
    assert api.patch(path,headers=b,json={'title':'wrong account'}).status_code==404
    assert api.delete(path,headers=b).status_code==404
    assert api.get(base+'/events?start=2026-10-01&end=2026-10-31',headers=b).json()['items']==[]
    assert api.patch(path,headers=a,json={'time':None,'reminderMinutes':None,'date':'2026-10-25'}).json()['remindAt'] is None
    assert api.get(base+'/events?start=2026-10-25&end=2026-10-25',headers=a).json()['items'][0]['id']==row['id']
    assert api.patch(path,headers=a,json={'date':None}).status_code==422
    for patch in [{'date':'2026-02-30','title':'x'},{'date':'2026-10-24','title':'   '},{'date':'2026-10-24','title':'x','time':'25:10'},{'date':'2026-10-24','title':'x','reminderMinutes':True},{'date':'2026-10-24','title':'x','user_id':999}]:
        assert api.post(base+'/events',headers=a,json=patch).status_code==422
    assert api.get(base+'/events?start=2026-01-01&end=2026-12-31',headers=a).status_code==422
    assert api.delete(path,headers=a).status_code==204


def test_shift_one_tap_upsert_custom_markers_and_history_snapshot(api):
    a=account(api,'shift-a');b=account(api,'shift-b');base='/api/lifestyle/calendar'
    r=api.put(base+'/shifts/2026-10-24',headers=a,json={'markerKey':'early'});assert r.status_code==200,r.text
    first=r.json();assert first['title']=='早班' and first['kind']=='shift'
    changed=api.put(base+'/shifts/2026-10-24',headers=a,json={'markerKey':'late'}).json();assert changed['id']==first['id'] and changed['title']=='晚班'
    assert len(api.get(base+'/events?start=2026-10-01&end=2026-10-31',headers=a).json()['items'])==1
    custom=api.post(base+'/markers',headers=a,json={'name':'休假','icon':'🌿','color':'#23754c'}).json();mid=custom['key'].split(':')[1]
    assert api.put(base+'/shifts/2026-10-25',headers=b,json={'markerKey':custom['key']}).status_code==404
    assert api.put(base+'/markers/'+mid,headers=b,json={'name':'x','icon':'x','color':'#ffffff'}).status_code==404
    saved=api.put(base+'/shifts/2026-10-25',headers=a,json={'markerKey':custom['key']}).json();assert saved['marker']['icon']=='🌿'
    assert api.delete(base+'/markers/'+mid,headers=a).status_code==204
    rows=api.get(base+'/events?start=2026-10-01&end=2026-10-31',headers=a).json()['items'];assert next(row for row in rows if row['id']==saved['id'])['marker']['name']=='休假'
    override=api.put(base+'/markers/early',headers=a,json={'name':'晨班','icon':'◆','color':'#234567'});assert override.status_code==200,override.text
    assert api.put(base+'/shifts/2026-10-26',headers=a,json={'markerKey':'early'}).json()['title']=='晨班'
    assert api.put(base+'/shifts/2026-10-26',headers=b,json={'markerKey':'early'}).json()['title']=='早班'
    assert api.delete(base+'/markers/early',headers=a).status_code==204
    assert api.get(base+'/markers',headers=a).json()['items'][0]['name']=='早班'
    assert api.post(base+'/markers',headers=a,json={'name':'x','icon':'x','color':'red;url(javascript:x)'}).status_code==422


def test_reminders_are_due_owned_and_acknowledged_without_cross_account_effect(api):
    a=account(api,'reminder-a');b=account(api,'reminder-b');base='/api/lifestyle/calendar'
    assert api.put('/api/lifestyle/preferences',headers=a,json={'timezone':'UTC'}).status_code==200
    now=datetime.now(timezone.utc)-timedelta(minutes=1)
    r=api.post(base+'/events',headers=a,json={'date':now.date().isoformat(),'time':now.strftime('%H:%M'),'title':'提醒測試','reminderMinutes':0});assert r.status_code==201,r.text
    event=r.json();assert event['timezone']=='UTC'
    assert [row['id'] for row in api.get(base+'/reminders',headers=a).json()['items']]==[event['id']]
    assert api.get(base+'/reminders',headers=b).json()['items']==[]
    assert api.post(base+'/reminders/ack',headers=b,json={'ids':[event['id']]}).status_code==204
    assert len(api.get(base+'/reminders',headers=a).json()['items'])==1
    assert api.post(base+'/reminders/ack',headers=a,json={'ids':[True]}).status_code==422
    assert api.post(base+'/reminders/ack',headers=a,json={'ids':[event['id']]}).status_code==204
    assert api.get(base+'/reminders',headers=a).json()['items']==[]
    assert api.patch(base+'/events/'+str(event['id']),headers=a,json={'reminderMinutes':0}).status_code==200
    assert api.get(base+'/reminders',headers=a).json()['items']==[]
    assert api.patch(base+'/events/'+str(event['id']),headers=a,json={'reminderMinutes':5}).status_code==200
    assert len(api.get(base+'/reminders',headers=a).json()['items'])==1


def test_nonexistent_dst_local_time_is_rejected(api):
    h=account(api,'dst-calendar');api.put('/api/lifestyle/preferences',headers=h,json={'timezone':'America/New_York'})
    r=api.post('/api/lifestyle/calendar/events',headers=h,json={'date':'2026-03-08','time':'02:30','title':'invalid local time'});assert r.status_code==422,r.text
