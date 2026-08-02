# Extension update strategy

Every installed extension gets updated — third-party and local alike. The site is only on v14 when
its **complete** extension set resolves and works there. Classify each extension during the P01
inventory, record the classification and its resolution in `manifests/extensions.json`, and route it
through one of the four branches below.

Gate A5 requires every extension to carry a resolution. `unresolved` is not an allowed end state.

## Declare the blockers loudly, before any migration work

Resolve the whole set at inventory time and **say out loud, at the top of the plan, which extensions
have no v14 release** — before a single migration step runs:

```bash
ddev composer why-not typo3/cms-core "^14.3"
```

Every package it names is a blocker on the whole install. List them up front with what each provides
and who depends on it. A blocker mentioned in passing three phases in has not been declared.

This is what makes the difference between an upgrade and a surprise: some blockers are purchases
with lead time, some need a fork nobody budgeted, some are features the client will choose to drop.
Those are decisions for the people paying for the project, and they are cheap at the start and
expensive in week three. See `rules/upgrade/upgrade-every-extension-resolves-on-v14.md`.

## 1. On Packagist

Require the newest release whose constraints declare TYPO3 14.3 and the PHP target, verified against
current Packagist metadata **at execution time** — never from memory.

```bash
ddev composer why-not typo3/cms-core "^14.3"
```

names every package still blocking the core jump. Clear all blockers before requiring the new core.

Resolution: `updated`, with the resolved version recorded.

## 2. Local extension in `packages/`

A first-class migration target, not a special case. Keep it wired through the project's Composer
path repository, raise its own `composer.json` to `typo3/cms-core: ^14.3` and the project's PHP
target, and run the full pipeline inside it — Rector, Fractor, manual migration, PHPStan, tests —
exactly as for any other extension.

Local extensions are held to the stricter PHPStan level (10) because nothing external constrains
them.

Resolution: `updated`.

## 3. No v14-compatible release

Look, in this order:

1. An upstream development branch or pending release.
2. A maintained fork or successor extension.
3. **A TYPO3 v14 Core feature that replaces it.** Check this properly — v14 absorbed functionality
   that used to need extensions, and removing a dependency is better than migrating one.

If the feature must stay and none of the above exists, **fork it into `packages/` and maintain it
yourself** — a local extension the project owns, wired into the root `composer.json` through a path
repository:

```bash
mkdir -p packages && git -C packages clone <upstream-url> <ext-key>
ddev composer config repositories.<ext-key> path "packages/<ext-key>"
ddev composer require <vendor>/<package>:"@dev"
```

The path repository wins over Packagist for that package name, so nothing else in the project
changes. Then raise the fork's own `composer.json` to `typo3/cms-core: ^14.3` and the project's PHP
target and run the full pipeline **inside the package** — Rector, Fractor, manual v14 work, PHPStan,
tests — exactly as branch 2 requires, because from here on it *is* a branch-2 local extension.

Record the fork as technical debt in the handover, with the condition that ends it: when upstream
publishes a v14 release, drop the path repository and require the released version.

A fork needs an approval (matrix #13) and an ADR: it is a maintenance commitment, not a fix.

Resolution: `forked` or `replaced`.

## Known blockers with a standing answer

Some packages come up on nearly every v12/v13 project and already have a decided outcome. Check
current metadata anyway — this list is a head start, not a substitute for looking:

| Package | Outcome | Why |
|---|---|---|
| `ichhabrecht/filefill` | **remove** | A development convenience that fills missing files from a remote source. Its newest release (5.0.0) is `^13.4`-only, so it blocks the 14.3 rung, and it is a dev dependency with no production role. Remove it rather than holding the whole upgrade for a helper. |
| `wapplersystems/core-upgrader` | **remove** | A tool for performing a major jump, not a runtime dependency. Once the jump is done it has no reason to stay, and its own versions trail the core it upgrades. Frequently sits in `require-dev` of a project meta-package rather than the root, so `composer remove` needs `--dev`. |
| `in2code/powermail` | use the `dirnbauer/powermail` v14 fork or remove | Upstream has no v14 release. When forms are genuinely in use, use the approved `typo3-v14` branch from `https://github.com/dirnbauer/powermail`; when nothing uses Powermail, remove it instead. **Check first**: a site can carry Powermail in `composer.json` with zero forms, fields and mails because its forms were built with Core `EXT:form`. |
| `fluidtypo3/fluid-components` | **replace** where it blocks the target | Move the existing component contract to native Fluid components, preserving namespaces, argument types, FAL objects and link behavior. Follow `references/native-fluid-components.md`; visible bug fixes remain declared changes. |

The general lesson under that last row: an extension appearing in `composer.json` proves it was
installed once, not that anything uses it. Count the records and the content elements before
committing to migrate or fork something.

### Approved Powermail v14 fork

For a site that uses Powermail, configure the approved VCS repository and require its v14 branch:

```bash
ddev composer config repositories.powermail-v14 vcs https://github.com/dirnbauer/powermail.git
ddev composer require in2code/powermail:"dev-typo3-v14" --with-all-dependencies
```

Before requiring it, verify at execution time that the branch still:

- uses the Composer identity `in2code/powermail`;
- requires `typo3/cms-core: ^14.3`;
- supports the selected PHP target; and
- comes from `github.com/dirnbauer/powermail`, not a similarly named repository.

Record the resolved commit from `composer.lock`, run the full extension migration and test pipeline,
and classify the resolution as `forked` with its approval and ADR. The Composer lock is the
reproducibility anchor; never follow an unrecorded moving branch in a completed run.

## 4. Still broken after migration attempts

Measure before deciding. Take a fresh `ddev snapshot`, then `ddev composer remove` the extension and
record what actually changes:

- frontend pages that rendered its output
- content elements and plugins it provided
- backend modules
- scheduler tasks
- TCA columns
- database tables left behind

If the site works without it, **propose** removing it permanently and let the user decide (matrix
#12). Document orphaned tables and columns for later cleanup.

If the loss matters, restore the snapshot, reinstall, and either fix the extension in `packages/` or
replace its functionality before the completion gate.

**Never drop a feature silently.** The uninstall experiment is a measurement, and its result is
evidence for a decision the user makes — not a decision the skill makes.

Resolution: `removed-approved`, with the approval id.

## Recording

`manifests/extensions.json`, one entry per installed extension:

```json
{
  "key": "news",
  "composer": "georgringer/news",
  "source": "packagist",
  "version_before": "11.4.3",
  "version_after": "13.0.1",
  "classification": "packagist",
  "resolution": "updated",
  "php_target_ok": true,
  "approval_ref": null,
  "notes": ""
}
```

`classification` is what it *is* (`packagist` · `local` · `no-v14-release`); `resolution` is what
*happened* (`updated` · `forked` · `replaced` · `removed-approved`).

## Interaction with the visual contract

Extension updates are Contract A work. An extension shipping a "more modern template" is not a
licence to change rendering — that is a `regression` until it is repaired or explicitly approved as
a `declared-change` with its own before/after evidence.

Where an extension's new version genuinely cannot reproduce the old output, that is a finding for
the user to decide on, and the decision belongs in `approvals/` before the loop closes.
