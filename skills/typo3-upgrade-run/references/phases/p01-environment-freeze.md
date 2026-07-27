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
3. **Assert the application context.** A freshly imported clone frequently runs `Development`,
   which emits debug comments, `displayErrors` output and admin-panel markup — identically before
   and after, so the comparison passes while proving nothing about how production renders. Set and
   record `Production` (or the exact context the site runs live), and record `displayErrors` and
   the log writer configuration in the environment fingerprint.
4. Inventory: PHP, TCA, schema, Extbase, hooks and events, backend modules, commands, upgrade
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
5. **Widen the content fingerprint to the tables this site actually renders from.** The default
   tracked set is core-only. On any news, blog, event or shop site most rendered content lives in
   extension tables, so an editor saving a news item or a feed import changing rows will not trip
   the drift check — the difference then gets misclassified as a regression and burns the one loop
   this skill exists for. Derive the tracked set from the installed TCA plus the inventory above,
   and record it in the manifest so the set itself is auditable.
6. **Update the reference index before sealing.** An imported dump carries a stale `sys_refindex`;
   wizards that depend on it (file references, slugs) then migrate the wrong rows, and broken FAL
   references surface much later looking like an image-processing problem. Run
   `referenceindex:update` now, note how long it took, and budget that time for the reruns later.
7. Run the repository's existing install, lint, static analysis and tests on the current branch.
   **Record pre-existing failures separately from regressions** — a failure that was already there is
   a `pre-existing` finding, not something this update caused.
8. Seal the environment fingerprint and the content fingerprint.

## Evidence
`manifests/environment.json` · `content-fingerprint.json` · `extensions.json` · `tooling.json` ·
`snapshots.json`

## Exit
Both fingerprints sealed; snapshot and dump exist outside the container; pre-existing failures
recorded separately.

## Blocking
DDEV will not boot. The installed core cannot run on the container PHP version — fix the container
version first, keeping it one the current core supports.

