# Prioritized human review

Prepared 2026-09-05. This is a review queue, **not a countersignature**. Read each named case's
prompt and assertions in its linked suite; accept or request a correction for that case explicitly.
Model trials and passing harness tests do not convert proposed cases to human-reviewed cases.

## First review batch

| Priority | Suite / case id | Decision to review |
|---|---|---|
| P0 | [upgrade-run](../skills/typo3-upgrade-run/evals/evals.json) / `passed-terminal-does-not-hide-blocked-branch` | A successful independent branch and valid graph structure must not hide an interrupted/blocked migration. Independent trial exposed this bug; executable regression tests now cover it. |
| P0 | [upgrade-run](../skills/typo3-upgrade-run/evals/evals.json) / `site-size-dependent-hard-runtime-profiles` | New small/large/huge caps 8/24/48 elapsed hours, closure reserves 2/6/12, no clock reset or legacy-seal extension. Previous human review applied to the old 8/12/14 policy; the changed case is proposed again. |
| P0 | [migration](../skills/typo3-upgrade-migration/evals/evals.json) / `migration-behaviour-snapshot` | Exact local snapshot and rollback before stateful changes; reconcile interruption before replay. |
| P0 | [upgrade-run](../skills/typo3-upgrade-run/evals/evals.json) / `shared-recovery-budget` | Three starts per node, twelve total retry traversals, smaller edge limits and earlier no-progress stop; no nested reset. |
| P0 | [closure](../skills/typo3-upgrade-closure/evals/evals.json) / `closure-behaviour-stale-import` | A dataset/import change invalidates prior proof instead of preserving a stale certificate. |
| P0 | [closure](../skills/typo3-upgrade-closure/evals/evals.json) / `closure-behaviour-acceptance-hash` | Acceptance applies to the observed manifest hash, not a reusable filename or a prior permission to attempt work. |
| P0 | [upgrade-run](../skills/typo3-upgrade-run/evals/evals.json) / `security-claims-and-solr-mutations-require-identity` | Verified advisory evidence and exact local Solr identity/backup before mutation; no advisory bypass. |
| P1 | [playwright](../skills/typo3-playwright/evals/evals.json) / `browser-beh-ajax-repeat` | Persistent behavior after AJAX replacement, not only the first successful click. |
| P1 | [playwright](../skills/typo3-playwright/evals/evals.json) / `browser-beh-editor-save` | Actual editor save/reopen consequence; backend HTTP 200 alone is insufficient. |
| P1 | [closure](../skills/typo3-upgrade-closure/evals/evals.json) / `late-user-acceptance-current-proof` | Timely complete proof may await later acceptance, but changed input or late initial proof cannot use that route. |
| P1 | [intake](../skills/typo3-upgrade-intake/evals/evals.json) / `reject-unfittable-night` | Forecast the complete locked critical path; refuse unmeasured overnight promises and never shrink mandatory coverage to fit. |
| P1 | [upgrade-run](../skills/typo3-upgrade-run/evals/evals.json) / `frontend-modernization-boundary` | Requested Bootstrap/native-JS work preserves the working asset integration and includes measured Lighthouse proof. |

Reply with exact case ids and either **accept** or the requested correction. A human acceptance
of these assertions is not acceptance of any customer upgrade or of unrelated cases. After the
individual decisions, update only those cases' status/reviewer and rerun `./scripts/check.sh`.

## Remaining review

Then review trigger-positive/negative boundaries for the four upgrade leaves and Playwright,
followed by the remaining proposed cases grouped by owner skill. Draft cases require rewriting
into concrete representative inputs before review. Do not batch-sign the entire collection.

This batch does not replace full local replay benchmarks, real TYPO3 editor tests or customer
closure reconciliation. Existing customer certificates and original baseline evidence remain unchanged.
