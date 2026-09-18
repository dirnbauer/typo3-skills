# Sealed feature coverage without new graph loops

New default graphs set `policy.require_feature_contracts: true`. `intake-join` seals one small JSON
plan as its normal node artifact; no extra graph node or full browser pass is added. The existing
thirteen closure checks carry the resulting evidence. Browser states and retry budgets stay unchanged.
Include selected journey timings in the existing runtime forecast. Count a shared test invocation
once even when several assertions consume its report; do not reserve one full capture per feature.

## Intake

Copy `templates/run-directory/manifests/feature-contracts.example.json` to the run's
`manifests/feature-contracts.json`. Fill every applicability decision from the inventory. The
example deliberately cannot pass. Use the categories and assertions in
[fleet regression contracts](fleet-regression-contracts.md), choosing only actual features.

Each feature has one hashed run-relative inventory artifact. Reuse the same inventory document
where it genuinely supports several decisions. Each applicable feature has at least one journey:

```json
{
  "id": "mail",
  "applicable": true,
  "evidence": {"path": "nodes/intake/integrations.md", "sha256": "sha256:<actual hash>"},
  "journeys": [{
    "id": "contact-de",
    "check": "interactions",
    "targets": ["local contact form, German, public visitor"],
    "assertions": ["invalid-input", "sender-reply-to", "intended-recipients", "partial-failure-message"]
  }]
}
```

Use meaningful stable assertion IDs, not `looks-good`. Backend and routes are mandatory for a
whole site. Mark other features absent only with inventory evidence and an empty `journeys` array.
Do not encode credentials, recipient addresses, tokens or customer records in the plan.

Finish the other intake prerequisites and sizing/forecast admission, then:

```bash
t3u node-open --node intake-join
t3u node-close --node intake-join --outcome pass --evidence manifests/feature-contracts.json
```

The engine rejects unresolved applicability, missing/duplicate features, absent mandatory surfaces,
empty or duplicate assertion IDs, wrong check routing and missing/changed inventory artifacts.
The existing node SHA-256 seals the plan. It is not a plan to edit after seeing failed tests.

## Final coverage

Add `featureResults` to the JSON file referenced by the closure manifest's `coverageRef`:

```json
{
  "featureResults": [{
    "id": "contact-de",
    "check": "interactions",
    "epoch": "sha256:<current final proof epoch>",
    "assertions": [
      {"id": "invalid-input", "status": "pass"},
      {"id": "sender-reply-to", "status": "pass"},
      {"id": "intended-recipients", "status": "pass"},
      {"id": "partial-failure-message", "status": "pass"}
    ],
    "artifacts": [{"path": "report/forms.json", "sha256": "sha256:<actual report hash>"}]
  }]
}
```

Emit one result per planned journey and one result per planned assertion from actual test reports.
Keep the coverage registry's existing URL/state/exclusion fields. Bind each journey artifact to
the same path/hash in its parent closure check's `artifacts`. Extra tests may live in the normal
reports; they do not replace a planned assertion. Preserve the first failing attempt separately.

`closure-start` binds the sealed feature plan to the source/data epoch. `closure-check` verifies
its inventory hashes, exact journey/assertion coverage, current parent check/epoch and artifact
binding in addition to the usual thirteen checks. Missing, failed, skipped, stale or duplicate
results refuse closure. These are bookkeeping guarantees: inspect the real assertions and logs;
JSON labels alone cannot establish meaningful tests or truthful feature applicability.

## Recovery and compatibility

Fix one failed feature and rerun its affected check while diagnosing. Do not restart the baseline
or unrelated migrations. After the last implementation change, the normal complete final proof
and unchanged rerun still apply. Do not add one exhaustive pass per journey or reporting consumer.

A newly discovered feature invalidates the intake coverage claim: stop and reconcile its missing
source/target evidence explicitly, without editing the sealed plan to hide the gap. A current
readiness audit may be narrower than historical invariance; say so.

Legacy graph definitions without this policy keep their existing contract. They are **not**
retroactively certified against these checks. Never replace a running project's pinned harness,
alter a sealed graph, or relabel historical evidence merely because the collection was updated.
