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
4. Plan the ladder. v12 with a real database → `^13.4` first (loop 110). v13 or a code-only package →
   straight to `^14.3`.
5. Audit every required and dev package against current release metadata and route it through
   `references/extension-strategy.md`.
6. Migrate extension metadata to `composer.json` per #108345.
7. **Move environment-specific configuration and secrets into `.env`.** An upgrade is when this is
   cheapest to fix, and most v12-era projects carry credentials in committed files — a sync script
   with a production password, a hard-coded database block in `AdditionalConfiguration.php`, an API
   key in TypoScript. Add [`helhum/dotenv-connector`](https://packagist.org/packages/helhum/dotenv-connector)
   (a Composer plugin, not an extension, so it needs no TYPO3 constraint and works in v12, v13 and
   v14 alike):

   ```bash
   ddev composer require helhum/dotenv-connector
   ```

   It hooks the Composer autoloader, so `.env` is loaded for every entry point — web, CLI, scheduler,
   tests — before TYPO3 boots, and values arrive as ordinary `getenv()` / `$_ENV` reads. Then:
   - keep `.env` out of git and commit a `.env.dist` documenting each key with a safe placeholder;
   - read values in `config/system/additional.php` (or `AdditionalConfiguration.php`) instead of
     literals — database, mail transport, `trustedHostsPattern`, API keys, feature switches;
   - **rotate every credential that was ever committed.** Removing it from the working tree does not
     remove it from history; treat a committed secret as disclosed.

   Record the resulting key list in the handover: per-environment values are exactly what P15 has to
   hand over, and a `.env.dist` is that list already written down.
8. Update PHPStan to the newest release compatible with the resolved dependency set, including
   `saschaegerer/phpstan-typo3` through `phpstan/extension-installer`. Do not copy stale config.
9. On the PHP 8.4 / TYPO3 13.4-or-14.3 compatible rung, install and locally configure
   `spooner/deployer-information` per `references/deployment-handover.md`. Verify current metadata
   before selecting the constraint; record its locked version and extension key
   `deployer_information` in the extension manifest.
10. `ddev composer validate --strict`, update with the narrowest justified command, inspect the
   lockfile diff.

## Exit
`ddev composer why-not typo3/cms-core "^14.3"` names no blocker. `why-not php 8.4` empty, and the 8.5
attempt recorded with its outcome. Every extension in `manifests/extensions.json` has a resolution.
`deployer_information` is installed at a compatible version and its local configuration mode is
recorded.

## Blocking
Any extension left `unresolved`. A removal without an approval record.
