# P00 — Intake and scope lock

No loop. This phase decides what is being updated and creates the run directory.

## Preconditions
- The repository is present and readable.
- No run directory yet, or one whose `run_id` the user confirms resuming.

## Allowed
Read-only inspection. Creating `.typo3-update/` from `templates/run-directory/`. Asking questions.

## Steps
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
9. **Ask about commercially licensed extensions.** Paid extensions usually need a new licence for a
   new major, served from a private repository. That is a purchase with lead time, not a dependency
   problem, and it surfaces mid-P05 as an opaque 403. Identify them now.
10. Create the run directory and fill `config/run.yml`: trusted origin (scheme included), every site,
   languages as the site's real prefixes, golden paths, budgets.
11. Ask once whether the run directory should be committed, and record the answer.
12. Write `ADR-001-scope.md`.

## Evidence
`state.json` initialised · `config/run.yml` · `decisions/ADR-001-scope.md`

## Exit
Target kind, source version, DDEV project and sync-freshness decision are all recorded in
`state.json`, and every extension without a v14 release has been named in the plan.

## Blocking
No local sync, or one the user cannot vouch for. Ask; do not improvise one.

