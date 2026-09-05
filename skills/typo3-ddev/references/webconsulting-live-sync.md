# Safe live → local preparation

Use only when the user separately requests preparing or executing a sync. An upgrade run by itself
never authorizes production access. This reference guides a project-owned helper; it is not a
universal script to execute blindly. All imports/migrations target the selected local DDEV project.

## What the fleet actually taught

- Gütezeichen's July helper still contains embedded configuration, a shared remote `/tmp` dump,
  and a broad local temp-directory cleanup. Do not copy it as a modern safe reference.
- FMW commit `898b088` (2026-08-16) improved configuration and `mktemp` cleanup, but still sources
  `.env` as shell code, uses a fixed remote dump filename, strips line one unconditionally and lacks
  a verified local rollback. Adopt the configuration idea, not the helper verbatim.
- OEII's 2026-09-05 refresh preserved local code/settings, exported a local rollback database,
  retained overwritten media, avoided deleting local-only files, and verified with a second dry
  run. That is the safer recovery model. The refresh changed image derivatives and invalidated
  prior Lighthouse measurements: sync is an evidence-epoch change, not a harmless cache action.

## Workflow and guards

1. Inspect DDEV configuration and `ddev describe -j` for exact root/name/URL/docroot. Resolve real
   local `fileadmin` storage; it may be `public/fileadmin`, not project-root `fileadmin`. Do not infer
   live release/shared paths from another customer. Identify approved SSH origin/account and DB.
2. Use a dedicated ignored mode-0600 sync configuration with names/paths, not application secret
   values in command arguments. Parse dotenv as data through a maintained loader, or use validated
   environment variables. No `source`, `eval`, `set -x`, shell interpolation of unvalidated paths,
   or printed connection strings. Remote DB authentication belongs in an approved protected client
   option file/secret mechanism, never the script. Do not copy a live `.env` to DDEV.
3. Default to a read-only plan/dry run. Show source/destination, proposed transfers, sizes, row/date
   sentinels and exclusions. Require explicit apply/import authorization before overwriting locally.
4. Before apply, create and verify local database export/snapshot and media rollback storage;
   checksum, free-space check and exact restore instructions. Record Git/dirty-tree identity to
   prove local code is preserved. A DB snapshot is not a fileadmin backup.
5. Prefer an existing approved export or a protected, streaming DB export with no public/shared
   remote dump file. If a remote temp export is necessary, authorize that write separately, use a
   unique restrictive filename and clean only that exact file. Do not change production data.
6. Validate compression/checksum/nonempty SQL and source-version metadata before import. Do not
   blindly delete the first SQL line; preserve the dump and handle a known client-incompatibility
   header only after inspecting the installed tools and documenting that exact transformation.
7. Stage media incrementally. Use rsync dry-run/itemization and a backup directory for replaced
   files; no default `--delete`, no merge into code/config/vendor. Validate resolved paths before
   every copy/cleanup. Explicit pruning is a separate approved operation after restore proof.
8. Stop local scheduler/queues and intercept outbound mail/APIs. Import locally, apply local
   environment overrides, and prove DB/mail/search origins remain local before running any job.
9. Reconcile page/content/FAL/file counts, newest content timestamps, known page/media sentinels,
   sitemap route differences and language/site identities. Verify a second rsync dry run has no
   unexpected transfers. Run source-compatible setup only when required, with its snapshot.
10. On failure retain evidence and recover the exact local DB/files; never clean away the only
    rollback archive. On success retain private backups per the user's retention policy. Do not
    erase arbitrary `tmp/` trees. Seal the dataset only after this preparation finishes.

## DDEV throughput

Use one canonical browser/test toolchain and the existing configured services. Turn off Xdebug
for measured production-build/browser runs, verify web and CLI PHP match the target, and use
production assets without an HMR server. Start/restart DDEV only for changed service/runtime config;
not before every node. Reuse package/browser caches and immutable manifests within a verified epoch.
Measure import, warmup, HTTP, capture and test throughput once; avoid CPU-heavy Lighthouse and
pixel capture concurrently. Never improve speed by dropping database/media identity checks.

Run browser proof against the URL from `ddev describe -j`, not a guessed multiversion demo URL.
Demo credentials in upstream examples are not project credentials. Do not provision a new empty
instance, change database engines, remove volumes, or add services simply because upstream examples
show them. Current DDEV operations: [official docs](https://docs.ddev.com/en/stable/users/usage/commands/).
