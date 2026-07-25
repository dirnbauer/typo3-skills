# webconsulting additions — `typo3-testing`

> **Overlay.** The vendored `SKILL.md` and its references are upstream Netresearch content, kept
> byte-identical. This file is webconsulting's addition and changes nothing above it.

## Verify the gate can actually go red

Before trusting any check as evidence, prove it can fail. A suite that has never failed may be
measuring nothing, and it is indistinguishable from a passing one until the day it matters.

This is not hypothetical. The `typo3-upgrade-run` harness shipped for months with three actions that
**never exited non-zero**: a run with forty differing screenshots exited `0`. Every consumer of that
exit code — CI, the loop, the completion gate — read it as success. The bug was not in the
comparison logic, which worked; it was that the result never reached the exit code.

Cheap checks that catch this class of defect:

- Break something deliberately and confirm the suite goes red.
- Assert on the **exit code**, not on log output.
- Distinguish *expected* skips from unexpected ones. "12 ok, 3 skipped" exiting `0` hides three
  unchecked items, and a coverage requirement is what turns that into a failure.
- Give errors a distinct exit code from findings. "The tool crashed" and "the tool found problems"
  demand different responses and should not share a code.

See `rules/security/security-no-claim-without-evidence.md`.

## Exit-code convention in this collection

Scripts written for this collection use:

| Code | Meaning |
|---|---|
| 0 | pass |
| 1 | findings — fix the subject |
| 2 | harness error — fix the tool |
| 3 | invalid — the run cannot be judged (environment drift, corrupted baseline) |
| 4 | precondition unmet |
| 5 | blocked by policy — a security guard refused |

Codes 3 and 5 exist because collapsing them loses the distinction that matters most: an environment
drift is not a subject regression, and a guard refusal is not a broken tool.
