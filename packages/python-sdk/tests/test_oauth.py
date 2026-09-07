import unittest, tempfile, os, time
from pathlib import Path
from unittest.mock import patch
from agfs_sdk.oauth import FileCredentialStore, OAuthSession


class OAuthTests(unittest.TestCase):
    def test_private_storage(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "credentials"
            store = FileCredentialStore(p)
            store.save({"secret": "test"})
            self.assertEqual(p.stat().st_mode & 0o777, 0o600)
            self.assertEqual(store.load(), {"secret": "test"})
            store.clear()
            p.symlink_to("/etc/passwd")
            with self.assertRaises(OSError):
                store.load()

    def test_origin_binding(self):
        with self.assertRaises(ValueError):
            OAuthSession(
                {
                    "base_url": "https://agfs.dev",
                    "token_endpoint": "https://evil.test/token",
                }
            )

    @patch("agfs_sdk.oauth._json")
    def test_refresh_rotation(self, request):
        request.return_value = {
            "access_token": "new",
            "refresh_token": "rotated",
            "expires_in": 3600,
            "token_type": "Bearer",
        }
        session = OAuthSession(
            {
                "base_url": "https://agfs.dev",
                "client_id": "client",
                "token_endpoint": "https://agfs.dev/token",
                "access_token": "old",
                "refresh_token": "refresh",
                "expires_at": 0,
            }
        )
        self.assertEqual(session.token(), "new")
        self.assertEqual(session.value["refresh_token"], "rotated")
        self.assertEqual(session.token(), "new")
        request.assert_called_once()
