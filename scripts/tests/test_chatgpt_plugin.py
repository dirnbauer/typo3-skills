"""Packaging and personal-install tests; no real account or global client changes."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import chatgpt_plugin as plugin


class ChatGPTPluginTests(unittest.TestCase):
    def fixture(self, temp):
        root = Path(temp).resolve() / "source"; root.mkdir()
        manifest = root / plugin.MANIFEST; manifest.parent.mkdir()
        manifest.write_text(json.dumps({"name": plugin.NAME, "version": "1.0.0", "skills": "./skills/"}))
        for name in ("AGENTS.md", "VENDORED.md", "LICENSE", "LICENSE-MIT", "LICENSE-CC-BY-SA-4.0", "vendor-lock.json"):
            (root / name).write_text("Preserve attribution and boundaries\n")
        skill = root / "skills/typo3-example"; skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("---\nname: typo3-example\ndescription: Test TYPO3 example\n---\n")
        overlay = skill / "references/webconsulting-additions.md"; overlay.parent.mkdir()
        overlay.write_text("Thank you to Netresearch.\n")
        script = skill / "scripts/check.sh"; script.parent.mkdir()
        script.write_text("#!/bin/sh\nexit 0\n"); script.chmod(0o755)
        (root / "scripts").mkdir()
        for name in ("chatgpt_plugin.py", "audit_skills.py"):
            shutil.copy2(plugin.ROOT / "scripts" / name, root / "scripts" / name)
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        subprocess.run(["git", "-C", str(root), "add", "."], check=True)
        return root

    def test_complete_bundle_excludes_untracked_secrets_caches_and_run_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp)
            for path in (".env", ".validation/private.json", "skills/typo3-example/node_modules/cache.js",
                         "skills/typo3-example/.env", ".typo3-update/database.sql"):
                file = root / path; file.parent.mkdir(parents=True, exist_ok=True); file.write_text("PRIVATE")
            payload, names = plugin.source_bundle(root)
            self.assertEqual(names, ["typo3-example"])
            self.assertTrue(all(b"PRIVATE" not in data for data, _ in payload.values()))
            self.assertIn("skills/typo3-example/references/webconsulting-additions.md", payload)
            self.assertEqual(payload["skills/typo3-example/scripts/check.sh"][1], 0o755)

    def test_tracked_secret_and_symlink_refused_without_following(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp)
            secret = root / "skills/typo3-example/.env"; secret.write_text("PRIVATE")
            subprocess.run(["git", "-C", str(root), "add", str(secret)], check=True)
            with self.assertRaisesRegex(ValueError, "Credential file"): plugin.source_bundle(root)
            subprocess.run(["git", "-C", str(root), "rm", "--cached", "-q", str(secret)], check=True)
            link = root / "skills/typo3-example/external"; link.symlink_to(secret)
            subprocess.run(["git", "-C", str(root), "add", str(link)], check=True)
            with self.assertRaisesRegex(ValueError, "Symlink"): plugin.source_bundle(root)

    def test_untracked_skill_does_not_silently_disappear(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp)
            extra = root / "skills/extra/SKILL.md"; extra.parent.mkdir(); extra.write_text("new")
            with self.assertRaisesRegex(ValueError, "Untracked skill"): plugin.source_bundle(root)

    def test_safe_rerun_then_update_keeps_recoverable_previous_bundle(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp); payload, names = plugin.source_bundle(root)
            target = root.parent / "plugins" / plugin.NAME
            self.assertTrue(plugin.write_bundle(payload, names, target))
            self.assertFalse(plugin.write_bundle(payload, names, target))
            changed = dict(payload); changed["AGENTS.md"] = (b"New context\n", 0o644)
            self.assertTrue(plugin.write_bundle(changed, names, target))
            plugin.verify_bundle(target)
            self.assertIn("+codex.local-", json.loads((target / plugin.MANIFEST).read_text())["version"])
            backups = list(target.parent.glob(".typo3-skills-backup-*"))
            self.assertEqual(len(backups), 1)
            self.assertEqual((backups[0] / "AGENTS.md").read_bytes(), payload["AGENTS.md"][0])

    def test_local_edits_unknown_directories_and_links_are_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp); payload, names = plugin.source_bundle(root)
            target = root.parent / "plugins" / plugin.NAME
            target.mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, "Unmanaged"): plugin.write_bundle(payload, names, target)
            target.rmdir(); target.symlink_to(root)
            with self.assertRaisesRegex(ValueError, "Symlink"): plugin.write_bundle(payload, names, target)
            target.unlink(); plugin.write_bundle(payload, names, target)
            (target / "AGENTS.md").write_text("User changes")
            with self.assertRaisesRegex(ValueError, "Local plugin edits"): plugin.write_bundle(payload, names, target)
            self.assertEqual((target / "AGENTS.md").read_text(), "User changes")

    def test_marketplace_preserves_names_order_metadata_and_refuses_collision(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp).resolve() / "marketplace.json"
            original = {"name": "my-personal", "interface": {"displayName": "Keep my label"},
                        "plugins": [{"name": "existing", "source": "./plugins/existing"}], "custom": True}
            path.write_text(json.dumps(original))
            planned, added = plugin.marketplace_plan(path)
            self.assertTrue(added)
            self.assertEqual(planned["plugins"][0], original["plugins"][0])
            self.assertEqual(planned["interface"], original["interface"])
            self.assertTrue(planned["custom"])
            self.assertEqual(json.loads(path.read_text()), original)
            path.write_text(json.dumps(planned))
            self.assertFalse(plugin.marketplace_plan(path)[1])
            planned["plugins"][-1]["source"]["path"] = "./different-source"
            path.write_text(json.dumps(planned))
            with self.assertRaisesRegex(ValueError, "source conflicts"): plugin.marketplace_plan(path)

    def test_prepare_and_native_command_are_explicit_and_scoped(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp); payload, names = plugin.source_bundle(root)
            personal = root.parent / "isolated-personal"
            with patch.object(plugin.shutil, "which", return_value=None):
                with self.assertRaisesRegex(ValueError, "CLI is required"):
                    plugin.install_personal(payload, names, personal)
                self.assertFalse(personal.exists())
                target, marketplace = plugin.install_personal(payload, names, personal, prepare_only=True)
            with patch.object(plugin.shutil, "which", return_value="/fixture/codex"), patch.object(plugin.subprocess, "run") as run:
                plugin.install_personal(payload, names, personal)
                run.assert_called_once_with(["/fixture/codex", "plugin", "add", "typo3-skills@personal", "--json"], check=True)
            self.assertEqual(plugin.verify_bundle(target)["skills"], names)
            self.assertEqual(len(json.loads(marketplace.read_text())["plugins"]), 1)
            self.assertFalse((personal / ".codex/config.toml").exists())

    def test_zip_is_reproducible_portable_and_refuses_unmanaged_output(self):
        with tempfile.TemporaryDirectory() as temp:
            root = self.fixture(temp); payload, names = plugin.source_bundle(root)
            archive = root.parent / "plugin.zip"
            plugin.package_zip(payload, names, archive); first = archive.read_bytes()
            plugin.package_zip(payload, names, archive)
            self.assertEqual(first, archive.read_bytes())
            with zipfile.ZipFile(archive) as packaged:
                self.assertIsNone(packaged.testzip())
                packaged.extractall(root.parent / "unpacked")
            unpacked = root.parent / "unpacked" / plugin.NAME
            result = subprocess.run([sys.executable, str(unpacked / "scripts/chatgpt_plugin.py"), "--check"],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(plugin.source_bundle(unpacked)[1], names)
            self.assertEqual((unpacked / "skills/typo3-example/SKILL.md").read_bytes(), payload["skills/typo3-example/SKILL.md"][0])
            archive.write_bytes(b"User archive")
            with self.assertRaisesRegex(ValueError, "Unmanaged output"): plugin.package_zip(payload, names, archive)
            self.assertEqual(archive.read_bytes(), b"User archive")

    def test_real_collection_manifest_is_skills_only_and_complete(self):
        payload, names = plugin.source_bundle(plugin.ROOT)
        self.assertEqual(len(names), len(list((plugin.ROOT / "skills").glob("*/SKILL.md"))))
        self.assertFalse(set(json.loads(payload[plugin.MANIFEST][0])) & {"apps", "mcpServers", "hooks"})
        self.assertIn(b"Netresearch", payload[plugin.MANIFEST][0])


if __name__ == "__main__":
    unittest.main()
