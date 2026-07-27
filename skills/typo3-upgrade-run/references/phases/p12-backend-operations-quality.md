# P12 — Backend, operations and quality gates (loops 310, 320)

Track `invariance`.

## Loop 310 — backend and operations
- **Backend module sweep**: every module opens without exception output, server errors or severe
  console errors. **100% coverage is required** — module *groups* are distinguished from real
  modules, and an unexpected skip fails the run. A sweep that reports "12 ok, 3 skipped" and exits 0
  is how unchecked modules ship.
- **Backend write round-trip**: opening a module proves almost nothing. The breakages editors hit
  on day one — a FormEngine exception on save, a broken FAL upload after a storage or driver change,
  a DataHandler hook that now throws, an RTE that strips markup — all happen in modules that open
  perfectly. So actually do it: create a content element, edit and save it, upload a file and
  reference it, translate a record, then delete what you made. A run that closes green while nobody
  can edit has proven the wrong thing.
- Scheduler: enumerate **every** row in `tx_scheduler_task`, resolve each task's PHP class, and
  force-execute one instance of each. On a fresh clone almost nothing is due, so "run due tasks"
  passes vacuously; tasks whose class came from a removed or renamed extension are unrunnable rows
  that fail silently after deploy — nightly imports, newsletters, cache warmers.
- Redirects: `EXT:redirects` entries resolve without loops or dead targets — and **request a real
  sample of source paths**, before and after. Redirect sources are by definition not in a sitemap,
  so no other stage in this run ever touches them; that table carries the SEO value of the last
  relaunches, and a changed host match or a slug-wizard regeneration 404s top-traffic legacy URLs
  while the certificate still says "invisible to visitors".
- Editorial configuration: page and user TSconfig, `be_groups` module access and permissions, DB and
  file mounts, and backend layouts still apply as before. v14's module-parent renames make old
  identifiers no-ops, which silently either hides every module or exposes all of them.
- Site search: with Solr, loop 200 covers it. With `EXT:indexed_search`, the index must be rebuilt
  by a scheduler task — see above — or the smoke test passes on an empty index because the result
  page renders fine.
- Forms: submit one. Assert it persisted **and** that the finisher mail arrived in Mailpit. v14
  replaced ten EXT:form hooks with PSR-14 events, so a form can render pixel-identical while its
  email finisher silently stops sending.
- Linkvalidator where installed; triage broken links.
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

## Loop 320 — static analysis and tests
- PHPStan level 9+ (10 for `packages/`); never lower an existing stricter level. No new suppressions
  or baseline entries for new or touched code; the baseline must shrink.
- PHP lint, code style, Rector dry-run, Fractor dry-run, unit, functional/integration and E2E tests
  through the repository's canonical commands inside DDEV.
- Conformance, simplification, `typo3-security` and `security-audit` passes. Fix verified actionable
  findings, then rerun the affected gate.
- `ddev composer audit` — unresolved advisories block completion.
- Prove a clean install: a fresh `ddev composer install` from the committed lockfile resolves against
  14.3 and the claimed PHP versions.
- Verify the PHP target across the whole extension set: `why-not php 8.4` empty, every local or
  forked package declares the target, PHPStan runs with `phpVersion` set to it, and lint plus all
  suites execute in the target container with a clean deprecation log.
- Reusable extensions keep a CI matrix with a 14.3 job and every claimed PHP version.

## Exit
Every sweep item green · 0 unresolved advisories · deprecation log clean · PHPStan baseline strictly
smaller than before the update.

