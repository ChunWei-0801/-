"""Local-only PostgreSQL proof that two writes cannot consume the same stock.

Run from backend with SMOKING_TEST_DATABASE_URL pointing to a local isolated
PostgreSQL service. This creates/removes its own random schema only; no production
host is accepted, and connection values are never printed.
"""
import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Event, Lock
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, select, text
from sqlalchemy.engine import make_url

from app.models import User
from app.models.lifestyle import SmokingEntry
from app.routers.lifestyle import router
from app.toolkit import crud, db, tokens
from app.toolkit.config import settings

settings.app_env = 'development'
settings.require_email_verification = False
original = os.environ.get('SMOKING_TEST_DATABASE_URL')
if not original:
    raise SystemExit('Set SMOKING_TEST_DATABASE_URL to an isolated local PostgreSQL URL.')
address = make_url(original)
if not address.drivername.startswith('postgresql') or address.host not in {'localhost', '127.0.0.1', '::1', 'db'}:
    raise SystemExit('This proof accepts only a local development PostgreSQL server.')
if address.drivername in {'postgresql', 'postgres'}:
    address = address.set(drivername='postgresql+psycopg')
original = address.render_as_string(hide_password=False)
schema = 'smoking_concurrency_' + uuid4().hex
root_engine = db.make_engine(original)
with root_engine.begin() as connection:
    connection.execute(text('CREATE SCHEMA ' + schema))
url = address.update_query_dict({'options': '-csearch_path=' + schema})
results = {'localOnly':True, 'randomSchemaOnly':True, 'productionConnected':False}
try:
    db.use_database(url.render_as_string(hide_password=False));db.create_all()
    user=crud.save(User,{'email':'smoking-concurrency@example.test','display_name':'隔離測試','password_hash':'not-a-login-password','theme':'paper'})
    headers={'Authorization':'Bearer '+tokens.make_access_token(user.id)}
    app=FastAPI();app.include_router(router,prefix='/api')

    def reset():
        with db.SessionLocal() as session:
            session.execute(delete(SmokingEntry).where(SmokingEntry.user_id==user.id))
            session.add(SmokingEntry(user_id=user.id,entry_date=date(2024,1,1),bought_packs=1,smoked_packs=0))
            session.commit()

    def request_one(spec):
        day,bought,smoked=spec
        with TestClient(app) as client:
            response=client.put('/api/lifestyle/smoking/'+day,headers=headers,json={'boughtPacks':bought,'smokedPacks':smoked})
            return response.status_code

    def race(specs):
        reset()
        blocked=Event();acquired=Event();guard=Lock();attempts=[0]
        # Hold exactly the owner's row. Both real HTTP requests must queue behind
        # this lock before either can read/validate and commit the stock change.
        locker=db.SessionLocal()
        locker.execute(select(User.id).where(User.id==user.id).with_for_update()).scalar_one()
        def is_owner_lock(statement):
            return 'FOR UPDATE' in statement.upper() and 'users' in statement.lower()
        def before(conn,cursor,statement,parameters,context,executemany):
            if is_owner_lock(statement):
                with guard:
                    attempts[0]+=1
                    if attempts[0]>=2:blocked.set()
        def after(conn,cursor,statement,parameters,context,executemany):
            if is_owner_lock(statement):acquired.set()
        event.listen(db.engine,'before_cursor_execute',before)
        event.listen(db.engine,'after_cursor_execute',after)
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                futures=[pool.submit(request_one,spec) for spec in specs]
                try:
                    assert blocked.wait(10),'Both requests did not attempt the owner row lock'
                    assert not acquired.is_set(),'A request passed a row lock held by another transaction'
                    assert not any(future.done() for future in futures),'A request bypassed owner serialization'
                finally:
                    locker.rollback();locker.close()
                statuses=[future.result(timeout=15) for future in futures]
                assert sorted(statuses)==[200,409],statuses
        finally:
            event.remove(db.engine,'before_cursor_execute',before)
            event.remove(db.engine,'after_cursor_execute',after)
            locker.close()
        with db.SessionLocal() as session:
            stock=0
            for row in session.scalars(select(SmokingEntry).where(SmokingEntry.user_id==user.id).order_by(SmokingEntry.entry_date)):
                stock+=row.bought_packs-row.smoked_packs
                assert stock>=0
            assert stock==0
        return True

    results['concurrentConsumptionOfLastPackSerialized']=race([('2024-01-02',0,1),('2024-01-03',0,1)])
    results['purchaseReductionAndConsumptionSerialized']=race([('2024-01-01',0,0),('2024-01-02',0,1)])
    with root_engine.connect() as connection:
        results['postgresMajor']=int(connection.execute(text('SHOW server_version_num')).scalar_one())//10000
    results['verified']=True
finally:
    db.engine.dispose()
    with root_engine.begin() as connection:
        connection.execute(text('DROP SCHEMA '+schema+' CASCADE'))
    root_engine.dispose()
results['temporarySchemaRemoved']=True
print(json.dumps(results))
