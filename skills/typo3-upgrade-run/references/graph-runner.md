# The graph runner

How one controller drives the sealed upgrade graph with small, fresh-context workers. The graph and
`t3u` are authoritative; this reference only explains how to use them well.

## Contents

- [The controller cycle](#the-controller-cycle)
- [Dispatching a worker](#dispatching-a-worker)
- [Evidence file](#evidence-file)
- [Independent review](#independent-review)
- [Choosing the outcome](#choosing-the-outcome)
- [Parallel sets](#parallel-sets)
- [Resume and calibration](#resume-and-calibration)
- [What the guards refuse](#what-the-guards-refuse)

## The controller cycle

```bash
t3u graph-next                      # ready nodes + compatible parallel sets
t3u node-brief --node <id>          # the work order; add --json for machine dispatch
t3u snapshot-create --node <id>     # stateful nodes only, immediately before opening
t3u node-open --node <id> [--snapshot node-<id>-aN] [--rollback-ref git:<sha>] [--approval APR-NNN]
#   … worker executes, writes nodes/<id>/evidence.md, returns an outcome …
#   … reviewer writes nodes/<id>/review.md when the brief requires it …
t3u node-close --node <id> --outcome <o> --evidence nodes/<id>/evidence.md [--review nodes/<id>/review.md] [--evidence-loop NNN]
t3u graph-report --write            # at checkpoints and before handover
```

The controller is the only process that opens or closes nodes. Take the Git anchor from a clean
commit (`git rev-parse HEAD` after committing the previous node's code) so the change guard measures
exactly this node's diff. If `node-close` refuses, the refusal is the finding: fix the cause or close
with the outcome the evidence supports. Never retry the same close with edited evidence.

## Dispatching a worker

A worker is a sub-agent (Claude Code `Agent`, a Codex task) or the controller itself after a context
reset. Fresh context is the point: the brief is small, explicit and complete, and the worker cannot
inherit assumptions, fatigue or a half-remembered verdict from earlier nodes.

Worker prompt, verbatim apart from the placeholders:

```text
You execute exactly one node of a TYPO3 upgrade evidence graph. Your whole input is this brief:

<paste the output of: t3u node-brief --node <id>>

Load the owner skill named in the brief. Work only on its objective and stop when the done
condition is proven or cannot be proven. Write the evidence file named in the brief. Return:
  outcome: <one allowed outcome>
  evidence: <path>
  summary: <three lines at most>
Do not run node-open or node-close. Do not edit state.json, config/, manifests/, baseline/ or the
graph. Do not start a retry loop. Return blocked on identity, credential, backup, approval or scope doubt.
```

The node is already open when the worker starts. For read-only nodes of one parallel set, several
workers may run at once; each gets only its own brief.

## Evidence file

Write `nodes/<id>/evidence.md` (or the path the brief names). The harness hashes it at close and
`graph-validate` rechecks the hash, so write it once, completely:

```markdown
# <node id> — attempt <n>
Objective: <copied from the brief>
Done when: <copied from the brief>

## Commands
| Command | Exit | Output artifact | SHA-256 |
|---|---|---|---|

## Findings
<numbered, each with its first differing stage or cause class>

## Decision
Proposed outcome: <outcome>. Reason: <why the done condition is met, or which cause blocks it>.
```

A narrative without commands, exit codes and artifacts is not evidence; fluent success reports that
hide a failed step are the most dangerous failure mode of agent systems.

## Independent review

Required for nodes flagged **R** in [the node reference](graph-nodes.md) and for every
`not-applicable` outcome: judgement calls and skipped work are where self-evaluation is weakest.
The reviewer is a fresh context that receives only the brief and the evidence file.

```bash
shasum -a 256 .typo3-update/nodes/<id>/evidence.md   # prefix the digest with "sha256:"
```

```markdown
verdict: agree
evidence_sha256: sha256:<digest of the exact evidence file>
reviewer: <agent/session id>
Checked: <which done-condition clauses the evidence proves>
Objections: <none, or the specific gap>
```

`node-close` refuses a missing review, a `disagree` verdict, a review of different evidence bytes, and
a review file that is the evidence file itself. A disagreement is data: close with the outcome the
review supports, or let the worker produce better evidence in a new attempt.

## Choosing the outcome

| Outcome | Use when |
|---|---|
| `pass` | the done condition is proven by the evidence |
| `findings` | the measurement worked and found a project or site defect |
| `invalid` | inputs drifted, or evidence cannot support any verdict |
| `harness-error` | the measuring system failed; the site was not judged |
| `blocked` | a guard, approval, identity, credential or policy refused the work |
| `not-applicable` | the condition was inspected and is absent; the evidence says why (reviewed) |
| domain outcomes | a classifier node selects a cause (`css`, `assets`, `markup`, `content`, `session`, `harness`, `http`, `visual`, …) |

Never collapse these into "red". Each has its own recovery route, and a wrong class sends the next
worker to the wrong repair.

## Parallel sets

`graph-next` groups ready nodes whose resource claims are compatible. Run a set concurrently only
with delegation permission; otherwise run it sequentially in the listed order. Shared readers may
overlap; writers, stateful work, quiet Lighthouse measurement and backend sessions stay exclusive.
Read [parallel execution](parallel-execution.md) before running concurrent browser proof.

## Resume and calibration

Resume from state, never from a transcript:

```bash
t3u graph-validate && t3u graph-status && t3u graph-next
```

Running nodes left by a crashed session keep their locks; inspect their evidence, then close them
with the outcome the evidence supports (usually `invalid` or `harness-error`) before continuing.

`t3u graph-report --write` writes `report/graph-report.{json,md}`: minutes per attempt from the
journal, retries used, phase totals, running nodes and whether the audit trail is in Git. Its
`measured_plan_nodes` entries are ready-made `minutes`/`source` pairs for the next run's
`runtime-plan.json`, so admission estimates come from measured work instead of guesses.

## What the guards refuse

| Attempt | Refusal |
|---|---|
| A site-fix node relaxes `config/thresholds.yml` or edits the URL manifest | measurement inputs changed in a non-measurement node |
| A harness node rewrites a sealed baseline | baseline seals are frozen for every node |
| A CSS recovery touches 40 files | recovery budget exceeded without a recorded approval |
| A specialist closes `not-applicable` alone | missing independent review |
| A reviewer checks yesterday's evidence | review names different evidence bytes |
| A third identical recovery attempt | retry edge exhausted: re-plan, do not repeat |
