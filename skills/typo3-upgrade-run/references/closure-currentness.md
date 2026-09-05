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
# --granted only after the user's acceptance, and --evidence path#sha256:<manifestHash>.
t3u node-open --node contract-a-gate
t3u node-close --node contract-a-gate --outcome pass --evidence-loop 301 \
  --evidence report/closure-evidence.json --approval APR-399
```

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

## Coverage that must not disappear

Always verify editor save/reopen and RTE link dialogs, plugin previews and PHP **web** runtime,
not just CLI PHP and `/typo3/` HTTP 200. When present, exercise AJAX filters after replacement,
UTF-8 search/suggest, cached-page indexing, stale FAL references and media/video output. Use
`typo3-playwright` for these cases. Keep the first failed command's exit code; isolated successful
rechecks do not rewrite it. Record masks, tolerance and excluded dynamic regions explicitly.

Read [`run-retrospective-2026-09.md`](run-retrospective-2026-09.md) for the underlying fleet evidence.
