# Rule 30 — Finding classification

Normative. Every difference, failure, and violation produced by any measurement is a **finding**, and every finding carries exactly one class. Unclassified findings block the gate.

Classification is not bookkeeping. The class determines who fixes what, and where: a `regression` is fixed in the site, `harness-noise` is fixed in the harness, and `content-drift` means the comparison itself is void. Getting the class wrong sends the repair to the wrong place.

## 30.1 The seven classes

| Class | Meaning | Where it is fixed | Blocks Contract A? |
|---|---|---|---|
| `regression` | The update changed what visitors see or receive. A Contract A violation. | The site | **Yes** |
| `declared-change` | An intentional, approved change with a recorded `approval_ref`. | Nowhere — it is recorded | No, with approval |
| `pre-existing` | Reproduces in baseline A. Not caused by this update. | Out of scope for A; candidate for B | No |
| `harness-noise` | Non-determinism in the measurement, not in the site. | The harness / stabilisation, via loop 000 | **Yes** |
| `environment` | A DDEV-local artifact — absolute URLs, mail transport, TLS termination. | Nowhere — goes to the handover | No |
| `content-drift` | The database or `fileadmin` changed under the run. | Escalate; the comparison is void | **Yes** |
| `improvement` | A Contract B candidate noticed during A. | Logged, not acted on inside A | No |

## 30.2 The decision tree

Work top to bottom. The first match wins.

1. **Did the content fingerprint change?** → `content-drift`. Stop. Do not classify anything else in this run until the drift is resolved; every other finding is suspect. See §30.7 for how to resolve it, because "escalate" alone leaves the run stuck.
2. **Does it reproduce on an immediate re-shoot of the same URL?** If no → `harness-noise`. A difference that does not reproduce is a property of the measurement.
3. **Does it reproduce against baseline A on the *unmodified* site?** If yes → `pre-existing`. It was already there.
4. **Is there an approval record naming this exact difference class?** If yes → `declared-change`. If the approval is missing, it is **not** a declared change — it is a `regression` until the approval exists.
   The comparison applies this step itself: each approved class is a rule in `decisions/declared-changes.json`
   (§30.8), and the HTTP and DOM stages classify a finding as `declared-change` only when rules backed by a granted
   user approval explain **all** of its differences. Pixels can be declared only through a URL-scoped `whole_document`
   rule (the page as a whole is approved as changed); every other pixel difference is restored or stops the loop.
5. **Does it exist only because this is DDEV** (a `.ddev.site` URL in a canonical, mail landing in Mailpit, a header a production proxy would set)? → `environment`.
6. **Would a visitor see or receive something different?** → `regression`.
7. **Is it a genuine opportunity rather than a difference?** → `improvement`.
8. **None of the above** → the loop aborts on `unclassifiable`. Escalate to the user with the evidence. Do not invent a class, and do not fall back to `regression` to keep moving — an unclassifiable finding means the model of the system is wrong somewhere, and that is worth a human's attention.

## 30.3 `harness-noise` is a defect, not a dismissal

Classifying a finding as `harness-noise` does not close it. It moves it: the loop stays blocked, and the missing stabilisation goes back to loop 000 to be fixed.

`harness-noise` count must be **zero** in every Contract A loop at exit. A run that tolerates noise cannot distinguish a real regression from a flake, which is the same as not testing.

## 30.4 Severity

Independent of class, for triage order only. Severity never converts a `regression` into something acceptable.

| Severity | Meaning |
|---|---|
| `blocker` | Page broken, content missing, error output, 5xx |
| `major` | Visible layout, spacing, colour, font, or content change on a primary template |
| `minor` | Visible change on a rarely-reached page or a non-default state |
| `info` | Structurally different, not visually apparent (for example an attribute order change that survived normalisation) |

`minor` here is a *priority*, not a verdict. A `minor` `regression` still blocks Contract A. This is deliberately different from the old harness, where `minor` silently meant "passed".

## 30.5 Finding lifecycle

`open` → `closed`, and back to `open` if it recurs.

Each finding records `reopened_count`. A single reopen triggers the oscillation abort in `10-loop-protocol.md`: a finding that closes and reopens means the fix addressed a symptom, and continuing to iterate will not find the cause.

Status changes go into `04-findings.md` (current state) and `journal.jsonl` (history). The register shows where things stand; the journal shows how they got there.

## 30.6 Residual findings at exit

A loop may exit green with residual findings **only** in the non-blocking classes: `pre-existing`, `environment`, `improvement`. Each is listed in `06-exit.md` under `residual_findings[]` and carried into the final report.

`regression`, `harness-noise`, `content-drift`, and unapproved `declared-change` findings never survive a green exit. If they cannot be resolved, the loop aborts and the user decides — the skill does not decide on its own that a regression is acceptable.

## 30.7 Resolving `content-drift`

A drift finding halts classification, so it needs an exit — otherwise the rule that protects the
proof is also the rule that strands the run.

First establish **where** the change happened, because the two cases have opposite answers:

**Drift inside the local clone** — someone edited the local backend, a scheduler task or feed import
wrote rows, or a migration touched data outside its declared scope. This is recoverable: restore the
nearest anchor per [`references/rollback.md`](../references/rollback.md), re-verify the baseline, and
resume. If the write was legitimate and must stay, it is a declared change and needs an approval
plus a documented content-fingerprint reseal — never a silent one.

**Drift on live, i.e. the clone is now stale** — editors kept publishing while the run progressed.
Nothing local changed, so the fingerprint still holds; what aged is the claim. Importing a fresh
dump would void `A-original`, and a baseline refresh is not grantable, so re-importing mid-run means
starting the invariance work again. That is a decision with a cost, and it belongs to the people who
own the site, not to the agent. Put the choice to them explicitly:

1. **Finish against the frozen dataset.** The proof stands for the content as of the sync date; that
   date goes in the closure certificate and the KPI report, stated plainly rather than implied.
2. **Re-import and restart the invariance track.** Honest and expensive: new baseline, new loops.
   Only worth it when the drift is large enough that a proof about the old dataset is not useful.

Both are legitimate; pretending the question does not exist is not. This is also why P00 asks for a
freeze window or a recorded staleness decision up front — resolving drift is much cheaper as a
decision made before the run than as a surprise in loop 300.

## 30.8 Declared changes are rules, not edits

A core upgrade changes some output on purpose: a default security header (`Cache-Control: private, no-store`),
a modernised head (`<meta charset>`), the `lang` value, a rewritten core script. Restoring that output is often
impossible or wrong, so the user may approve the difference **class**. Record it as a rule; never edit a stage
report to change a class.

```json
{
  "schema": "typo3-upgrade-run/declared-changes@1",
  "changes": [
    { "id": "DC-001", "approval_ref": "APR-009", "stage": "http", "field": "header:cache-control",
      "before": "^max-age=0$", "after": "^private, no-store, max-age=0$",
      "reason": "TYPO3 13 sends Cache-Control: private, no-store by default" },
    { "id": "DC-002", "approval_ref": "APR-009", "stage": "dom",
      "before": "<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\" ?/>",
      "after": "<meta charset=\"utf-8\"/>", "reason": "TYPO3 13 page template always renders <meta charset>" },
    { "id": "DC-003", "approval_ref": "APR-009", "stage": "dom", "whole_document": true, "url": "/sitemap\\.xml$",
      "reason": "Core exception template on a page that already returned HTTP 500 before the upgrade" }
  ]
}
```

- `http` rules match one recorded difference: `field`, and the `before`/`after` regular expressions against the
  value (objects as JSON). `dom` rules rewrite an in-memory copy of the normalised BEFORE document
  (`before` regex → `after` text), and only where the new document no longer contains the old form. A
  `whole_document` DOM rule must be scoped with `url`; it declares that page's DOM **and its screenshots**, and it is the
  only way a pixel difference can be declared. `url` is an optional regex on the page URL.
- A rule counts only when its `approval_ref` is a granted user approval of this run (in `state.json` and in
  `approvals/`). Refused rules are listed in the stage report and change nothing.
- The file's hash is part of every stage report's inputs, so all three stages of one comparison judge with the
  same rules. A finding a rule explains keeps its raw segments/differences plus the rule ids it relied on;
  a finding with anything unexplained stays a `regression` and reports only the unexplained part.
- A declared change is still a change: prove the behaviour behind it where it matters (for example a journey
  that decodes an obfuscated mailto link after the core rewrote its script).

