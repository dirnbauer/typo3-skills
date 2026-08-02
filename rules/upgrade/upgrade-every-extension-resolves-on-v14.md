---
id: upgrade-every-extension-resolves-on-v14
title: "Declare v14-incompatible extensions before migrating anything, and give every one of them a resolution"
category: upgrade
severity: error
appliesTo: ["**/composer.json", "**/composer.lock", "**/ext_emconf.php", "packages/**", "**/*.md"]
typo3: ">=14.0"
php: ">=8.2"
trigger: "Use when planning or running a TYPO3 upgrade to v14, or when adding, forking or removing an extension during one."
---
# Every extension resolves on v14, and the ones that do not are announced first

A TYPO3 site is on v14 when its **complete** extension set resolves and works there. One extension
without a v14 release blocks the whole install, so it decides the shape and the cost of the project.
Discovering that in week three is the single most expensive way to run an upgrade.

## Announce the blockers before migrating anything

Resolve the whole set **first**, at inventory time, and say out loud — at the top of the plan, before
any migration work — which extensions have no v14 release:

```bash
ddev composer why-not typo3/cms-core "^14.3"
```

Every package it names is a blocker. Report them as a list, up front, with what each one provides
and who depends on it. A blocker buried in the middle of a status update has not been declared.

This is not pessimism. Some blockers are purchases with lead time, some need a fork nobody budgeted,
and some are features the client will choose to drop — all decisions that belong at the start, to
the people paying for the project, not to an agent three phases in.

## Then give every extension exactly one resolution

| Situation | Do this | Resolution |
|---|---|---|
| A v14-compatible release exists | Require the **newest** one, verified on Packagist at execution time | `updated` |
| It lives in `packages/` | Migrate it in place — it is a first-class target, not a special case | `updated` |
| No v14 release, but an upstream branch, fork, or successor exists | Use it; a `dev-` branch needs the lockfile committed and an exit condition | `updated` |
| No v14 release, and TYPO3 v14 Core now does the job | Remove the extension | `replaced` |
| Only a small, stable provider surface is used | Extract that contract into a project-owned sitepackage, preserve legacy database/FAL identities, migrate stored textual references, then remove the provider with approval | `replaced` |
| No v14 release and the feature must stay | **Fork it into `packages/` and maintain it yourself** | `forked` |
| It still breaks after real migration attempts | Measure the impact of removal, then let the user decide | `removed-approved` |

`unresolved` is not an end state. Never silently drop a feature because its extension was awkward.

## Forking into `packages/`

A local fork is a maintenance commitment, so it needs an approval and a recorded exit condition —
but it is a legitimate answer, and often the only one:

```bash
mkdir -p packages && git -C packages clone <upstream-url> <ext-key>
ddev composer config repositories.<ext-key> path "packages/<ext-key>"
ddev composer require <vendor>/<package>:"@dev"
```

Then raise the fork's own `composer.json` to `typo3/cms-core: ^14.3` and the project's PHP target,
and run the full migration pipeline **inside the package** — Rector, Fractor, manual v14 work,
PHPStan, tests — exactly as for any other extension. A path repository beats Packagist for that
package name, so nothing else in the project needs to change.

Record it as technical debt with the condition that ends it: when upstream publishes a v14 release,
drop the path repository and require the released version.
