"""Read-only, maintenance-gated comparison of the pinned Render and Neon databases.

Credentials arrive only on bounded stdin. This module performs no restore,
source write, setting change, website switch, or paid-resource provisioning.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import ssl
import sys
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener
from urllib.parse import unquote, urlsplit

_spec = importlib.util.spec_from_file_location("fambudget_compare_restore_shared", Path(__file__).with_name("neon_restore.py"))
restore = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(restore)
shared = restore.shared

MAX_INPUT_BYTES = 32768
MAX_RESPONSE_BYTES = 16384
MAINTENANCE_URL = "https://fambudget-recovery-20261017.onrender.com/capabilities"
CODES = frozenset({"OK", "DATABASES_DIFFER", "INPUT_INVALID", "INPUT_TOO_LARGE", "SOURCE_URL_INVALID", "SOURCE_OPTIONS_UNSUPPORTED", "TARGET_URL_INVALID", "TARGET_OPTIONS_UNSUPPORTED", "TARGET_POOLER_UNSUPPORTED", "SOURCE_MAINTENANCE_REQUIRED", "CLIENT_VERSION_UNSUPPORTED", "SOURCE_VERSION_UNSUPPORTED", "TARGET_VERSION_UNSUPPORTED", "READ_ONLY_REQUIRED", "VAULT_UNSAFE", "RESULT_ALREADY_EXISTS", "OPERATION_FAILED", "REPORT_WRITE_FAILED", "PREREQUISITES_FAILED"})
STAGES = frozenset({"input", "prerequisites", "report-storage", "source-maintenance", "source-connect", "target-connect", "data-compare", "schema-compare", "sequence-compare", "source-maintenance-final", "report", "complete"})
BOOL_FIELDS = ("match", "dataMatched", "schemaMatched", "sequenceMatched", "readOnly", "sourceMaintenanceObserved")
COUNT_FIELDS = ("Tables", "Rows", "PhotoBlobs", "PhotoBytes")

COLUMNS_QUERY = """SELECT c.relname,a.attnum,a.attname,
    pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid,false),co.collname
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    LEFT JOIN pg_catalog.pg_collation co ON co.oid=a.attcollation
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
    AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname COLLATE "C",a.attnum"""
CONSTRAINTS_QUERY = """SELECT c.relname,k.conname,k.contype,k.convalidated,
    pg_catalog.pg_get_constraintdef(k.oid,false)
    FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY c.relname COLLATE "C",k.conname COLLATE "C"
    """
INDEXES_QUERY = """SELECT c.relname,i.relname,pg_catalog.pg_get_indexdef(i.oid,0,false),
    x.indisvalid,x.indisready
    FROM pg_catalog.pg_index x
    JOIN pg_catalog.pg_class c ON c.oid=x.indrelid
    JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' ORDER BY c.relname COLLATE "C",i.relname COLLATE "C"
    """
SEQUENCES_QUERY = """SELECT sequencename,data_type,start_value,min_value,max_value,
    increment_by,cycle,cache_size FROM pg_catalog.pg_sequences
    WHERE schemaname='public' ORDER BY sequencename COLLATE "C"
    """


class CompareError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise CompareError("INPUT_INVALID")
        value[key] = item
    return value


def read_config(stream):
    payload = stream.read(MAX_INPUT_BYTES + 1)
    if len(payload) > MAX_INPUT_BYTES:
        raise CompareError("INPUT_TOO_LARGE")
    try:
        value = json.loads(payload, object_pairs_hook=_unique_object)
    except (ValueError, UnicodeError):
        raise CompareError("INPUT_INVALID") from None
    if not isinstance(value, dict) or set(value) != {"sourceUrl", "targetUrl"}:
        raise CompareError("INPUT_INVALID")
    return value


def normalize_urls(config):
    if not isinstance(config, dict) or set(config) != {"sourceUrl", "targetUrl"}:
        raise CompareError("INPUT_INVALID")
    source = config["sourceUrl"]
    if not isinstance(source, str) or "#" in source or restore._controls(source) or re.search(r"%(?![0-9a-fA-F]{2})", source):
        raise CompareError("SOURCE_URL_INVALID")
    try:
        parsed = urlsplit(source)
        if parsed.netloc.count("@") != 1:
            raise CompareError("SOURCE_URL_INVALID")
        if any(restore._controls(unquote(item, encoding='utf-8', errors='strict')) for item in (parsed.username or '', parsed.password or '')):
            raise CompareError("SOURCE_URL_INVALID")
        source = shared.normalize_source_url({"sourceUrl": source})
    except shared.RunnerError as error:
        code = "SOURCE_OPTIONS_UNSUPPORTED" if error.code == "SOURCE_OPTIONS_UNSUPPORTED" else "SOURCE_URL_INVALID"
        raise CompareError(code) from None
    except (ValueError, UnicodeError):
        raise CompareError("SOURCE_URL_INVALID") from None
    try:
        target = restore.normalize_target_url({"targetUrl": config["targetUrl"]})
    except restore.RestoreError as error:
        raise CompareError(error.code if error.code in CODES else "TARGET_URL_INVALID") from None
    except (ValueError, UnicodeError):
        raise CompareError("TARGET_URL_INVALID") from None
    return source, target


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def maintenance_status():
    """Require a fresh affirmative response from the fixed HTTPS service only."""
    try:
        opener = build_opener(HTTPSHandler(context=ssl.create_default_context()), _NoRedirect())
        request = Request(MAINTENANCE_URL, headers={"Accept":"application/json", "Cache-Control":"no-cache", "Pragma":"no-cache", "User-Agent":"FamBudget-ReadOnly-Migration-Check/1"})
        with opener.open(request, timeout=20) as response:
            if response.status != 200 or response.geturl() != MAINTENANCE_URL:
                return False
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                return False
            value = json.loads(payload, object_pairs_hook=_unique_object)
            return isinstance(value, dict) and value.get("maintenance_mode") is True
    except BaseException:
        return False


def schema_inventory(connection):
    # A consistent search_path avoids role-specific qualification differences.
    return {"columns": connection.execute(COLUMNS_QUERY).fetchall(),
            "constraints": connection.execute(CONSTRAINTS_QUERY).fetchall(),
            "indexes": connection.execute(INDEXES_QUERY).fetchall()}


def sequence_inventory(connection):
    from psycopg import sql
    result = []
    for row in connection.execute(SEQUENCES_QUERY).fetchall():
        name = row[0]
        state = connection.execute(sql.SQL("SELECT last_value,is_called FROM {}.{}").format(sql.Identifier("public"), sql.Identifier(name))).fetchone()
        if state is None:
            raise CompareError("OPERATION_FAILED")
        result.append([*row, *state])
    return result


def _start_readonly(connection, major_code):
    connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
    readonly = connection.execute("SHOW transaction_read_only").fetchone()
    if not readonly or readonly[0] != "on":
        raise CompareError("READ_ONLY_REQUIRED")
    major = int(connection.execute("SHOW server_version_num").fetchone()[0]) // 10000
    if major != 18:
        raise CompareError(major_code)
    connection.execute("SET LOCAL search_path = pg_catalog, public")
    return major


def _counts(inventory, prefix):
    tables = inventory["tables"]
    return {prefix+"Tables":len(tables), prefix+"Rows":sum(t["rows"] for t in tables.values()),
            prefix+"PhotoBlobs":sum(t["photo_blobs"] for t in tables.values()),
            prefix+"PhotoBytes":sum(t["photo_bytes"] for t in tables.values())}


def _digest(core, inventory):
    return hashlib.sha256(core._canonical(inventory)).hexdigest()


def run_compare(config, vault=Path("/vault")):
    report = {"schemaVersion":1,"status":"failed","code":"OPERATION_FAILED","stage":"input", **{key:False for key in BOOL_FIELDS}}
    core = None
    result_file = None
    with restore._without_pg_environment():
        try:
            source, target = normalize_urls(config)
            report["stage"] = "prerequisites"
            try:
                report["clientMajor"] = shared.preflight()
                core = shared.load_backup_module()
            except shared.RunnerError:
                raise CompareError("PREREQUISITES_FAILED") from None
            report["sourceIdentitySHA256"] = core._pg_identity(source)
            report["targetIdentitySHA256"] = core._pg_identity(target)
            if report["clientMajor"] != 18:
                raise CompareError("CLIENT_VERSION_UNSUPPORTED")
            report["stage"] = "report-storage"
            try:
                vault = restore._directory(core, vault)
                results = restore._directory(core, vault / "result")
            except restore.RestoreError:
                raise CompareError("VAULT_UNSAFE") from None
            if any(results.iterdir()):
                raise CompareError("RESULT_ALREADY_EXISTS")
            result_file = results / "comparison.json"
            report["stage"] = "source-maintenance"
            if maintenance_status() is not True:
                raise CompareError("SOURCE_MAINTENANCE_REQUIRED")
            report["stage"] = "source-connect"
            with core._pg_connect(source) as source_connection:
                report["sourceMajor"] = _start_readonly(source_connection, "SOURCE_VERSION_UNSUPPORTED")
                report["stage"] = "target-connect"
                with core._pg_connect(target) as target_connection:
                    report["targetMajor"] = _start_readonly(target_connection, "TARGET_VERSION_UNSUPPORTED")
                    report["readOnly"] = True
                    report["stage"] = "data-compare"
                    source_data = core.postgres_inventory(source_connection)
                    target_data = core.postgres_inventory(target_connection)
                    report.update(_counts(source_data,"source")); report.update(_counts(target_data,"target"))
                    report["dataMatched"] = source_data == target_data
                    report["stage"] = "schema-compare"
                    source_schema = schema_inventory(source_connection); target_schema = schema_inventory(target_connection)
                    report["schemaMatched"] = source_schema == target_schema
                    report["stage"] = "sequence-compare"
                    source_sequences = sequence_inventory(source_connection); target_sequences = sequence_inventory(target_connection)
                    report["sequenceMatched"] = source_sequences == target_sequences
                    report["sourceInventorySHA256"] = _digest(core,{"data":source_data,"schema":source_schema,"sequences":source_sequences})
                    report["targetInventorySHA256"] = _digest(core,{"data":target_data,"schema":target_schema,"sequences":target_sequences})
                    report["stage"] = "source-maintenance-final"
                    if maintenance_status() is not True:
                        raise CompareError("SOURCE_MAINTENANCE_REQUIRED")
                    report["sourceMaintenanceObserved"] = True
                    report["match"] = all(report[k] for k in ("dataMatched","schemaMatched","sequenceMatched"))
                    report.update(status="verified" if report["match"] else "different", code="OK" if report["match"] else "DATABASES_DIFFER",stage="complete",comparedAtUtc=datetime.now(timezone.utc).isoformat())
        except CompareError as error:
            report.update(status="failed",match=False,code=error.code)
        except BaseException:
            report.update(status="failed",match=False,code="OPERATION_FAILED")
        finally:
            if result_file is not None and core is not None:
                try:
                    core._write_private(result_file, (json.dumps(report,ensure_ascii=True)+"\n").encode())
                except BaseException:
                    report.update(status="failed",code="REPORT_WRITE_FAILED",stage="report",match=False)
    return report


def main():
    os.umask(0o077)
    try:
        report = run_compare(read_config(sys.stdin.buffer))
    except BaseException as error:
        report = {"schemaVersion":1,"status":"failed","code":error.code if isinstance(error,CompareError) else "INPUT_INVALID","stage":"input", **{key:False for key in BOOL_FIELDS}}
    print(json.dumps(report,ensure_ascii=True))
    return 0 if report["status"] == "verified" and report["match"] else 2 if report["status"] == "different" else 1


if __name__ == '__main__':
    raise SystemExit(main())
