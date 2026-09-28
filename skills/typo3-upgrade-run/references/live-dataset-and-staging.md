# Live dataset pull and staging publication

Two operations sit at the edges of an upgrade run. Both are authorized per project by the user;
neither ever writes to a live server.

## Pulling the dataset from live

Use the script, not ad-hoc commands:

```bash
node skills/typo3-upgrade-run/scripts/pull-live-dataset.mjs \
  --project . --host www.example.at --out .typo3-update/dataset/$(date +%F) --dry-run
node skills/typo3-upgrade-run/scripts/pull-live-dataset.mjs \
  --project . --host www.example.at --out .typo3-update/dataset/$(date +%F)
```

- The host comes from the project's Deployer `.hosts.yaml`. Every server command is read-only:
  `readlink current`, a file count, and `typo3 database:export` streamed into a local `.sql.gz`.
- A project without one (TYPO3 Surf through GitLab CI, for example) gets a hand-written, read-only
  hosts file in the same shape, passed with `--hosts-file` and kept in the run directory. Optional
  keys describe other layouts, each a relative path without `..`: `current_path` (default `current`),
  `fileadmin_path` (default `shared/<webroot>/fileadmin`) and `typo3_bin` (default
  `vendor/bin/typo3`, relative to the release). Without `remote_user` the target is the bare
  hostname, so an `~/.ssh/config` alias supplies user, port and key; `-p` is passed only for an
  explicit `port`.

  ```yaml
  hosts:
    live:
      hostname: project-live            # ~/.ssh/config alias
      deploy_path: /var/www/project
      bin/php: php8.3
      current_path: releases/current      # Surf
      fileadmin_path: shared/Data/fileadmin
      typo3_bin: app/vendor/bin/typo3     # Composer project in app/
      labels: { stage: production }
  ```
- **Delete the local fileadmin before any fileadmin sync from live.** The script removes
  `<project>/<webroot>/fileadmin` first, then rsyncs `<deploy_path>/<fileadmin_path>/`.
  A mirror that mixes old local files with new server files is not the dataset anyone approved.
  The same rule applies to any project script that syncs fileadmin: change it to delete first.
- `_processed_/` and `_temp_/` are not copied; TYPO3 regenerates them. Caches, sessions, locks,
  `sys_log` and `sys_http_report` are not exported.
- The script compares server and local file counts and writes `live-dataset.json` with release,
  timestamps, counts and the dump's SHA-256. Use it as `dataset-freshness` or `data-recovery` evidence.
- Importing is a separate stateful step: `t3u snapshot-create --node data-recovery`, then
  `ddev import-db --file=<out>/db.sql.gz`, then `ddev exec vendor/bin/typo3 extension:setup` and
  `cache:flush`. The excluded cache tables are missing entirely until `extension:setup` recreates
  them; without it every request fails with a missing `cache_*` table. Then verify the content sentinels.

## Publishing to staging

```bash
node skills/typo3-upgrade-run/scripts/deploy-staging.mjs --project . \
  --host staging.example.at --branch feature/typo3-14.3 --record .typo3-update/report/staging-deploy.json
```

- The guard refuses any host whose stage label or hostname is not a staging one, and any staging
  host that shares a hostname or deploy path with a production host. Exit code 5 is a refusal. It
  reads `hostname`, so an ssh alias for staging carries the prefix too (`Host staging.<project>`).
- The platform preflight runs before the deploy and in `--dry-run`. It takes the target major from
  `typo3/cms-core` in `composer.lock` (`--composer-lock` for a Composer project in a subdirectory)
  and reads, over SSH and read-only, the `-- Server version` line of a header-only
  `database:export -e '*' | head -8` and `php -r 'echo PHP_VERSION;'`. Outside get.typo3.org's
  declared support (13/14: MariaDB 10.4.3–10.99.99 or MySQL 8.0.17–8.99.99, PHP 8.2.0–8.5.99; 12:
  MariaDB from 10.3.0, PHP 8.1.0–8.4.99) it refuses with **exit code 6**: the deploy would install
  and then fail with SQL syntax errors. A check that cannot run (no current release, no version
  line) refuses with exit 6 too. The web (FPM) PHP is not readable over SSH; the output and
  `--record` say so, next to the facts and the verdict. `--skip-platform-check "<reason>"` records
  why the check was skipped, for example a first deploy with no current release.
- A project without a staging host is not published. Report it and ask for a staging target;
  never fall back to the live host.
- GitLab CI projects publish by pushing the branch its CI deploys to staging (for example
  `development`). Never push a branch whose pipeline deploys live (`master`/`main` in most projects).
  CI skips the preflight, so run it by hand before the push: `deploy-staging.mjs --dry-run --host
  <staging> --record …`, with `--hosts-file` describing the staging target when the project has none.
- Staging runs its own database. Before replacing it with the upgraded local dataset, check what
  staging holds (relaunch previews, editor drafts) and get an exact-scope approval.
- A staging publication is not Contract A acceptance. The human acceptance names the closure hash.
