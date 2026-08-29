# P00 — Intake and scope lock

No loop. This phase decides what is being updated and creates the run directory.

Scoping **several** projects rather than starting one? Use
[`references/fleet-survey.md`](../fleet-survey.md) first — it is read-only, answers which project
to start with and what each will cost, and leaves this phase to the one you choose.

## Preconditions
- The repository is present and readable.
- No run directory yet, or one whose `run_id` the user confirms resuming.

## Allowed
Read-only inspection. Creating `.typo3-update/` from `templates/run-directory/`. Asking questions.

## Overnight clock
`t3u init` starts the clock without guessing the site size. During the read-only P00 branches,
record all nine dimensions in [`../runtime-sizing.md`](../runtime-sizing.md), write
`nodes/intake/runtime-size.json`, and seal it with `t3u runtime-seal --evidence …` before P02.
The harness selects small 8h/T+6h, large 12h/T+9h, or huge 14h/T+10h and protects the remaining
2h, 3h, or 4h for closure. No arbitrary duration or requested profile is accepted. At the sealed
migration cutoff start no new P05–P10 cause; unresolved work becomes an honest blocker, never a
shortened proof or a false pass.

## Steps
0. **Read [`references/fleet-profile.md`](../fleet-profile.md) and work down it.** These projects
   repeat themselves, and most of its checks take seconds. Record every answer in the intake,
   including the negatives — "checked, not present" is what stops the next run re-checking it.
   Confirm each item against this project: it is a list of likely findings, not a description of
   any particular site.
1. Determine the target: **project**, **sitepackage**, or **extension**. For a standalone extension
   with no host project, create a disposable TYPO3 14.3 DDEV installation to prove installation and
   behaviour.
2. For a full site, confirm a current local sync of live exists — database and `fileadmin` imported
   into DDEV. **Creating that sync is outside this skill.** When it is missing or stale, ask for a
   fresh dump; never connect to production to fetch it.
3. Record the sync freshness decision. A stale sync is usable, but the invariance claim is only as
   current as the content it was measured against, and that must be visible later.
4. **Agree the editorial freeze, or agree its absence.** A 12→14.3 run spans days or weeks while
   editors keep publishing on live. Nothing changes locally, so the fingerprint holds and the proof
   silently ages into a statement about a weeks-old dataset. Importing a fresh dump later voids
   `A-original`, and a baseline refresh is not grantable — so the run would become unfinishable by
   its own rules. Settle it now: either a freeze window covering the invariance phases, or a
   recorded, accepted staleness date that appears in the closure certificate. Name who enforces it.
5. **Enumerate every site.** Read `config/sites/*/config.yaml` and list each site, its base, its
   base variants, and its languages. A single TYPO3 install serving several domains is normal; a
   run configured for one origin measures one site and stays silent about the rest. Record every
   site in `config/run.yml`, and if any site is deliberately out of scope, say so — a site never
   discovered must appear in the coverage declaration, not be absent from it.

   Validate the runtime interpretation as well as the YAML text:

   ```bash
   ddev typo3 site:list
   ddev typo3 site:show <site-identifier>
   ddev exec locale -a
   ddev typo3 site:sets:list   # on rungs that provide the site-set commands
   ```

   Record each configured locale beside the matching locale installed in the container, and record
   its BCP 47/hreflang value separately — `de_DE` and `de-AT` solve different problems. Inventory
   every selected site set and its dependency graph. A configured locale with no installed runtime
   equivalent invalidates the local baseline; an unavailable site set or unresolved dependency is a
   target-rung blocker. Repeat `site:list`, `site:show` and `site:sets:list` on every rung that exposes
   them and before target rendering; do not wait for a frontend exception to reveal the defect.
6. **Enumerate every file storage.** Read `sys_file_storage`. `fileadmin` is a default, not a
   guarantee: a second local storage, a protected `user_upload` storage, or a remote driver is
   routine. Anything not synced is neither fingerprinted nor captured, so its images render broken
   in baseline *and* after-capture and invariance passes on an identically broken site. Remote
   drivers additionally trip the origin guard mid-capture — decide up front whether they are in
   scope or declared untested.
7. **Note the personal data and set a retention rule.** The clone is a full copy of production:
   `fe_users`, `be_users` hashes, form submissions, order and newsletter data. Captures include
   full-page screenshots of login and form pages. Decide before capturing whether the run directory
   may be committed — a "yes" pushes customer data to a remote — and record when `.typo3-update/`
   gets deleted. Prefer an anonymised dump where the site's rendering does not depend on real data.
8. **Name the v14 blockers out loud.** Once the extension set is known, run
   `ddev composer why-not typo3/cms-core "^14.3"` and put every package it names at the **top** of
   the plan, with what it provides and who depends on it. An extension with no v14 release blocks
   the whole install and can change the project's cost and shape, so it is intake output, not a
   mid-run discovery. See `references/extension-strategy.md`.
9. **Inventory EVERY extension, with usage evidence.** Step 8 finds what *blocks* the target;
   it says nothing about an extension that upgrades cleanly and nobody uses — and those are the
   expensive ones, because they get migrated, tested, sometimes forked, and carried forward
   forever without anyone asking whether the site needs them. Removing beats migrating, and it
   beats forking by a wide margin.

   ```bash
   node scripts/extension-usage.mjs --ddev-dir . --report .typo3-update/report.extension-usage.json
   ```

   It reads `composer.json`, skips Core subpackages, and for every remaining package counts its
   own tables, its content elements and plugin instances, **and the columns it adds to existing
   tables** — that last one matters, because an extension that only extends `pages` or
   `tt_content` owns no table and registers no CType, so a naive count reports something
   load-bearing as unused.

   **Zero usage is a question, not a verdict.** Sitepackages, ViewHelper libraries, middlewares,
   link handlers, scheduler tasks and monitoring clients all legitimately store nothing. Confirm
   before removing, then run the complete persisted-reference manifest from
   `references/extension-strategy.md` rather than treating these starter checks as exhaustive:

   ```bash
   ddev typo3 extension:list --active
   grep -rn '<ext-key>' packages/ config/ fileadmin/
   ddev mysql -N -e "SELECT uid,title FROM sys_template WHERE deleted=0
     AND (config LIKE '%<ext-key>%' OR include_static_file LIKE '%<ext-key>%');"
   ```

   Then remove, and **prove the removal with the invariance gate** rather than by looking at the
   site.

10. **Sweep the database for TypoScript that only exists there.** Automated tooling processes
   files; on sites of this generation the interesting TypoScript lives in `sys_template` and in
   `TSconfig` columns, edited through the backend and never on disk. `<INCLUDE_TYPOSCRIPT:>` is
   the sharpest example — removed in v14 and discarded *silently* — but the same blind spot
   applies to anything a file-based migration tool is expected to catch. Run the detection query
   in `known-problems.md` and record the count, including zero.
11. **Inventory the custom code, and say what each piece does.** The extension *list* is not the
   scope; the custom code is. A site with forty third-party extensions and no custom PHP is a
   smaller job than one with four extensions and a bespoke Extbase domain model. Record, per
   in-house package (`packages/`, `extensions/`, path repositories in `composer.json`):

   - what it is for, in one sentence, from its `composer.json` description or `ext_emconf.php`
   - `.php` file count and rough line count — the honest proxy for how much has to be reviewed
   - Extbase plugins, custom backend modules, middlewares, event listeners and hooks
   - domain models and their tables: bespoke data is the single biggest driver of upgrade effort,
     because nothing upstream will migrate it for you
   - integrations with anything outside TYPO3 — APIs, imports, external systems. These break
     without any TYPO3 error and are invisible to every gate in this skill.

   ```bash
   for d in packages/* extensions/*; do
     [ -d "$d" ] || continue
     echo "$d  php:$(find "$d" -name '*.php' | wc -l)  loc:$(find "$d" -name '*.php' -exec cat {} + | wc -l)"
   done
   grep -rln 'MiddlewareInterface\|registerPlugin\|configureModule\|EventListener' packages/ extensions/
   ```

12. **Check for `EXT:mask` specifically.** If the site builds content elements with Mask, the
   migration to Content Blocks has to happen **on the 13.4 rung, before the v14 rung** — the
   importer supports v13 and there is no supported path once you are on 14.3. That changes the
   shape of the ladder, so it is intake output, not a mid-run discovery. See
   [`references/mask-to-content-blocks.md`](../mask-to-content-blocks.md).

   ```bash
   ddev mysql -N -e "SELECT CType, COUNT(*) FROM tt_content
     WHERE deleted=0 AND CType LIKE 'mask_%' GROUP BY CType ORDER BY 2 DESC;"
   ```

   Also check for `fluidtypo3/fluid-components` and inventory every `fc:` invocation. When it has
   to be replaced, the component namespace, argument API, FAL values and link behavior are Contract
   A inputs; follow [`references/native-fluid-components.md`](../native-fluid-components.md).

13. **Name the subsystems that carry their own upgrade project.** Some things are not "an
   extension to update" but a workstream with their own version matrix, their own data to
   reindex or migrate, and sometimes their own licence: a search stack (Solr and its companions),
   a form framework holding live submissions, a news or blog archive, Content Blocks, anything
   commerce. Record which are present, at what version, and **how much data each holds** — an
   extension with zero records gets removed, not migrated, and that decision belongs here rather
   than mid-run. See `references/feature-upgrades.md`.

   Build `config/interactions.yml` at the same time. Inventory consent, sliders/carousels/rotators,
   primary navigation, dropdowns/accordions, search, forms/newsletters, modals, filters, quizzes and
   embeds. Name one or two representative URLs and the before/after journey for every component
   present. A widget that the settle report later finds but this manifest does not test blocks
   closure; freezing a carousel is not testing it. Use the matrix in
   [`recent-run-lessons.md`](../recent-run-lessons.md).

   Before scheduling the exhaustive browser proof, inspect the machine-wide visual lock. Record
   its live owner and planned release time. If occupied, continue renderer-free discovery,
   migration, HTTP/DOM capture or comparison; do not start a second exhaustive proof just to spend
   hours queued behind the first one.

14. **Read the README and write one sentence about what this site actually is.** Whose site,
   for whom, what it is for. It costs a minute, it is the context every later judgement call is
   made against, and its absence is why a run can be technically green while nobody noticed the
   most important page was broken.

15. **Ask about commercially licensed extensions.** Paid extensions usually need a new licence for a
   new major, served from a private repository. That is a purchase with lead time, not a dependency
   problem, and it surfaces mid-P05 as an opaque 403. Identify them now.
16. Create the run directory and fill `config/run.yml`: trusted origin (scheme included), every site,
   languages as the site's real prefixes, golden paths, budgets.
17. Ask once whether the run directory should be committed, and record the answer.
18. Write `ADR-001-scope.md`.

## Evidence
`state.json` initialised · `config/run.yml` · `decisions/ADR-001-scope.md`

## Exit
Target kind, source version, DDEV project and sync-freshness decision are all recorded in
`state.json`, and every extension without a v14 release has been named in the plan.

## Blocking
No local sync, or one the user cannot vouch for. Ask; do not improvise one.
