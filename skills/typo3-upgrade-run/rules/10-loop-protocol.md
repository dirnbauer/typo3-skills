# Rule 10 — The loop protocol

Normative. The upgrade run owns the only iterative control loop. Routed skills and migration tools
perform one bounded pass, return findings, and stop; they never start a nested "repeat until green"
cycle. A needed second Rector, Fractor, scanner, test, or review pass is the next recorded iteration
of the parent upgrade loop.

A loop is the unit of work, the unit of rollback, and the unit of evidence. Its identity is `<NNN>-<track>-<slug>`, and it owns exactly one directory: `.typo3-update/loops/<NNN>-<track>-<slug>/`.

Tracks: `harness` · `invariance` · `elevation` · `report`.

Default Contract A uses two scaffolded work loops: `100` migration/conditional feature parity and
`300` closure. Determinism `000` and the Baseline A seal are machine-managed evidence units, not
operator-authored seven-document fix loops. Contract B (`500–899`) is separate opt-in work.
Reporting is assembled from existing evidence and does not create another fix loop.

## 10.1 The twelve steps

**1. Scaffold.** For work loops 100, 300, and any approved Contract B loop, run `t3u loop-start`. It creates the loop directory from
`templates/run-directory/loop/` with all seven documents present and front matter prefilled from
`state.json`. Scaffold it; do not type it by hand.

**2. Charter and intent authorization.** Write `00-charter.md`: objective, contract, track, in scope,
**out of scope**, `depends_on`, budgets, baseline, and the approval that authorises the work. Every
elevation loop needs a granted **intent** approval before it starts. A possible Contract A
rendering difference cannot yet carry acceptance evidence; it remains a regression until the
observed result is shown to the user and a separate **acceptance** approval is recorded.

**3. Preconditions.** Evaluate every `checks[]` entry in `01-preconditions.md` **against `state.json` and the manifests on disk** — never against memory and never against what the transcript says happened. Any `result: fail` blocks the loop.

**4. Freeze check.** `t3u loop-open` and every comparison re-collect the live environment and
semantic content fingerprints. The PHP and TYPO3 versions being upgraded are recorded subjects,
not immutable renderer keys. Any renderer/toolchain or unrecorded content drift is `INVALID`, not a
failure of the site.

**5. Rollback anchor.** Code-only and read-only work opens with a recorded Git anchor:
`t3u loop-open --loop <NNN> --rollback-ref git:<sha>`. Create a DDEV snapshot immediately before
each schema change, wizard run, data migration, extension setup, or other database mutation. When a
loop starts with stateful work, open it with `--stateful --snapshot <name>`. Do not pay for snapshots around
analysis, linting, documentation, or code edits.

**6. Baseline binding.** Record which baseline this loop measures against. Every Contract A loop binds to `A-original`. Elevation loops bind to their own `B-<n>`. **A Contract A loop naming anything other than `A-original` is a rules violation**, not a configuration choice.

**7. Measure.** Ordinary iterations capture only the `default` state on affected URLs plus critical
pages and seeded random sentinels; record the seed, requested/matched affected ids, sentinels, and
artifact hashes. Baseline, determinism proof, and final closure use the sealed viewport matrix and
exactly `default`, `keyboard-focus`, and `nav-open`. Final HTTP and DOM still cover every discovered URL.

**8. Classify.** Every finding gets a class from `30-finding-classification.md`. No finding may remain unclassified — unclassified is a blocking state, not a backlog.

**9. Iterate — one cause, one pass, one budget.** Each iteration addresses exactly **one** root
cause. A routed skill or fixed-point tool receives one pass; its remaining findings become the next
parent iteration. Default change budget: **≤10 files or ≤400 changed lines**. A larger fix must be
split, or escalated as an ADR.

**10. Progress.** After each iteration, `open_after < open_before` for the loop's open findings. Equal or higher is a no-progress iteration and counts toward the abort matrix.

**11. Abort matrix.** Any condition below aborts the loop: restore the relevant Git/file/database
anchor, write `06-exit.md` with `verdict: aborted`, and **escalate to the user with the specific
evidence**. Never silently retry.

| Condition | Default trigger |
|---|---|
| Max iterations | 6 · 8 for loop 300 · 3 for harness loops |
| No progress | 2 consecutive iterations with `progress: false` |
| Oscillation | any finding transitions `closed → open` once (`reopened_count ≥ 1`) |
| Fingerprint drift | environment or content fingerprint changed mid-loop |
| Time budget | 90 min per loop · 240 min for loop 000 and loop 300 |
| Budget breach | an iteration exceeded the change budget |
| Unclassifiable finding | a finding that fits no class in `30-finding-classification.md` |

The whole run has a non-extendable 14-hour deadline. Reserve its final four hours for loop 300,
reporting and contingency; at T+10h start no new migration cause. A deadline cannot become green.

Aborting is a correct outcome. A loop that thrashes for twenty iterations produces less information than one that stops after six and says precisely what it could not resolve.

**12. Exit.** `06-exit.md` lists `exit_criteria[]` as boolean expressions over `report.json`.
Ordinary iterations do not repeat the entire measurement unchanged. Idempotence is required at
three boundaries only: loop 000 proves the harness deterministic; every stateful migration command
is rerun to its documented fixed point (for example `upgrade:list` empty); and loop 300 reruns the
complete final measurement unchanged with `t3u gate --loop 300 --idempotence-diff 0`. Missing final
evidence is not zero. Then advance `state.json` and append the transition to `journal.jsonl`.

## 10.2 Loop 000 — the determinism self-test

Runs after phase P01, **before any baseline exists**.

Shoot the untouched site twice — same sample, same viewports, same settings, browser fully closed
between passes — and require **zero** differences. Pixel colour tolerance and dust floor are both
zero; one changed pixel blocks.

Before the first exhaustive run, execute a seeded intermediate diagnostic:

```bash
t3u selftest-determinism --sample intermediate --visual-workers 3
```

It uses the same thresholds over the deterministic intermediate URL slice in the `default` state,
but it never writes a self-test lock and can never close loop 000. Its purpose is
to catch stabilization defects in minutes instead of discovering them near the end of a
full-site run. Once the diagnostic is green, run the exhaustive `--sample all` command once; it
performs two unchanged passes and requires zero differences.

Intermediate and authoritative captures default to three independent Chromium processes.
Contexts inside one shared process are forbidden: renderer-global state can make fractional layout
allocation depend on concurrent workload. Three workers are permitted **only as a proven
property** — the exhaustive double-shoot itself runs at that count and must reach zero, which
seals the count into the self-test lock, and every authoritative capture and comparison of the
run must then use exactly that count. The worker count is recorded in capture metadata and the
self-test report and remains unchanged between both sides and both exhaustive proofs. If three
workers flake, rerun the whole self-test and authoritative captures serially; never mix counts.

A non-zero result is **always** a harness or stabilisation defect. It is never a site defect, because nothing changed between the two passes. Fix it in the harness or in the stabilisation configuration (`references/determinism-stabilization.md`), never in the site.

**Forbidden ways to pass loop 000:** reducing the sample, raising a threshold, excluding a page without an ADR, or accepting "close enough". Each of these makes every later comparison meaningless, because the harness would then be unable to tell a real regression from its own noise.

Exit: one exhaustive double-shoot at zero. Abort: three failed attempts without reaching zero — escalate.

Only a harness that proves zero against itself may judge an update. Every `compare-*` command refuses to run without a valid self-test lock.

## 10.3 Why the loop is bounded

An unbounded "repeat until green" loop has three failure modes this protocol closes:

- **Thrashing** — two fixes that undo each other, forever. Closed by one-cause-per-iteration plus the progress requirement.
- **Chasing ghosts** — hunting a site regression that is actually harness noise or content drift.
  Closed by loop 000, live fingerprints, and strict zero.
- **False green** — passing by weakening the measurement. Closed by `20-baseline-integrity.md`,
  stateful fixed-point checks, and the final closure rerun.

The budgets are defaults. Exceeding one requires an approval recorded in `06-exit.md`, which makes the decision visible instead of implicit.
