---
name: typo3-upgrade-migration
description: >-
  Execute one graph-authorized dependency, code, schema, or data migration node within a
  whole-site TYPO3 v12/v13 to 14.3 upgrade. Use after Baseline A is sealed for the 13.4
  rung, Composer blocker resolution, Rector/Fractor pass, manual API/data migration,
  stored `list_type` to `CType` ordering, 14.3 rung, schema quarantine, or fixed-point reconciliation. Enforces rollback anchors,
  snapshots, v14-only constraints, one-cause budgets, and specialist routing. Never owns
  intake, baseline, final parity, deployment, or an unbounded repeat-until-green cycle.
metadata:
  skill_type: preference
---

# TYPO3 upgrade migration node

One job: change one authorized cause and return inspectable evidence to the graph.

## Preconditions

- The node is `ready`; Baseline A is sealed and verified; graph definition/identity/fingerprints match.
- Code changes have a Git/file rollback reference. Stateful work has a DDEV snapshot taken
  immediately before this node. Exact destructive scope has a granted approval.
- Application PHP/Composer/TYPO3 commands run through DDEV.

## Invariants

- Target `typo3/cms-core: ^14.3`; PHP 8.4 standard; try 8.5 and record `why-not`.
- Produce v14-only project code. Verify every replacement API against installed 14.3 source.
- One cause/pass, normally ≤10 files or ≤400 changed lines. Remaining findings return to the graph.
- Each extension ends with a supported upgrade, replacement, compatibility fork + exit plan, local
  migration, or approved removal. Never silently drop a feature.
- Prefer 13.4 as the compatibility rung, then mechanical and manual work, then 14.3.
- Run Rector/Fractor/scanner a second time after registry/cache rebuild; preserve exact output.
- Migrate stored data before new registration. Preserve CType/list-type identities, parent/child and
  FAL relations, nullable meaning, translations, and YAML scalar types.
- Schema analyzer output is quarantine. Drops require separate exact table/field/index approval.
- Every migration/wizard/setup command must reach documented fixed point on an unchanged rerun.

## Specialist routes

- Mask/content modeling → `typo3-content-blocks`
- PHP APIs → `typo3-v14-reference` + `typo3-rector`
- TypoScript/Fluid/YAML/XLIFF → `typo3-fractor`
- Assets/Gulp/Bootstrap → `typo3-vite`
- Solr/indexing/order → `typo3-solr`
- RTE/inline editing → `typo3-visual-editor`
- Redirect install/editor groups → DDEV Composer + `typo3-backend-rights`
- Security finding → `typo3-security`/`security-audit`, without disguising it as Composer failure

If `typo3/cms-redirects` is absent, dependency resolution installs a constraint compatible with the
locked 14.3 core, inside DDEV. Snapshot before setup/schema. The later rights node proves intended
editor access and least privilege.

## Evidence and exit

Run syntax/static/unit/functional checks proportionate to the cause, schema/extension fixed-point
checks, Composer audit, affected URL/component sentinels, and a bounded intermediate parity capture.

- `pass`: requested cause is migrated, fixed-point proof is green, no new unclassified findings.
- `findings`: record root cause and affected evidence; graph routes to re-plan/specialist/recovery.
- `blocked`: identity, backup, approval, credential, policy, dependency, or retry bound prevents safe work.

Rollback on drift, oscillation, two no-progress attempts, scope/destination change, or exceeded
budget. Never rebaseline and never deploy.

## Boundaries

Use `typo3-upgrade-closure` for full source→target proof. A successful Composer update is not an
upgrade verdict.
