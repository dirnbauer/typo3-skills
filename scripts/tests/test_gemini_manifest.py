"""Native Gemini packaging checks, without installing into a user's client."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import generate_gemini_manifest as gemini


class GeminiManifestTests(unittest.TestCase):
    def fixture(self, root):
        for name in ("GEMINI.md", "AGENTS.md"):
            (root / name).write_text("Fixture context\n")
        skill = root / "skills/typo3-example"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("---\nname: typo3-example\ndescription: Test TYPO3 example\n---\n")

    def test_native_manifest_uses_directory_discovery_not_invented_triggers(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.fixture(root)
            result = gemini.manifest(root)
            self.assertEqual(set(result), {"name", "version", "description", "contextFileName"})
            self.assertEqual(result["contextFileName"], "GEMINI.md")
            self.assertTrue(result["description"].startswith("1 TYPO3"))

    def test_bad_identity_and_missing_context_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.fixture(root)
            (root / "GEMINI.md").unlink()
            with self.assertRaisesRegex(ValueError, "Missing extension context"): gemini.manifest(root)
            (root / "GEMINI.md").write_text("restored")
            (root / "skills/typo3-example/SKILL.md").write_text("---\nname: other\ndescription: Example\n---\n")
            with self.assertRaisesRegex(ValueError, "Invalid skill identity"): gemini.manifest(root)

    def test_generate_is_deterministic_and_check_detects_drift_without_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); self.fixture(root)
            cmd = [sys.executable, gemini.__file__, "--root", str(root)]
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
            target = root / "gemini-extension.json"; before = target.read_bytes()
            self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
            self.assertEqual(target.read_bytes(), before)
            self.assertEqual(subprocess.run(cmd + ["--check"], capture_output=True).returncode, 0)
            target.write_text(json.dumps({"name": "stale"}))
            self.assertEqual(subprocess.run(cmd + ["--check"], capture_output=True).returncode, 1)
            self.assertEqual(json.loads(target.read_text()), {"name": "stale"})

    def test_checked_in_manifest_is_current(self):
        self.assertEqual(json.loads((gemini.ROOT / "gemini-extension.json").read_text()), gemini.manifest(gemini.ROOT))


if __name__ == "__main__":
    unittest.main()
