# P05 — Target, environment and dependencies (loop 100)

Track `invariance`. Resolve every dependency before touching application code.

## Preconditions
The deterministic baseline node passed. P03/P04 optional improvements are not prerequisites.

## Steps
1. Align the DDEV environment with the ladder rung, not with the destination: keep a PHP version the
   installed core supports so the site boots. `ddev restart` after each change.
2. Set the target per `references/typo3-14-constraints.md`: `typo3/cms-core: ^14.3`, PHP 8.4 with an
   explicit 8.5 attempt recorded.
3. Keep `config.platform.php` in step with the container — never ahead of it.
4. Plan the ladder. v12 with a real database → `^13.4` first (a stateful loop 100 iteration). v13 or a code-only package →
   straight to `^14.3`.
5. Audit every required and dev package against current release metadata and route it through
   `references/extension-strategy.md`.
6. Require `typo3/cms-redirects:^14.3` in every whole-site target. If it is absent, add it to the
   planned Core Composer transaction; do not run an unrelated broad update. Package setup and
   editor permissions follow `references/feature-upgrades.md`.
7. Migrate extension metadata to `composer.json` per #108345.
8. Read `references/project-environment.md`: use ignored root env files or environment injection
   for credentials, retaining a compatible existing loader. Verify CLI and web precedence with
   non-secret fixtures. Historical exposure still requires a rotation finding.
9. Require compatible `spooner/deployer-information` and verify registration/toolbar at P12.
   Keep PHPStan and the Deployer CLI major unless compatibility requires a change; neither is
   the information extension. Require the latest stable Bootstrap 5.x when present; migrate
   project jQuery to native JS with tested, explicit exceptions only for unavoidable dependencies.
10. `ddev composer validate --strict`, update with the narrowest justified command, inspect the
   lockfile diff.

## Exit
`ddev composer why-not typo3/cms-core "^14.3"` names no blocker. `why-not php 8.4` empty, and the 8.5
attempt recorded with its outcome. Every extension in `manifests/extensions.json` has a resolution;
`typo3/cms-redirects:^14.3` is present for a whole-site run.

## Blocking
Any extension left `unresolved`. A removal without an approval record.
