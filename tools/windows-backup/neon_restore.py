"""Restore an authenticated recent snapshot into an empty direct Neon endpoint.

Only the copied backup/key in a new local private vault are used. Credentials
arrive on bounded stdin, never argv or Docker configuration. No source server
is contacted and no website settings are changed.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

_shared_spec = importlib.util.spec_from_file_location("fambudget_windows_backup_shared", Path(__file__).with_name("windows_backup.py"))
shared = importlib.util.module_from_spec(_shared_spec)
_shared_spec.loader.exec_module(shared)

MAX_INPUT_BYTES = 16384
MAX_MANIFEST_BYTES = 1024 * 1024
REQUIRED_TABLES = frozenset({"users", "transactions", "transaction_photos", "alembic_version", "calendar_events", "calendar_markers"})
STAGES = frozenset({"input", "prerequisites", "input-files", "backup-authentication", "backup-validation", "target-connection", "target-empty-check", "target-restore", "cleanup", "report", "complete"})
CODES = frozenset({"OK", "INPUT_INVALID", "INPUT_TOO_LARGE", "TARGET_URL_INVALID", "TARGET_OPTIONS_UNSUPPORTED", "TARGET_POOLER_UNSUPPORTED", "TARGET_VERSION_UNSUPPORTED", "CLIENT_VERSION_UNSUPPORTED", "INPUT_FILES_INVALID", "VAULT_UNSAFE", "RESULT_ALREADY_EXISTS", "BACKUP_INVALID", "SOURCE_IDENTITY_MISMATCH", "BACKUP_TOO_OLD", "BACKUP_TIME_INVALID", "BACKUP_SCHEMA_UNSUPPORTED", "TARGET_NOT_EMPTY", "RESTORE_NOT_VERIFIED", "OPERATION_FAILED", "PRIVATE_CLEANUP_FAILED", "REPORT_WRITE_FAILED"})
EMPTY_QUERY = ("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
               "WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1")


class RestoreError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def read_config(stream) -> dict:
    payload = stream.read(MAX_INPUT_BYTES + 1)
    if len(payload) > MAX_INPUT_BYTES:
        raise RestoreError("INPUT_TOO_LARGE")
    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise RestoreError("INPUT_INVALID")
            result[key] = value
        return result
    try:
        config = json.loads(payload, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError):
        raise RestoreError("INPUT_INVALID") from None
    if not isinstance(config, dict) or set(config) != {"targetUrl"}:
        raise RestoreError("INPUT_INVALID")
    return config


def _controls(value: str) -> bool:
    return any(unicodedata.category(c) == "Cc" for c in value)


def normalize_target_url(config: dict) -> str:
    if not isinstance(config, dict) or set(config) != {"targetUrl"}:
        raise RestoreError("INPUT_INVALID")
    value = config["targetUrl"]
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > MAX_INPUT_BYTES:
        raise RestoreError("INPUT_INVALID")
    if _controls(value) or "#" in value or re.search(r"%(?![0-9a-fA-F]{2})", value):
        raise RestoreError("TARGET_URL_INVALID")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if (parsed.scheme not in {"postgres", "postgresql"} or parsed.netloc.count("@") != 1
                or (parsed.port is not None and parsed.port != 5432) or parsed.netloc.endswith(":") or not host.endswith(".neon.tech")
                or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host)
                or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", part) for part in host.split("."))):
            raise RestoreError("TARGET_URL_INVALID")
        if "-pooler" in host.split(".")[0]:
            raise RestoreError("TARGET_POOLER_UNSUPPORTED")
        components = (parsed.username or "", parsed.password or "", parsed.path[1:] if parsed.path.startswith("/") else "")
        if any(not re.fullmatch(r"(?:[A-Za-z0-9._~-]|%[0-9a-fA-F]{2})+", part) for part in components):
            raise RestoreError("TARGET_URL_INVALID")
        user, password, database = (unquote(part, encoding="utf-8", errors="strict") for part in components)
        if any(not part.strip() or _controls(part) for part in (user, password, database)):
            raise RestoreError("TARGET_URL_INVALID")
        options = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True, encoding="utf-8", errors="strict")
        names = [name for name, _ in options]
        if len(names) != len(set(names)) or set(names) - {"sslmode", "channel_binding", "connect_timeout"}:
            raise RestoreError("TARGET_OPTIONS_UNSUPPORTED")
        for name, item in options:
            if (name == "sslmode" and item not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}
                    or name == "channel_binding" and item not in {"disable", "prefer", "require"}
                    or name == "connect_timeout" and not re.fullmatch(r"[0-9]{1,3}", item)):
                raise RestoreError("TARGET_OPTIONS_UNSUPPORTED")
        authority = quote(user, safe="") + ":" + quote(password, safe="") + "@" + host + ":5432"
        query = urlencode({"sslmode": "verify-full", "sslrootcert": shared.SOURCE_CA, "channel_binding": "require", "connect_timeout": "15", "application_name": "fambudget-private-neon-restore"})
        return urlunsplit(("postgresql", authority, "/" + quote(database, safe=""), query, ""))
    except (ValueError, UnicodeError):
        raise RestoreError("TARGET_URL_INVALID") from None


@contextmanager
def _without_pg_environment():
    """Prevent libpq routing/service overrides for psycopg as well as pg_restore."""
    previous = {key: value for key, value in os.environ.items() if key.startswith("PG")}
    for key in previous:
        del os.environ[key]
    try:
        yield
    finally:
        for key in list(os.environ):
            if key.startswith("PG"):
                del os.environ[key]
        os.environ.update(previous)


def _directory(backup, path: Path) -> Path:
    path = path.absolute()
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise RestoreError("VAULT_UNSAFE")
    try:
        return backup._private_directory(path)
    except backup.BackupError:
        raise RestoreError("VAULT_UNSAFE") from None


def _input_file(path: Path, maximum: int | None = None):
    if path.is_symlink() or not path.is_file() or path.stat().st_uid != os.getuid():
        raise RestoreError("INPUT_FILES_INVALID")
    if maximum is not None and path.stat().st_size > maximum:
        raise RestoreError("INPUT_FILES_INVALID")
    path.chmod(0o600)


def _now():
    return datetime.now(timezone.utc)


def _validate_manifest(backup, manifest: dict) -> dict:
    expected = backup._pg_identity("postgresql://" + shared.EXPECTED_HOST + ":5432/" + shared.EXPECTED_DATABASE)
    if manifest.get("source_identity") != expected:
        raise RestoreError("SOURCE_IDENTITY_MISMATCH")
    stamp = manifest.get("created_at")
    try:
        if not isinstance(stamp, str) or len(stamp) > 64:
            raise ValueError
        created = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if created.tzinfo is None or created.utcoffset() is None or created > _now() + timedelta(minutes=5):
            raise ValueError
    except (ValueError, OverflowError):
        raise RestoreError("BACKUP_TIME_INVALID") from None
    if _now() - created > timedelta(hours=24):
        raise RestoreError("BACKUP_TOO_OLD")
    inventory = manifest.get("inventory")
    if not isinstance(inventory, dict):
        raise RestoreError("BACKUP_SCHEMA_UNSUPPORTED")
    tables = inventory.get("tables", {})
    if not isinstance(tables, dict) or not REQUIRED_TABLES <= set(tables):
        raise RestoreError("BACKUP_SCHEMA_UNSUPPORTED")
    for table in tables.values():
        if not isinstance(table, dict) or any(type(table.get(field)) is not int or table[field] < 0 for field in ("rows", "photo_blobs", "photo_bytes")):
            raise RestoreError("BACKUP_INVALID")
    if not isinstance(manifest.get("archive_sha256"), str) or not re.fullmatch(r"[0-9a-f]{64}", manifest["archive_sha256"]):
        raise RestoreError("BACKUP_INVALID")
    counts = backup._summary(manifest)
    return {"backupCreatedAt": created.astimezone(timezone.utc).isoformat(), "archiveSHA256": manifest["archive_sha256"],
            "tables": counts["tables"], "rows": counts["rows"], "photoBlobs": counts["photo_blobs"], "photoBytes": counts["photo_bytes"]}


def run_restore(config: dict, vault: Path = Path("/vault")) -> dict:
    report = {"schemaVersion": 1, "status": "failed", "code": "OPERATION_FAILED", "stage": "input", "restoreVerified": False, "plaintextRemoved": False}
    temporary = None
    copied_key = None
    result_file = None
    backup = None
    with _without_pg_environment():
        try:
            target = normalize_target_url(config)
            report["stage"] = "prerequisites"
            report["clientMajor"] = shared.preflight()
            if report["clientMajor"] != 18:
                raise RestoreError("CLIENT_VERSION_UNSUPPORTED")
            backup = shared.load_backup_module()
            report["stage"] = "input-files"
            vault = _directory(backup, vault)
            inputs = _directory(backup, vault / "input")
            keys = _directory(backup, vault / "key")
            temporary = _directory(backup, vault / "restore-temporary")
            results = _directory(backup, vault / "result")
            if any(temporary.iterdir()):
                raise RestoreError("VAULT_UNSAFE")
            if any(results.iterdir()):
                raise RestoreError("RESULT_ALREADY_EXISTS")
            result_file = results / "verification.json"
            manifest_path = inputs / "backup.json"
            candidate_key = keys / "backup.key"
            _input_file(candidate_key, 1024)
            copied_key = candidate_key
            _input_file(manifest_path, MAX_MANIFEST_BYTES)
            raw = json.loads(manifest_path.read_bytes())
            name = raw.get("archive") if isinstance(raw, dict) else None
            if not isinstance(name, str) or not re.fullmatch(r"postgresql-[0-9TZ]+-[0-9a-f]{8}\.enc", name):
                raise RestoreError("INPUT_FILES_INVALID")
            _input_file(inputs / name)
            key = backup._key(str(copied_key))
            report["stage"] = "backup-authentication"
            try:
                with tempfile.TemporaryDirectory(prefix=".neon-auth-", dir=temporary) as check:
                    manifest = backup._unseal(manifest_path, key, Path(check) / "authenticated.dump", "postgresql")
            except backup.BackupError:
                raise RestoreError("BACKUP_INVALID") from None
            report["stage"] = "backup-validation"
            report.update(_validate_manifest(backup, manifest))
            report["stage"] = "target-connection"
            with backup._pg_connect(target) as connection:
                connection.execute("SET TRANSACTION READ ONLY")
                report["targetMajor"] = int(connection.execute("SHOW server_version_num").fetchone()[0]) // 10000
                if report["targetMajor"] != 18:
                    raise RestoreError("TARGET_VERSION_UNSUPPORTED")
                report["stage"] = "target-empty-check"
                if connection.execute(EMPTY_QUERY).fetchone():
                    raise RestoreError("TARGET_NOT_EMPTY")
            report["stage"] = "target-restore"
            restored = backup.postgres_restore(manifest_path, target, key, temporary)
            if restored.get("verified") is not True or restored.get("inventory") != manifest["inventory"] or restored.get("archive_sha256") != manifest["archive_sha256"]:
                raise RestoreError("RESTORE_NOT_VERIFIED")
            report["restoreVerified"] = True
            report["status"] = "verified"
            report["code"] = "OK"
            report["stage"] = "complete"
        except RestoreError as error:
            report["code"] = error.code
        except BaseException:
            # Database/command errors may contain credentials or complete rows.
            report["code"] = "OPERATION_FAILED"
        finally:
            try:
                if copied_key is not None:
                    copied_key.unlink(missing_ok=True)
                report["plaintextRemoved"] = (temporary is not None and not any(temporary.iterdir())
                                               and copied_key is not None and not copied_key.exists())
            except BaseException:
                report["plaintextRemoved"] = False
            if not report["plaintextRemoved"] and report["restoreVerified"]:
                report.update(status="failed", stage="cleanup", code="PRIVATE_CLEANUP_FAILED")
            if result_file is not None and backup is not None:
                try:
                    backup._write_private(result_file, (json.dumps(report, ensure_ascii=True) + "\n").encode())
                except BaseException:
                    report.update(status="failed", stage="report", code="REPORT_WRITE_FAILED")
    return report


def main() -> int:
    os.umask(0o077)
    try:
        report = run_restore(read_config(sys.stdin.buffer))
    except BaseException as error:
        report = {"schemaVersion": 1, "status": "failed", "code": error.code if isinstance(error, RestoreError) else "INPUT_INVALID", "stage": "input", "restoreVerified": False, "plaintextRemoved": False}
    print(json.dumps(report, ensure_ascii=True))
    return 0 if report["status"] == "verified" and report["restoreVerified"] and report["plaintextRemoved"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
