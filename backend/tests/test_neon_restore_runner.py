"""Private Neon restore input/authentication guards; no real hosted DB is used."""
from datetime import datetime, timedelta, timezone
from importlib.util import module_from_spec, spec_from_file_location
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch
from urllib.parse import parse_qs, urlsplit

path = Path(__file__).resolve().parents[2] / "tools/windows-backup/neon_restore.py"
spec = spec_from_file_location("neon_restore_runner", path)
runner = module_from_spec(spec)
spec.loader.exec_module(runner)
FIXED_TIME = datetime(2026, 10, 24, 6, 0, tzinfo=timezone.utc)


def target_url(query=""):
    return "postgresql://family_owner:fixture%40password@ep-family-fixture.us-west-2.aws.neon.tech:5432/neondb" + query


class NeonRestoreInputTests(unittest.TestCase):
    def test_direct_url_preserves_encoded_auth_and_enforces_tls_binding_and_timeout(self):
        for query in ("", "?sslmode=require&channel_binding=require", "?sslmode=disable&channel_binding=disable&connect_timeout=120"):
            value = runner.normalize_target_url({"targetUrl": target_url(query)})
            url = urlsplit(value)
            self.assertEqual(url.hostname, "ep-family-fixture.us-west-2.aws.neon.tech")
            self.assertEqual(url.password, "fixture%40password")
            self.assertEqual(url.path, "/neondb")
            self.assertEqual(parse_qs(url.query), {"sslmode":["verify-full"], "sslrootcert":[runner.shared.SOURCE_CA], "channel_binding":["require"], "connect_timeout":["15"], "application_name":["fambudget-private-neon-restore"]})

    def test_unicode_components_are_strictly_percent_encoded_and_normalized(self):
        uri = target_url().replace("family_owner", "%E5%AE%B6%E4%BA%BA").replace("neondb", "family%2Fledger")
        self.assertIn("%E5%AE%B6%E4%BA%BA", runner.normalize_target_url({"targetUrl":uri}))
        self.assertEqual(urlsplit(runner.normalize_target_url({"targetUrl":uri})).path, "/family%2Fledger")

    def test_rejects_render_poolers_non_neon_hosts_wrong_port_and_fragments(self):
        for uri in (target_url().replace("ep-family-fixture", "ep-family-fixture-pooler"),
                    target_url().replace("ep-family-fixture", "ep-family-pooler-fixture"),
                    target_url().replace("ep-family-fixture.us-west-2.aws.neon.tech", runner.shared.EXPECTED_HOST),
                    target_url().replace(".neon.tech", ".neon.tech.example.test"),
                    target_url().replace(".neon.tech", ".neon.tech."), target_url().replace(":5432/", ":5433/"),
                    target_url()+"#", target_url()+"#private", target_url().replace("postgresql://", "https://"),
                    target_url().replace(":5432/", ":0/"),target_url().replace(":5432/", ":/")):
            with self.subTest(uri=uri), self.assertRaises(runner.RestoreError):
                runner.normalize_target_url({"targetUrl":uri})

    def test_rejects_override_duplicate_and_malformed_query_options(self):
        for query in ("?hostaddr=127.0.0.1", "?host=db.example.test", "?service=other", "?options=-c%20role%3Dother",
                      "?sslrootcert=/untrusted", "?sslmode=require&ssl%6dode=disable", "?sslmode=", "?channel_binding=unknown",
                      "?connect_timeout=-1", "?bad", "?sslmode=%FF"):
            with self.subTest(query=query), self.assertRaises(runner.RestoreError):
                runner.normalize_target_url({"targetUrl":target_url(query)})

    def test_rejects_raw_or_encoded_controls_malformed_escapes_and_missing_fields(self):
        for uri in (None, "", target_url()+"\n", target_url().replace("fixture%40password", "%00secret"),
                    target_url().replace("fixture%40password", "%FFsecret"), target_url().replace("fixture%40password", "%C2%85secret"), target_url().replace("fixture%40password", "%ZZ"),
                    target_url().replace("fixture%40password", "raw@secret"), target_url().replace("family_owner", ""),
                    target_url().replace("fixture%40password", ""), target_url().replace("/neondb", "/")):
            with self.subTest(uri=uri), self.assertRaises(runner.RestoreError):
                runner.normalize_target_url({"targetUrl":uri})
        for payload in (b"not-json", b"[]", b"{}", b'{"targetUrl":"x","extra":1}', b'{"targetUrl":"x","targetUrl":"y"}', b" "*(runner.MAX_INPUT_BYTES+1)):
            with self.subTest(payload=payload[:30]), self.assertRaises(runner.RestoreError):
                runner.read_config(io.BytesIO(payload))
        self.assertEqual(runner.read_config(io.BytesIO(json.dumps({"targetUrl":target_url()}).encode())), {"targetUrl":target_url()})


class NeonRestoreOutcomeTests(unittest.TestCase):
    def fixture(self, root, *, age=timedelta(hours=1), source_identity=None, exclude_table=None):
        core = runner.shared.load_backup_module()
        vault = root / "vault"
        inputs = core._private_directory(vault / "input")
        keys = core._private_directory(vault / "key")
        key = b"synthetic-neon-restore-key-at-least-32-bytes"
        core._write_private(keys / "backup.key", key)
        dump = root / "synthetic.dump"
        dump.write_bytes(b"synthetic-unit-fixture-no-real-pg-dump")
        inventory={"tables": {name: {"columns":["id"], "rows":1, "rows_sha256":"1"*64, "photo_blobs":0, "photo_bytes":0, "photo_blobs_sha256":"2"*64} for name in runner.REQUIRED_TABLES if name != exclude_table}}
        inventory["tables"]["transaction_photos"].update(photo_blobs=1,photo_bytes=32)
        source_identity = source_identity or core._pg_identity("postgresql://"+runner.shared.EXPECTED_HOST+":5432/"+runner.shared.EXPECTED_DATABASE)
        manifest = core._seal(dump, inputs, key, kind="postgresql", inventory=inventory, source_identity=source_identity)
        metadata = json.loads(manifest.read_bytes())
        metadata["created_at"] = (FIXED_TIME-age).isoformat()
        metadata["hmac_sha256"] = core._authentication(key, metadata)
        manifest.write_text(json.dumps(metadata))
        manifest.rename(inputs / "backup.json")
        source_bytes = dump.read_bytes()
        return vault, core, metadata, key, dump, source_bytes

    def run_case(self, vault, core, metadata, *, major=18, nonempty=False, failure=None, cleanup_failure=False):
        connection = MagicMock()
        def execute(statement):
            result=Mock()
            result.fetchone.return_value = (str(major*10000+6),) if statement == "SHOW server_version_num" else (1,) if nonempty and statement == runner.EMPTY_QUERY else None
            return result
        connection.execute.side_effect = execute
        core._pg_connect=MagicMock()
        transport = MagicMock()
        transport.__enter__.return_value = connection
        def connect(url):
            self.assertFalse(any(name.startswith("PG") for name in os.environ), "psycopg must not inherit routing/service overrides")
            return transport
        core._pg_connect.side_effect = connect
        core.postgres_restore=Mock(return_value={"verified":True,"archive_sha256":metadata["archive_sha256"],"inventory":metadata["inventory"]},side_effect=failure)
        with patch.object(runner.shared,"load_backup_module",return_value=core), patch.object(runner.shared,"preflight",return_value=18), patch.object(runner,"_now",return_value=FIXED_TIME):
            if cleanup_failure:
                actual_unlink=Path.unlink
                def refuse_key(path,*args,**kwargs):
                    if path == vault/"key/backup.key":raise PermissionError("synthetic private error")
                    return actual_unlink(path,*args,**kwargs)
                with patch.object(Path,"unlink",refuse_key):report=runner.run_restore({"targetUrl":target_url()},vault)
            else:report=runner.run_restore({"targetUrl":target_url()},vault)
        return report,core,connection

    def test_success_authenticates_snapshot_reports_safe_counts_and_removes_copied_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);vault,core,metadata,key,dump,before=self.fixture(root)
            with patch.dict(os.environ,{"PGHOSTADDR":"192.0.2.1","PGSERVICE":"unsafe-service","PGOPTIONS":"-c role=other"}):
                report,core,connection=self.run_case(vault,core,metadata)
                self.assertEqual(os.environ["PGSERVICE"],"unsafe-service")
            self.assertEqual(report["status"],"verified");self.assertEqual(report["code"],"OK")
            self.assertTrue(report["restoreVerified"]);self.assertTrue(report["plaintextRemoved"])
            self.assertEqual((report["targetMajor"],report["clientMajor"]),(18,18))
            self.assertEqual((report["tables"],report["rows"],report["photoBlobs"],report["photoBytes"]),(6,6,1,32))
            self.assertEqual(report,json.loads((vault/"result/verification.json").read_bytes()))
            self.assertFalse((vault/"key/backup.key").exists());self.assertEqual(list((vault/"restore-temporary").iterdir()),[])
            self.assertEqual(dump.read_bytes(),before);self.assertTrue((vault/"input"/metadata["archive"]).is_file())
            self.assertEqual((vault/"result/verification.json").stat().st_mode&0o777,0o600)
            self.assertEqual(core._pg_connect.call_count,1)
            for call in core._pg_connect.call_args_list:self.assertTrue(urlsplit(call.args[0]).hostname.endswith(".neon.tech"))
            connection.execute.assert_any_call("SET TRANSACTION READ ONLY")
            encoded=json.dumps(report);self.assertNotIn("fixture%40password",encoded);self.assertNotIn("postgresql://",encoded)

    def test_client_version_guard_stops_before_authentication_or_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            vault,core,metadata,*_=self.fixture(Path(temporary))
            core._pg_connect=Mock();core.postgres_restore=Mock()
            with patch.object(runner.shared,"preflight",return_value=17),patch.object(runner.shared,"load_backup_module",return_value=core):
                report=runner.run_restore({"targetUrl":target_url()},vault)
            self.assertEqual(report["code"],"CLIENT_VERSION_UNSUPPORTED")
            core._pg_connect.assert_not_called();core.postgres_restore.assert_not_called()

    def test_existing_result_is_not_overwritten_and_target_never_contacted(self):
        with tempfile.TemporaryDirectory() as temporary:
            vault,core,metadata,*_=self.fixture(Path(temporary));result=vault/"result";result.mkdir();(result/"verification.json").write_bytes(b"previous-result")
            report,core,_=self.run_case(vault,core,metadata)
            self.assertEqual(report["code"],"RESULT_ALREADY_EXISTS");self.assertEqual((result/"verification.json").read_bytes(),b"previous-result")
            core._pg_connect.assert_not_called();core.postgres_restore.assert_not_called()

    def test_false_verification_or_inventory_mismatch_is_not_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            vault,core,metadata,*_=self.fixture(Path(temporary))
            bad={"verified":True,"inventory":{"tables":{}},"archive_sha256":metadata["archive_sha256"]}
            report,core,_=self.run_case(vault,core,metadata,failure=lambda *args:bad)
            self.assertEqual(report["code"],"RESTORE_NOT_VERIFIED");self.assertFalse(report["restoreVerified"]);self.assertTrue(report["plaintextRemoved"])

    def test_main_emits_only_fixed_safe_fields_on_invalid_input(self):
        for payload,code in [(b'{"targetUrl":"postgresql://private-secret@db.example.test/x"}',"TARGET_URL_INVALID"),(b" "*(runner.MAX_INPUT_BYTES+1),"INPUT_TOO_LARGE")]:
            with self.subTest(code=code):
                output=io.StringIO()
                with patch.object(runner.sys,"stdin",SimpleNamespace(buffer=io.BytesIO(payload))),patch.object(runner.sys,"stdout",output):
                    exit_code=runner.main()
                report=json.loads(output.getvalue());self.assertEqual(exit_code,1);self.assertEqual(report["code"],code)
                self.assertEqual(set(report),{"schemaVersion","status","code","stage","restoreVerified","plaintextRemoved"})
                self.assertNotIn("private-secret",output.getvalue())

    def test_wrong_hmac_and_corrupt_archive_fail_before_any_target_network(self):
        for kind in ("hmac","archive"):
            with self.subTest(kind=kind),tempfile.TemporaryDirectory() as temporary:
                vault,core,metadata,*_=self.fixture(Path(temporary))
                if kind=="hmac":
                    metadata["hmac_sha256"]="0"*64;(vault/"input/backup.json").write_text(json.dumps(metadata))
                else:
                    archive=vault/"input"/metadata["archive"];archive.write_bytes(archive.read_bytes()+b"corrupt")
                report,core,_=self.run_case(vault,core,metadata)
                self.assertEqual(report["code"],"BACKUP_INVALID");self.assertEqual(report["stage"],"backup-authentication")
                core._pg_connect.assert_not_called();core.postgres_restore.assert_not_called()
                self.assertTrue(report["plaintextRemoved"])

    def test_authenticated_wrong_source_old_future_naive_or_old_schema_prevents_network(self):
        cases=[({"source_identity":"0"*64},"SOURCE_IDENTITY_MISMATCH"),({"age":timedelta(hours=25)},"BACKUP_TOO_OLD"),({"age":timedelta(minutes=-6)},"BACKUP_TIME_INVALID"),({"exclude_table":"calendar_events"},"BACKUP_SCHEMA_UNSUPPORTED")]
        for options,code in cases:
            with self.subTest(code=code),tempfile.TemporaryDirectory() as temporary:
                vault,core,metadata,*_=self.fixture(Path(temporary),**options)
                report,core,_=self.run_case(vault,core,metadata);self.assertEqual(report["code"],code)
                core._pg_connect.assert_not_called();core.postgres_restore.assert_not_called()
        with tempfile.TemporaryDirectory() as temporary:
            vault,core,metadata,key,*_=self.fixture(Path(temporary));metadata["created_at"]="2026-10-24T05:00:00";metadata["hmac_sha256"]=core._authentication(key,metadata);(vault/"input/backup.json").write_text(json.dumps(metadata))
            report,core,_=self.run_case(vault,core,metadata);self.assertEqual(report["code"],"BACKUP_TIME_INVALID");core._pg_connect.assert_not_called()

    def test_older_target_or_nonempty_public_schema_never_reaches_restore(self):
        for options,code in [({"major":17},"TARGET_VERSION_UNSUPPORTED"),({"nonempty":True},"TARGET_NOT_EMPTY")]:
            with self.subTest(code=code),tempfile.TemporaryDirectory() as temporary:
                vault,core,metadata,*_=self.fixture(Path(temporary));report,core,_=self.run_case(vault,core,metadata,**options)
                self.assertEqual(report["code"],code);self.assertFalse(report["restoreVerified"]);core.postgres_restore.assert_not_called()

    def test_command_failure_redacts_private_error_and_leaves_original_archive(self):
        with tempfile.TemporaryDirectory() as temporary:
            vault,core,metadata,*_=self.fixture(Path(temporary));report,core,_=self.run_case(vault,core,metadata,failure=RuntimeError(target_url()+" private account row"))
            self.assertEqual(report["status"],"failed");self.assertEqual(report["code"],"OPERATION_FAILED");self.assertFalse(report["restoreVerified"])
            self.assertTrue(report["plaintextRemoved"]);self.assertTrue((vault/"input"/metadata["archive"]).exists())
            self.assertNotIn("private account",json.dumps(report));self.assertNotIn("fixture%40password",json.dumps(report))

    def test_cleanup_failure_cannot_claim_complete_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            vault,core,metadata,*_=self.fixture(Path(temporary));report,_,_=self.run_case(vault,core,metadata,cleanup_failure=True)
            self.assertTrue(report["restoreVerified"]);self.assertFalse(report["plaintextRemoved"])
            self.assertEqual(report["status"],"failed");self.assertEqual(report["code"],"PRIVATE_CLEANUP_FAILED")

    def test_symlink_input_refuses_target_connection_and_does_not_touch_original(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);vault,core,metadata,key,*_=self.fixture(root);saved=root/"original.key";saved.write_bytes(key);saved.chmod(0o640)
            (vault/"key/backup.key").unlink();(vault/"key/backup.key").symlink_to(saved)
            report,core,_=self.run_case(vault,core,metadata);self.assertEqual(report["code"],"INPUT_FILES_INVALID")
            core._pg_connect.assert_not_called();self.assertEqual(saved.read_bytes(),key);self.assertEqual(saved.stat().st_mode&0o777,0o640)


if __name__ == "__main__":
    unittest.main()
