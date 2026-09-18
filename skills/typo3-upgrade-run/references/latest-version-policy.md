# Latest stable is the default

User preference, 2026-09-18. Apply to every dependency and tool in the authorized update scope:
Core/extensions, Vite and its plugins, Bootstrap, Sass/PostCSS, loaders, PHPStan, Rector/Fractor,
Deployer and project runtimes. Do not add unused packages or update unrelated host/global tools.

## Select from current releases, not old constraints

- Resolve the newest **stable, maintained, compatible** release from the official project and
  registry at execution time. Dated examples, a working old installation, an imported skill's
  version heading and the current lockfile are not target versions.
- Preserve explicit target families: this run targets TYPO3 14.3 LTS and, when used, Bootstrap 5.x;
  choose their latest eligible releases. Preserve the selected PHP target/rung policy. Do not turn
  a general latest-version preference into an unrequested TYPO3/Bootstrap major or product change.
- For packages without an explicit target-family restriction, assess the newest stable major too.
  Update inherited manifest constraints when the reviewed migration permits it. An old Vite/plugin
  pin alone is not proof that a newer release is incompatible: assess its Node engine, peer ranges,
  adapter and migration guide together. Upgrade the blocking dependency/runtime within scope first.
- Use stable releases by default, not beta/RC/nightly/dev branches or floating install commands.
  An approved compatibility fork remains an explicit exception, pinned to its exact source commit;
  check whether a stable upstream release now replaces it.

Use official package-manager discovery rather than a custom version scraper. Inspect
`ddev composer outdated --direct --format=json`, `ddev composer show --all <package>` and
`ddev composer why-not <package> <candidate>` for PHP dependencies. In the existing frontend
workspace/runtime, use its package manager's outdated and package metadata commands. For npm,
`wanted` is constrained by the existing manifest; `latest` is a publisher-managed tag, not proof
of the highest stable compatible release. Compare release metadata and requirements before selecting.
See [Composer's commands](https://getcomposer.org/doc/03-cli.md#outdated),
[npm's version columns](https://docs.npmjs.com/cli/v11/commands/npm-outdated/#description)
and [Vite's release policy](https://vite.dev/releases).

## Exceptions must be visible

Record current version, newest stable candidate, selected version, source URL, lookup time and
compatibility/test evidence in the existing dependency/assets node report; reuse that record in
handover. This is one decision per component, not a new document or graph node per package.

If the selected version is older than the newest stable within the allowed family, record the
concrete blocker, attempted resolution, affected feature, safe fallback, approval reference and
exit condition. Obtain explicit user acceptance before retaining that fallback. No response means
pending/blocked, not silently approved. A registry outage means current-release status is unknown;
do not invent a version or call a cached example current. Never bypass platform/peer requirements,
security checks or global stability settings to claim the newest version works.

## Lock once, prove once

Select and record versions at dependency planning or the bounded assets node, then lock exact
resolved versions and test the actual production build/runtime. Keep pixel, interaction, backend
and Lighthouse gates; latest does not authorize redesign or removal of used features. An installed
but outdated frontend is applicable work, not a reason for `vite-assets` to return not-applicable.

Choose current stable compatible measurement tools before Baseline A, then pin the same browser,
Lighthouse and harness environment across source/target proof. Do not chase releases during each
page, retry or final pass. Reuse the dated decision for the sealed run; a necessary security or
compatibility change requires explicit replanning and affected-evidence invalidation, never an
overwritten baseline or a deadline extension. Re-resolve releases for the next run.

Behavior checks: `latest-stable-default-not-old-example`, `latest-not-mid-proof-moving-target`,
`latest-unavailable-or-blocked-not-guessed` and `migration-latest-tooling-with-proof` in the owned
eval suites. They are proposed cases, not an automated proof of model behavior or current versions.
