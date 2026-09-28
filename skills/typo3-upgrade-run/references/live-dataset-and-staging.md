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
- **Delete the local fileadmin before any fileadmin sync from live.** The script removes
  `<project>/<webroot>/fileadmin` first, then rsyncs `<deploy_path>/shared/<webroot>/fileadmin/`.
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
  host that shares a hostname or deploy path with a production host. Exit code 5 is a refusal.
- A project without a staging host is not published. Report it and ask for a staging target;
  never fall back to the live host.
- GitLab CI projects publish by pushing the branch its CI deploys to staging (for example
  `development`). Never push a branch whose pipeline deploys live (`master`/`main` in most projects).
- Staging runs its own database. Before replacing it with the upgraded local dataset, check what
  staging holds (relaunch previews, editor drafts) and get an exact-scope approval.
- A staging publication is not Contract A acceptance. The human acceptance names the closure hash.
