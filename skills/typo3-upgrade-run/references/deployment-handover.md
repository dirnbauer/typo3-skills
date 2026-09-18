# Deployment audit and deployer information

This skill never deploys. It audits deployment code locally, proves what can be proved without a
remote environment, and writes exact operator instructions into `report/handover-deployment.md`.

## Audit Deployer when its major changes

A Deployer 7-to-8 update is a recipe migration, not only a Composer constraint. Review the complete
recipe and its imported recipes for:

- project tasks that now collide with built-in task names or duplicate built-in behavior;
- removed/renamed configuration and custom overrides that are no longer needed;
- the selected PHP binary (`bin/php`) on the target hosts;
- `shared_files`, `shared_dirs`, writable paths and whether `settings.php` is actually shared;
- cleanup/rollback expectations and release retention; and
- database commands: schema and reviewed non-destructive migrations must precede cache warm-up,
  while destructive cleanup remains a separately approved operator action.

Use the project's canonical Deployer entry point to inspect `dep tree` and `dep config` locally.
Record the exact command and relevant output; do not run a task against a host. Remove duplicate
tasks only after proving what Deployer 8 already supplies.

## Install EXT:deployer_information on the target rung

The Composer package is `spooner/deployer-information`; the TYPO3 extension key is
`deployer_information`. Verify current metadata at execution time rather than freezing this guide
to a release. Checked 2.0.1 supports TYPO3 13.4/14.3 and PHP ^8.2; 2.0.0 required PHP ^8.4.
Keep the project's PHP 8.4 standard and install after reaching the compatible rung:

- [TYPO3 Extension Repository](https://extensions.typo3.org/extension/deployer_information)
- [Composer metadata](https://packagist.org/packages/spooner/deployer-information)

```bash
ddev composer show --all spooner/deployer-information
ddev composer require spooner/deployer-information:^2.0
ddev typo3 extension:setup
ddev composer show spooner/deployer-information
```

Record the locked version in `manifests/extensions.json` as an operational dependency. Verify that
PHP `ext-intl` is available in the local and target runtime because it provides the preferred date
formatting:

```bash
ddev exec php -r 'var_export(extension_loaded("intl")); echo PHP_EOL;'
```

## Configuration modes

For standard Deployer 7+ layouts, no project configuration is required: the extension detects the
deployment metadata under the project-adjacent `.dep` directory, including `latest_release` and
`releases_log`. Older Deployer layouts use `.dep/releases`.

For a custom deployment workflow, the extension reads a `LAST_DEPLOY` file in TYPO3's project root.
The deployment owner must update that marker only after successful release activation and cache
warm-up. Document that hook in the handover; this skill does not add it to a remote pipeline or run
it there.

Do not create `LAST_DEPLOY` for a standard Deployer setup merely to make the toolbar show a value.
That masks whether the actual release metadata is readable.

## Local verification

After cache flush/warm-up, log in to the TYPO3 backend and verify that System Information contains
“Last Deployment” without exceptions. For standard Deployer, use representative local `.dep`
metadata only if the repository already provides it. For a custom workflow, an isolated local probe
may create an exact `LAST_DEPLOY` file, verify the toolbar, then remove that file and confirm
`git status --short` is unchanged.

The handover must ask the deploying party to verify after the first real deployment:

- the displayed date matches the activated release, not the build start;
- the detected mode is the intended standard/legacy/custom mode;
- the deployment user can update/read the marker metadata; and
- failure or rollback does not publish a misleading newer timestamp.

This is an information and observability feature, not proof that a deployment completed safely.

## Fleet-derived release contract

When deployment code or package/runtime configuration changes, audit these locally and put the
unverified remote consequences in handover. Do not run remote commands as part of this upgrade.

- Inspect the exact release archive, not merely the checkout. Required migration/flush helpers,
  Composer patches/locks and production assets must be present. Private `.typo3-update` evidence,
  backups, authentication state and env files must be absent. Move reusable deployment helpers into
  a project-owned deploy/scripts location; do not ship the entire run directory to retain one helper.
- Resolve the target PHP binary for **every** Composer, console, migration and cache task. A pinned
  `bin/php` is ineffective when a custom task hardcodes another `php`. Preserve the host-specific
  web handler and shared configuration; CLI proof does not prove FPM/web worker parity.
- Inspect task order around release activation. Prove locally that the selected flush covers
  compiled DI as well as ordinary caches; an existing custom cache helper may cover only one.
  Handover requires the authorized deployment owner to check the active release and real web
  modules/assets after cutover, including OPcache where the host needs it. Do not prescribe an
  unauthenticated web reset endpoint or a blanket CDN purge.
- Record production context names, expected host predicates, header/TLS ownership and provider/CDN
  configuration separately from DDEV. Inspect authorized live evidence only in its separate task.
- Reconcile prior hotfixes with the next release's source/patches. Shared env persistence alone
  does not preserve an application fix. If the release root changes while preparing an authorized
  operation, stop and re-resolve identity/hashes; do not apply to the remembered symlink target.

See the [September follow-up](run-retrospective-2026-09-16.md) for FMW archive exclusions,
Scioflex/Gütezeichen/ÖIAT runtime differences, Saferinternet DI cache behavior and Watchlist cache
invalidation. These are bounded release checks, not permission to deploy.
