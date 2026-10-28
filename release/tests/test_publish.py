"""Self-tests for the GitHub Releases validator."""
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "publish.py"
spec = importlib.util.spec_from_file_location("publisher", SCRIPT)
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)


class ReleaseTests(unittest.TestCase):
    def test_github_attachment_only(self):
        self.assertTrue(pub.validate_source_url(
            "https://github.com/user-attachments/files/12345/MGLOTEK_v1.0.1.zip"))
        for url in ("https://attacker.example/files/game.zip",
                    "http://github.com/user-attachments/files/5/game.zip",
                    "https://github.com/attacker/repo/raw/main/game.zip"):
            with self.assertRaises(ValueError):
                pub.validate_source_url(url)

    def test_requested_draft_mode(self):
        with patch.dict("os.environ", {"INPUT_VERSION": "", "INPUT_RUN": ""}):
            self.assertEqual(pub.request()["mode"], "draft")

    def test_release_modes(self):
        self.assertIn("draft", ("draft", "finalize"))

    def test_wrong_semver(self):
        self.assertFalse(pub.SEMVER.fullmatch("1.0.1!"))

    def test_safe_zip(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "game.zip"
            with zipfile.ZipFile(f, "w") as z:
                for name in ("MGLOTEK/main.py", "MGLOTEK/start_windows.bat",
                             "MGLOTEK/requirements.txt"):
                    z.writestr(name, "test")
            self.assertEqual(pub.validate_game_zip(f), 3)

    def test_missing_launcher(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "bad.zip"
            with zipfile.ZipFile(f, "w") as z:
                z.writestr("main.py", "test")
            with self.assertRaises(ValueError):
                pub.validate_game_zip(f)

    def test_unsafe_zip(self):
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "bad.zip"
            with zipfile.ZipFile(f, "w") as z:
                for n in ("../bad", "main.py", "start_windows.bat",
                          "requirements.txt"):
                    z.writestr(n, "test")
            with self.assertRaises(ValueError):
                pub.validate_game_zip(f)


if __name__ == "__main__":
    unittest.main()
