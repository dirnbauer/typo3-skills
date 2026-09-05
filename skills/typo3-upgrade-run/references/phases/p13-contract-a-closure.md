# P13 — Current Contract A closure certificate

Gate, no new loop. Read and follow [`../closure-currentness.md`](../closure-currentness.md).

## Preconditions

The final proof nodes and closure join passed. Baseline A is intact. Every mandatory check is
bound to the current code/graph/dataset/renderer epoch. No unapproved regression remains.

## Workflow

1. Run `t3u closure-check --evidence report/closure-evidence.json --json`, `t3u graph-validate` and
   `t3u validate-run`. Directory/schema validity alone is not closure.
2. Write the concise human report alongside the machine manifest: exact subject, commands/exit
   codes, source/target hashes, coverage/exclusions, backups/restore, declared changes and risks.
3. Run `t3u closure-verify` before the deadline, then ask for observed-result acceptance of that precise manifest hash. If no answer, report
   **verified, awaiting acceptance**; never countersign as the user.
4. Close `contract-a-gate` through `t3u node-close` with the evidence loop, manifest and acceptance id.
   The command updates contract state. Never edit `contract_a` or unlock B by hand.

## Claim limits

State exactly which routes, pixels, component journeys, roles and dataset were verified. Do not
call sampled pixels exhaustive; list untested visual pages and exclusions. No automated result
proves WCAG conformance, production delivery, zero undiscovered defects or production deployment.

If later fixes change inputs, retain this historical certificate and produce current final proof.
If the source baseline is missing, report present-day readiness only, not retroactive invariance.
Contract B changes require their own approvals and derived baselines; never overwrite A-original.
