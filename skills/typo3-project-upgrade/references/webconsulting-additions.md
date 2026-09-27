# webconsulting integration: typo3-project-upgrade

Load this skill only for its stated task; importing it does not authorize its installers, remote changes, deployments, auto-merge, or credential access.
Project/user approval and this collection's safety rules remain authoritative.

## Composition boundary

The local `typo3-upgrade-run` owns whole-site orchestration, evidence, retries and the overnight
deadline. Load this upstream skill through that owner for a specific migration question, or on an
explicit user request. Never launch its whole-project workflow inside another upgrade graph.

## Fleet corrections to the upstream procedure

Read the local owner's [feature contracts](../../typo3-upgrade-run/references/fleet-regression-contracts.md)
for integrations, backend, cache and route/data coverage. Reuse them inside the parent graph;
do not create a second set of phases or retry budgets.

This collection deliberately does **not** adopt blanket `sys_template` deletion, unconditional
processed-file cleanup or acceptance of every Bootstrap difference. Inventory all roots, includes,
stored constants/config and their rendered dependencies. Preserve each used behavior, migrate only
the approved records and prove a fixed point under exact-scope backup/approval. A version's default
appearance does not override Contract A; shown differences require actual acceptance.

For a patch update on an already-v14 site, inspect changed dependencies and run the affected
backend/integration/cache journeys. Do not rerun a major-version migration or infer historical
closure from successful current checks. Frontend production-context fixtures remain local with
intercepted external services; they do not grant live access.

## #109585 applies to direct v13 → 14.3 too

Upstream limits the #109585 wizard to sites that ran v14.2 and says to skip it for direct
v13 → 14.3 upgrades. Run `setup_userSettingsScrubbingMigration` on every upgrade to 14.3 instead:
v12/v13 left empty `password`/`password2` keys that the user-settings migration copies, and a
skipped or out-of-order scrub leaves residue behind a wizard marked done. Details and the
value-based check: [typo3-security v14 notes](../../typo3-security/references/v14-notes.md).

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-project-upgrade-skill

Special thanks to the Netresearch team for generously sharing the practical TYPO3 and PHP
expertise behind these skills, and for the continuing care they put into their documentation,
examples and maintenance. Their work gives this collection a foundation we are genuinely
grateful to build on.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
