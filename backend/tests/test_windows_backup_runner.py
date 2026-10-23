"""Safety boundaries and honest outcomes for the local Windows/Docker runner."""
import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, Mock, patch
from urllib.parse import parse_qs, urlsplit

path = Path(__file__).resolve().parents[2] / "tools/windows-backup/windows_backup.py"
spec = spec_from_file_location("windows_backup_runner", path)
runner = module_from_spec(spec)
spec.loader.exec_module(runner)


def source_url(query=""):
    return ("postgresql://family:fixture%40password@" + runner.EXPECTED_HOST + ":5432/"
            + runner.EXPECTED_DATABASE + query)


class WindowsBackupInputTests(unittest.TestCase):
    def test_full_external_url_keeps_encoded_credentials_and_enforces_verified_tls(self):
        for supplied in ("", "?sslmode=require", "?sslmode=disable&connect_timeout=120"):
            normalized = runner.normalize_source_url({"sourceUrl": source_url(supplied)})
            parsed = urlsplit(normalized)
            self.assertEqual(parsed.password, "fixture%40password")
            self.assertEqual(parsed.hostname, runner.EXPECTED_HOST)
            query = parse_qs(parsed.query)
            self.assertEqual(query["sslmode"], ["verify-full"])
            self.assertEqual(query["sslrootcert"], [runner.SOURCE_CA])
            self.assertEqual(query["connect_timeout"], ["15"])

    def test_refuses_other_hosts_databases_ports_and_internal_destinations(self):
        for value in (source_url().replace(runner.EXPECTED_HOST, "localhost"),
                      source_url().replace(runner.EXPECTED_HOST, "db.example.test"),
                      source_url().replace(runner.EXPECTED_HOST, "dpg-db9opdu1egvs7382neg0-a"),
                      source_url().replace(":5432/", ":5433/"),
                      source_url().replace("/" + runner.EXPECTED_DATABASE, "/another_database"),
                      source_url() + "#fragment", source_url().replace("postgresql:", "https:")):
            with self.subTest(value=value), self.assertRaises(runner.RunnerError):
                runner.normalize_source_url({"sourceUrl": value})

    def test_refuses_tunnels_query_overrides_and_ambiguous_duplicate_options(self):
        for query in ("?hostaddr=127.0.0.1", "?host=127.0.0.1", "?options=-c%20role%3Dother",
                      "?sslrootcert=/untrusted/file", "?sslmode=require&sslmode=disable",
                      "?sslmode=invalid", "?connect_timeout=-1", "?malformed"):
            with self.subTest(query=query), self.assertRaises(runner.RunnerError):
                runner.normalize_source_url({"sourceUrl": source_url(query)})

    def test_bounded_input_requires_only_the_source_field_and_never_reads_past_limit(self):
        result = runner.read_config(io.BytesIO(json.dumps({"sourceUrl": source_url()}).encode()))
        self.assertEqual(result, {"sourceUrl": source_url()})
        for payload in (b"not json", b"[]", b"{}", b'{"sourceUrl":"x","extra":"x"}',
                        b" " * (runner.MAX_INPUT_BYTES + 1)):
            with self.assertRaises(runner.RunnerError):
                runner.read_config(io.BytesIO(payload))

    def test_rejects_control_characters_and_missing_credentials(self):
        for value in (None, "", source_url() + "\n", source_url().replace("fixture%40password", ""),
                      source_url().replace("fixture%40password", "%00secret"),
                      source_url().replace("family:", ":")):
            with self.subTest(value=value), self.assertRaises(runner.RunnerError):
                runner.normalize_source_url({"sourceUrl": value})

    def test_private_vault_refuses_existing_data_and_symlinks(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            vault = root / "vault"
            export, key = runner.prepare_vault(vault)
            self.assertEqual(vault.stat().st_mode & 0o777, 0o700)
            self.assertEqual(export.stat().st_mode & 0o777, 0o700)
            self.assertEqual(key.stat().st_mode & 0o777, 0o700)
            with self.assertRaisesRegex(runner.RunnerError, "VAULT_NOT_EMPTY"):
                runner.prepare_vault(vault)
            target = root / "target"
            target.mkdir()
            link = root / "link"
            link.symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(runner.RunnerError, "VAULT_UNSAFE"):
                runner.prepare_vault(link)
            self.assertEqual(list(target.iterdir()), [])


class WindowsBackupOutcomeTests(unittest.TestCase):
    def fake_backup(self):
        backup = runner.load_backup_module()
        backup._pg_connect = MagicMock()
        connection = backup._pg_connect.return_value.__enter__.return_value
        connection.execute.return_value.fetchone.return_value = ("170004",)

        def create_archive(source, destination, key):
            archive = destination / "fixture.enc"
            backup._write_private(archive, b"encrypted synthetic fixture")
            manifest = destination / "fixture.json"
            metadata = {"archive": archive.name, "archive_sha256": backup._sha256(archive),
                        "created_at": "2026-10-23T00:00:00+00:00", "inventory": {"tables": {
                            "photos": {"rows": 2, "photo_blobs": 2, "photo_bytes": 152}}}}
            backup._write_private(manifest, json.dumps(metadata).encode())
            return manifest

        backup.postgres_backup = Mock(side_effect=create_archive)
        backup.postgres_restore = Mock(return_value={"verified": True})
        return backup, connection

    def run_case(self, root, *, cleanup=True, restore_error=None, source_version="170004"):
        backup, connection = self.fake_backup()
        connection.execute.return_value.fetchone.return_value = (source_version,)
        if restore_error:
            backup.postgres_restore.side_effect = restore_error
        drill = Mock()
        drill.start.return_value = "postgresql://isolated.test/restore"
        drill.cleanup.return_value = cleanup
        with patch.object(runner, "preflight", return_value=18), \
                patch.object(runner, "load_backup_module", return_value=backup), \
                patch.object(runner, "IsolatedRestore", return_value=drill):
            report = runner.run_backup({"sourceUrl": source_url()}, root / "vault")
        return report, backup, connection, drill

    def test_success_requires_restore_and_cleanup_and_records_separate_key(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report, backup, connection, drill = self.run_case(root)
            self.assertTrue(report["verified"])
            self.assertTrue(report["restoreVerified"])
            self.assertTrue(report["plaintextRemoved"])
            self.assertEqual(report["status"], "verified")
            self.assertEqual((report["tables"], report["rows"], report["photoBlobs"], report["photoBytes"]), (1, 2, 2, 152))
            key = root / "vault/key/backup.key"
            self.assertEqual(len(key.read_bytes()), 64)
            self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            self.assertFalse((root / "vault/export/backup.key").exists())
            self.assertEqual(report["keySHA256"], hashlib.sha256(key.read_bytes()).hexdigest())
            self.assertEqual(report, json.loads((root / "vault/export/verification.json").read_bytes()))
            connection.execute.assert_any_call("SET TRANSACTION READ ONLY")
            self.assertEqual(connection.execute.call_count, 2)
            backup.postgres_restore.assert_called_once()
            drill.cleanup.assert_called_once()

    def test_restore_error_is_not_success_and_retains_ciphertext_key_without_private_error(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report, _, _, drill = self.run_case(root, restore_error=RuntimeError(source_url() + " private row"))
            self.assertFalse(report["verified"])
            self.assertTrue(report["backupCompleted"])
            self.assertFalse(report["restoreVerified"])
            self.assertTrue(report["plaintextRemoved"])
            self.assertEqual(report["stage"], "isolated-restore")
            encoded = json.dumps(report)
            self.assertNotIn("fixture%40password", encoded)
            self.assertNotIn("private row", encoded)
            self.assertTrue((root / "vault/export/fixture.enc").exists())
            self.assertTrue((root / "vault/key/backup.key").exists())
            drill.cleanup.assert_called_once()

    def test_cleanup_failure_does_not_claim_overall_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            report, _, _, _ = self.run_case(Path(temporary), cleanup=False)
            self.assertTrue(report["restoreVerified"])
            self.assertFalse(report["plaintextRemoved"])
            self.assertFalse(report["verified"])
            self.assertEqual(report["code"], "PLAINTEXT_CLEANUP_FAILED")

    def test_newer_source_refuses_dump_before_key_creation_or_restore(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            report, backup, _, drill = self.run_case(root, source_version="190001")
            self.assertFalse(report["verified"])
            self.assertFalse(report["backupCompleted"])
            self.assertEqual(report["code"], "SOURCE_VERSION_UNSUPPORTED")
            backup.postgres_backup.assert_not_called()
            backup.postgres_restore.assert_not_called()
            drill.start.assert_not_called()
            self.assertFalse((root / "vault/key/backup.key").exists())


if __name__ == "__main__":
    unittest.main()
