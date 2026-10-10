---
name: typo3-upgrade-closure
description: >-
  Prove and close Contract A after a whole-site TYPO3 14.3 upgrade. Use when the target is
  stable for target-content-epoch reconciliation, exhaustive HTTP/DOM comparison, tiered
  pixel proof, consent/slider/search/form sentinels, backend login/module/write checks,
  Redirects rights, runtime/Composer/schema checks, Lighthouse/axe evidence, regression
  classification, idempotence, or deciding whether the final upgrade may close when cookie
  dialogs/carousels were not operated. Produces the certificate and local handover. Never performs the
  main migration, rebaselines, accepts unexplained differences, or deploys.
metadata:
  skill_type: preference
---

# TYPO3 upgrade closure

One job: decide whether Contract A is actually proven.

## Nodes you own

Start every node from `t3u node-brief --node <id>`; it carries the contract, routes and budget.

| Node | Focus |
|---|---|
| `db-health-target` | Before the epoch: dbdoctor 2.2.x check plus restored probe, compared on `(check, table, uid)` with the intake inventory; new → `content-recovery`, vanished → ledger, never execute ([database health](../typo3-upgrade-run/references/database-health.md#db-health-target-the-comparison)) |
| `target-content-epoch` | Workflow step 1; flagged **R**: a verifier checks the ledger explanations, including every dbdoctor finding that vanished since intake |
| `content-ledger-recovery` | Explain or revert unledgered drift; flagged **R** |
| `http-dom-proof` | Step 3 for every discovered URL; evidence loop |
| `visual-proof` | Step 3 for the sealed tiered sample; evidence loop; findings → `visual-classify` |
| `visual-classify` | One cause per difference; flagged **R**, because a wrong class sends the next worker to the wrong repair |
| `backend-operations` | Step 5 with a non-admin editor where the plan names one |
| `axe-proof` | Step 7, verify mode, per visible state |
| `lighthouse-proof` | Step 7 in the quiet lane with the required run count |
| `markup-recovery` | One template/markup cause; outcome `http` or `visual` names the proof to rerun |
| `interaction-recovery` | One failing journey step |
| `quality-recovery` | One accessibility or performance regression |
| `closure-harness-recovery` | Measurement node: repair the final instrument; the outcome names the single proof to rerun |
| `closure-join` | All final proofs passed on the current epoch |
| `closure-reconcile` | Stale evidence, missing assertions or unaccepted changes; flagged **R** |
| `contract-a-gate` | Closure certificate plus recorded human acceptance of its hash; evidence loop |
| `elevation-join` | Both standard Contract B branches (structured data, WebMCP) passed; `not-applicable` only with a reviewed impossibility reason, never "not requested" |
| `handover` | Local handover including the graph report and the audit-trail location |

## Worker protocol

Your input is the node brief. Write its evidence file, return one allowed outcome, and never run
`node-open`/`node-close` or edit run state. Details: [graph runner](../typo3-upgrade-run/references/graph-runner.md).
Keep the evidence lean: about 120 lines of proof, earlier artifacts cited by path and hash, one probe
artifact; at the brief's forecast (15 minutes or less) or twice it, stop and return what is proven
plus the open question ([lean profile](../typo3-upgrade-run/references/graph-runner.md#evidence-file)).

## Preconditions

- Graph and identity validate; Baseline A verifies byte-for-byte.
- Migration and applicable specialist nodes are passed/skipped with evidence.
- Stateful migrations reached fixed points; source content fingerprint remains immutable.

## Workflow: proof graph

Read `../typo3-upgrade-run/references/closure-currentness.md`. After the last migration/build,
reconcile the target content epoch first; then use `t3u closure-start` and bind every check to it.
Read the sealed intake feature plan and [feature evidence format](../typo3-upgrade-run/references/feature-evidence.md).
Report each planned journey/assertion under its existing closure check. Aggregate green counts
cannot hide an untested finisher, provider state, authenticated module or warmed-cache consequence.

1. Reconcile every expected DB/file/schema/generated-asset change in the content-transition ledger;
   seal the target editorial epoch. Unledgered content drift is `INVALID`.
2. Capture target with the exact sealed renderer, origins, URLs, seed, viewports, states, workers, and
   stabilization inputs, once, inside `visual-proof`. `http-dom-proof` and `visual-proof` then compare
   that capture side by side and `axe-proof` follows; `component-sentinels` and `backend-operations`
   run alone, Lighthouse last ([final-proof order](../typo3-upgrade-run/references/parallel-execution.md#dispatch-what-the-graph-offers)).
3. Compare HTTP/metadata for all URLs, normalized DOM for all HTML, and pixels for the sealed tiered
   sample. Missing evidence is not zero.
4. Run component sentinels before/after: cookie consent first/reject/accept/settings, sliders settled
   and operated, navigation/focus, forms/Mailpit, search order/empty/pagination, media, login/reset/404,
   language and project-critical flows.
5. Verify backend login, expected module inventory, editor roles, cache/task/data write round-trip,
   runtime logs, scheduler/search as applicable, Composer audit, schema, and migration idempotence.
   Use `typo3-playwright`: non-admin save/reopen, RTE page/record/file link dialogs, actual plugin
   previews, media/video and category fields. Test mobile filters a second time after AJAX results
   replacement and UTF-8 search/suggest when present. Verify the web PHP runtime, not only CLI.
   For migrated rich text or preset changes, require the [field round-trip proof](../typo3-content-blocks/references/rich-text-roundtrip.md).
   Standalone editor/parser results cannot close a pending authenticated backend check.
6. Redirects is mandatory: package/module present, intended editor group can read/create/edit only in
   authorized scope, unrelated actions remain denied, and frontend redirect response is correct.
7. Run version-pinned Lighthouse repeated on fixed URLs and axe over representative visible states.
   Report medians/ranges and all findings. Automated green is not WCAG conformance.
   Use `--mode verify` before closure, not the optional Contract B optimization mode.
8. Re-run the complete final measurement unchanged and require the same verdict.

## Classification and routes

- HTTP+DOM+pixels → routing/template/content recovery.
- DOM+pixels → markup/template recovery.
- pixels only → classify CSS, assets, fonts, images, content, session/consent, or harness.
- component failure → interaction recovery; search order is output, not incidental index state.
- malformed/missing/hash/input mismatch → harness recovery and `INVALID`, not site findings.
- policy/identity/credential/approval failure → blocked security path.

There is no “minor acceptable” regression. Repair it or obtain acceptance for a specifically shown
declared change with before/after evidence. Do not refresh Baseline A or relax measurement.

## Closure certificate

Close only with zero unapproved regressions and passing `t3u closure-check`, `graph-validate` and
`validate-run`. Missing/failed/skipped checks cannot be waived by a narrative summary. Record:
project/remote/branch/HEAD, core/PHP, dataset date, source/target hashes, graph hash, backup/restore,
commands and exit codes, coverage, declared changes, residual risks, any runtime extension or waiver
(`closure-check` and `closure-verify` print it) with its approval id and new deadline, and exact
next local step. When
the run moved Bootstrap to 5.x, name the invariance loop/commit and the accepted Bootstrap change
(intent and acceptance ids, declared-change ids) as separate items ([procedure](../typo3-upgrade-run/references/bootstrap-5-migration.md#sequence-inside-the-run)).
State that no staging/live action occurred. Contract B remains locked until countersigned; after
that, the standard structured-data and WebMCP branches run in every upgrade before handover.
Use `closure-verify` before the deadline to record complete proof awaiting actual human acceptance.
This receipt can be accepted later only while its source/data/renderer inputs and artifacts remain
current. Never set contract fields manually. `node-close --node contract-a-gate` validates proof and
human acceptance before updating them. Changed source/data make earlier closure stale; evidence-only
commits do not invalidate their own reports. Preserve
history and obtain current evidence. A missing source baseline cannot be recreated after upgrade.

## Boundaries

Use `typo3-wcag22-aa-agentic` for a separate conformance programme and `typo3-security` for approved
hardening. Their visible changes belong to Contract B after this closure.
