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

## Preconditions

- Graph and identity validate; Baseline A verifies byte-for-byte.
- Migration and applicable specialist nodes are passed/skipped with evidence.
- Stateful migrations reached fixed points; source content fingerprint remains immutable.

## Proof graph

1. Reconcile every expected DB/file/schema/generated-asset change in the content-transition ledger;
   seal the target editorial epoch. Unledgered content drift is `INVALID`.
2. Capture target with the exact sealed renderer, origins, URLs, seed, viewports, states, workers, and
   stabilization inputs.
3. Compare HTTP/metadata for all URLs, normalized DOM for all HTML, and pixels for the sealed tiered
   sample. Missing evidence is not zero.
4. Run component sentinels before/after: cookie consent first/reject/accept/settings, sliders settled
   and operated, navigation/focus, forms/Mailpit, search order/empty/pagination, media, login/reset/404,
   language and project-critical flows.
5. Verify backend login, expected module inventory, editor roles, cache/task/data write round-trip,
   runtime logs, scheduler/search as applicable, Composer audit, schema, and migration idempotence.
6. Redirects is mandatory: package/module present, intended editor group can read/create/edit only in
   authorized scope, unrelated actions remain denied, and frontend redirect response is correct.
7. Run version-pinned Lighthouse repeated on fixed URLs and axe over representative visible states.
   Report medians/ranges and all findings. Automated green is not WCAG conformance.
8. Re-run the complete final measurement unchanged and require the same verdict.

## Classification and routes

- HTTP+DOM+pixels → routing/template/content recovery.
- DOM+pixels → markup/template recovery.
- pixels only → classify CSS, assets/fonts/images, content, session/consent, or harness.
- component failure → interaction recovery; search order is output, not incidental index state.
- malformed/missing/hash/input mismatch → harness recovery and `INVALID`, not site findings.
- policy/identity/credential/approval failure → blocked security path.

There is no “minor acceptable” regression. Repair it or obtain acceptance for a specifically shown
declared change with before/after evidence. Do not refresh Baseline A or relax measurement.

## Closure certificate

Close only with zero unapproved regressions and passing `t3u graph-validate`/`validate-run`. Record:
project/remote/branch/HEAD, core/PHP, dataset date, source/target hashes, graph hash, backup/restore,
commands and exit codes, coverage, declared changes, residual risks, and exact next local step. State
that no staging/live action occurred. Contract B remains locked until countersigned.

## Boundaries

Use `typo3-wcag22-aa-agentic` for a separate conformance programme and `typo3-security` for approved
hardening. Their visible changes belong to Contract B after this closure.
