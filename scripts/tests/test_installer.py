"""Exercise actual installer control flow in isolated project directories."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class InstallerTests(unittest.TestCase):
    def fixture(self, root):
        bundle = root / "bundle"; bundle.mkdir()
        shutil.copy2(ROOT / "install.sh", bundle / "install.sh")
        scripts = bundle / "scripts"; scripts.mkdir()
        # Generation itself has dedicated tests; isolate installation from catalog generation.
        for name in ("generate_inventory", "audit_skills", "check_attribution_guardrails", "generate_gemini_manifest"):
            (scripts / f"{name}.py").write_text("pass\n")
        (bundle / "AGENTS.md").write_text("Collection instructions\n")
        skill = bundle / "skills/typo3-example"; skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("---\nname: typo3-example\ndescription: Example\n---\n")
        overlay = skill / "references/webconsulting-additions.md"; overlay.parent.mkdir()
        overlay.write_text("Keep attribution and boundaries\n")
        project = root / "project"; project.mkdir()
        (project / "composer.json").write_text("{}\n")
        (project / "AGENTS.md").write_text("User-owned project instructions\n")
        return bundle, project

    def install(self, bundle, project, *args):
        return subprocess.run(["bash", str(bundle / "install.sh"), "--project-only", "--client", "gemini", *args],
                              cwd=project, capture_output=True, text=True)

    def test_gemini_only_complete_directory_and_safe_rerun(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle, project = self.fixture(Path(tmp))
            for _ in range(2):
                result = self.install(bundle, project)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            link = project / ".gemini/skills/typo3-example"
            self.assertTrue(link.is_symlink())
            self.assertEqual(link.resolve(), (bundle / "skills/typo3-example").resolve())
            self.assertTrue((link / "references/webconsulting-additions.md").is_file())
            self.assertIn(".gemini/skills/<name>", (project / "GEMINI.md").read_text())
            self.assertEqual((project / "AGENTS.md").read_text(), "User-owned project instructions\n")
            for other in (".codex", ".cursor", ".agents", ".windsurf", "CLAUDE.md", ".windsurfrules", "gemini-extension.json"):
                self.assertFalse((project / other).exists(), other)

    def test_conflicting_skill_is_preserved_and_install_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle, project = self.fixture(Path(tmp))
            owned = project / ".gemini/skills/typo3-example"; owned.mkdir(parents=True)
            (owned / "SKILL.md").write_text("My local changes\n")
            result = self.install(bundle, project)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Conflict preserved", result.stderr)
            self.assertEqual((owned / "SKILL.md").read_text(), "My local changes\n")

    def test_unrelated_broken_link_and_existing_context_are_untouched(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle, project = self.fixture(Path(tmp))
            directory = project / ".gemini/skills"; directory.mkdir(parents=True)
            stale = directory / "unrelated"; stale.symlink_to(project / "absent")
            (project / "GEMINI.md").write_text("My Gemini instructions\n")
            result = self.install(bundle, project)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(stale.is_symlink())
            self.assertEqual((project / "GEMINI.md").read_text(), "My Gemini instructions\n")

    def test_an_identical_copied_bundle_is_retained_but_overlay_edits_are_not_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle, project = self.fixture(Path(tmp))
            target = project / ".gemini/skills/typo3-example"
            shutil.copytree(bundle / "skills/typo3-example", target)
            result = self.install(bundle, project)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(target.is_symlink())
            overlay = target / "references/webconsulting-additions.md"
            overlay.write_text("User addition\n")
            self.assertNotEqual(self.install(bundle, project).returncode, 0)
            self.assertEqual(overlay.read_text(), "User addition\n")

    def test_each_selected_client_has_its_project_discovery_directory(self):
        for client in ("claude", "codex", "cursor", "gemini", "windsurf"):
            with self.subTest(client=client), tempfile.TemporaryDirectory() as tmp:
                bundle, project = self.fixture(Path(tmp))
                result = self.install(bundle, project, "--client", client)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertTrue((project / f".{client}/skills/typo3-example").is_symlink())
                for other in {"claude", "codex", "cursor", "gemini", "windsurf"} - {client}:
                    self.assertFalse((project / f".{other}").exists(), other)

    def test_dangling_context_links_are_not_followed_or_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle, project = self.fixture(Path(tmp))
            (project / "AGENTS.md").unlink()
            for name in ("AGENTS.md", "GEMINI.md"):
                (project / name).symlink_to(project / f"absent-{name}")
            result = self.install(bundle, project)
            self.assertEqual(result.returncode, 0, result.stderr)
            for name in ("AGENTS.md", "GEMINI.md"):
                self.assertTrue((project / name).is_symlink())
                self.assertFalse((project / f"absent-{name}").exists())

    def test_cursor_rule_safe_rerun_and_local_edits_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundle, project = self.fixture(Path(tmp))
            for _ in range(2):
                result = self.install(bundle, project, "--client", "cursor")
                self.assertEqual(result.returncode, 0, result.stderr)
            rule = project / ".cursor/rules/typo3-example.mdc"
            rule.write_text("User-owned rule\n")
            result = self.install(bundle, project, "--client", "cursor")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Conflict preserved", result.stderr)
            self.assertEqual(rule.read_text(), "User-owned rule\n")


if __name__ == "__main__":
    unittest.main()
