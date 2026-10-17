"""Public email links use explicit settings or Render's trusted runtime URL."""

import os

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("JWT_SECRET", "config-public-url-test-secret-longer-than-32-bytes")

from app.toolkit.config import Settings


def configuration(**overrides):
    return Settings(_env_file=None, database_url="sqlite://",
                    jwt_secret="config-public-url-test-secret-longer-than-32-bytes", **overrides)


def test_explicit_public_url_takes_priority_over_render(monkeypatch):
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://fambudget-recovery.onrender.com")
    monkeypatch.setenv("APP_BASE_URL", "https://budget.example.com")
    assert configuration().app_base_url == "https://budget.example.com"
    assert configuration(app_base_url="https://override.example.com").app_base_url == "https://override.example.com"


def test_render_runtime_url_is_used_when_public_url_is_omitted(monkeypatch):
    monkeypatch.delenv("APP_BASE_URL", raising=False)
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://fambudget-recovery.onrender.com")
    assert configuration(app_env="production").app_base_url == "https://fambudget-recovery.onrender.com"


def test_development_keeps_localhost_default_without_render(monkeypatch):
    monkeypatch.delenv("APP_BASE_URL", raising=False)
    monkeypatch.delenv("RENDER_EXTERNAL_URL", raising=False)
    assert configuration(app_env="development").app_base_url == "http://localhost:5174"
