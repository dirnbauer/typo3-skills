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
t3u node-open --node <id> [--snapshot <run-id>-node-<id>-aN] [--rollback-ref git:<sha>] [--approval APR-NNN]
#   … worker executes, writes nodes/<id>/evidence.md, returns an outcome …
#   … reviewer writes nodes/<id>/review.md when the brief requires it …
t3u node-close --node <id> --outcome <o> --evidence nodes/<id>/evidence.md [--review nodes/<id>/review.md] [--evidence-loop NNN]
t3u graph-report --write            # at checkpoints and before handover
```

Snapshot names start with the run id (`<run-id>-node-<id>-a<n>`): a project keeps its DDEV snapshots across runs,
and DDEV refuses an existing name while still exiting 0. `snapshot-create` therefore refuses a name that already
exists in `.ddev/db_snapshots` and fails unless DDEV wrote a new snapshot file.

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
condition is proven or cannot be proven. Write the evidence file named in the brief, lean: about
120 lines, only artifacts that prove the done condition (each with its SHA-256), earlier nodes'
artifacts cited by path and hash, read-only checks in one probe artifact. Your time box is the
brief's forecast: stop at the forecast when it is 15 minutes or less, otherwise at twice it, and
return what is proven plus the one open question. Return:
  outcome: <one allowed outcome>
  evidence: <path>
  summary: <three lines at most>
Do not run node-open or node-close. Do not edit state.json, config/, manifests/, baseline/ or the
graph. Do not start a retry loop. Return blocked on identity, credential, backup, approval or scope doubt.
```

The node is already open when the worker starts. Workers of one parallel set run at once, each in
the background with only its own brief ([parallel sets](#parallel-sets)).

### Trivial nodes run in the controller

A fresh worker has a fixed cost: it loads its skill, re-measures what earlier nodes proved and
writes 60–120 lines. In one fleet run each trivial node took 14–23 minutes that way;
`solr-search` was forecast at 1 minute. When a node's outcome follows from closed evidence plus at
most about five read-only commands, the controller runs it itself: one probe artifact, about 30
lines of evidence, a few minutes. No fresh worker.

- `solr-search` or `webmcp-parity` is `not-applicable` because the closed inventory proved the
  feature absent (no search extension, no WebMCP declaration).
- `structured-data-parity` passes because the source emitted no structured data and one target scan
  shows none.

Work that changes code, data or a measurement input, or needs judgement beyond the cited evidence,
still goes to a worker.

**Time box.** A worker gets the brief's forecast as its limit. A node forecast at 15 minutes or less
stops at 1×, not 2×; a longer node stops at twice its forecast.

**Short review.** A trivial node keeps its independent review, but a short one: the evidence hash
plus three spot checks, at most 30 lines. A smaller, faster model is acceptable for it. Nodes
flagged **R** and every node that changed code or data keep a full reviewer
([independent review](#independent-review)).

```text
You review one trivial node of a TYPO3 upgrade evidence graph. Your whole input is the brief and
the evidence file. Check three claims the outcome rests on against their cited artifacts and
hashes. Write nodes/<id>/review.md, 30 lines at most:
  verdict: agree|disagree
  evidence_sha256: sha256:<shasum -a 256 of the evidence file>
  reviewer: <agent/session id>
  Checked: <the three claims and what each artifact showed>
  Objections: <none, or the specific gap>
```

## Evidence file

Write `nodes/<id>/evidence.md` (or the path the brief names). The harness hashes it at close and
`graph-validate` rechecks the hash, so write it once, completely, and **lean**: the evidence proves
the done condition; it is not a diary of the investigation. Fleet workers that wrote more than 100
files and spent 20–40 minutes on a node proved no more than the ones that wrote ten.

- **About 120 lines at most.** A reviewer reads all of it.
- **Only artifacts that prove a done-condition clause or a finding**, each with its SHA-256. Output
  that nothing cites stays out of the node directory.
- **Cite, do not re-derive.** Name an earlier node's artifact by run-relative path and hash; its node
  already proved it. Re-running its commands costs minutes and invites drift.
- **One probe, one artifact.** Collect the read-only checks in one script and its output in one file,
  each command with its exit code (the [fix-pack probe](typo3-14-fix-pack.md#the-probe-and-the-evidence)
  is the pattern), not one file per command.
- **No copies of tools, configs or vendor files**, unless the copy is the proof instrument itself;
  the repository and the harness pin them already.
- **Stop at the time box.** The brief prints `forecast N min`. At N when N is 15 or less, otherwise
  at 2N ([time box](#trivial-nodes-run-in-the-controller)), stop and return the outcome the evidence
  supports so far (`findings` with the open cause, or `blocked` when only a decision can continue)
  and name the one open question. Exploring further is the controller's call.
- **Review only where the brief asks**: flag **R** or a `not-applicable` outcome. An unrequested
  review doubles the cost and proves nothing new.

```markdown
# <node id> — attempt <n>
Objective: <copied from the brief>
Done when: <copied from the brief>

## Proof
| Done-condition clause | Command (exit) | Artifact | SHA-256 |
|---|---|---|---|
| <clause> | `<command>` (0) | nodes/<id>/probe.txt | sha256:<digest> |
| <clause> | cited | nodes/<earlier node>/<artifact> | sha256:<digest> |

## Changes
<one line per commit or snapshot; "none" for a read-only node>

## Findings
<numbered: cause class, first differing stage, affected URLs as a count plus one list artifact>

## Decision
Proposed outcome: <outcome>. Reason: <why the done condition is met, or which cause blocks it>.
Open question: <only when the node stopped at its time box>
```

A narrative without commands, exit codes and artifacts is not evidence; fluent success reports that
hide a failed step are the most dangerous failure mode of agent systems. Lean is not thin: every
done-condition clause still needs its command, exit code and hashed artifact.

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
review supports, or let the worker produce better evidence in a new attempt. A review needs no
resource lock: start it as soon as the evidence exists, beside the next node. It stays lean too:
each done-condition clause checked against its cited artifact and hash, in about 20 lines. A
trivial node gets the [short review](#trivial-nodes-run-in-the-controller).

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

`graph-next` groups ready nodes whose resource claims are compatible. With delegation permission
(asked once, in the intake question round), open every node of the offered set and start all its
workers at once, in the background; without it, run the set in the listed order. Do not serialize an
offered set to be careful: the locks already keep writers, stateful work, strict pixels, quiet
Lighthouse measurement and backend sessions exclusive, and a fleet run lost hours by running offered
sets one node at a time. Where the shipped graph offers sets, and the final-proof order, are in
[parallel execution](parallel-execution.md#dispatch-what-the-graph-offers).

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
| `selftest-determinism` while a guarded code/stateful node is open (an approved re-seal inside `rung-14`) | refused, naming the open nodes: the self-test rewrites `selftest.lock.json`, a measurement input |
| A migration-window node (P05–P10) opens while a Contract A Lighthouse floor is null | refused until the owner's floors are in `config/thresholds.yml` ([quality bars](quality-bars.md#contract-a-lighthouse-floors-decided-at-intake)) |

Rule 10.9 fingerprints the measurement inputs, `selftest.lock.json` among them, at `node-open`; only
measurement nodes may change them. Run the self-test before opening a code or stateful node, after
closing it, or inside a measurement node (`harness-recovery`, `closure-harness-recovery`). On older pins
the self-test ran inside the open node and changed the lock, and the node could then close only as
`blocked`: one fleet run lost its green `rung-14` close that way after an approved environment re-seal.
A failed self-test deletes the lock as well, so every `compare-*` refuses until the next pass.
