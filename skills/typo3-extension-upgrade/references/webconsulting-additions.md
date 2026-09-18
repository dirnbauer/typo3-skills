# webconsulting additions — `typo3-extension-upgrade`

> **Overlay.** The vendored `SKILL.md` and references remain upstream-owned. These additions record
> project-tested TYPO3 v14 workflow constraints.

## Reach a tool fixed point

Run Rector and Fractor as **dry run → review → apply → repeat** until a fresh dry run reports zero
changed files. Generated code is part of the next pass: Rector-created CType upgrade wizards can
themselves require a later v14 namespace migration.

If Composer was recovered with `--no-plugins`, follow it with a normal plugin-enabled reproducible
install and autoload regeneration before running Fractor. A missing TYPO3 extension registry is a
generated-artifact problem; do not patch `vendor/`.

## Prove compatibility beyond Composer metadata

A package resolving on TYPO3 14 proves its constraints allow the graph, not that method signatures,
TCA, backend modules or runtime paths work. Inspect installed interfaces, run Scanner and static
analysis, then render/execute every used surface. Lock fork commits and Composer patches exactly,
make patches fail on context drift, and record their removal condition.

Recheck this after patch-level Core updates too: the September 2026 Saferinternet and Watchlist
repairs exposed an inline page-controller constructor dependency on installed backend internals.
Verify the target constructor/factory in vendor source, compile DI, then open the actual
authenticated module with a representative record. A login-page 200 is not that test. Prefer an
upstream-compatible release; any temporary Composer patch needs a clean-install regression and an
exit condition, never an untracked vendor edit. Apply the
[fleet integration contracts](../../typo3-upgrade-run/references/fleet-regression-contracts.md)
only to surfaces the extension supplies; do not start a whole-site upgrade for one extension fix.

Classify Scanner findings. Compatibility aliases can intentionally remain on the target while the
scanner warns about their future removal; runtime tests decide whether they are still needed.

## Migrate persisted identities before registrations

Move legacy `tt_content.list_type` data to CType before enabling CType-only registration, with
translation/workspace coverage and an idempotent second run. Before tightening Content Block
nullability or dropping fields such as `pages.url`, audit every stored value even when an upgrade
wizard is already marked done. Schema convergence without a row-level proof is not data integrity.

## Extract a minimal provider deliberately

When a broad incompatible extension supplies only a few used CTypes/tables/templates, a project-owned
replacement may extract that small contract. Inventory CTypes/list types, tables, fields, IRRE/FAL
identities, templates, processors, TypoScript and assets first. Preserve legacy database and FAL
identities under an invariance contract; rename only through a separately tested repeatable migration.

Before removing the provider, scan persisted `EXT:` paths, namespaces, CType/plugin signatures,
FlexForms, TSconfig, `sys_template`, icon paths and form identifiers, including translations and
workspaces. Parse structured values through TYPO3 APIs rather than blind SQL replacement. Removal
needs zero undocumented live residue, clean relation/reference-index checks and a render of every
retained path.

Moving a Form Framework `*.form.yaml` file also moves a persisted identifier. Register the new
`persistenceManager.allowedExtensionPaths` entry, migrate `settings.persistenceIdentifier` inside
`tt_content.pi_flexform` with an idempotent structured-data-aware wizard, then submit each form and
prove finishers/mail before deleting the old extension.

Fluid cache warm-up is not render coverage. A custom ViewHelper namespace must be declared in every
independently parsed template or partial that uses it; render every retained CType, plugin/list type
and page template at least once.

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-extension-upgrade-skill

Special thanks to Netresearch for publishing and maintaining these skills.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
