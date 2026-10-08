# Database health with lolli/dbdoctor

A database can pass the analyzer and every wizard and still hold rows that point nowhere: content on
deleted pages, translations without a parent, file references to removed tables, workspace leftovers.
The upgrade moves those rows along unchanged, and a migration can add new ones. Two graph nodes measure
this with [lolli/dbdoctor](https://docs.typo3.org/p/lolli/dbdoctor/main/en-us/):

| Node | Phase | Owner | What it does |
|---|---|---|---|
| `db-health-intake` | P01, after `intake-join`, before `deterministic-baseline` | typo3-upgrade-intake | Inventory of the accepted dataset, every group classified with the owner (**R**) |
| `db-health-recovery` | P01, before Baseline A | typo3-upgrade-intake | Applies only owner-approved, curated SQL as one dated dataset transition (**A**) |
| `db-health-target` | P11, after `migration-join`, before `target-content-epoch` | typo3-upgrade-closure | Same inventory on the target, compared with the intake one; never fixes |

Why there: the P00 inventories (URL discovery, structured data, WebMCP) read the frontend in parallel;
the probe writes to the database for a few minutes, so it runs only after they joined. Baseline A then
captures the dataset after any approved fix, so a fix never shows up as a difference in the final proof.
On the target the inventory runs once the migration and every specialist branch are done, and before the
epoch seal, so every row it finds that vanished can still be ledgered.

## Contents

- [The tool in short](#the-tool-in-short) · [Versions and pins](#versions-and-pins) · [Commands](#commands) · [Exit codes](#exit-codes)
- [The probe](#the-probe) · [The checks and their parity risk](#the-checks-and-their-parity-risk)
- [Classification at intake](#classification-at-intake) · [Strategy per problem type](#strategy-per-problem-type)
- [db-health-recovery](#db-health-recovery-the-dated-dataset-transition) · [Contract A interaction](#contract-a-interaction)
- [db-health-target](#db-health-target-the-comparison) · [Staging and live](#staging-and-live) · [Pitfalls](#pitfalls) · [Evidence layout](#evidence-layout)

## The tool in short

What it does well: 46 to 49 consistency checks over every TCA table, ordered so that each fix can feed
the next; a read-only check mode; an SQL log of every change it executes. Maintained by a core developer,
CI on four databases.

What it does not do, and what the nodes therefore add:

- **Check mode is not an inventory.** It prints a record count per table, no uids and no SQL. On a dirty
  database it aborts with exit 255 at the first check that expects an earlier fix ("A previous check
  should have found and fixed this. Please repeat."), so the checks after it never run. The full,
  chained change set only exists as the `-f` SQL file of an execute run, which the probe produces on a
  snapshot it restores.
- **Execute mode writes raw SQL**, row by row, without a transaction, DataHandler, `sys_history`,
  `sys_log`, `tstamp`, reference index or cache tags. One row count other than 1 throws mid-run and
  leaves a partial state. The nodes never let it write a database that is kept.
- **Some fixes change the frontend.** Duplicate translations keep the lowest uid and ignore `hidden`,
  start and end time. `TcaTablesPidTranslatedPage` moves rows onto the default-language page, where they
  can appear. 1.0.6 deletes language `-1` inline children of translated parents that the frontend shows
  (fixed in 2.2.0, dbdoctor #192). Rows of a removed extension or of a table without TCA are deleted, and
  so is every workspace draft when EXT:workspaces is not loaded.
- **Blind spots:** MM tables and `group` relations, FlexForm relations, `sys_refindex`, `sys_file` and
  `sys_file_metadata` themselves, physical files, `zzz_deleted_*` columns, and content pulled through
  "Insert records" or `CONTENT` from storage pages. "Clean" says nothing about these.
- **Slow on large databases:** several checks scan every TCA table, and records are fetched one by one.
  Record the runtime at intake and set the timeout from it.

## Versions and pins

No release supports both 12.4 and 14.3. Pin an exact version and record it in the evidence: the release
cadence is high (2.1.0 and 2.2.0 came out on the same day, and the next 2.x adds five checks, some of them
destructive).

| Source core | Intake version | Target version | Note |
|---|---|---|---|
| 12.4 | `lolli/dbdoctor:1.0.6` (TYPO3 12.4/13.4, PHP ^8.1) | `2.2.x` exact (13.4/14.3, PHP ^8.2) | The dependency plan bumps it at the 13.4 rung, the only core both run on |
| 13.4 | `2.2.x` exact | the same version | Same check list at both ends |

The harness knows the check order of 1.0.6 and 2.2.x (`CHECK_ORDER` in `scripts/db-health.mjs`). Any other
version runs, but the checks an abort skipped cannot be listed.

### Install as a dev dependency, in its own commit

```bash
ddev composer require --dev lolli/dbdoctor:1.0.6   # 13.4 source: the exact 2.2.x version
git add composer.json composer.lock && git commit -m "build: add lolli/dbdoctor for the database health check"
```

This is a Composer change in a node before Baseline A, and it is acceptable there because:

- the package registers one CLI command through DI; it ships no TCA, TypoScript, middleware, routes or
  assets, so nothing the visitor or editor sees changes;
- it happens after the read-only P00 inventories and before Baseline A, so the environment fingerprint
  and the baseline already contain it, and no later proof sees it as a change;
- `--dev` keeps it out of every `--no-dev` deploy artifact, and the separate commit can be reverted alone;
- `db-health-intake` declares `composer` and `ddev-stateful`, so no other node runs meanwhile.

If the owner allows no commit before Baseline A, run it in a disposable worktree with its own DDEV
project on a copy of the same dataset; that is heavier and must prove the dataset identity again.

## Commands

All commands run in the project root through DDEV. Pass `--mode` explicitly: interactive mode, the
default, asks `[e,s,a,r,p,d,?]` and under `-n` or without a TTY answers `?` forever.

```bash
H=skills/typo3-upgrade-run/scripts   # or .typo3-update/harness
N=.typo3-update/nodes/db-health-intake

# 1. Read-only check, normalised into deterministic JSON (check.json with sha256)
node $H/db-health.mjs check --project . --out $N/check [--timeout 3600]

# 2. Full inventory: probe on a snapshot it takes, restores and proves restored
node $H/db-health.mjs probe --project . --out $N/probe --snapshot-name <run>-dbdoctor-probe-a1

# 3. Offline: re-parse saved output or SQL files
node $H/db-health.mjs parse-check --stdout $N/check/dbdoctor-check.stdout.txt --exit 255 --version 2.2.0
node $H/db-health.mjs parse-sql --sql $N/probe/pass1.sql --sql $N/probe/pass2.sql --version 1.0.6 --json records.json
```

`check` runs `COLUMNS=200 timeout <s> vendor/bin/typo3 dbdoctor:health --mode=check --no-ansi
--no-interaction` inside the web container (a fixed width keeps the wrapping stable), stores stdout,
stderr and the exit code verbatim, and writes `check.json`: per check its status (`ok`, `affected`,
`aborted`, `timed-out`, `not-run`), its action tags (`risky`, `remove`, `soft-delete`, `update-fields`,
`workspace-remove`) and its table counts with sorted keys. The version comes from
`ddev composer show lolli/dbdoctor`.

The probe needs a recorded node snapshot as well: open the node with
`t3u snapshot-create --node db-health-intake` and `--snapshot`, as for every stateful node. The probe's
own snapshot is separate, so a failed probe never touches the node snapshot.

### Exit codes

| dbdoctor | Meaning | `db-health.mjs` | Action |
|---|---|---|---|
| 0 | No affected records | 0 | Clean |
| 1 | Findings (check) or changes made (execute) | 1 | Complete count inventory; run the probe for uids |
| 2 | User abort | 2 | Cannot happen with `--mode`; a harness fault |
| 4 | Precondition: missing table/column/index, or bad options | 4 | See below; never fix the schema just to run dbdoctor before Baseline A |
| 124 | Our `timeout` killed it (undocumented in dbdoctor) | 2 | Raise the timeout from the measured runtime |
| 255 | A check threw. With "previous check should have … fixed" it is a chained finding | 1 (`partial-findings`) | Partial inventory; the probe gets the rest |
| 255 | Any other exception (row count, TCA shape) | 2 (`crashed`) | Read stderr; a tool or data problem to name in the evidence |

The script adds 3 when the probe cannot prove the database restored (stop, restore the node snapshot by
hand, never continue) and 5 when `apply` refuses: no approval id, or a statement that is not a single-row
dbdoctor `UPDATE`/`DELETE … WHERE uid = N` under its `# Triggered by` header.

Exit 4 at intake usually means the source schema is behind its TCA. That is a migration subject, not
something to repair before Baseline A: close `db-health-intake` `not-applicable` (reviewed) with the
missing objects named. `db-health-target` then has no intake inventory, and every target finding needs
the Baseline A lookup described below. Exit 4 on the target is a migration defect (the schema must be at
its fixed point after `rung-14`) and closes `findings`.

## The probe

```text
fingerprint F (all non-cache tables) -> ddev snapshot --name P
loop pass 1..5:
    dbdoctor --mode=execute --file=/var/www/html/.dbdoctor/P-passN.sql
    copy the SQL file out of the container (ddev exec cat, so a Mutagen lag cannot lose it)
    dbdoctor --mode=check  -> stop when clean
finally: delete the container SQL files, ddev snapshot restore P, fingerprint again == F
```

- Each pass can create findings for an earlier check (dbdoctor's own advice is to repeat until check
  exits 0). Five passes without a clean check is a finding of its own (`converged: false`).
- The restore proof fingerprints every table except `cache_*` and the harness exclusions (`cf_*`,
  `sys_log`, sessions, `sys_refindex`, `sys_history`), so tables beyond the default content fingerprint,
  for example `fe_users` or `sys_category`, are covered. `tstamp` is never touched by dbdoctor; only the
  row hash sees its changes.
- A probe exit 3 on an untouched database caused by chunked decoding (a multibyte UTF-8 character split
  across two output chunks changed the fingerprint of large tables) was fixed in the 2026-10-09 runner
  update: `defaultRunner` collects Buffers and decodes once.
- `records.json` lists one record per `(check, table, uid)` with its actions (`delete`, `soft-delete`,
  `update`) and the updated fields, sorted, plus one group per `(check, table)` with the risk and a
  default proposal, and its sha256. `probe.json` records the snapshot, passes, convergence and the
  restore verdict.
- Runtime: one probe pass costs an execute run plus a check run, both full scans, plus a snapshot and a
  restore. `t3u graph-forecast` needs positive estimates for `db-health-intake` and `db-health-target`:
  take the measured intake check runtime as the source and multiply by the passes the probe needed.
- String values in dbdoctor's SQL are not escaped (`l10n_state` JSON, for example). The parser keeps
  only statements it reads unambiguously and lists the rest under `unparsed`; never replay those.

## The checks and their parity risk

Risk is the effect on Contract A when the fix is applied: **none** never rendered, **low** backend or
editor consistency only, **medium** can change rendering in some configurations, **high** usually changes
it. "2.2" marks checks missing from 1.0.6. The default proposal of `db-health.mjs` follows the risk:
none/low = `fix-candidate`, medium/high = `owner-decision`.

| Check | Fix | Risk | Parity notes |
|---|---|---|---|
| WorkspacesNotLoadedRecordsDangling | delete | high | Deletes **every** draft when EXT:workspaces is not loaded, also by mistake during the upgrade |
| WorkspacesRecordsOfDeletedWorkspaces | delete | none | |
| TcaTablesDeleteFlagZeroOrOne | deleted=1 | none | Disastrous when the delete column is a varchar (README limits) |
| WorkspacesSoftDeletedRecords · WorkspacesPidNegative · WorkspacesT3verStateMinusOne · WorkspacesT3verStateThree | delete | none | Leftovers of missing v10–v12 wizards: run those wizards first |
| WorkspacesT3verStateNotZeroInLive | per row | low | |
| SysRedirectInvalidPid | pid to site root or 0 | medium | Check the redirect sentinels |
| TcaTablesLanguageLessThanOneHasZeroLanguageParent | l10n_parent=0 | medium | Overlay lookups can change |
| TcaTablesLanguageLessThanOneHasZeroLanguageSource | l10n_source=0 | low | |
| PagesBrokenTree · PagesTranslatedLanguageParentMissing · PagesTranslatedLanguageParentDeleted | delete / soft-delete | none | Not reachable |
| PagesTranslatedLanguageParentSelf | soft-delete | low | |
| PagesTranslatedLanguageParentDifferentPid | **delete** | medium | The frontend may still resolve it through `l10n_parent` |
| PagesTranslatedLanguageParentDuplicates (2.2) | deleted=1 on all but the lowest uid | high | Not tagged risky; ignores `hidden`/start/end: the visible translation can go, its URL can 404 |
| TcaTablesTranslatedParentSelf | soft-delete | high | Tagged risky: may still render |
| TcaTablesTranslatedParentInvalidPointer | repoint or soft-delete | medium | |
| TtContentPidMissing | delete | medium | Except `tt_content` used as inline child (news) |
| TtContentPidDeleted | soft-delete | medium | Content pulled by Insert records or `CONTENT` from deleted pages disappears |
| TtContentDeletedLocalizedParentExists · TtContentDeletedLocalizedParentDifferentPid | delete | none | |
| TtContentLocalizedParentExists | delete | medium | "Typically never rendered" |
| TtContentLocalizedParentSoftDeleted · TtContentLocalizedParentDifferentPid | soft-delete / pid | low | |
| TtContentLocalizedDuplicates | deleted=1 on all but the lowest uid | high | Not tagged risky; ignores hidden, timing, pid and colPos |
| TtContentLocalizationSource* (3 checks) | l10n_source | none | Backend "Translate" button only |
| SysFileReferenceDangling | delete | medium | A missing parent **table** (removed extension) deletes all its references |
| SysFileReferenceDeletedLocalizedParentExists · SysFileReferenceInvalidPid | delete / pid | none | |
| SysFileReferenceLocalizedParentExists · …ParentDeleted · …FieldSync | delete / soft-delete | high | Tagged risky: the frontend often still shows the image |
| TcaTablesPidMissing · TcaTablesPidDeleted | delete / soft-delete | medium | Plugin storage folders that were deleted but are still referenced lose their records |
| TcaTablesPidTranslatedPage (2.2) | pid to the default page | high | Tagged only update-fields: rows can **appear** on the default-language page |
| TcaTablesTranslatedLanguageParentMissing · …ParentDeleted | delete / soft-delete | low | |
| TcaTablesTranslatedLanguageParentDifferentPid | move + hidden=1, or delete | medium | Deliberately hides the record |
| InlineForeignFieldChildrenParentMissing · …NoForeignTableField…Missing | delete | medium | Parent table without TCA deletes all children; without `foreign_table_field` the parent table is guessed ("first one wins"), false positives for shared Content Blocks collections without `shareAcrossTables` |
| InlineForeignFieldChildrenParentDeleted · …NoForeignTableField…Deleted | soft-delete | none | |
| InlineForeignFieldChildrenParentLanguageDifferent · …NoForeignTableField…LanguageDifferent | 2.2: `-1` child gets the parent language, others deleted; **1.0.6: all deleted** | high | Tagged risky; 1.0.6 deletes visible images (#167). Proposal on 1.0.6: `do-not-fix-with-1.0.6` |
| TcaTablesTranslatedLanguageParentDuplicates (2.2) | soft-delete all but the lowest uid | high | Not tagged risky; hidden state ignored |

Two checks are disabled in every version (SysFileReferenceInvalidFieldname, TcaTablesInvalidLanguageParent).
The unreleased 2.x adds PagesLanguageNegative, PagesPidDeleted, TtContentLocalizedPageTranslationMissing,
TcaTablesTranslatedLanguageNotInSiteConfiguration (high when the site configuration changed between source
and target) and TcaTablesTranslatedWithAllowLanguageSynchronization; the harness already rates them.

## Classification at intake

Every group `(check, table)` of `records.json` gets exactly one class in `nodes/db-health-intake/classification.md`:

| Class | Meaning | Where it goes |
|---|---|---|
| `pre-existing` | Recorded, not fixed in this run: no frontend effect, or the owner does not want a fix now | Inventory baseline and handover residual |
| `fix-approved` | The owner approved the group as a dated dataset transition before Baseline A | `findings` → `db-health-recovery` |
| `blocker` | The run cannot be judged: a crash dbdoctor cannot assess, or drafts #1 would wipe | `blocked` |

Rules:

1. Ask per group, never per row and never "approve everything" ([approval matrix](../rules/40-approval-matrix.md#401-the-matrix), row 32).
   The round-1 policy decides the default: **record only** (every group `pre-existing`, the intake node
   passes) or **fix approved groups before Baseline A**.
2. `fix-candidate` groups (risk none/low) may be approved as a batch per check.
3. `owner-decision` groups (medium/high or tagged risky) need the evidence of their visible effect: render
   the affected URLs on the dataset and on a probe snapshot with the fix, and show the pair. For duplicate
   translations, list kept and dropped rows with `hidden`, `starttime` and `endtime`; when the lowest uid
   is the hidden one, edit the curated statement to drop the hidden row instead (keep the dbdoctor statement
   shape, it is still one `UPDATE … SET deleted = 1 WHERE uid = N`).
4. On a 12.4 source never approve the two `…ParentLanguageDifferent` groups from 1.0.6. Record them; 2.2.x
   on the target reports them again as `unchanged`, and the owner can decide after Contract A.
5. A group caused by an approved upgrade decision (an extension removal, a dropped workspace) is not fixed
   at intake. At the target it is an expected consequence and belongs in the ledger.
6. Never approve `WorkspacesNotLoadedRecordsDangling` when the site uses workspaces: load EXT:workspaces
   instead, or decide about the drafts as a destructive operation (row 15) with its own evidence.

### Strategy per problem type

| Problem type | Typical checks | Strategy |
|---|---|---|
| Orphans nobody renders | PagesBrokenTree, *ParentMissing, *ParentDeleted, deleted-row checks | Approve as a batch before Baseline A, or record; zero frontend risk either way |
| Workspace leftovers | Workspaces* | Run the missing core wizards first; recheck. Drafts of a used workspace are never deleted by the tool |
| Duplicate translations | *Duplicates | Owner decision per group with the visibility table; curated SQL keeps the visible row |
| Content pulled from elsewhere | TtContentPidDeleted, TcaTablesPidDeleted, TcaTablesPidMissing | Search Insert records, `CONTENT` and plugin storage pids first; record when anything pulls them |
| Removed extensions, Mask leftovers | SysFileReferenceDangling, InlineForeignField*ParentMissing | Do not fix at intake; ledger them at the target as the consequence of the approved removal |
| Translation structure | *DifferentPid, *InvalidPointer, TcaTablesPidTranslatedPage | Render compare; usually record and fix after Contract A as a separate owner task |
| Language `-1` children | InlineForeignField*LanguageDifferent | Never with 1.0.6; with 2.2.x the language update is the intended repair, decided after Contract A |

## db-health-recovery: the dated dataset transition

Only before Baseline A, only the approved groups, never `--mode=execute`:

1. Build `curated.sql` from the probe SQL: the approved groups' statements under their
   `# Triggered by` headers, in probe order. Review the string values by hand.
2. `t3u snapshot-create --node db-health-recovery`, then open the node with that `--snapshot` and the
   `--approval` id.
3. Apply:

   ```bash
   node $H/db-health.mjs apply --project . --sql curated.sql --approval APR-012 \
     --snapshot <recorded-snapshot> --out .typo3-update/nodes/db-health-recovery
   ```

   It wraps the statements in `START TRANSACTION … COMMIT`, pipes them into `ddev mysql`, runs
   `referenceindex:update` and `cache:flush`, re-checks, and writes `apply.json`: approval id, SQL sha256,
   statements per check, tool version, re-check verdict and the database fingerprints before and after
   (D0 → D0′).
4. Close `pass`; `db-health-intake` reruns (retry edge, at most twice) and must find only `pre-existing`
   groups. A second recovery for groups the fix itself uncovered uses the second traversal.
5. Record the transition in the intake evidence as dataset D0 → D0′. The source content fingerprint of
   Baseline A is taken afterwards, on D0′, so the fix is part of the baseline.

## Contract A interaction

- Fixes happen only before Baseline A. After the seal, any dbdoctor change is a declared content change
  with its SQL file in the transition ledger, or it is reverted.
- dbdoctor leaves `tstamp` alone, so the dataset-freshness sentinels ("newest `tt_content.tstamp`") never
  see its writes. Only the row-hash fingerprint does; recompute it after every fix.
- `referenceindex:update` rewrites `sys_refindex`; the content fingerprint excludes that table, the
  transition records the run.
- dbdoctor bypasses DataHandler hooks: Solr queues and cache tags do not follow. Flush caches after a
  fix; a Solr site reindexes in `solr-search` anyway.

## db-health-target: the comparison

1. Open with a snapshot (the probe is stateful); run `check` and `probe` with the target version.
2. Compare with the intake inventory:

   ```bash
   node $H/db-health.mjs compare \
     --intake .typo3-update/nodes/db-health-intake/probe/records.json \
     --target .typo3-update/nodes/db-health-target/probe/records.json \
     --ledger <cumulative content-transition.json> [--pre-existing baseline-lookups.json] \
     --json .typo3-update/nodes/db-health-target/compare.json
   ```

   | Class | Meaning | Route |
   |---|---|---|
   | `new` | Same check in both versions, row not found at intake: a migration defect | `findings` → `content-recovery`, which closes `db-health` to rerun this node |
   | `unchanged` | Pre-existing | Residual in the handover |
   | `vanished` | Fixed by a wizard, a migration or an approved change | Must be in the ledger: `declared_transitions[].db_health_resolved` lists its `check\|table\|uid` keys; `target-content-epoch` refuses unledgered ones |
   | `target-only` | Found by a check the intake version lacks (1.0.6 → 2.2: the duplicate checks and TcaTablesPidTranslatedPage) | Pre-existing only when a targeted `SELECT` on the Baseline A dump proves the same condition; list proven keys in `--pre-existing`, otherwise it counts as new |

   `compare` exits 1 for any `new` or unproven `target-only` entry; `--require-ledgered` also fails on
   unledgered vanished entries (use it when sealing the epoch).
3. Optional calibration for a 12.4 source: run 1.0.6 and 2.2.x on the same 13.4 database right after
   `rung-13` reaches its fixed point. The difference quantifies the version-only findings before the end.
4. Never execute on the target. A fix the owner wants happens in `content-recovery` with a snapshot,
   ledger entries, `referenceindex:update` and a re-check until clean, before the epoch seal.

## Staging and live

The run never touches staging or live. The handover carries a runbook item instead:

- Never run dbdoctor in the live web container: `--dev` packages are absent, and the scans load the database.
- Run it on a **fresh dated copy of live** (staging or local) and diff that inventory against the approved
  intake set. Editors may have fixed or recreated rows since the dump, and a uid can mean something else
  now. Re-approve only the difference.
- Apply the reviewed SQL file as an **owner-approved maintenance task**: a backup immediately before, with a
  restore test (the README recommends dumps before and after, `--skip-extended-insert` for diffable
  dumps); one transaction; then `referenceindex:update`, cache flush and a Solr reindex; then
  `--mode=check` exits 0 on a new copy.
- Never auto-execute, never interactive `e`, never on a schedule.

## Pitfalls

1. Check mode on a dirty database stops at exit 255; read `check.json` `complete` before calling it an inventory.
2. Simulated SQL (`s` in interactive mode) is printed, never written to `-f`; there is no skip key.
3. Interactive mode loops forever without a TTY; always pass `--mode` and wrap in `timeout`.
4. Execute mode has no transaction; a wrong row count leaves the database half fixed.
5. 1.0.6 deletes visible `-1` inline children under translated parents.
6. Duplicate checks keep the lowest uid, visible or not.
7. TcaTablesPidTranslatedPage can make content appear on the default-language page.
8. Inline children of tables without TCA count as orphans: removed extensions and Mask tables lose them.
9. Children without `foreign_table_field` get their parent table guessed; shared collections give false positives.
10. A child table whose TCA lacks the `foreign_field` column is skipped silently: "clean" proves nothing for it.
11. Insert records and `CONTENT` from storage pages are invisible to dbdoctor.
12. Run only after wizards and schema reached their fixed point and caches are flushed (TCA is static per run).
13. Pin the version; compare only like with like.
14. Never replay an SQL file with unparsed lines; string values are not escaped.

## Evidence layout

```text
nodes/db-health-intake/
  check/{dbdoctor-check.stdout.txt, dbdoctor-check.stderr.txt, dbdoctor-check.exit, check.json}
  probe/{passN.sql, passN.execute.*.txt, passN.check.json, records.json, probe.json}
  classification.md        group -> class, approval ids, rendered pairs for owner-decision groups
  evidence.md              tool version, runtime, hashes of the files above, snapshot names
nodes/db-health-recovery/{apply.sql, apply.json, recheck.json, evidence.md}
nodes/db-health-target/{check/, probe/, compare.json, evidence.md}
```

Related: [database integrity](database-integrity.md) for schema and relation work around P09,
[closure currentness](closure-currentness.md#target-content-epoch-one-cumulative-ledger) for the ledger.
