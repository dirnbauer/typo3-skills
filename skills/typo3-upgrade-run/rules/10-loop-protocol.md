# Rule 10 — The loop protocol

Normative. **Every** loop in this skill is an instance of this protocol — harness loops, invariance loops, elevation loops, the reporting loop. There is one protocol, not one per phase.

A loop is the unit of work, the unit of rollback, and the unit of evidence. Its identity is `<NNN>-<track>-<slug>`, and it owns exactly one directory: `.typo3-update/loops/<NNN>-<track>-<slug>/`.

Tracks: `harness` · `invariance` · `elevation` · `report`.

Loop id bands: `000–009` harness · `010–099` pre-update stabilisation · `100–199` migration · `200–299` feature parity · `300–399` closure · `500–899` elevation · `900–999` reporting.

## 10.1 The twelve steps

**1. Scaffold.** Run `t3u loop-start`. It creates the loop directory from
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

**5. Rollback anchor.** Run `t3u snapshot-create --loop <NNN>` and then
`t3u loop-open --loop <NNN> --snapshot loop-<NNN>-pre`. A loop that changes state without a
recorded snapshot id may not proceed.

**6. Baseline binding.** Record which baseline this loop measures against. Every Contract A loop binds to `A-original`. Elevation loops bind to their own `B-<n>`. **A Contract A loop naming anything other than `A-original` is a rules violation**, not a configuration choice.

**7. Measure.** Run the loop's measurement command exactly as recorded in `05-evidence.md`, with pinned tool versions, the frozen sample, and the frozen viewport matrix. Record every artifact path with its SHA-256.

**8. Classify.** Every finding gets a class from `30-finding-classification.md`. No finding may remain unclassified — unclassified is a blocking state, not a backlog.

**9. Iterate — one cause, one budget.** Each iteration addresses exactly **one** root cause. Default change budget: **≤10 files or ≤400 changed lines**. A larger fix must be split, or escalated as an ADR. Fixing two causes in one iteration destroys the attribution that makes the next measurement meaningful.

**10. Progress.** After each iteration, `open_after < open_before` for the loop's open findings. Equal or higher is a no-progress iteration and counts toward the abort matrix.

**11. Abort matrix.** Any condition below aborts the loop: restore `loop-<NNN>-pre`, write `06-exit.md` with `verdict: aborted`, and **escalate to the user with the specific evidence**. Never silently retry.

| Condition | Default trigger |
|---|---|
| Max iterations | 6 · 8 for loop 300 · 3 for harness loops |
| No progress | 2 consecutive iterations with `progress: false` |
| Oscillation | any finding transitions `closed → open` once (`reopened_count ≥ 1`) |
| Fingerprint drift | environment or content fingerprint changed mid-loop |
| Time budget | 90 min per loop · 240 min for loop 000 and loop 300 |
| Budget breach | an iteration exceeded the change budget |
| Unclassifiable finding | a finding that fits no class in `30-finding-classification.md` |

Aborting is a correct outcome. A loop that thrashes for twenty iterations produces less information than one that stops after six and says precisely what it could not resolve.

**12. Exit, then prove idempotence.** `06-exit.md` lists `exit_criteria[]` as boolean expressions over
`report.json`. When all are true, **re-run the measurement once more, changing nothing**.
`idempotence_rerun.diff_count` must be `0`; pass it explicitly to
`t3u gate --loop <NNN> --idempotence-diff 0`. Missing is not zero.

A green loop that is not idempotent is not green — it is `harness-noise`, and the noise must be fixed before the loop closes. Then advance `state.json` and append the transition to `journal.jsonl`.

## 10.2 Loop 000 — the determinism self-test

Runs after phase P01, **before any baseline exists**.

Shoot the untouched site twice — same sample, same viewports, same settings, browser fully closed
between passes — and require **zero** differences. Pixel colour tolerance and dust floor are both
zero; one changed pixel blocks.

Before the first exhaustive run, execute a seeded intermediate diagnostic:

```bash
t3u selftest-determinism --sample intermediate --visual-workers 3
```

It uses the same thresholds and viewport matrix over the deterministic intermediate URL
slice, but it never writes a self-test lock and can never close loop 000. Its purpose is
to catch stabilization defects in minutes instead of discovering them near the end of a
full-site run. Once the diagnostic is green, run the exhaustive `--sample all` command
twice unchanged.

The intermediate diagnostic uses three independent Chromium processes concurrently by default.
Contexts inside one shared process are forbidden for a multi-worker diagnostic: renderer-global
state can make fractional layout allocation depend on concurrent workload. Exhaustive proofs
and baseline captures default to one worker; a higher count is permitted **only as a proven
property** — the exhaustive double-shoot itself runs at that count and must reach zero, which
seals the count into the self-test lock, and every authoritative capture and comparison of the
run must then use exactly that count. The worker count is recorded in capture metadata and the
self-test report and remains unchanged between both sides and both exhaustive proofs.

A non-zero result is **always** a harness or stabilisation defect. It is never a site defect, because nothing changed between the two passes. Fix it in the harness or in the stabilisation configuration (`references/determinism-stabilization.md`), never in the site.

**Forbidden ways to pass loop 000:** reducing the sample, raising a threshold, excluding a page without an ADR, or accepting "close enough". Each of these makes every later comparison meaningless, because the harness would then be unable to tell a real regression from its own noise.

Exit: two consecutive double-shoots at zero. Abort: three iterations without reaching zero — escalate.

Only a harness that proves zero against itself may judge an update. Every `compare-*` command refuses to run without a valid self-test lock.

## 10.3 Why the loop is bounded

An unbounded "repeat until green" loop has three failure modes this protocol closes:

- **Thrashing** — two fixes that undo each other, forever. Closed by one-cause-per-iteration plus the progress requirement.
- **Chasing ghosts** — hunting a site regression that is actually harness noise or content drift.
  Closed by loop 000, live fingerprints, and strict zero.
- **False green** — passing by weakening the measurement. Closed by `20-baseline-integrity.md` and by the idempotence re-run.

The budgets are defaults. Exceeding one requires an approval recorded in `06-exit.md`, which makes the decision visible instead of implicit.
