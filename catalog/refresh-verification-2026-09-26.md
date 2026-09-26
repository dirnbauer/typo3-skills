# Existing-skill refresh verification — 2026-09-26

Repository: `dirnbauer/typo3-skills`; branch: `codex/refresh-existing-skills`.
Baseline: `c8c508f0485829eb94610933a4b6c9cc9952ce50`.
The isolated worktree preserves the original checkout's unrelated icon changes.
No archived `webconsulting-skills` content was edited. At the initial review, no commit,
push or merge had been performed.

## Recovery verification

After an unexpected local deletion, all 1,121 missing tracked files were restored from
the committed baseline. The 16 refreshed Netresearch skills were recovered from the
original source clones against the surviving lockfile hashes. The collection-owned
uncommitted changes, including the Powermail examples, were recovered from this task's
recorded patches. The tracked diff returned to its pre-deletion totals: 133 changed files,
3,998 added lines and 4,116 removed lines, before this recovery note.

Generation, all eight repository gates, the PHP example checks and both pairs of
Powermail source probes were rerun successfully after recovery. No tracked deletions
remain. Commit and branch publication were separately requested after restoration;
neither publication nor these tests imply a merge to `main` or a live deployment.

## Scope

- Retained all 60 existing skills; added no skill entrypoints.
- Cloned and refreshed the 16 already-selected Netresearch sources. Exact revisions and
  byte-level provenance are in [vendor-lock.json](../vendor-lock.json). Preserved licences
  and attribution and expanded the acknowledgements.
- Added a tested sync guard requiring explicit review when upstream's skill inventory changes.
- Corrected selected source-backed claims and examples in owned guides or mandatory overlays.
- Kept QA/engineering workflow improvements inside the existing Playwright skill.
- Reworked the existing Powermail guide, references and examples. Conditional multistep
  handling is shared with upstream, not introduced by the fork. Both inspected source pairs
  reproduce the consecutive-hidden-step navigation limitation.

## Executed checks

All commands below completed with exit status 0 on the review machine:

| Check | Observed result |
|---|---|
| `./install.sh --generate-only` | 60 skills; 16 pinned Netresearch skills; attribution checks pass |
| `./scripts/check.sh` | All 8 gates pass, including vendored-byte verification and harness suite |
| Harness `npm test --silent` | 344 tests pass; no failures, skips or cancellations |
| `python3 -m unittest discover -s scripts/tests -q` | 31 tooling tests pass |
| PHP lint of both Powermail example classes | Both pass |
| Powermail `check-examples.php` | 7 payload/guard checks pass; no database writes |
| Powermail `check-comparison.php`, both source clones | 11 comparator cases pass per clone |
| Powermail `check-multistep.mjs`, both source pairs | 4 source-level behaviors pass per pair; shared edge limitation reported |
| `diff -u` for upstream/fork navigation and condition JavaScript | Both files byte-identical across the inspected pairs |
| `git diff --check` | Pass |

## Evidence limits

The [collection review](collection-fact-review.md) records coverage and gaps for every skill.
It does **not** certify every fact, reference or example. The
[Powermail review](powermail-source-review.md) records exact source revisions, commands and
runtime gaps. No complete TYPO3/browser/mail installation or custom-listener integration was
tested. New behavior evals remain proposed; they are not passed model trials or human approvals.
Collection and source-unit checks do not establish application, legal or accessibility compliance.
