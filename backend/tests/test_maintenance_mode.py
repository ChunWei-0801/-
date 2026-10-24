"""Freeze all business requests before routing during a database cutover."""
from unittest.mock import Mock

from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from app.main import app
from app.toolkit import db
from app.toolkit.config import Settings, settings


@pytest.mark.parametrize("method,path", [
    ("GET", "/api"), ("GET", "/api/auth/me"),
    ("GET", "/api/lifestyle/preferences"), ("GET", "/api/missing-route"),
    ("POST", "/api/auth/login"), ("POST", "/api/transactions"),
    ("PATCH", "/api/auth/me"), ("DELETE", "/api/transactions"),
    ("PUT", "/api/lifestyle/preferences"), ("OPTIONS", "/api/auth/me"),
    ("GET", "/%61pi/auth/me"), ("POST", "/api%2Ftransactions"),
])
def test_maintenance_blocks_before_router_dependencies_and_body_parsing(monkeypatch, method, path):
    router_calls = []
    async def forbidden_router(scope, receive, send):
        router_calls.append(scope["path"])
        raise AssertionError("business routing must never run during migration")

    database = Mock(side_effect=AssertionError("maintenance must not open a database"))
    monkeypatch.setattr(settings, "maintenance_mode", True)
    monkeypatch.setattr(db, "SessionLocal", database)
    # Exercise the real middleware stack but make entry to ANY router/dependency
    # fail. Invalid JSON also must not reach the normal FastAPI body parser.
    monkeypatch.setattr(app, "router", forbidden_router)
    monkeypatch.setattr(app, "middleware_stack", None)
    response = TestClient(app).request(method, path, content=b"{not valid json", headers={"Content-Type": "application/json"})

    assert response.status_code == 503
    assert response.json() == {"detail": "系統正在搬移資料，請稍後再試。", "code": "MAINTENANCE_MODE"}
    assert response.headers["Retry-After"] == "60"
    assert response.headers["X-FamBudget-Maintenance"] == "1"
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["Pragma"] == "no-cache"
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert router_calls == []
    database.assert_not_called()


def test_health_and_capabilities_remain_available_without_database_during_freeze(monkeypatch):
    monkeypatch.setattr(settings, "maintenance_mode", True)
    monkeypatch.setattr(settings, "jwt_secret", "synthetic-private-secret-should-not-be-returned")
    monkeypatch.setattr(settings, "database_url", "postgresql://synthetic-private-url")
    database = Mock(side_effect=AssertionError("status endpoints must not query the database"))
    monkeypatch.setattr(db, "SessionLocal", database)
    client = TestClient(app)

    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "fambudget-backend"}
    capability = client.get("/capabilities")
    assert capability.status_code == 200
    assert capability.json()["maintenance_mode"] is True
    assert capability.headers["Cache-Control"] == "no-store"
    assert "synthetic-private" not in capability.text
    readiness = client.get("/readyz")
    assert readiness.status_code == 503
    assert readiness.json() == {"status": "maintenance", "database": "not_checked"}
    assert readiness.headers["Retry-After"] == "60"
    assert readiness.headers["X-FamBudget-Maintenance"] == "1"
    assert readiness.headers["Cache-Control"] == "no-store"
    database.assert_not_called()


@pytest.mark.parametrize("mode", [False, True])
def test_only_business_api_is_frozen_and_disabled_mode_forwards_normally(monkeypatch, mode):
    calls = []
    async def normal_router(scope, receive, send):
        calls.append(scope["path"])
        await JSONResponse({"forwarded": scope["path"]}, status_code=206)(scope, receive, send)
    monkeypatch.setattr(settings, "maintenance_mode", mode)
    monkeypatch.setattr(app, "router", normal_router)
    monkeypatch.setattr(app, "middleware_stack", None)
    client = TestClient(app)

    for path in ("/", "/ai-test.html", "/apiculture", "/api-other"):
        response = client.get(path)
        assert response.status_code == 206
        assert response.json() == {"forwarded": path}
        assert "X-FamBudget-Maintenance" not in response.headers
    response = client.post("/api/auth/login", json={"email": "fixture@example.invalid"})
    if mode:
        assert response.status_code == 503
        assert "/api/auth/login" not in calls
    else:
        assert response.status_code == 206
        assert response.json() == {"forwarded": "/api/auth/login"}
        assert response.headers["Cache-Control"] == "no-store"
        assert "X-FamBudget-Maintenance" not in response.headers


def test_maintenance_mode_defaults_off_and_accepts_render_environment_flag(monkeypatch):
    values = {"database_url": "sqlite://", "jwt_secret": "isolated-config-test-secret-at-least-thirty-two-bytes", "_env_file": None}
    monkeypatch.delenv("MAINTENANCE_MODE", raising=False)
    assert Settings(**values).maintenance_mode is False
    for supplied, expected in (("true", True), ("false", False), ("1", True), ("0", False)):
        monkeypatch.setenv("MAINTENANCE_MODE", supplied)
        assert Settings(**values).maintenance_mode is expected
    monkeypatch.setenv("MAINTENANCE_MODE", "not-a-boolean")
    with pytest.raises(ValidationError):
        Settings(**values)


@pytest.mark.parametrize("url,expected", [
    ("postgresql://private_user:private_pass@ep-example.us-west-2.aws.neon.tech/private_db?sslmode=require", "neon"),
    ("postgres://private_user:private_pass@ep-example.us-west-2.aws.neon.tech/private_db", "neon"),
    ("postgresql+psycopg://private_user:private_pass@ep-example.us-west-2.aws.neon.tech/private_db", "neon"),
    ("postgresql://private_user:private_pass@dpg-example-a.oregon-postgres.render.com/private_db", "render"),
    ("postgresql://private_user:private_pass@dpg-example-a/private_db", "render"),
    ("postgresql://private_user:private_pass@db.example.invalid/private_db", "postgresql"),
    ("postgresql://private_user:private_pass@localhost/private_db", "postgresql"),
    ("sqlite://", "sqlite"), ("sqlite:///private_db.sqlite3", "sqlite"),
    ("sqlite+pysqlite:///:memory:", "sqlite"),
    ("postgresql://private_user:private_pass@evil-neon.tech/private_db", "postgresql"),
    ("postgresql://private_user:private_pass@ep-example.neon.tech.evil.invalid/private_db", "postgresql"),
    ("postgresql://private_user:private_pass@evilrender.com/private_db", "postgresql"),
    ("https://private_user:private_pass@ep-example.neon.tech/private_db", "unknown"),
    ("mysql://private_user:private_pass@db.example.invalid/private_db", "unknown"),
    ("not a URL containing private_user:private_pass", "unknown"),
    ("postgresql://private_user:private_pass@/private_db", "unknown"),
    ("postgresql://private_user:private_pass@[broken/private_db", "unknown"),
    ("postgresql://private_user:private_pass@ep-example.neon.tech:bad/private_db", "unknown"),
    ("\npostgresql://private_user:private_pass@ep-example.neon.tech/private_db", "unknown"),
    ("postgresql://private_user:private_pass@ep-example.neon.tech/private_db\n", "unknown"),
])
def test_database_provider_labels_parse_without_exposing_config_or_using_sql(monkeypatch, url, expected):
    config = Settings(database_url=url, jwt_secret="isolated-config-test-secret-at-least-thirty-two-bytes", _env_file=None)
    database = Mock(side_effect=AssertionError("provider labels are configuration-only"))
    monkeypatch.setattr(db, "SessionLocal", database)
    assert config.database_provider == expected
    database.assert_not_called()


@pytest.mark.parametrize("mode", [False, True])
@pytest.mark.parametrize("url,expected", [
    ("postgresql://hidden_user:hidden_pass@ep-hidden.us-west-2.aws.neon.tech/hidden_db", "neon"),
    ("postgresql://hidden_user:hidden_pass@dpg-hidden-a.oregon-postgres.render.com/hidden_db", "render"),
    ("sqlite:///hidden_db.sqlite3", "sqlite"),
    ("postgresql://hidden_user:hidden_pass@private.example.invalid/hidden_db", "postgresql"),
    ("postgresql://hidden_user:hidden_pass@[broken/hidden_db", "unknown"),
])
def test_capabilities_exposes_only_provider_label_in_either_mode(monkeypatch, mode, url, expected):
    monkeypatch.setattr(settings, "maintenance_mode", mode)
    monkeypatch.setattr(settings, "database_url", url)
    database = Mock(side_effect=AssertionError("capabilities must never query the database"))
    monkeypatch.setattr(db, "SessionLocal", database)
    response = TestClient(app).get("/capabilities")
    assert response.status_code == 200
    assert response.json()["database_provider"] == expected
    assert response.json()["maintenance_mode"] is mode
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    for secret in ("hidden_user", "hidden_pass", "hidden_db", "ep-hidden", "dpg-hidden", "example.invalid", "neon.tech", "render.com"):
        assert secret not in response.text
    database.assert_not_called()


@pytest.fixture(scope="module")
def backup_identity_function():
    """Compare against the real backup contract, rather than a duplicate hash."""
    import importlib.util
    from pathlib import Path
    path = Path(__file__).resolve().parents[1] / "tools" / "backup_restore.py"
    spec = importlib.util.spec_from_file_location("maintenance_backup_identity_contract", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module._pg_identity


@pytest.mark.parametrize("url", [
    "postgresql://hidden_user:hidden_pass@ep-hidden.us-west-2.aws.neon.tech/hidden_db",
    "postgres://hidden_user:hidden_pass@ep-hidden.us-west-2.aws.neon.tech:5432/hidden_db?sslmode=require",
    "postgresql+psycopg://hidden_user:hidden_pass@ep-hidden.us-west-2.aws.neon.tech/hidden_db?channel_binding=require",
    "postgresql://other_user:rotated_password@EP-HIDDEN.us-west-2.aws.neon.tech/hidden%5Fdb?connect_timeout=15",
    "postgresql://ep-hidden.us-west-2.aws.neon.tech/hidden_db?application_name=private_value",
])
def test_database_identity_matches_backup_contract_and_ignores_credentials_options(monkeypatch, backup_identity_function, url):
    database = Mock(side_effect=AssertionError("identity must not connect"))
    monkeypatch.setattr(db, "SessionLocal", database)
    config = Settings(database_url=url, jwt_secret="isolated-config-test-secret-at-least-thirty-two-bytes", _env_file=None)
    reference = "postgresql://ep-hidden.us-west-2.aws.neon.tech:5432/hidden_db"
    assert config.database_identity_sha256 == backup_identity_function(url) == backup_identity_function(reference)
    database.assert_not_called()


@pytest.mark.parametrize("changed", [
    "postgresql://ep-other.us-west-2.aws.neon.tech/hidden_db",
    "postgresql://ep-hidden.us-west-2.aws.neon.tech/another_db",
    "postgresql://ep-hidden.us-west-2.aws.neon.tech:5433/hidden_db",
])
def test_database_identity_distinguishes_host_database_and_port(backup_identity_function, changed):
    original = "postgresql://ep-hidden.us-west-2.aws.neon.tech/hidden_db"
    config = Settings(database_url=changed, jwt_secret="isolated-config-test-secret-at-least-thirty-two-bytes", _env_file=None)
    assert config.database_identity_sha256 == backup_identity_function(changed)
    assert config.database_identity_sha256 != backup_identity_function(original)


def test_database_identity_uses_decoded_database_path_and_ascii_json_contract(backup_identity_function):
    raw = "postgresql://fixture:secret@ep-example.neon.tech/家庭"
    encoded = "postgresql://another:rotated@ep-example.neon.tech/%E5%AE%B6%E5%BA%AD?sslmode=require"
    config = Settings(database_url=encoded, jwt_secret="isolated-config-test-secret-at-least-thirty-two-bytes", _env_file=None)
    assert config.database_identity_sha256 == backup_identity_function(encoded) == backup_identity_function(raw)


@pytest.mark.parametrize("url", [
    "sqlite://", "sqlite:///hidden_db.sqlite3", "sqlite+pysqlite:///:memory:",
    "https://hidden_user:hidden_pass@ep-hidden.neon.tech/hidden_db",
    "not a database URL", "postgresql://ep-hidden.neon.tech", "postgresql://ep-hidden.neon.tech/",
    "postgresql://hidden_user:hidden_pass@/hidden_db",
    "postgresql://hidden_user:hidden_pass@[broken/hidden_db",
    "postgresql://hidden_user:hidden_pass@ep-hidden.neon.tech:bad/hidden_db",
    "postgresql://hidden_user:hidden_pass@ep-hidden.neon.tech:0/hidden_db",
    "postgresql://hidden_user:hidden_pass@ep-hidden.neon.tech/hidden_db#fragment",
    "postgresql://hidden_user:hidden_pass@ep-hidden.neon.tech/%ZZ",
    "\npostgresql://hidden_user:hidden_pass@ep-hidden.neon.tech/hidden_db",
])
def test_database_identity_returns_none_for_nonpostgresql_or_malformed_config(monkeypatch, url):
    database = Mock(side_effect=AssertionError("invalid identity must not connect"))
    monkeypatch.setattr(db, "SessionLocal", database)
    config = Settings(database_url=url, jwt_secret="isolated-config-test-secret-at-least-thirty-two-bytes", _env_file=None)
    assert config.database_identity_sha256 is None
    database.assert_not_called()


@pytest.mark.parametrize("mode", [False, True])
def test_capabilities_identity_is_safe_and_available_without_database(monkeypatch, backup_identity_function, mode):
    url = "postgresql://hidden_user:hidden_pass@ep-hidden.neon.tech/hidden_db?application_name=hidden_query"
    monkeypatch.setattr(settings, "maintenance_mode", mode)
    monkeypatch.setattr(settings, "database_url", url)
    database = Mock(side_effect=AssertionError("binding endpoint must not connect"))
    monkeypatch.setattr(db, "SessionLocal", database)
    response = TestClient(app).get("/capabilities")
    assert response.status_code == 200
    assert response.json()["database_identity_sha256"] == backup_identity_function(url)
    assert response.headers["cache-control"] == "no-store"
    for secret in ("hidden_user", "hidden_pass", "ep-hidden", "hidden_db", "hidden_query", "neon.tech"):
        assert secret not in response.text
    database.assert_not_called()
