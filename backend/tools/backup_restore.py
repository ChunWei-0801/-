"""Private authenticated database backups, including every database-stored photo.

Run ``python backend/tools/backup_restore.py --help``. No application imports,
.env reads, source writes, destructive restore flags, or credentials in argv.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import secrets
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import parse_qsl, unquote, urlsplit
from uuid import UUID

FORMAT = "fambudget-private-backup-v1"
ITERATIONS = 200_000


class BackupError(RuntimeError):
    """An operation stopped before overwriting an existing database."""


def _private_directory(path: Path) -> Path:
    path = path.absolute()
    # Private data must never be placed anywhere inside a Git checkout.
    if path.is_symlink() or any(parent.joinpath(".git").is_file() or parent.joinpath(".git", "HEAD").is_file()
                                for parent in (path.resolve(), *path.resolve().parents)):
        raise BackupError("Choose a private directory outside every Git checkout")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not path.is_dir() or path.stat().st_uid != os.getuid():
        raise BackupError("The private directory must belong to the current user")
    path.chmod(0o700)
    return path.resolve()


def _write_private(path: Path, content: bytes) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as file:
        file.write(content)


def _key(key_file: str | None) -> bytes:
    if key_file:
        path = Path(key_file)
        if path.is_symlink() or path.stat().st_mode & 0o077:
            raise BackupError("Key files must have mode 600 or stricter")
        key = path.read_bytes()
    else:
        key = os.environ.get("BACKUP_PASSPHRASE", "").encode()
    if len(key) < 32:
        raise BackupError("Set BACKUP_PASSPHRASE or provide a private key file with at least 32 bytes")
    return key


def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _cell(value):
    if isinstance(value, (bytes, bytearray, memoryview)):
        return ["bytes", hashlib.sha256(bytes(value)).hexdigest(), len(value)]
    if value is None:
        return ["null"]
    if isinstance(value, bool):
        return ["bool", value]
    if isinstance(value, int):
        return ["int", str(value)]
    if isinstance(value, float):
        return ["float", value.hex()]
    if isinstance(value, datetime):
        normalized = value.astimezone(timezone.utc) if value.tzinfo else value
        return ["datetime", normalized.isoformat()]
    if isinstance(value, (Decimal, UUID)):
        return [type(value).__name__, str(value)]
    if isinstance(value, str):
        return ["str", value]
    if isinstance(value, (dict, list)):
        return ["json", value]
    if hasattr(value, "isoformat"):
        return [type(value).__name__, value.isoformat()]
    raise BackupError("Unsupported database value type")


def _table_report(columns, rows) -> dict:
    row_hashes, blob_hashes = [], []
    blob_bytes = 0
    for row in rows:
        row_hashes.append(hashlib.sha256(_canonical([_cell(value) for value in row])).hexdigest())
        for column, value in zip(columns, row):
            if isinstance(value, (bytes, bytearray, memoryview)):
                blob_bytes += len(value)
                blob_hashes.append([column, hashlib.sha256(bytes(value)).hexdigest(), len(value)])
    return {
        "columns": list(columns), "rows": len(row_hashes),
        "rows_sha256": hashlib.sha256(_canonical(sorted(row_hashes))).hexdigest(),
        "photo_blobs": len(blob_hashes), "photo_bytes": blob_bytes,
        "photo_blobs_sha256": hashlib.sha256(_canonical(sorted(blob_hashes))).hexdigest(),
    }


def _sqlite_open(path: Path):
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)


def sqlite_inventory(connection) -> dict:
    check = connection.execute("PRAGMA integrity_check").fetchall()
    if check != [("ok",)]:
        raise BackupError("SQLite integrity_check failed")
    result = {}
    tables = connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
    for (name,) in tables:
        quoted = '"' + name.replace('"', '""') + '"'
        cursor = connection.execute("SELECT * FROM " + quoted)
        result[name] = _table_report([column[0] for column in cursor.description], cursor)
    return {"integrity_check": "ok", "tables": result}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _run(command: list[str], *, env: dict | None = None):
    try:
        result = subprocess.run(command, env=env, capture_output=True, check=False)
    except FileNotFoundError:
        raise BackupError("A required executable is missing: " + command[0]) from None
    if result.returncode:
        # pg_restore errors can contain complete rows, so never print stderr.
        raise BackupError(command[0] + " failed; database output was suppressed to protect private data")
    return result.stdout


def _cipher(source: Path, target: Path, key: bytes, *, decrypt: bool = False):
    env = os.environ.copy()
    env["FAMBUDGET_BACKUP_CIPHER_KEY"] = base64.b64encode(key).decode("ascii")
    command = ["openssl", "enc", "-aes-256-cbc", "-pbkdf2", "-iter", str(ITERATIONS),
               "-pass", "env:FAMBUDGET_BACKUP_CIPHER_KEY", "-in", str(source), "-out", str(target)]
    if decrypt:
        command.append("-d")
    _write_private(target, b"")
    _run(command, env=env)
    target.chmod(0o600)


def _authentication(key: bytes, manifest: dict) -> str:
    salt = bytes.fromhex(manifest["authentication_salt"])
    auth_key = hashlib.pbkdf2_hmac("sha256", key, b"fambudget-auth-v1" + salt, ITERATIONS)
    unsigned = {name: value for name, value in manifest.items() if name != "hmac_sha256"}
    # The authenticated ciphertext digest binds every encrypted byte to metadata.
    return hmac.new(auth_key, _canonical(unsigned), hashlib.sha256).hexdigest()


def _seal(snapshot: Path, destination: Path, key: bytes, *, kind: str, inventory: dict, source_identity=None) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    basename = kind + "-" + stamp + "-" + secrets.token_hex(4)
    archive = destination / (basename + ".enc")
    manifest_path = destination / (basename + ".json")
    try:
        _cipher(snapshot, archive, key)
        manifest = {
            "format": FORMAT, "database": kind, "created_at": datetime.now(timezone.utc).isoformat(),
            "archive": archive.name, "archive_sha256": _sha256(archive),
            "encryption": "AES-256-CBC/PBKDF2-SHA256-200000+HMAC-SHA256",
            "authentication_salt": secrets.token_hex(16), "inventory": inventory,
            "source_identity": source_identity,
        }
        manifest["hmac_sha256"] = _authentication(key, manifest)
        _write_private(manifest_path, _canonical(manifest) + b"\n")
    except BaseException:
        archive.unlink(missing_ok=True)
        manifest_path.unlink(missing_ok=True)
        raise
    return manifest_path


def _unseal(manifest_path: Path, key: bytes, output: Path, expected_kind: str) -> dict:
    manifest = json.loads(manifest_path.read_bytes())
    if manifest.get("format") != FORMAT or manifest.get("database") != expected_kind:
        raise BackupError("Backup format or database type mismatch")
    if not hmac.compare_digest(manifest.get("hmac_sha256", ""), _authentication(key, manifest)):
        raise BackupError("Backup authentication failed; restore was not started")
    archive_name = manifest["archive"]
    if Path(archive_name).name != archive_name:
        raise BackupError("Invalid archive filename")
    archive = manifest_path.parent / archive_name
    if archive.is_symlink() or _sha256(archive) != manifest["archive_sha256"]:
        raise BackupError("Encrypted archive SHA256 mismatch; restore was not started")
    _cipher(archive, output, key, decrypt=True)
    return manifest


def sqlite_backup(source: Path, destination: Path, key: bytes) -> Path:
    destination = _private_directory(destination)
    if not source.is_file():
        raise BackupError("The source SQLite database does not exist")
    with tempfile.TemporaryDirectory(prefix=".sqlite-snapshot-", dir=destination) as temporary:
        snapshot = Path(temporary) / "snapshot.sqlite"
        # The SQLite online backup API safely includes committed WAL pages.
        with _sqlite_open(source) as original, sqlite3.connect(snapshot) as backup:
            original.backup(backup)
            inventory = sqlite_inventory(backup)
        snapshot.chmod(0o600)
        return _seal(snapshot, destination, key, kind="sqlite", inventory=inventory)


def sqlite_restore(manifest_path: Path, target: Path, key: bytes) -> dict:
    destination = _private_directory(target.parent)
    if target.exists() or target.is_symlink():
        raise BackupError("Restore refuses to overwrite an existing SQLite database")
    target = destination / target.name
    with tempfile.TemporaryDirectory(prefix=".sqlite-restore-", dir=destination) as temporary:
        restored = Path(temporary) / "restored.sqlite"
        manifest = _unseal(manifest_path, key, restored, "sqlite")
        with _sqlite_open(restored) as connection:
            actual = sqlite_inventory(connection)
        if actual != manifest["inventory"]:
            raise BackupError("Restored rows or photo hashes differ from the snapshot")
        # Link creation is atomic and fails if a concurrent process created target.
        os.link(restored, target)
        target.chmod(0o600)
    return {"verified": True, "archive_sha256": manifest["archive_sha256"], "inventory": actual}


def _pg_url(url: str) -> str:
    url = url.replace("postgresql+psycopg://", "postgresql://", 1)
    parsed = urlsplit(url)
    if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname or not parsed.path.strip("/"):
        raise BackupError("Use a complete PostgreSQL URL from an environment variable")
    parameters = parse_qsl(parsed.query, keep_blank_values=True)
    loopback = [value for name, value in parameters if name == "hostaddr"]
    if loopback:
        # A platform-approved TCP forward may listen only on loopback. Keep
        # the actual source hostname for TLS verification and source identity;
        # this option neither opens a tunnel nor grants destination access.
        ssl_modes = [value for name, value in parameters if name == "sslmode"]
        if len(loopback) != 1 or loopback[0] not in ("127.0.0.1", "::1") or ssl_modes != ["verify-full"]:
            raise BackupError("A loopback forward requires one loopback hostaddr and sslmode=verify-full")
    return url


def _pg_identity(url: str) -> str:
    parsed = urlsplit(_pg_url(url))
    return hashlib.sha256(_canonical([parsed.hostname, parsed.port or 5432, unquote(parsed.path)])).hexdigest()


def _pg_env(url: str) -> dict:
    # libpq environment parameters keep credentials out of process argv.
    parsed = urlsplit(_pg_url(url))
    env = {name: value for name, value in os.environ.items() if not name.startswith("PG")}
    env.update(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432),
               PGDATABASE=unquote(parsed.path.lstrip("/")))
    if parsed.username:
        env["PGUSER"] = unquote(parsed.username)
    if parsed.password:
        env["PGPASSWORD"] = unquote(parsed.password)
    options = {"sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT", "sslcert": "PGSSLCERT",
               "sslkey": "PGSSLKEY", "connect_timeout": "PGCONNECT_TIMEOUT", "options": "PGOPTIONS",
               "application_name": "PGAPPNAME", "channel_binding": "PGCHANNELBINDING",
               "hostaddr": "PGHOSTADDR"}
    for name, value in parse_qsl(parsed.query):
        if name not in options:
            raise BackupError("Unsupported PostgreSQL URL option")
        env[options[name]] = value
    return env


def _pg_connect(url: str):
    try:
        import psycopg
    except ImportError:
        raise BackupError("PostgreSQL operations require psycopg from backend/requirements.txt") from None
    return psycopg.connect(_pg_url(url))


def postgres_inventory(connection) -> dict:
    from psycopg import sql
    result = {}
    tables = connection.execute("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").fetchall()
    for (name,) in tables:
        cursor = connection.execute(sql.SQL("SELECT * FROM public.{}").format(sql.Identifier(name)))
        result[name] = _table_report([column.name for column in cursor.description], cursor)
    return {"tables": result}


def postgres_backup(source_url: str, destination: Path, key: bytes) -> Path:
    destination = _private_directory(destination)
    with tempfile.TemporaryDirectory(prefix=".postgres-snapshot-", dir=destination) as temporary:
        snapshot = Path(temporary) / "snapshot.dump"
        with _pg_connect(source_url) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            snapshot_id = connection.execute("SELECT pg_export_snapshot()").fetchone()[0]
            inventory = postgres_inventory(connection)
            _run(["pg_dump", "--format=custom", "--no-owner", "--no-acl", "--schema=public",
                  "--snapshot=" + snapshot_id, "--file=" + str(snapshot)], env=_pg_env(source_url))
        snapshot.chmod(0o600)
        return _seal(snapshot, destination, key, kind="postgresql", inventory=inventory,
                     source_identity=_pg_identity(source_url))


def postgres_restore(manifest_path: Path, target_url: str, key: bytes, temporary_directory: Path) -> dict:
    temporary_directory = _private_directory(temporary_directory)
    with tempfile.TemporaryDirectory(prefix=".postgres-restore-", dir=temporary_directory) as temporary:
        dump = Path(temporary) / "restore.dump"
        manifest = _unseal(manifest_path, key, dump, "postgresql")
        if _pg_identity(target_url) == manifest["source_identity"]:
            raise BackupError("Restore target must be a separate PostgreSQL database")
        with _pg_connect(target_url) as connection:
            exists = connection.execute("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                                        "WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1").fetchone()
            if exists:
                raise BackupError("PostgreSQL restore requires an empty isolated database")
        # pg_dump includes CREATE SCHEMA public; fresh databases already have it.
        # Omit only that TOC entry, preserving every table, constraint and sequence.
        listing = _run(["pg_restore", "--list", str(dump)])
        restore_list = Path(temporary) / "restore.list"
        entries = [line for line in listing.splitlines()
                   if not re.match(rb"^\d+; \d+ \d+ SCHEMA - public(?: |$)", line)]
        _write_private(restore_list, b"\n".join(entries) + b"\n")
        # No --clean, DROP, truncate, or database creation is ever performed.
        _run(["pg_restore", "--exit-on-error", "--single-transaction", "--no-owner", "--no-acl",
              "--use-list=" + str(restore_list), "--dbname=" + _pg_env(target_url)["PGDATABASE"], str(dump)],
             env=_pg_env(target_url))
        with _pg_connect(target_url) as connection:
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            actual = postgres_inventory(connection)
        if actual != manifest["inventory"]:
            raise BackupError("Restored PostgreSQL rows or photo hashes differ")
        return {"verified": True, "archive_sha256": manifest["archive_sha256"], "inventory": actual}


def _summary(report: dict) -> dict:
    tables = report["inventory"]["tables"]
    return {"verified": report.get("verified", False), "archive_sha256": report["archive_sha256"],
            "tables": len(tables), "rows": sum(table["rows"] for table in tables.values()),
            "photo_blobs": sum(table["photo_blobs"] for table in tables.values()),
            "photo_bytes": sum(table["photo_bytes"] for table in tables.values())}


def main(argv=None) -> int:
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--key-file", help="Private key file outside Git; otherwise BACKUP_PASSPHRASE")
    commands = parser.add_subparsers(dest="command", required=True)
    backup = commands.add_parser("sqlite-backup")
    backup.add_argument("--source", required=True, type=Path)
    backup.add_argument("--destination", required=True, type=Path)
    restore = commands.add_parser("sqlite-restore")
    restore.add_argument("--manifest", required=True, type=Path)
    restore.add_argument("--target", required=True, type=Path)
    backup_pg = commands.add_parser("postgres-backup")
    backup_pg.add_argument("--url-env", default="DATABASE_URL")
    backup_pg.add_argument("--destination", required=True, type=Path)
    restore_pg = commands.add_parser("postgres-restore")
    restore_pg.add_argument("--manifest", required=True, type=Path)
    restore_pg.add_argument("--url-env", default="RESTORE_DATABASE_URL")
    restore_pg.add_argument("--temporary-directory", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        key = _key(args.key_file)
        if args.command == "sqlite-backup":
            manifest = sqlite_backup(args.source, args.destination, key)
        elif args.command == "postgres-backup":
            manifest = postgres_backup(os.environ.get(args.url_env, ""), args.destination, key)
        elif args.command == "sqlite-restore":
            report = sqlite_restore(args.manifest, args.target, key)
        else:
            report = postgres_restore(args.manifest, os.environ.get(args.url_env, ""), key, args.temporary_directory)
        if args.command.endswith("backup"):
            report = json.loads(manifest.read_bytes())
            print(json.dumps({"manifest": str(manifest), **_summary(report)}))
        else:
            print(json.dumps(_summary(report)))
    except BackupError as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception as error:
        # An unexpected SQL/URL error may embed secrets or a data row.
        print("Backup/restore failed (" + type(error).__name__ + "); private details suppressed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
