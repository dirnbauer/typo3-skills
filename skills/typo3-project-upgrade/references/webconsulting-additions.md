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

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-project-upgrade-skill

Special thanks to Netresearch for publishing and maintaining these skills.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
