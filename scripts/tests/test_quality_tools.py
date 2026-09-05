"""Checks for the collection's validators, not model-behaviour claims."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _skilltext import domain_eligible, routing_policy
from trigger_collisions import load_allowlist
from validate_evals import validate_suite
from run_evals import grade_claude
import check_attribution_guardrails as attribution
import sync_netresearch as sync


class RoutingTests(unittest.TestCase):
    def test_sync_scope_cannot_expand_with_the_marketplace(self):
        self.assertEqual(len(sync.UPSTREAM_REPOSITORIES), 16)
        self.assertTrue(sync.in_scope('netresearch/typo3-testing-skill'))
        self.assertTrue(sync.in_scope('netresearch/php-modernization-skill'))
        self.assertFalse(sync.in_scope('netresearch/orocommerce-skill'))
        self.assertFalse(sync.in_scope('netresearch/typo3-new-unapproved-skill'))

    def test_explicit_other_framework_is_not_typo3(self):
        self.assertFalse(domain_eligible('typo3-playwright', 'Test a Svelte storefront.'))
        self.assertTrue(domain_eligible('typo3-playwright', 'Test a TYPO3 frontend containing React islands.'))

    def test_companions_do_not_start_second_workflows(self):
        for name in routing_policy()['companions']:
            self.assertFalse(domain_eligible(name, 'Upgrade a TYPO3 site.'))
            self.assertTrue(domain_eligible(name, f'Use {name} for a bounded reference check.'))

    def test_no_skill_means_none_in_the_model_grader_too(self):
        case = {'kind': 'trigger-negative', 'prompt': 'An unrelated request', 'expect_no_skill': True}
        with patch('run_evals.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='another-skill', stderr='')):
            self.assertEqual(grade_claude(case, 'test', {}, 1)['result'], 'fail')
        with patch('run_evals.subprocess.run', return_value=SimpleNamespace(returncode=0, stdout='NONE', stderr='')):
            self.assertEqual(grade_claude(case, 'test', {}, 1)['result'], 'pass')


class IntegrityTests(unittest.TestCase):
    def test_sync_refuses_local_edits_before_any_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); dest = root / 'skills/example'; dest.mkdir(parents=True)
            file = dest / 'SKILL.md'; file.write_text('local edit')
            old = {'example': {'files': {'SKILL.md': hashlib.sha256(b'upstream').hexdigest()}}}
            data = {'skills': [{'name': 'example', 'files': {'SKILL.md': 'new'}, 'repository': 'https://github.com/netresearch/example'}]}
            with patch.object(sync, 'ROOT', root):
                with self.assertRaisesRegex(ValueError, 'Locally changed'): sync.preflight(data, old)
            self.assertEqual(file.read_text(), 'local edit')

    def test_sync_refuses_a_symlinked_skill_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'skills').mkdir(); (root / 'outside').mkdir()
            (root / 'skills/example').symlink_to(root / 'outside', target_is_directory=True)
            with patch.object(sync, 'ROOT', root):
                with self.assertRaisesRegex(ValueError, 'Unsafe local skill'):
                    sync.preflight({'skills': [{'name': 'example', 'files': {}}]}, {})

    def test_collision_allowlist_cannot_hide_an_arbitrary_pair(self):
        with tempfile.TemporaryDirectory() as tmp:
            file = Path(tmp) / 'pairs.json'
            for a, b in [('*', 'anything'), ('same', 'same')]:
                file.write_text(json.dumps({'pairs': [{'a': a, 'b': b, 'reason': 'test', 'max_overlap': .2}]}))
                with self.assertRaises(ValueError): load_allowlist(file)
            file.write_text(json.dumps({'pairs': [{'a': 'one', 'b': 'two', 'reason': 'boundary', 'max_overlap': .2}]}))
            self.assertEqual(set(load_allowlist(file)), {('one', 'two')})

    def test_vendored_bytes_are_checked_even_with_correct_credits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); skill = root / 'skills/example'; skill.mkdir(parents=True)
            file = skill / 'SKILL.md'; file.write_text('pinned source')
            overlay = skill / 'references/webconsulting-additions.md'; overlay.parent.mkdir()
            overlay.write_text('\n'.join(attribution.COMMON_REQUIRED_SKILL_SNIPPETS + attribution.REQUIRED_SKILL_SNIPPETS)
                               + '\nOriginal repository: https://github.com/netresearch/example\n')
            (root / 'vendor-lock.json').write_text(json.dumps({'skills': [{'name': 'example', 'commit': 'a' * 40,
                'licenses': ['LICENSE'], 'files': {'SKILL.md': hashlib.sha256(file.read_bytes()).hexdigest()}}]}))
            with patch.object(attribution, 'ROOT', root), patch.object(attribution, 'SKILLS_DIR', root / 'skills'):
                self.assertEqual(attribution.check_skill_file('example', 'Netresearch', 'https://github.com/netresearch/example'), [])
                file.write_text('silent upstream edit')
                self.assertTrue(any('modified' in e for e in attribution.check_skill_file('example', 'Netresearch', 'https://github.com/netresearch/example')))

    def test_lifecycle_drift_and_nonobject_evals_fail_closed(self):
        suite = {'skill_name': 'example', 'skill_type': 'preference', 'evals': [None]}
        errors, _ = validate_suite('example', suite, 1, '---\nname: example\nmetadata:\n  skill_type: capability\n---\n')
        self.assertTrue(any('lifecycle' in e for e in errors))
        self.assertTrue(any('not an object' in e for e in errors))


if __name__ == '__main__': unittest.main()
