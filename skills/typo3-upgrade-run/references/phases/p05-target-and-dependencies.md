# P05 — Target, environment and dependencies (loop 100)

Track `invariance`. Resolve every dependency before touching application code.

## Preconditions
P04 green.

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
6. Migrate extension metadata to `composer.json` per #108345.
7. If committed credentials are discovered, stop exposing them and record rotation as a security
   follow-up. Do not turn a routine core upgrade into a dotenv architecture migration unless the
   credential issue blocks safe local execution or the user explicitly includes that work.
8. Keep the project's existing PHPStan and deployment tooling unless compatibility requires a
   change. Upgrading PHPStan or installing `deployer_information` is optional assurance work.
9. `ddev composer validate --strict`, update with the narrowest justified command, inspect the
   lockfile diff.

## Exit
`ddev composer why-not typo3/cms-core "^14.3"` names no blocker. `why-not php 8.4` empty, and the 8.5
attempt recorded with its outcome. Every extension in `manifests/extensions.json` has a resolution.

## Blocking
Any extension left `unresolved`. A removal without an approval record.
