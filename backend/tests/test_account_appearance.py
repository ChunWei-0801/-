"""Account appearance survives login; photos are persistent and owner-only."""
import base64
from io import BytesIO
import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "appearance-tests-a-secret-longer-than-32-bytes")
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from app.main import app
from app.toolkit import db
from app.toolkit.config import settings


@pytest.fixture()
def api(monkeypatch):
    original = str(db.engine.url)
    monkeypatch.setattr(settings, "app_env", "development")
    monkeypatch.setattr(settings, "require_email_verification", False)
    db.use_database("sqlite://")
    db.create_all()
    try:
        with TestClient(app) as client:
            yield client
    finally:
        db.drop_all()
        db.use_database(original)


def account(api, name):
    r = api.post("/api/auth/register", json={"name": name, "email": name+"@example.test", "password": "test1234"})
    assert r.status_code == 201
    return {"Authorization": "Bearer "+r.json()["accessToken"]}


def photo():
    stream = BytesIO()
    Image.new("RGB", (2400, 600), "#176b5d").save(stream, "PNG")
    return "data:image/png;base64,"+base64.b64encode(stream.getvalue()).decode()


def test_preferences_survive_new_login(api):
    headers = account(api, "appearance")
    chosen = {"preset": "forest", "fit": "contain", "x": 25, "y": 75,
              "brightness": 82, "blur": 3, "overlay": 40}
    r = api.patch("/api/auth/me", headers=headers, json={"appearance": chosen, "language": "en", "theme": "sky"})
    assert r.status_code == 200, r.text
    login = api.post("/api/auth/login", json={"email": "appearance@example.test", "password": "test1234"})
    assert login.status_code == 200
    fresh = {"Authorization": "Bearer "+login.json()["accessToken"]}
    for user in (login.json()["user"], api.get("/api/auth/me", headers=fresh).json()["user"]):
        assert user["language"] == "en" and user["theme"] == "sky"
        assert user["appearance"]["preset"] == "forest" and user["appearance"]["y"] == 75
        assert user["appearance"]["updatedAt"]


def test_registration_returns_same_presentation_fields_as_profile(api):
    created = api.post("/api/auth/register", json={"name": "initial", "email": "initial@example.test", "password": "test1234"}).json()
    fresh = api.get("/api/auth/me", headers={"Authorization": "Bearer " + created["accessToken"]}).json()["user"]
    assert {key: created["user"][key] for key in ("appearance", "language", "appearanceImageUrl")} == {
        key: fresh[key] for key in ("appearance", "language", "appearanceImageUrl")
    }


def test_background_owner_only_raster_and_durable(api):
    owner, other = account(api, "owner"), account(api, "other")
    path = "/api/auth/me/appearance-image"
    assert api.post(path, headers=owner, json={"dataUrl": photo()}).status_code == 200
    assert api.get(path).status_code == 401 and api.get(path, headers=other).status_code == 404
    loaded = api.get(path, headers=owner)
    assert loaded.status_code == 200 and loaded.headers["content-type"] == "image/jpeg"
    assert loaded.headers["cache-control"] == "private, no-store"
    with Image.open(BytesIO(loaded.content)) as im:
        assert im.size == (1920, 480)
    assert api.get("/api/auth/me", headers=owner).json()["user"]["appearanceImageUrl"] == path
    assert api.delete(path, headers=owner).status_code == 200 and api.get(path, headers=owner).status_code == 404


def test_background_photo_changes_invalidate_other_device_versions(api):
    headers = account(api, "version")
    chosen = {"preset": "custom", "fit": "contain", "x": 25, "y": 75}
    saved = api.patch("/api/auth/me", headers=headers, json={"appearance": chosen}).json()["appearance"]
    upload = api.post("/api/auth/me/appearance-image", headers=headers, json={"dataUrl": photo()})
    assert upload.status_code == 200
    version = api.get("/api/auth/me", headers=headers).json()["user"]["appearance"]
    assert version["updatedAt"] != saved["updatedAt"]
    assert version["fit"] == "contain" and version["x"] == 25
    assert upload.json()["appearanceUpdatedAt"] == version["updatedAt"]
    assert api.delete("/api/auth/me/appearance-image", headers=headers).status_code == 200
    deleted = api.get("/api/auth/me", headers=headers).json()["user"]
    assert deleted["appearance"]["updatedAt"] != version["updatedAt"]
    assert deleted["appearanceImageUrl"] is None


@pytest.mark.parametrize("payload", [
    {"appearance": {"preset": "javascript:alert(1)"}}, {"appearance": {"blur": -1}},
    {"appearance": {"overlay": 101}}, {"appearance": {"url": "https://example.test/photo"}},
    {"appearance": {"photoStorage": "saved"}}, {"language": "unsupported"}, {"language": None},
])
def test_rejects_untrusted_preferences(api, payload):
    assert api.patch("/api/auth/me", headers=account(api, "invalid"), json=payload).status_code == 422


def test_disguised_image_does_not_replace_background(api):
    headers = account(api, "decode")
    path = "/api/auth/me/appearance-image"
    assert api.post(path, headers=headers, json={"dataUrl": photo()}).status_code == 200
    before = api.get(path, headers=headers).content
    fake = "data:image/png;base64,"+base64.b64encode(b"<svg onload='alert(1)'/>").decode()
    assert api.post(path, headers=headers, json={"dataUrl": fake}).status_code == 422
    assert api.get(path, headers=headers).content == before
