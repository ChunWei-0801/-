"""Local-only PostgreSQL concurrency proof for simulated allowance issuance.

Run ``python -m tests.check_allowance_postgres`` with
ALLOWANCE_TEST_DATABASE_URL (or SMOKING_TEST_DATABASE_URL in the shared CI job).
Only loopback / the CI ``db`` host is accepted. Each run creates and removes its
own random schema; no production service or existing table is read or modified.
"""
from __future__ import annotations

import json
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Event, Lock
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import delete, event, func, select, text, update
from sqlalchemy.engine import make_url

from app.models import Allowance, AuditLog, Guardianship, Transaction, User
from app.routers.allowance_simulation import router
from app.services.allowance_simulation import ACTION
from app.toolkit import crud, db, tokens
from app.toolkit.config import settings


def main() -> None:
    original = os.environ.get("ALLOWANCE_TEST_DATABASE_URL") or os.environ.get("SMOKING_TEST_DATABASE_URL")
    if not original:
        raise SystemExit("Set ALLOWANCE_TEST_DATABASE_URL to an isolated local PostgreSQL URL.")
    address = make_url(original)
    if not address.drivername.startswith("postgresql") or address.host not in {"localhost", "127.0.0.1", "::1", "db"}:
        raise SystemExit("This proof accepts only a local development PostgreSQL server.")
    if address.drivername == "postgresql":
        address = address.set(drivername="postgresql+psycopg")
    settings.app_env = "development"
    settings.require_email_verification = False
    schema = "allowance_concurrency_" + uuid4().hex
    root_engine = db.make_engine(address.render_as_string(hide_password=False))
    result = {"localOnly": True, "randomSchemaOnly": True, "productionConnected": False}
    with root_engine.begin() as connection:
        result["postgresMajor"] = int(connection.execute(text("SHOW server_version_num")).scalar_one()) // 10000
        connection.execute(text("CREATE SCHEMA " + schema))
    try:
        isolated = address.update_query_dict({"options": "-csearch_path=" + schema})
        db.use_database(isolated.render_as_string(hide_password=False))
        db.create_all()
        parent = crud.save(User, {"email": "parent@allowance-concurrency.test", "display_name": "隔離家長", "password_hash": "not-a-login-password", "theme": "paper"})
        child = crud.save(User, {"email": "child@allowance-concurrency.test", "display_name": "隔離孩子", "password_hash": "not-a-login-password", "theme": "paper"})
        relation = crud.save(Guardianship, {"guardian_id": parent.id, "ward_id": child.id, "created_by": parent.id})
        headers = {"Authorization": "Bearer " + tokens.make_access_token(parent.id)}
        app = FastAPI()
        app.include_router(router, prefix="/api")

        def send(payload):
            with TestClient(app) as client:
                response = client.post("/api/allowance-simulation", headers=headers, json=payload)
                return response.status_code, response.json()

        def clear():
            with db.SessionLocal() as session:
                session.execute(delete(AuditLog).where(AuditLog.action == ACTION))
                session.commit()

        def owner_race(different=False):
            clear()
            blocked, acquired, counter_lock = Event(), Event(), Lock()
            attempts = [0]
            locker = db.SessionLocal()
            locker.execute(select(User.id).where(User.id == parent.id).with_for_update()).scalar_one()

            def owner_lock(statement):
                return "FOR UPDATE" in statement.upper() and "users" in statement.lower()

            def before(conn, cursor, statement, parameters, context, executemany):
                if owner_lock(statement):
                    with counter_lock:
                        attempts[0] += 1
                        if attempts[0] >= 2:
                            blocked.set()

            def after(conn, cursor, statement, parameters, context, executemany):
                if owner_lock(statement):
                    acquired.set()

            event.listen(db.engine, "before_cursor_execute", before)
            event.listen(db.engine, "after_cursor_execute", after)
            payload = {"wardId": str(child.id), "amount": 200, "note": "隔離教學模擬", "idempotencyKey": str(uuid4())}
            try:
                with ThreadPoolExecutor(max_workers=2) as pool:
                    jobs = [pool.submit(send, payload), pool.submit(send, {**payload, "amount": 201 if different else 200})]
                    try:
                        assert blocked.wait(12), "Both requests must attempt the issuer's row lock"
                        assert not acquired.is_set(), "A request bypassed the held issuer row lock"
                        assert not any(job.done() for job in jobs), "A request bypassed issuer serialization"
                    finally:
                        locker.rollback()
                        locker.close()
                    responses = [job.result(timeout=20) for job in jobs]
            finally:
                event.remove(db.engine, "before_cursor_execute", before)
                event.remove(db.engine, "after_cursor_execute", after)
                locker.close()
            assert sorted(status for status, _ in responses) == ([201, 409] if different else [201, 201]), responses
            with db.SessionLocal() as session:
                assert session.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == ACTION)) == 1
            if not different:
                assert responses[0][1]["item"]["id"] == responses[1][1]["item"]["id"]
                assert {body["replayed"] for _, body in responses} == {False, True}
            return True

        result["sameIssuerSameKeySerializedAndReplayedOnce"] = owner_race()
        result["sameKeyDifferentPayloadConflictsAfterSerialization"] = owner_race(different=True)

        # A revocation commits while issuance waits at the actual relationship
        # row lock. PostgreSQL rechecks ended_at after waking and denies issuance.
        clear()
        blocked, acquired = Event(), Event()
        locker = db.SessionLocal()
        locker.execute(update(Guardianship).where(Guardianship.id == relation.id).values(ended_at=datetime.now(timezone.utc)))

        def relation_lock(statement):
            return "FOR UPDATE" in statement.upper() and "guardianships" in statement.lower()

        def before_relation(conn, cursor, statement, parameters, context, executemany):
            if relation_lock(statement):
                blocked.set()

        def after_relation(conn, cursor, statement, parameters, context, executemany):
            if relation_lock(statement):
                acquired.set()

        event.listen(db.engine, "before_cursor_execute", before_relation)
        event.listen(db.engine, "after_cursor_execute", after_relation)
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                job = pool.submit(send, {"wardId": str(child.id), "amount": 200, "idempotencyKey": str(uuid4())})
                try:
                    assert blocked.wait(12), "Issuance did not attempt the held relationship lock"
                    assert not acquired.is_set() and not job.done(), "Issuance bypassed the relationship row lock"
                finally:
                    locker.commit()
                    locker.close()
                status, _ = job.result(timeout=20)
                assert status == 403, status
        finally:
            event.remove(db.engine, "before_cursor_execute", before_relation)
            event.remove(db.engine, "after_cursor_execute", after_relation)
            locker.close()
        result["concurrentRelationshipRevocationPreventsNewIssuance"] = True
        with db.SessionLocal() as session:
            assert session.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == ACTION)) == 0
            assert session.scalar(select(func.count()).select_from(Transaction)) == 0
            assert session.scalar(select(func.count()).select_from(Allowance)) == 0
        result["realTransactionsAndAllowancesUnchanged"] = True
        result["verified"] = True
    finally:
        db.engine.dispose()
        with root_engine.begin() as connection:
            connection.execute(text("DROP SCHEMA " + schema + " CASCADE"))
        root_engine.dispose()
    result["temporarySchemaRemoved"] = True
    print(json.dumps(result))


if __name__ == "__main__":
    main()
