# Current-code closure, not a historical success label

## Workflow

Distinguish these outcomes in every status and handover:

- **implemented**: dependencies/code migrated; proof may be missing;
- **verified, awaiting acceptance**: current complete proof passed; human countersignature missing;
- **closed locally**: current proof and recorded acceptance; no deployment is implied;
- **stale/incomplete/blocked**: name the missing check or changed input, never call it complete.

Start final verification after all migration changes, production builds and target-content-epoch
reconciliation. Commit implementation
first when authorized; otherwise stage and bind the exact dirty-tree delta. Classify untracked
files, ignore private artifacts, and never stage secrets or customer data to satisfy a gate.

```bash
t3u closure-start
# Run each mandatory check against the printed immutable proof epoch.
t3u closure-check --evidence report/closure-evidence.json
t3u graph-validate
t3u closure-verify --evidence report/closure-evidence.json
t3u validate-run
# Record real observed-result acceptance; an agent cannot countersign for the user.
# Use t3u approval with an unused APR-NNN, --stage acceptance, the actual question/answer,
# --granted only after the user's acceptance, and --evidence path#sha256:<manifestHash>, where
# <manifestHash> is the sha256 of the manifest FILE bytes (shasum -a 256), not the canonical hash
# closure-verify prints.
t3u node-open --node contract-a-gate
t3u node-close --node contract-a-gate --outcome pass --evidence-loop 301 \
  --evidence nodes/contract-a-gate/evidence.md --approval APR-399
# ... Contract B branches (not-applicable unless requested), elevation-join ...
t3u node-open --node handover
t3u node-close --node handover --outcome pass --evidence report/handover.md
```

The gate nodes judge the closure manifest separately from their own evidence file. `node-close`
uses `--closure-evidence <manifest>` when given; otherwise, for `contract-a-gate`, the manifest
`closure-verify` recorded (`report/closure-evidence.json` when there is none) and, for `handover`,
the accepted manifest (`contract_a.closure_ref`). After approved Contract B work, pass the fresh
final manifest with `--closure-evidence`; the accepted Contract A manifest is still checked for its
recorded acceptance. Runs that passed the manifest itself as `--evidence` keep working.

### Commands that print nothing on success

`closure-check` refuses an empty artifact, because an empty file cannot show what was checked. Some
commands print only problems: `redirects:checkintegrity` renders a table only for conflicts.
Record such a check as a non-empty file with the command, its exit code and timestamps, plus a
read-only read-back of what it checked or wrote (for the integrity check: the
`tx_redirects/conflicting_redirects` registry entry and the `integrity_status` of every redirect),
and reference that file instead of the empty output.

`closure-start` writes a unique, hashed epoch beneath `report/`; it never rewrites old epochs.
Copy its run id and hash into `report/closure-evidence.json`, using this shape:

```json
{
  "schema": "typo3-upgrade-run/closure@1",
  "runId": "2026-09-05-example",
  "epochRef": "report/closure-epoch-<generated-id>.json",
  "coverageRef": "report/coverage.json",
  "backupRef": "report/backup-verification.json",
  "restoreRef": "report/restore-plan.md",
  "coverageSha256": "sha256:<actual coverage file hash>",
  "backupSha256": "sha256:<actual backup verification report hash>",
  "restoreSha256": "sha256:<actual restore plan hash>",
  "checks": [{
    "id": "interactions", "status": "pass", "exitCode": 0,
    "expected": 18, "executed": 18, "failed": 0, "skipped": 0,
    "command": "<actual canonical test command, without secrets>",
    "startedAt": "<actual UTC timestamp>", "finishedAt": "<actual UTC timestamp>",
    "epoch": "sha256:<printed epoch hash>",
    "artifacts": [{"path": "report/interactions.json", "sha256": "sha256:<actual file hash>"}]
  }]
}
```

The complete manifest needs these thirteen check IDs exactly once: `http-dom`, `visual`,
`interactions`, `backend-editor`, `redirects`, `runtime`, `dependencies`, `schema`, `assets`,
`environment`, `deployer`, `lighthouse`, `axe`. Each contains positive expected coverage, matching
executed coverage, zero skipped/failed checks, actual exit 0 and nonempty hashed artifacts.
`visual` additionally records `pixelThreshold: 0` and `unapprovedDifferences: 0`; every intentional
difference links to its observed-result acceptance in the coverage report. `lighthouse` records
`runsPerUrl >= 3`, `budgetApplied: true`, `toolVersion` and `chromeVersion`.
The coverage and backup/restore references also need their matching file hashes. Reference only
verification metadata, never a database dump, credentials or the backup contents themselves.

These are evidence checks, not thirteen new implementation programmes. For example, `assets`
proves the existing integration works; it does not require installing Vite on a CSS-only site.
Keep detailed per-feature applicability in the coverage registry. Do not claim a package's mere
presence proves its configured runtime behavior. Machine validation checks identity, freshness,
coverage accounting and artifact integrity; the agent must still inspect actual assertions/logs.

New graphs additionally require the [sealed feature plan and JSON coverage results](feature-evidence.md).
The plan is the passed `intake-join` artifact. Every planned assertion must have a current result
and evidence bound to its parent check; missing or altered inventory/plan files refuse closure.
No extra top-level checks, global browser states or full-capture loops are introduced.

## Residual findings do not block closure

`closure-check` requires zero unresolved run findings. That count follows the loop gate (`loopVerdict`): only
blocking classes (`regression`, `harness-noise`, `content-drift`), an unapproved `declared-change` and unclassified
findings count. An approved declared change, a `pre-existing`, `environment` or `improvement` finding is a residual:
it stays in the loop report and in the certificate, but it does not keep the run open. Harness versions before this
rule counted every open residual, so a run with approved declared changes could never close.

## Epoch order: what makes a new epoch stale

An epoch binds the source identity, the self-test lock, the environment, the URL manifest and the
content epoch. Changing any of them after `closure-start` wastes every check run in that epoch; two
fleet runs lost an epoch each this way. Before `closure-start`:

1. **Commit every code change.** A recovery that commits site code after `closure-start` (a backend fix
   found by `backend-operations`, or the `settings.php` cleanup of an
   [admin login](known-problems.md#logging-in-as-admin-or-opening-the-install-tool-changes-tracked-files))
   makes the epoch stale: the next proof (there `axe-proof`) closes `invalid`, `closure-harness-recovery`
   finds nothing to repair in the instrument and returns `reproof`, and the route runs
   `target-content-epoch` again before a new `closure-start`.
2. **Re-run the self-test after any environment re-seal.** `closure-start` refuses a missing or stale
   lock (`Re-run "t3u selftest-determinism" before closure-start`). Older pins accepted a stale lock,
   and `closure-check` refused the epoch as STALE only after all thirteen checks had run. Order:
   re-seal, self-test, `closure-start`.
3. **Classify untracked owner folders.** `closure-start` refuses untracked files outside the run
   directory and names their top-level paths. Add owner drafts (for example `relaunch/`) to
   `.git/info/exclude`: local, never committed, never `.gitignore`.

The `lighthouse` check also needs floors that were fixed before the first migration node
([quality bars](quality-bars.md#contract-a-lighthouse-floors-decided-at-intake)); its required fields
are listed above.

**Reproof mechanics.** `node-close --outcome reproof` prints `exit 2 (OUTCOME reproof): node-close
recorded <node> as "reproof" and activated <edge>; the exit code reports that outcome, not a failure of
this command.` Older pins printed `exit 2 (HARNESS_ERROR): The harness failed` for the same, correctly
recorded close: read the journal (`verdict: reproof`) before retrying anything. Run the new epoch's
checks in new loops; a green loop never reopens. A quality loop is an invariance loop: run
`compare-all` and `gate` in it as well, or close a loop the new epoch replaces with
`t3u loop-supersede --loop <NNN> --by <MMM> --reason "…"`. Until then `gate` refuses with "Active loop
NNN has no authoritative report.json", because axe and Lighthouse write only artifacts.

## Invalidation and recovery

Changed source/index objects, branch, unstaged-code delta, graph hash, dataset/media epoch,
renderer/configuration or manifest make the current closure stale. HEAD is recorded as provenance:
committing only run evidence (or already-staged, tested implementation) leaves the source identity
unchanged and does not create an endless proof→commit→stale cycle. Old certificates remain historical evidence,
not proof of the current checkout. Regenerate the affected tests first; after the last change,
start a fresh final epoch and perform one complete final verification, then its required unchanged
rerun. Do not run exhaustive proof after every single fix.

When a completed final epoch has become stale, return `reproof` from `closure-reconcile` or
`closure-harness-recovery`. Its bounded edge reopens target-content reconciliation and then all
final proof nodes, without restarting the baseline or dependency/data migrations. Finish that
reconciliation before `closure-start`; otherwise the transition itself would invalidate the epoch.

Reuse unrelated migration results only with verified input hashes. Never rerun schema/data
migrations just to make an old P05/P11 label look current. An old run without an intact source
baseline can prove present-day readiness, but cannot retroactively prove v12→v14 invariance.
Describe that as a narrower readiness audit/new run; never fabricate the missing Baseline A.

Approved Contract B changes leave the original A certificate historical. Before handover, collect
fresh final evidence for the resulting code/dataset and link the approved B baselines and declared
changes. `handover` also calls `closure-check`, so old A evidence alone cannot certify changed B code.

The acceptance record's `evidence_ref` is `report/closure-evidence.json#sha256:<manifestHash>`
using the hash returned by `closure-check --json`, not just the reusable filename.
The acceptance record must reference this exact manifest and observed result. After acceptance,
do not edit its manifest or reuse the acceptance for a different epoch. Gather missing decisions
before the overnight run; if a new human decision is needed overnight, finish safe diagnostics and
report awaiting acceptance/incomplete within the sealed deadline rather than inventing approval.

`closure-verify` records a hash-bound verification receipt **before** the deadline while keeping A
open and B locked. This is the unattended terminal checkpoint. A later human acceptance can reuse
that exact receipt after current source/data/renderer/artifact checks; it does not require rerunning
unchanged tests merely because the person was asleep. A changed manifest, late test, late initial
verification or changed input cannot use this route to extend the overnight computation window.
After the deadline only `t3u approval … --stage acceptance` and `node-open`/`node-close` of
`contract-a-gate` still run, and only when `closure-verify` recorded the proof before the deadline.

## Coverage that must not disappear

Always verify editor save/reopen and RTE link dialogs, plugin previews and PHP **web** runtime,
not just CLI PHP and `/typo3/` HTTP 200. When present, exercise AJAX filters after replacement,
UTF-8 search/suggest, cached-page indexing, stale FAL references and media/video output. Use
`typo3-playwright` for these cases. Keep the first failed command's exit code; isolated successful
rechecks do not rewrite it. Record masks, tolerance and excluded dynamic regions explicitly.

Read [`run-retrospective-2026-09.md`](run-retrospective-2026-09.md) for the underlying fleet evidence.
