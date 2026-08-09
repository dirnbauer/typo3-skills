---
schema: typo3-upgrade-run/loop-doc@1
run_id: "{{RUN_ID}}"
loop_id: "{{LOOP_ID}}"
loop_slug: "{{LOOP_SLUG}}"
track: "{{TRACK}}"            # harness | invariance | elevation | report
contract: "{{CONTRACT}}"      # A | B | none
phase: "{{PHASE}}"
doc: charter
baseline_ref: "{{BASELINE_REF}}"   # A-original for every Contract A loop
snapshot: null                # only for stateful work
rollback_ref: null            # Git/file anchor for code-only or read-only work
approval_ref: {{INTENT_REF}}  # intent approval required before every Contract B loop
acceptance_ref: null          # observed-result approval; only after evidence exists
status: planned
frozen: false                 # set true once written; this document does not change afterwards
created_at: "{{NOW}}"
updated_at: "{{NOW}}"

objective: ""
in_scope: []
out_of_scope: []
depends_on: []
max_iterations: 6             # 8 for loop 300, 3 for harness loops
change_budget: { files: 10, lines: 400 }
time_budget_min: 90           # 240 for loop 000 and loop 300
abort_conditions:
  - max_iterations
  - no_progress_2
  - oscillation
  - fingerprint_drift
  - time_budget
  - budget_breach
  - unclassifiable
---

# Loop {{LOOP_ID}} — {{LOOP_SLUG}}

## Objective

One sentence. What must be true when this loop closes.

## Contract

Which contract governs this loop, and what that means here. A Contract A loop must
produce no unexplained difference against `A-original`. A Contract B loop measures against its
own derived baseline, needs an intent approval before it starts, and needs a separate acceptance
approval for any observed result the user chooses to keep.

## In scope

- 

## Out of scope

Name what this loop will *not* touch. This is the sentence that keeps Contract B
work from leaking into Contract A — an improvement noticed here is logged as an
`improvement` finding, not fixed here.

- 

## Depends on

Loops that must be green first, and why.

## Authorisation

| Field | Value |
|---|---|
| Approval | `{{APPROVAL_REF}}` (or "not required — automatic per rules/40") |
| Baseline | `{{BASELINE_REF}}` |
| Rollback anchor | Git ref, or DDEV snapshot for stateful work |

## Budgets

| Budget | Value |
|---|---|
| Max iterations | |
| Change budget | ≤ files / ≤ lines per iteration |
| Time budget | min |
| Whole-run deadline | `state.runtime.deadline_at` (not extendable) |

Exceeding a loop budget requires an approval recorded in `06-exit.md`; the whole-run deadline
cannot be extended. Aborting is the default and is a correct outcome.
