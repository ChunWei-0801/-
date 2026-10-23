"""Exercise the actual Linux image with synthetic data only, never Render.

Copy this file into a newly created local test container and run it with python3.
It creates its own loopback TLS source and separately restores the real encrypted
snapshot. The expected production destination is changed in memory for this test
only; the distributed runner has no command-line destination override.
"""
from datetime import date, datetime, timezone
from decimal import Decimal
import importlib.util
import json
from pathlib import Path
import struct
import sys
import zlib
from urllib.parse import urlsplit, urlunsplit


def png(rgb):
    def chunk(kind, body):
        return struct.pack("!I", len(body)) + kind + body + struct.pack("!I", zlib.crc32(kind + body))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"\0" + bytes(rgb))) + chunk(b"IEND", b""))


def main():
    sys.path.insert(0, "/app")
    import windows_backup as runner
    from psycopg.types.json import Jsonb

    backup = runner.load_backup_module()
    source = runner.IsolatedRestore()
    report = {"syntheticOnly": True, "productionConnected": False, "verified": False}
    step = "source-start"
    try:
        runner.LOCAL_PORT = 15433
        source_url = source.start(backup)
        step = "source-fixture"
        with backup._pg_connect(source_url) as connection:
            connection.execute("CREATE TABLE members (id bigint PRIMARY KEY, name text, birthday date, metadata jsonb, avatar bytea)")
            connection.execute("CREATE TABLE entries (id bigint PRIMARY KEY, member_id bigint REFERENCES members, amount numeric(12,2), at timestamptz, confirmed boolean, receipt bytea)")
            connection.execute("INSERT INTO members VALUES (%s,%s,%s,%s,%s)",
                               (1, "合成家庭甲", date(2000, 2, 29), Jsonb({"test": True, "tag": "相片"}), png((0, 180, 90))))
            connection.execute("INSERT INTO members VALUES (%s,%s,%s,%s,%s)", (2, "合成家庭乙", None, Jsonb({}), None))
            for ident, amount in ((1, Decimal("65.50")), (2, Decimal("120.00")), (3, Decimal("1.00"))):
                connection.execute("INSERT INTO entries VALUES (%s,%s,%s,%s,%s,%s)",
                                   (ident, 1, amount, datetime(2026, 10, 23, 5, 0, tzinfo=timezone.utc),
                                    ident != 2, png((120, 40, 180)) if ident == 1 else None))
        with backup._pg_connect(source_url) as connection:
            before = backup.postgres_inventory(connection)

        # Only this explicit synthetic harness changes these in-memory values.
        # No production URL, credentials, remote DNS or network call is used.
        runner.EXPECTED_HOST = "localhost"
        runner.EXPECTED_DATABASE = "fambudget_restore_check"
        runner.EXPECTED_PORT = 15433
        runner.SOURCE_CA = str(source.directory / "server.crt")
        runner.LOCAL_PORT = 15432
        parsed = urlsplit(source_url)
        plain_source_url = urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
        result = runner.run_backup({"sourceUrl": plain_source_url})
        if not result.get("verified"):
            report.update({"runnerStage": result.get("stage"), "runnerCode": result.get("code")})
            raise RuntimeError("Synthetic roundtrip failed")
        with backup._pg_connect(source_url) as connection:
            after = backup.postgres_inventory(connection)
        if before != after:
            raise RuntimeError("Synthetic source changed")
        metadata = json.loads((Path("/vault/export") / result["manifest"]).read_bytes())
        if metadata["inventory"] != before:
            raise RuntimeError("Snapshot differs from synthetic source")
        export_files = sorted(path.name for path in Path("/vault/export").iterdir())
        if len(export_files) != 3 or any(not path.is_file() for path in Path("/vault/export").iterdir()):
            raise RuntimeError("Unexpected exported file or plaintext directory")
        key = Path("/vault/key/backup.key")
        if key.stat().st_mode & 0o777 != 0o600 or len(key.read_bytes()) != 64:
            raise RuntimeError("Private key permissions/length invalid")
        if list(Path("/vault/restore-temporary").iterdir()):
            raise RuntimeError("Plaintext restore dump remains")
        report.update({"verified": True, "sourceUnchanged": True, "rowsAndPhotosMatch": True,
                       "restored": result["restoreVerified"], "plaintextRemoved": result["plaintextRemoved"],
                       "tables": result["tables"], "rows": result["rows"], "photoBlobs": result["photoBlobs"],
                       "photoBytes": result["photoBytes"], "sourceMajor": result["sourceMajor"],
                       "clientMajor": result["clientMajor"], "encryptedExportFiles": export_files,
                       "separatePrivateKey": True})
    except BaseException as error:
        report["verified"] = False
        report["testStage"] = step
        report["testErrorType"] = type(error).__name__
        if isinstance(error, runner.RunnerError):
            report["testErrorCode"] = error.code
    finally:
        report["syntheticSourceRemoved"] = source.cleanup()
        if not report["syntheticSourceRemoved"]:
            report["verified"] = False
    print(json.dumps(report, ensure_ascii=True))
    return 0 if report["verified"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
