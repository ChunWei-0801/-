"""Restore real private photo bytes and reject corrupt or unsafe backups."""
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = spec_from_file_location("private_backup", Path(__file__).parents[1] / "tools" / "backup_restore.py")
backup = module_from_spec(spec)
spec.loader.exec_module(backup)


class PrivateBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="fambudget-backup-tests-")
        self.root = Path(self.temporary.name)
        self.source = self.root / "source.sqlite"
        self.key = b"a-private-test-key-of-at-least-32-bytes"
        self.private = self.root / "backups"
        with sqlite3.connect(self.source) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, avatar BLOB)")
            connection.execute("CREATE TABLE photos (id INTEGER PRIMARY KEY, image BLOB)")
            connection.execute("INSERT INTO users VALUES (?, ?, ?)", (1, "private@example.test", b"avatar-photo"))
            connection.execute("INSERT INTO photos VALUES (?, ?)", (1, bytes(range(256))))

    def tearDown(self):
        self.temporary.cleanup()

    def test_encrypted_backup_restores_all_rows_and_photos(self):
        before = self.source.read_bytes()
        manifest = backup.sqlite_backup(self.source, self.private, self.key)
        metadata = json.loads(manifest.read_bytes())
        archive = manifest.parent / metadata["archive"]
        self.assertNotIn(b"private@example.test", archive.read_bytes())
        self.assertNotIn(bytes(range(256)), archive.read_bytes())
        self.assertEqual(self.private.stat().st_mode & 0o777, 0o700)
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        self.assertEqual(manifest.stat().st_mode & 0o777, 0o600)
        restored = self.root / "restore" / "verified.sqlite"
        report = backup.sqlite_restore(manifest, restored, self.key)
        self.assertTrue(report["verified"])
        self.assertEqual(report["inventory"], metadata["inventory"])
        self.assertEqual(report["inventory"]["tables"]["photos"]["photo_bytes"], 256)
        self.assertEqual(before, self.source.read_bytes())
        self.assertEqual(restored.stat().st_mode & 0o777, 0o600)
        with sqlite3.connect(restored) as connection:
            self.assertEqual(connection.execute("SELECT image FROM photos").fetchone()[0], bytes(range(256)))

    def test_wal_committed_photo_is_included(self):
        # Keep an active reader so committed pages remain only in the WAL file.
        connection = sqlite3.connect(self.source)
        try:
            connection.execute("PRAGMA wal_autocheckpoint=0")
            connection.execute("INSERT INTO photos VALUES (?, ?)", (2, b"committed-in-wal"))
            connection.commit()
            manifest = backup.sqlite_backup(self.source, self.private, self.key)
            restored = self.root / "restore" / "wal.sqlite"
            backup.sqlite_restore(manifest, restored, self.key)
            with sqlite3.connect(restored) as copy:
                self.assertEqual(copy.execute("SELECT image FROM photos WHERE id=2").fetchone()[0], b"committed-in-wal")
        finally:
            connection.close()

    def test_rejects_archive_corruption_before_creating_target(self):
        manifest = backup.sqlite_backup(self.source, self.private, self.key)
        archive = manifest.parent / json.loads(manifest.read_bytes())["archive"]
        content = bytearray(archive.read_bytes())
        content[-10] ^= 1
        archive.write_bytes(content)
        target = self.root / "restore" / "invalid.sqlite"
        with self.assertRaisesRegex(backup.BackupError, "SHA256 mismatch"):
            backup.sqlite_restore(manifest, target, self.key)
        self.assertFalse(target.exists())

    def test_rejects_wrong_key_and_modified_manifest(self):
        manifest = backup.sqlite_backup(self.source, self.private, self.key)
        target = self.root / "restore" / "invalid.sqlite"
        with self.assertRaisesRegex(backup.BackupError, "authentication failed"):
            backup.sqlite_restore(manifest, target, b"different-private-key-at-least-32-bytes")
        metadata = json.loads(manifest.read_bytes())
        metadata["inventory"]["tables"]["photos"]["rows"] = 0
        manifest.write_text(json.dumps(metadata))
        with self.assertRaisesRegex(backup.BackupError, "authentication failed"):
            backup.sqlite_restore(manifest, target, self.key)
        self.assertFalse(target.exists())

    def test_refuses_overwriting_and_backups_in_git(self):
        manifest = backup.sqlite_backup(self.source, self.private, self.key)
        with self.assertRaisesRegex(backup.BackupError, "overwrite"):
            backup.sqlite_restore(manifest, self.source, self.key)
        checkout = self.root / "checkout"
        (checkout / ".git").mkdir(parents=True)
        (checkout / ".git" / "HEAD").write_text("ref: refs/heads/main\n")
        with self.assertRaisesRegex(backup.BackupError, "outside every Git"):
            backup.sqlite_backup(self.source, checkout / "private", self.key)

    def test_postgres_environment_never_requires_password_in_argv(self):
        url = "postgresql+psycopg://member:encoded%40secret@db.example.test:5433/ledger?sslmode=require"
        env = backup._pg_env(url)
        self.assertEqual(env["PGPASSWORD"], "encoded@secret")
        self.assertEqual(env["PGDATABASE"], "ledger")
        self.assertEqual(env["PGSSLMODE"], "require")
        self.assertEqual(backup._pg_identity(url), backup._pg_identity(url.replace("member:encoded%40secret", "other:other")))


if __name__ == "__main__":
    unittest.main()
