"""Release checks for same-origin serving, database readiness and Render URLs."""
import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "development-test-secret-at-least-thirty-two-bytes")

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Category
from app.toolkit import db
from app.toolkit.config import Settings, settings


@pytest.fixture()
def isolated_database():
    original = str(db.engine.url)
    db.use_database("sqlite://")
    db.create_all()
    try:
        yield
    finally:
        db.drop_all()
        db.use_database(original)


def test_readiness_requires_initialized_categories(isolated_database):
    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/readyz").status_code == 503
        with db.session_scope() as session:
            session.add(Category(name="餐飲", kind="expense", color="cat-food"))
        assert client.get("/readyz").json() == {"status": "ready", "database": "ok"}


def test_same_origin_serves_app_and_keeps_swagger_routes():
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200 and "FamBudget" in response.text
        assert client.get("/docs").status_code == 200
        assert client.get("/docs/index.html").status_code == 200
        assert "/api/auth/login" in client.get("/openapi.json").json()["paths"]


@pytest.mark.parametrize("prefix", ["postgres://", "postgresql://", "postgresql+psycopg://"])
def test_provider_database_url_uses_the_installed_driver(prefix):
    config = Settings(database_url=prefix + "demo:demo@localhost/demo", jwt_secret="test-secret-long-enough-for-hmac-sha256")
    assert config.database_url == "postgresql+psycopg://demo:demo@localhost/demo"


def test_capabilities_does_not_expose_credentials(monkeypatch):
    monkeypatch.setattr(settings, "model_base_url", "https://example.org/model")
    monkeypatch.setattr(settings, "model_api_key", "test-model-secret")
    monkeypatch.setattr(settings, "brevo_api_key", "test-mail-secret")
    monkeypatch.setattr(settings, "mail_from", "test@example.org")
    response = TestClient(app).get("/capabilities")
    assert response.status_code == 200
    assert response.json()["model_configured"] is True
    assert response.json()["mail_configured"] is True
    assert "test-model-secret" not in response.text and "test-mail-secret" not in response.text
    assert "example.org" not in response.text


def test_sensitive_api_responses_cannot_be_cached():
    response = TestClient(app).get("/api/auth/me")
    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["x-content-type-options"] == "nosniff"
