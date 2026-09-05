# P12 — Essential backend, operations and quality checks (inside loop 300)

Track `invariance`.

Read `../closure-currentness.md`; its thirteen evidence checks are mandatory. This is a
risk-routed checklist, not thirteen independent implementation programmes. Run the project's
canonical tests and the checks whose subject was changed by the upgrade. Keep the detailed recipes
below for those cases; record the rest `not-applicable` with inventory evidence. A full security,
conformance, simplification, editor-permission, search, CI, and documentation programme is optional
Contract B work unless a concrete blocker or touched boundary makes it necessary for v14 parity.

## Backend and operations recipes

### A disposable backend user

The sweep and the write round-trip both need a real login. Do not reuse a client's account and
do not guess one — create a throwaway admin at the start of the loop and **delete it when the
loop closes**:

```bash
# create
ddev typo3 backend:user:create --username=_t3u_upgrade_probe \
  --password="$(openssl rand -base64 24)" --email=probe@example.invalid \
  --admin --no-interaction

# … run the sweep and the write round-trip …

# delete — this is part of the loop, not an afterthought
ddev mysql -e "DELETE FROM be_users WHERE username='_t3u_upgrade_probe';"
```

Keep the password out of shell history (a leading space in `bash`/`zsh`, or read it from a
`600` file) and destroy the file afterwards. On the older `TYPO3_BE_USER_*` environment-variable
form: it is documented in `--help` but is **not accepted on every 14.x build** — if the command
answers with its usage block and exit 255, pass `--username/--password` explicitly instead.

Verify the teardown rather than assuming it:

```bash
ddev mysql -N -e "SELECT COUNT(*) FROM be_users WHERE username='_t3u_upgrade_probe';"   # 0
```

- **Backend module sweep**: the Core major changed the backend boundary, so verify expected modules
  on every whole-site upgrade. Every module opens without exception output, server errors or severe
  console errors. **100% coverage is required** — module *groups* are distinguished from real
  modules, and an unexpected skip fails the run. A sweep that reports "12 ok, 3 skipped" and exits 0
  is how unchecked modules ship.
- **Backend write round-trip**: opening a module proves almost nothing. The breakages editors hit
  on day one — a FormEngine exception on save, a broken FAL upload after a storage or driver change,
  a DataHandler hook that now throws, an RTE that strips markup — all happen in modules that open
  perfectly. A run that closes green while nobody can edit has proven the wrong thing.

  ```bash
  BE_USER=_t3u_upgrade_probe BE_PASSWORD="…" node scripts/backend-write-roundtrip.mjs \
    --base-url https://site.ddev.site --ddev-dir . --parent 1 \
    --report .typo3-update/report.backend-write.json
  ```

  It creates a page, adds a `textmedia` element, attaches an image, asserts the **frontend renders
  an `<img>`**, translates when a second language exists, then deletes everything and verifies
  nothing is left — including after a failure.

  Three things this taught, all of which cost a debugging round:
  - **FormEngine lives in the `list_frame` iframe.** Selectors run against the main frame find
    nothing and the form looks empty. TYPO3 mints the CSRF token itself when the outer
    `/typo3/record/edit?…` URL is opened, so there is no token to forge.
  - **A new content element defaults to `CType=text`, which has no image field.** Pass
    `&defVals[tt_content][CType]=textmedia` — the same mechanism the new-content wizard uses —
    or the FAL control never renders and the image half of the test is silently skipped.
  - **`sys_file_reference.table_local` was dropped in v14.** An insert naming it fails outright.

  The v14 file picker is a JS tree whose folder navigation does not drive reliably by selector. The
  script therefore asserts that **the element browser opens**, and attaches the file with a direct
  `sys_file_reference` insert. That is a deliberate trade: a flaky step in a gate is worse than an
  honest one, and the assertion that matters — the frontend resolving the reference — is unaffected.
  Say which method was used in the report; never let a reader infer more coverage than exists.
- Scheduler: enumerate rows and resolve each task's PHP class. Execute only safe local task
  instances with side effects intercepted or disabled and explicit fixture scope. Never force real
  imports, emails, payments or remote jobs. On a fresh clone almost nothing is due, so "run due tasks"
  passes vacuously; tasks whose class came from a removed or renamed extension are unrunnable rows
  that fail silently after deploy — nightly imports, newsletters, cache warmers.
- Redirects: require `typo3/cms-redirects:^14.3`; when it was absent, set it up from the operation
  snapshot before testing. Resolve module id `redirects` from the runtime registry and use
  `typo3-backend-rights` to grant the trusted main editor group `sys_redirect` listing/modify plus
  runtime-editable exclude fields. Then verify the module as a real non-admin and **request a real
  sample of source paths**, before and after. Redirect sources are by definition not in a sitemap,
  so no other stage in this run ever touches them; that table carries the SEO value of the last
  relaunches, and a changed host match or a slug-wizard regeneration 404s top-traffic legacy URLs
  while the certificate still says "invisible to visitors".
- **Backend users and permissions** — the gate nothing else covers. The sweep proves a module
  opens; the write round-trip proves an *admin* can save. Neither says anything about the editor
  who logs in on Monday, and permission damage is silent: TYPO3 ignores an entry pointing at
  something that no longer exists, and does not offer a content type an editor may not use.

  ```bash
  node scripts/backend-permissions-audit.mjs --ddev-dir . \
    --report .typo3-update/report.permissions.json        # --fix for additive repairs
  ```

  It checks who holds admin, whether `groupMods` still resolves, whether every CType **in use** is
  editable, table access, file permissions and mountpoints. See
  [`references/backend-permissions.md`](../backend-permissions.md) — scoped to what an upgrade
  breaks, including that module identifiers must be enumerated from registered code rather than
  from the module menu.

  **Designing an editor group is a different job.** The leaf-group structure, TSconfig, mounts,
  MFA, login branding and converting an admin down to an editor belong to the
  **`typo3-backend-rights`** skill. This phase audits; that skill builds.

  Then log in as a real editor and try it. The audit proves the configuration is coherent; only
  using the account proves an editor can work.
- **Site search.** With Solr, loop 200 covers it. With `EXT:indexed_search` the index must be
  rebuilt, or the smoke test passes on an empty index because the result page renders perfectly.

  ```bash
  node scripts/indexed-search-check.mjs --base-url https://site.ddev.site --ddev-dir . \
    --count 50 --language 0 --report .typo3-update/report.indexed-search.json
  ```

  It truncates the index tables, requests N pages, and then proves search actually returns
  something. **Always rebuild from empty** — a stale index makes a broken indexer look healthy.

  - `indexed_search` indexes during page **generation**, not on request, so flush the cache first
    and bust it per URL. Skip that and it reports "nothing indexed" on a working installation.
  - Pass the **language** explicitly and select pages by `sys_language_uid`; indexing the default
    language and searching another returns nothing, which reads exactly like a broken index.
  - Do not hand-pick the search term. Take the **most frequent indexed word** — if the commonest
    word on the site cannot be found, search is broken, not the query.
  - Expect slightly fewer indexed rows than pages requested: `no_search` pages and identical
    content hashes are skipped. Report the gap rather than treating it as a failure.
- Forms: submit one. Assert it persisted **and** that the finisher mail arrived in Mailpit. v14
  replaced ten EXT:form hooks with PSR-14 events, so a form can render pixel-identical while its
  email finisher silently stops sending.
- Linkvalidator where installed; triage broken links.
- **Deployment visibility.** Require `spooner/deployer-information`; open System Information and
  verify “Last Deployment” renders without exceptions and uses the intended standard/legacy/custom
  detection mode. This is a local integration check; the real timestamp remains an explicit P15
  operator verification. See `references/deployment-handover.md`.
- **Final smoke test — no NEW errors.** `node scripts/smoke-log-check.mjs --base-url … --count 10`
  requests a seeded random sample from the sitemap and reads the application log, `sys_log` and the
  responses, reporting only what appeared *during* the requests. It must come back clean: a page
  answering 200 is not the same as a page produced without error, and a warning that is harmless on
  13.4 is frequently fatal on 14.3. See `references/harness-contract.md` for the log locations.
- Smoke test: homepage, a standard content page, news or detail pages, search including empty and
  paginated results, login and password recovery, forms, the 404 response, `robots.txt`, every
  sitemap entry point. DDEV routes all mail to Mailpit (`ddev launch -m`), so no real recipient is
  ever contacted.

The smoke test is a **deterministic read-only flow**, not random link clicking. Even GET links can
trigger logout, cache clearing, deletion, unsubscribe, scheduler actions or large downloads.

## Static analysis and tests
- Lighthouse and axe verification run before closure with `--mode verify` on the open A loop.
  Require at least three pinned Lighthouse runs per sampled URL, predeclared budgets, medians/ranges,
  raw JSON and tool/Chrome versions. Single live-vs-DDEV scores are not a controlled benchmark.
  Keep at most three global states; exercise extra widgets only in targeted Playwright journeys.
- Use `typo3-playwright` for RTE link insertion/save/reopen, non-admin editing, real plugin/FlexForm
  previews, hidden-content permission behavior, media/video and re-operated AJAX filters.
- When frontend source, Fluid asset inclusion or build configuration changed, run the canonical
  clean Vite production build, then `node scripts/vite-production-check.mjs --manifest …
  --public-root …`. Require every declared entry/import/CSS/asset to exist with a content hash.
  Walk the representative pages with zero failed requests, missing fonts/images, dev/HMR clients,
  stale legacy bundles or severe console errors. `base: './'`, a manifest and a green build in
  isolation are not proof that TYPO3 emitted the right URLs.
- Run the interaction sentinels from `config/interactions.yml`. Consent and sliders are mandatory
  when present; stabilisation metadata showing a component with no journey is a coverage failure.
  Search checks include deterministic first-page ordering, empty results and pagination—not merely
  “some documents exist”.
- Run the existing project PHPStan level; do not lower it or add suppressions for touched code.
  Raising the whole project to level 9/10 is optional modernization work.
- PHP lint, code style, Rector dry-run, Fractor dry-run, unit, functional/integration and E2E tests
  through the repository's canonical commands inside DDEV.
- Route conformance, simplification or security review only for concrete migration findings or
  touched security boundaries; broad audits are Contract B.
- `ddev composer audit --locked --format=json` — unresolved advisories block completion. A solver
  sentence alone does not establish a security blocker: also record advisory IDs/constraints,
  `composer show --all typo3/cms-core`, `why-not`, policy configuration with sources, and official
  TYPO3 release/advisory evidence. Never disable or ignore dependency policy to pass.
- Prove a clean install: a fresh `ddev composer install` from the committed lockfile resolves against
  14.3 and the claimed PHP versions.
- Verify the PHP target across the whole extension set: `why-not php 8.4` empty, every local or
  forked package declares the target, PHPStan runs with `phpVersion` set to it, and lint plus all
  suites execute in the target container with a clean deprecation log.
- Update reusable-extension CI only when those packages are in the requested upgrade scope.

## Exit
Every applicable, risk-routed check is green; canonical project tests pass; unresolved advisories
and new deprecations that affect the target are zero. No unchanged rerun here—the loop 300 final
rerun is the authoritative idempotence proof.
