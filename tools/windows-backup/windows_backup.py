"""Run a private snapshot and isolated restore inside the local Docker image.

The production URL is accepted only through bounded standard input.  This file
does not install a VPN, open a host port, change production data, or upload data.
"""
from __future__ import annotations

from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

EXPECTED_HOST = "dpg-db9opdu1egvs7382neg0-a.oregon-postgres.render.com"
EXPECTED_DATABASE = "fambudget_ygx0"
EXPECTED_PORT = 5432
SOURCE_CA = "/etc/ssl/certs/ca-certificates.crt"
LOCAL_PORT = 15432
MAX_INPUT_BYTES = 16384


class RunnerError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def load_backup_module():
    script = Path(__file__).resolve()
    candidates = [script.with_name("backup_restore.py")]
    if len(script.parents) > 2:
        candidates.append(script.parents[2] / "backend/tools/backup_restore.py")
    path = next((candidate for candidate in candidates if candidate.is_file()), None)
    if path is None:
        raise RunnerError("BACKUP_TOOL_MISSING")
    spec = importlib.util.spec_from_file_location("fambudget_backup_core", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_config(stream) -> dict:
    payload = stream.read(MAX_INPUT_BYTES + 1)
    if len(payload) > MAX_INPUT_BYTES:
        raise RunnerError("INPUT_TOO_LARGE")
    try:
        config = json.loads(payload)
    except (ValueError, UnicodeError):
        raise RunnerError("INPUT_INVALID") from None
    if not isinstance(config, dict) or set(config) != {"sourceUrl"}:
        raise RunnerError("INPUT_INVALID")
    return config


def normalize_source_url(config: dict) -> str:
    value = config.get("sourceUrl")
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > MAX_INPUT_BYTES:
        raise RunnerError("INPUT_INVALID")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise RunnerError("INPUT_INVALID")
    try:
        parsed = urlsplit(value)
        parameters = parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True)
        if (parsed.scheme not in ("postgres", "postgresql") or parsed.fragment
                or parsed.hostname != EXPECTED_HOST or (parsed.port or 5432) != EXPECTED_PORT
                or unquote(parsed.path) != "/" + EXPECTED_DATABASE
                or not parsed.username or not parsed.password):
            raise RunnerError("SOURCE_DESTINATION_MISMATCH")
        names = [name for name, _ in parameters]
        if len(set(names)) != len(names) or any(name not in {"sslmode", "connect_timeout"} for name in names):
            raise RunnerError("SOURCE_OPTIONS_UNSUPPORTED")
        for name, item in parameters:
            if name == "sslmode" and item not in {"disable", "allow", "prefer", "require", "verify-ca", "verify-full"}:
                raise RunnerError("SOURCE_OPTIONS_UNSUPPORTED")
            if name == "connect_timeout" and not re.fullmatch(r"[0-9]{1,3}", item):
                raise RunnerError("SOURCE_OPTIONS_UNSUPPORTED")
        username, password = unquote(parsed.username), unquote(parsed.password)
        if any(ord(character) < 32 or ord(character) == 127 for character in username + password):
            raise RunnerError("INPUT_INVALID")
        authority = quote(username, safe="") + ":" + quote(password, safe="") + "@" + EXPECTED_HOST + ":" + str(EXPECTED_PORT)
        query = urlencode({"sslmode": "verify-full", "sslrootcert": SOURCE_CA,
                           "connect_timeout": "15", "application_name": "fambudget-private-backup"})
        return urlunsplit(("postgresql", authority, "/" + EXPECTED_DATABASE, query, ""))
    except (ValueError, UnicodeError):
        raise RunnerError("INPUT_INVALID") from None


def preflight() -> int:
    if os.geteuid() != 0:
        raise RunnerError("CONTAINER_ROOT_REQUIRED")
    for executable in ("pg_dump", "pg_restore", "pg_ctl", "initdb", "openssl", "su"):
        if shutil.which(executable) is None:
            raise RunnerError("LOCAL_TOOL_MISSING")
    if not Path(SOURCE_CA).is_file():
        raise RunnerError("TLS_CA_MISSING")
    try:
        pwd.getpwnam("postgres")
        version = subprocess.run(["pg_dump", "--version"], capture_output=True, check=True, timeout=10)
        match = re.search(rb"PostgreSQL\) (\d+)", version.stdout)
        if not match:
            raise RunnerError("CLIENT_VERSION_UNKNOWN")
        return int(match.group(1))
    except (KeyError, subprocess.SubprocessError):
        raise RunnerError("LOCAL_TOOL_UNAVAILABLE") from None


def prepare_vault(vault: Path) -> tuple[Path, Path]:
    vault = vault.absolute()
    if any(part.is_symlink() for part in (vault, *vault.parents)):
        raise RunnerError("VAULT_UNSAFE")
    if vault.exists():
        if not vault.is_dir() or vault.stat().st_uid != os.getuid() or any(vault.iterdir()):
            raise RunnerError("VAULT_NOT_EMPTY")
    else:
        vault.mkdir(mode=0o700, parents=True)
    vault.chmod(0o700)
    export, key = vault / "export", vault / "key"
    export.mkdir(mode=0o700)
    key.mkdir(mode=0o700)
    return export, key


def _run_private(command: list[str], *, as_postgres=False, timeout=45):
    if as_postgres:
        command = ["su", "-s", "/bin/sh", "postgres", "-c", shlex.join(command)]
    try:
        result = subprocess.run(command, capture_output=True, check=False, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        raise RunnerError("LOCAL_PROCESS_FAILED") from None
    if result.returncode:
        raise RunnerError("LOCAL_PROCESS_FAILED")
    return result.stdout


class IsolatedRestore:
    """A fresh, password-protected localhost cluster inside this container only."""

    def __init__(self):
        self.directory = None
        self.started = False
        self.start_attempted = False
        self.target_url = None
        self.cleaned = False

    def _postgres_file(self, path: Path, content: bytes, mode=0o600):
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(descriptor, "wb") as file:
            file.write(content)
        user = pwd.getpwnam("postgres")
        os.chown(path, user.pw_uid, user.pw_gid)
        path.chmod(mode)

    def start(self, backup):
        user = pwd.getpwnam("postgres")
        self.directory = Path(tempfile.mkdtemp(prefix="fambudget-isolated-restore-"))
        os.chown(self.directory, user.pw_uid, user.pw_gid)
        self.directory.chmod(0o700)
        password = secrets.token_urlsafe(48)
        password_file = self.directory / "initial-password"
        self._postgres_file(password_file, password.encode())
        data = self.directory / "data"
        try:
            _run_private(["initdb", "-D", str(data), "--username=postgres", "--encoding=UTF8", "--locale=C",
                          "--auth-local=trust", "--auth-host=scram-sha-256", "--pwfile=" + str(password_file)],
                         as_postgres=True)
        finally:
            password_file.unlink(missing_ok=True)
        certificate, private_key = self.directory / "server.crt", self.directory / "server.key"
        _run_private(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                      "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
                      "-addext", "basicConstraints=critical,CA:TRUE", "-keyout", str(private_key),
                      "-out", str(certificate)])
        for path in (certificate, private_key):
            os.chown(path, user.pw_uid, user.pw_gid)
            path.chmod(0o600)
        socket = self.directory / "socket"
        socket.mkdir(mode=0o700)
        os.chown(socket, user.pw_uid, user.pw_gid)
        config = ("\nlisten_addresses = '127.0.0.1'\nport = " + str(LOCAL_PORT)
                  + "\nunix_socket_directories = '" + str(socket) + "'\nssl = on\nssl_cert_file = '"
                  + str(certificate) + "'\nssl_key_file = '" + str(private_key)
                  + "'\nlog_statement = 'none'\nlog_min_error_statement = 'panic'\n"
                  + "log_connections = off\nlog_disconnections = off\n")
        with (data / "postgresql.conf").open("a", encoding="utf-8") as file:
            file.write(config)
        self.start_attempted = True
        _run_private(["pg_ctl", "-D", str(data), "-l", str(self.directory / "server.log"),
                      "-w", "-t", "20", "start"], as_postgres=True, timeout=30)
        self.started = True
        credentials = "postgres:" + quote(password, safe="") + "@localhost:" + str(LOCAL_PORT)
        query = urlencode({"hostaddr": "127.0.0.1", "sslmode": "verify-full", "sslrootcert": str(certificate),
                           "connect_timeout": "5", "application_name": "fambudget-isolated-restore"})
        admin = "postgresql://" + credentials + "/postgres?" + query
        with backup._pg_connect(admin) as connection:
            connection.autocommit = True
            connection.execute("CREATE DATABASE fambudget_restore_check TEMPLATE template0 ENCODING 'UTF8'")
        self.target_url = "postgresql://" + credentials + "/fambudget_restore_check?" + query
        return self.target_url

    def cleanup(self) -> bool:
        if self.directory is None:
            self.cleaned = True
            return True
        if self.start_attempted:
            try:
                _run_private(["pg_ctl", "-D", str(self.directory / "data"), "-m", "fast", "-w", "-t", "20", "stop"],
                             as_postgres=True, timeout=30)
            except RunnerError:
                # Never remove files under a possibly running database.  Status
                # code 3 means this known cluster is not running.
                try:
                    command = ["su", "-s", "/bin/sh", "postgres", "-c", shlex.join(
                        ["pg_ctl", "-D", str(self.directory / "data"), "status"])]
                    status = subprocess.run(command, capture_output=True, timeout=10).returncode
                except (OSError, subprocess.SubprocessError):
                    return False
                if status != 3:
                    return False
        try:
            if self.directory.is_symlink() or self.directory.parent != Path(tempfile.gettempdir()):
                return False
            shutil.rmtree(self.directory)
        except OSError:
            return False
        self.started = False
        self.target_url = None
        self.cleaned = True
        return True


def _safe_summary(backup, manifest_path: Path) -> dict:
    metadata = json.loads(manifest_path.read_bytes())
    counts = backup._summary(metadata)
    return {"manifest": manifest_path.name, "archive": metadata["archive"],
            "archiveSHA256": metadata["archive_sha256"], "manifestSHA256": backup._sha256(manifest_path),
            "tables": counts["tables"], "rows": counts["rows"],
            "photoBlobs": counts["photo_blobs"], "photoBytes": counts["photo_bytes"],
            "snapshotCreatedAtUtc": metadata["created_at"]}


def run_backup(config: dict, vault: Path = Path("/vault")) -> dict:
    """Return only safe metadata.  No connection URL or server stderr escapes."""
    summary = {"format": "fambudget-local-verification-v1", "status": "failed", "verified": False,
               "backupCompleted": False, "productionBackupCompleted": False, "restoreVerified": False,
               "plaintextRemoved": False, "createdAtUtc": datetime.now(timezone.utc).isoformat()}
    export = None
    drill = IsolatedRestore()
    stage = "input"
    try:
        source_url = normalize_source_url(config)
        stage = "prerequisites"
        client_major = preflight()
        backup = load_backup_module()
        export, key_directory = prepare_vault(vault)
        stage = "source-connection"
        with backup._pg_connect(source_url) as connection:
            connection.execute("SET TRANSACTION READ ONLY")
            server_version = int(connection.execute("SHOW server_version_num").fetchone()[0])
        source_major = server_version // 10000
        summary["sourceMajor"] = source_major
        summary["clientMajor"] = client_major
        if source_major > client_major:
            raise RunnerError("SOURCE_VERSION_UNSUPPORTED")
        key = secrets.token_bytes(64)
        backup._write_private(key_directory / "backup.key", key)
        summary["keySHA256"] = backup._sha256(key_directory / "backup.key")
        stage = "encrypted-backup"
        manifest = backup.postgres_backup(source_url, export, key)
        summary.update(_safe_summary(backup, manifest))
        summary["backupCompleted"] = True
        summary["productionBackupCompleted"] = True
        stage = "isolated-restore"
        target_url = drill.start(backup)
        report = backup.postgres_restore(manifest, target_url, key, vault / "restore-temporary")
        if report.get("verified") is not True:
            raise RunnerError("RESTORE_NOT_VERIFIED")
        summary["restoreVerified"] = True
    except RunnerError as error:
        summary["code"] = error.code
        summary["stage"] = stage
    except BaseException:
        # SQL errors can contain a password, complete URL or account row.
        summary["code"] = "OPERATION_FAILED"
        summary["stage"] = stage
    finally:
        summary["plaintextRemoved"] = drill.cleanup()
        if summary["backupCompleted"] and summary["restoreVerified"] and summary["plaintextRemoved"]:
            summary["status"] = "verified"
            summary["verified"] = True
        elif summary["restoreVerified"] and not summary["plaintextRemoved"]:
            summary["code"] = "PLAINTEXT_CLEANUP_FAILED"
            summary["stage"] = "cleanup"
        if export is not None:
            try:
                # This is metadata only; private data rows stay in ciphertext.
                backup._write_private(export / "verification.json", (json.dumps(summary, ensure_ascii=True) + "\n").encode())
            except BaseException:
                summary["verified"] = False
                summary["status"] = "failed"
                summary["code"] = "REPORT_WRITE_FAILED"
                summary["stage"] = "report"
    return summary


def main() -> int:
    os.umask(0o077)
    try:
        config = read_config(sys.stdin.buffer)
        report = run_backup(config)
    except BaseException:
        report = {"status": "failed", "verified": False, "backupCompleted": False,
                  "productionBackupCompleted": False, "restoreVerified": False,
                  "plaintextRemoved": True, "stage": "input", "code": "INPUT_INVALID"}
    print(json.dumps(report, ensure_ascii=True))
    return 0 if report.get("verified") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
