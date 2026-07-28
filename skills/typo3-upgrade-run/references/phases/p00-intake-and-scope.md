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
9. **Sweep the database for TypoScript that only exists there.** Automated tooling processes
   files; on sites of this generation the interesting TypoScript lives in `sys_template` and in
   `TSconfig` columns, edited through the backend and never on disk. `<INCLUDE_TYPOSCRIPT:>` is
   the sharpest example — removed in v14 and discarded *silently* — but the same blind spot
   applies to anything a file-based migration tool is expected to catch. Run the detection query
   in `known-problems.md` and record the count, including zero.
10. **Inventory the custom code, and say what each piece does.** The extension *list* is not the
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

11. **Name the subsystems that carry their own upgrade project.** Some things are not "an
   extension to update" but a workstream with their own version matrix, their own data to
   reindex or migrate, and sometimes their own licence: a search stack (Solr and its companions),
   a form framework holding live submissions, a news or blog archive, Content Blocks, anything
   commerce. Record which are present, at what version, and **how much data each holds** — an
   extension with zero records gets removed, not migrated, and that decision belongs here rather
   than mid-run. See `references/feature-upgrades.md`.

12. **Read the README and write one sentence about what this site actually is.** Whose site,
   for whom, what it is for. It costs a minute, it is the context every later judgement call is
   made against, and its absence is why a run can be technically green while nobody noticed the
   most important page was broken.

13. **Ask about commercially licensed extensions.** Paid extensions usually need a new licence for a
   new major, served from a private repository. That is a purchase with lead time, not a dependency
   problem, and it surfaces mid-P05 as an opaque 403. Identify them now.
14. Create the run directory and fill `config/run.yml`: trusted origin (scheme included), every site,
   languages as the site's real prefixes, golden paths, budgets.
15. Ask once whether the run directory should be committed, and record the answer.
16. Write `ADR-001-scope.md`.

## Evidence
`state.json` initialised · `config/run.yml` · `decisions/ADR-001-scope.md`

## Exit
Target kind, source version, DDEV project and sync-freshness decision are all recorded in
`state.json`, and every extension without a v14 release has been named in the plan.

## Blocking
No local sync, or one the user cannot vouch for. Ask; do not improvise one.

