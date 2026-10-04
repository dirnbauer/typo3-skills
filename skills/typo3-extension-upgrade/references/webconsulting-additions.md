# webconsulting additions — `typo3-extension-upgrade`

> **Overlay.** The vendored `SKILL.md` and references remain upstream-owned. These additions record
> project-tested TYPO3 v14 workflow constraints.

## Migration versus assessment

A requested extension version raise stays here until target installation and runtime checks are
accounted for. Use `typo3-conformance` for a bounded metadata/quality assessment; its scan is not
the migration's completion proof. A whole-site upgrade remains owned by `typo3-upgrade-run`.

## Class references and clean installs: corrections to upstream shorthand

Scan production code and tests for removed APIs, but classify each result. A PHP `use`
alias does not load its target. An unresolved property/parameter/return type declaration
also does not invariably fail when the file is loaded. Inheritance, interface/trait
resolution, reflection/autoloading, instantiation and PHPUnit mock creation can require
the class at different times. Do not delete imports or skip tests just to silence a scan;
prove each retained compatibility path on every supported Core line.
Source: [PHP namespace importing](https://www.php.net/manual/en/language.namespaces.importing.php).

For the upstream clean-install recipe, inspect the resolved `vendor` directory before
removing anything. It must contain only reproducible Composer dependencies, not local
work, a symlink or a shared tree. Prefer a clean temporary checkout or a recoverable
rename when uncertain. `composer install` executes permitted project scripts/plugins:
review that trust boundary first. Capture the real exit status of resolution, install
and tests; the upstream trailing `echo` prints the prior status but itself exits zero.
Do not use that compound command's final shell status as a CI gate.

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

Recheck this after patch-level Core updates too: the September 2026 Site D and Site G
repairs exposed an inline page-controller constructor dependency on installed backend internals.
Verify the target constructor/factory in vendor source, compile DI, then open the actual
authenticated module with a representative record. A login-page 200 is not that test. Prefer an
upstream-compatible release; any temporary Composer patch needs a clean-install regression and an
exit condition, never an untracked vendor edit. Apply the
[fleet integration contracts](../../typo3-upgrade-run/references/fleet-regression-contracts.md)
only to surfaces the extension supplies; do not start a whole-site upgrade for one extension fix.

Classify Scanner findings. Compatibility aliases can intentionally remain on the target while the
scanner warns about their future removal; runtime tests decide whether they are still needed.
Without backend access, run the Core matchers headlessly with
[`typo3-upgrade-run/scripts/extension-scanner.php`](../../typo3-upgrade-run/scripts/extension-scanner.php)
(`--path=` the extension; exit 1 on a strong match or parse error).

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

## #109585 applies to direct v13 → 14.3 too

Upstream `upgrade-v13-to-v14.md` §2 says to skip the #109585 wizard when upgrading directly from
v13. Do not: 12.4/13.4 left empty `password`/`password2` keys in `be_users.uc`, which
`setup_userSettingsMigration` copies into `user_settings`, and the scrubber is idempotent. Keep the
user-settings wizards in registry order and judge residue by value, not key — see the
[typo3-security v14 notes](../../typo3-security/references/v14-notes.md).

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-extension-upgrade-skill

Special thanks to the Netresearch team for generously sharing the practical TYPO3 and PHP
expertise behind these skills, and for the continuing care they put into their documentation,
examples and maintenance. Their work gives this collection a foundation we are genuinely
grateful to build on.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
