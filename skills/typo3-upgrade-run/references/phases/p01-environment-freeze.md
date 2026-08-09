# P01 — Environment capture and freeze

No loop. Everything measured later is measured against what this phase seals.

## Preconditions
P00 complete.

## Allowed
`ddev start` / `describe`; reading `composer.json|lock`, CI config, `.ddev/config.yaml`;
`ddev snapshot`; `ddev export-db`; extension inventory; running the existing lint/test suites.

## Steps
1. `ddev start`, then `ddev describe` — record PHP version, database engine and version, docroot,
   project type. Determine current TYPO3/PHP from `composer.json`, `composer.lock`, CI and
   `.ddev/config.yaml`. **Do not infer a version from a filename.**
2. Create the **complete** restore path before changing anything — see
   [`references/rollback.md`](../rollback.md). `ddev snapshot` restores the database only, so a
   snapshot alone cannot undo a rung: restoring a v12 database under a v14 `vendor/` tree yields an
   unbootable install. You need all three, and they must be restored together: `ddev snapshot
   --name pre-update` plus `ddev export-db > pre-update.sql.gz` outside the container, a git commit
   or tag marking the code state, and a `fileadmin` (and other storages) archive, because wizards
   that move or rename FAL files are otherwise irreversible and mutating files after sealing voids
   the content fingerprint.
2b. **Pin the harness into the run.** Copy the skill's `typo3-upgrade-run` tree at one committed
   revision into `<run-dir>/harness/` (`git archive <rev> | tar -x`, then `npm ci && npm test`
   inside `harness/scripts/`), record the revision in `manifests/tooling.json`, and invoke
   **only** `node <run-dir>/harness/scripts/t3u.mjs` from then on. The skill directory is a
   live working tree (often shared by several concurrent runs and editing sessions); running
   it directly means the measuring instrument can change — or break — mid-run, and the
   environment fingerprint will correctly void the run when it does. Two independent runs
   derived this pin under fire on the same day; it is a rule, not a workaround. Re-pinning at
   a newer revision is allowed **only before the baseline is sealed**, and re-seals the
   environment fingerprint.

3. **Check the container against the target's minimums, not against what boots today.** A v12-era
   DDEV project routinely runs a database the target cannot use, and the failure mode is nasty:
   the update installs cleanly, the backend works, and the frontend returns 500 with an SQL
   *syntax* error — because Doctrine has no platform class for that engine and emits DDL the
   server cannot parse. Nothing says "your database is too old".

   | | TYPO3 13.4 | TYPO3 14.3 | Note |
   |---|---|---|---|
   | PHP | 8.2 – 8.4 | 8.2 – 8.5, **8.4 is this collection's target** | `ddev config --php-version` |
   | MariaDB | **10.4.3+** | **10.4.3+** | Doctrine DBAL 4 ships no platform below 10.4.3; 10.11 LTS is the safe choice |
   | MySQL | 8.0+ | 8.0+ | |
   | PostgreSQL | 10+ | 10+ | |

   Read the current values from `ddev describe`, compare them against the row for the *target*, and
   if the engine is below the floor migrate it here — before the baseline, not after a 500:

   ```bash
   ddev snapshot --name pre-db-engine-migration
   ddev export-db --file=../<project>-pre-db-migration.sql.gz   # outside the container
   ddev debug migrate-database mariadb:10.11
   ```

   `ddev debug migrate-database` dumps, recreates the service and re-imports in one step. Take the
   snapshot and the external dump first anyway: it replaces the database container, and a failed
   migration with no dump is an unrecoverable local state. Verify row counts afterwards — a
   migration that silently truncated is worse than one that failed.

4. **Assert the application context.** A freshly imported clone frequently runs `Development`,
   which emits debug comments, `displayErrors` output and admin-panel markup — identically before
   and after, so the comparison passes while proving nothing about how production renders. Set and
   record `Production` (or the exact context the site runs live), and record `displayErrors` and
   the log writer configuration in the environment fingerprint.
5. Inventory: PHP, TCA, schema, Extbase, hooks and events, backend modules, commands, upgrade
   wizards, Fluid, TypoScript, FlexForms, YAML, JavaScript and import maps, translations, Content
   Blocks, DataHandler and FAL usage, workspaces, third-party dependencies. Classify every extension
   per `references/extension-strategy.md` into `manifests/extensions.json`. Additionally inventory,
   because each is invisible to a frontend comparison and breaks after deploy:
   - **Site configuration** — `config/sites/*/config.yaml` and any site sets: base variants per
     environment, language fallback type and order, route enhancers, per-site error handling. v13
     introduced site sets and v14 continues moving settings out of `sys_template`; a shifted
     `fallbackType` changes which language renders, and a 404 handler pointing at a page uid works
     locally and dies on deploy.
   - **Editorial configuration** — page and user TSconfig, `be_groups` permissions and module
     access, DB and file mounts, backend layouts. v14 renamed the module parents (`web`→`content`,
     `file`→`media`, `tools`→`admin|system`), so every `mod.web_layout.*`, `options.hideModules`
     and module-permission entry naming an old identifier stops applying silently — editors end up
     with no modules or with all of them, which is also a security regression the frontend gate
     cannot see.
   - **Scheduler tasks** — every row in `tx_scheduler_task` with its PHP class, whether that class
     still resolves, and when it last ran.
   - **Redirects** — the `sys_redirect` row count and a sample of real source paths. They are not
     in any sitemap, so nothing else in this run will ever request them.
   - **Workspaces** — pending versioned rows per workspace. Wizards touch versioned records;
     publishing or discarding unpublished editorial work without asking is approval #15 executed
     silently.
   - **Integrations and entry points** — cron entries and CLI paths, `AdditionalConfiguration.php`,
     `.env`, caching backends (Redis/Memcached keys), Solr cores, payment/CRM/newsletter APIs,
     CDN purge hooks. Composer-mode path changes (`typo3conf/ext/*` → `vendor/`) break cron lines
     that a green run never touches. Third-party origins are blocked during every capture, so these
     integrations are provably untested — they must reach the handover as named gaps.
   - **Committed secrets** — grep the worktree *and* the history for passwords, API keys and SSH
     targets: sync and deploy scripts, `AdditionalConfiguration.php`, TypoScript, CI files. A
     credential in git is disclosed to everyone with repository access, and deleting the line does
     not undo that. List what you find; P05 moves it to `.env` and the owner rotates it.
   - **Table sizes** — `sys_log`, `sys_history` and `cf_*` can reach multiple GB, which makes every
     snapshot take tens of minutes and dominates the run's wall clock. Truncating cache and log
     tables locally is safe **before** sealing; doing it afterwards changes the content fingerprint.
6. **Widen the content fingerprint to the tables this site actually renders from.** The default
   tracked set is core-only. On any news, blog, event or shop site most rendered content lives in
   extension tables, so an editor saving a news item or a feed import changing rows will not trip
   the drift check — the difference then gets misclassified as a regression and burns the one loop
   this skill exists for. Derive the tracked set from the installed TCA plus the inventory above,
   and record it in the manifest so the set itself is auditable.
7. **Update the reference index before sealing.** An imported dump carries a stale `sys_refindex`;
   wizards that depend on it (file references, slugs) then migrate the wrong rows, and broken FAL
   references surface much later looking like an image-processing problem. Run
   `referenceindex:update` now, note how long it took, and budget that time for the reruns later.
8. Run the repository's existing install, lint, static analysis and tests on the current branch.
   **Record pre-existing failures separately from regressions** — a failure that was already there is
   a `pre-existing` finding, not something this update caused.
9. Seal the environment fingerprint and the content fingerprint.

## Evidence
`manifests/environment.json` · `content-fingerprint.json` · `extensions.json` · `tooling.json` ·
`snapshots.json`

## Exit
Both fingerprints sealed; snapshot and dump exist outside the container; pre-existing failures
recorded separately.

## Blocking
DDEV will not boot. The installed core cannot run on the container PHP version — fix the container
version first, keeping it one the current core supports. The database engine is below the target's
floor and the owner will not accept an engine migration: without it the target cannot run, so this
is a project decision, not something to work around.

## Image processor capabilities

Record what the processor can **write**, not just read — it decides the output format for the
whole run and is cheap to check now, expensive to discover later:

```bash
ddev exec convert -list format | grep -iE '^ *(AVIF|WEBP)'   # need rw+, not r--
ddev typo3 configuration:show GFX/imagefile_ext              # must list avif and webp
```

Pick the format from that evidence — **AVIF if writable, else WebP, else leave JPEG/PNG and say
why** — and write the answer into the run notes. See
[`references/image-formats.md`](../image-formats.md).

