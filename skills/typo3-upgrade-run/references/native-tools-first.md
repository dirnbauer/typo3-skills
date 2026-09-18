# Native TYPO3 tools before custom solutions

User preference, 2026-09-17. Apply when choosing an implementation at intake, dependency work or a
migration/recovery node. Do not create a new checklist document per command: record the choice and
any gap in the existing node evidence. Reuse results until their code/config/data inputs change.

## Selection order

1. **Installed TYPO3 Core command, upgrade wizard or backend tool.** Verify its registered command,
   current `help`, actual implementation and applicable version. Core APIs are the next choice when
   no CLI exposes the required operation; use supported DataHandler/FAL/configuration APIs.
2. **Existing compatible extension's documented command/wizard.** Prefer its maintained upstream
   implementation over reimplementing its data migration. Existing dependencies are not removed
   merely because their download counts are lower; preserve the used feature and assess its risk.
3. **A widely used, maintained package for a demonstrated gap.** Check the dated shortlist below,
   current stable constraints, maintenance, advisories and the actual operation. Add only packages
   needed by this node; do not install the whole shortlist or another parent upgrader.
4. **Small project-owned adapter/wizard only for the remaining gap.** Record which native/upstream
   option was insufficient and why. Use a registered TYPO3 command/upgrade wizard and supported APIs
   for project data writes, with scoped rollback, pre/post invariants and a no-change rerun. Do not
   create standalone PHP bootstraps, a replacement schema engine, regex-based content migration,
   custom dotenv parser or a second cache/reference-index implementation.

The collection's graph, evidence hashing, parity capture and publication allowlist have no equivalent
Core closure contract. Keep that harness; it orchestrates native tools rather than replacing them.
Small policy checks such as local-extension metadata validation supplement the Core scanner, not
supersede it. A native tool is not permission for destructive cleanup, remote calls or new features.

## Existing Core capabilities to reuse

Inspect the installed `ddev exec vendor/bin/typo3 list --raw` and relevant `help <command>` once per
changed command provider/version. `ddev typo3` is equivalent only when the project's wrapper points
to that binary; do not assume every third-party command listed there belongs to Core.
The [Core command reference](https://docs.typo3.org/m/typo3/reference-coreapi/14.3/en-us/ApiOverview/CommandControllers/ListCommands.html)
is discovery guidance; installed source determines availability and side effects.

| Need | First choice | Boundary |
|---|---|---|
| Inventory | `extension:list`, `site:list`, `site:show`, `site:sets:list` | Sanitize site/config output; no ad-hoc bootstrap just to enumerate packages/sites |
| Core/extension data upgrade | `upgrade:list`, `upgrade:run <reviewed-id>` | Review actual wizard and prerequisites; snapshot before mutation; unqualified run executes all available wizards |
| Schema and package setup | Core Database Analyzer, `extension:setup` | Setup writes schema/config/static data; it is not a dry run or a blanket-safe schema diff |
| Compatibility discovery | Core Extension Scanner in System → Upgrade | Inspect strong/weak findings, then use maintained Rector/Fractor rules; not a self-written replacement scanner |
| Template diagnostics | `fluid:analyze`, `fluid:namespaces`, `fluid:cache:warmup` | Verify discovery includes affected templates and interpret findings; actual rendered paths still need proof |
| References | `referenceindex:update --check`, then authorized `referenceindex:update` | Check output, not exit alone; do not rebuild `sys_refindex` with custom SQL |
| Cache / local assets | `cache:flush`, `cache:flushtags`, `cache:warmup`, `asset:publish` | Use the smallest relevant operation; recheck actual DI/runtime effect and published assets |
| Redirects | `redirects:checkintegrity` | Treat its writes/HTTP requests as scoped operations after inspecting implementation; don't bulk-delete redirects |
| Form storage transition | `form:definition:transfer` with selected identifier and dry run | Evaluate before writing a custom persistence-identifier migration; verify all referenced records, languages and workspaces |
| Page-tree transfer | `impexp:export` / `impexp:import` from Core `cms-impexp` | T3D/XML record transfer, not a full database backup or proven conflict-aware live synchronization |
| Local DB/files preparation | Official DDEV snapshot/export/import commands and existing rsync tooling | Outside the upgrade's sync authority; preserve staging, checksums, local overrides and backups |

See [Core upgrade tools](https://docs.typo3.org/m/typo3/reference-coreapi/14.3/en-us/Administration/Tools/Upgrade/Index.html),
[Core import/export](https://docs.typo3.org/c/typo3/cms-impexp/14.3/en-us/Usage/CommandLine.html)
and [DDEV commands](https://docs.ddev.com/en/stable/users/usage/commands/).

## Traps verified in installed Core 14.3.7

- `upgrade:list` returns success even while necessary wizards remain. Inspect its list; the exit
  code alone is not fixed-point proof. Core's bounded internal prerequisite/configuration work is
  not a reason to wrap the command in another repeat-until-green controller.
- `extension:setup --extension=key` filters package initialization, **not the schema blast radius**:
  `PackageSetup::updateDatabaseSchemaForAllPackages()` processes all active package definitions.
  Review the whole schema delta and warnings and take the correct snapshot before running it.
- `fluid:analyze` defaults to discovered `*.fluid.*` templates. Legacy `.html` may need explicit
  `--stdin` analysis; reconcile checked files with the affected inventory. In this version its
  `--json` path returns success even with errors: inspect the JSON findings/counts. Zero checked
  templates is missing coverage, not a clean site. Neither mode proves data-dependent rendering.
- `form:definition:transfer` updates `tt_content` references but no other tables. Inspect its actual
  filters and transformation before assuming translated/workspace/custom records are covered.
  Same-storage moves need an explicit identifier. Never use `--move` without source-deletion
  approval. A configured extension-path move is not automatically a requirement to switch storage.
- `cleanup:*` names do not imply read-only behavior. For example `cleanup:missingrelations` removes
  references without `--dry-run` and may also update the reference index as a prerequisite. Inspect
  every option and prerequisite; no blind cleanup, mark-undone, replayed wizard, or `--force`.

These are inspected-source facts, not commands run on a customer database during this review.
Recheck the selected rung/patch before relying on flags. Preserve output and command exit separately.

## Widely used candidates, not an installation list

For **new optional non-Core dependencies**, use a conservative collection default for “many
downloads”: at least **100,000 total and 1,000 monthly Packagist downloads**, plus a maintained,
non-abandoned stable release compatible with the selected environment and acceptable audit results.
This numeric default is our selection convention, not a TYPO3 standard or a user-supplied number.
Report counts/source/date; downloads include CI reinstalls and do not prove unique sites, security
or quality. Do not silently lower the threshold or substitute GitHub stars. Unknown/low adoption
means do not recommend/install by default; bring a necessary exception to the user.

Live Packagist API snapshot, **2026-09-17** (`https://packagist.org/packages/<vendor>/<name>.json`):

| Package (community, not Core) | Total / monthly downloads | Stable checked | Use only for |
|---|---:|---|---|
| [TYPO3 Console](https://packagist.org/packages/helhum/typo3-console) | 9,858,923 / 157,512 | 9.0.1; Core ^14.3 allowed | Granular schema preview with `database:updateschema "*.add,*.change" --dry-run` where Core CLI does not expose it; prefer already installed |
| [TYPO3 Rector](https://packagist.org/packages/ssch/typo3-rector) | 3,564,809 / 146,703 | 3.16.0 | Existing PHP migration rules; verify the selected v14 set and Composer/tool compatibility |
| [TYPO3 Fractor](https://packagist.org/packages/a9f/typo3-fractor) | 540,177 / 72,433 | 1.0.0 | Existing TypoScript/Fluid/FlexForm/YAML/XLIFF migration rules; verify v14 set coverage |
| [Content Blocks](https://packagist.org/packages/friendsoftypo3/content-blocks) | 668,840 / 60,699 | 2.4.9; Core ^14.3.7 | Planned content-model migration, native lint/list commands; not mandatory replacement of every working CType |
| [Deployer Information](https://packagist.org/packages/spooner/deployer-information) | 195,256 / 1,409 | 2.0.1; Core ^13.4 or ^14.3 | The already-required deployment toolbar; no bespoke timestamp extension |
| [Symfony Dotenv](https://packagist.org/packages/symfony/dotenv) | 259,206,664 / 6,883,599 | Resolve within the actual lock | File loading only when environment injection is insufficient; do not force the newest incompatible Symfony major |
| [Dotenv Connector](https://packagist.org/packages/helhum/dotenv-connector) | 5,224,965 / 122,152 | 3.2.0; Composer plugin | Retain a working compatible loader with plugin consent; not the old config-handling extension |

TYPO3 Rector and Fractor are third-party tools referenced in TYPO3's upgrade guidance, not Core
commands. Prefer their existing transformations over new search/replace scripts; application tests
still own semantics. Respect Composer plugin approval and run tooling inside the selected DDEV.
When no Helmut Hummel dependency is wanted, prefer injected env or compatible Symfony Dotenv.

Not selected: `b13/content-sync` has 5,341 total / 81 monthly downloads despite a v14-compatible
3.1.1 declaration; it does not meet this adoption policy. `helhum/typo3-config-handling` (320,946 /
2,438), `ichhabrecht/filefill` (1,569,764 / 32,159) and upstream `in2code/powermail` (2,710,912 /
46,431) pass adoption but their latest checked stable releases do **not** declare v14 support.
Popularity cannot solve compatibility. `wapplersystems/core-upgrader` (30,938 / 1,322; stable
13.0.1) is not a reason to skip the supported major-version path or add a second orchestrator.
Re-resolve facts at execution; existing feature/fork decisions remain subject to the user's scope.

## Before retaining custom sync or migration code

Try the native candidate against a small authorized disposable fixture, then compare exact coverage:
identity, FAL/IRRE, translations/workspaces, target-only edits, conflict detection and fixed point.
Core Import/Export is a candidate for a scoped tree transfer, not proven replacement for the fleet's
three-way incremental merge. Document that gap before extending a project-specific adapter and keep
its actual writes on supported Core APIs. Do not copy an entire customer sync framework by default.

Register the selected tool/version/operation and any fallback reason in node evidence. Share it
across affected checks; no per-page tooling evaluation or nested retry budget. Behavioral evals
exercise Core-first choice, adoption/compatibility, native side effects and output interpretation;
their proposed status does not claim successful model trials.
