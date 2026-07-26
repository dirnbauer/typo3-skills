# Skill evals — source analysis and what we changed

Why `SKILL-SPEC.md` and `rules/skills/` exist, what they came from, and what the sources
did *not* settle.

## Sources

The trigger was a talk by **Philipp Schmid (Google DeepMind), _Don't Ship Skills Without
Evals_** — [youtube.com/watch?v=0vphxNt4wyk](https://www.youtube.com/watch?v=0vphxNt4wyk).

No transcript is exposed on the video page, so the analysis below is built from the
speaker's own written treatments of the same material, which are more precise than a
transcript anyway:

- [8 Tips for Writing Agent Skills](https://www.philschmid.de/agent-skills-tips)
- [Practical Guide to Evaluating and Testing Agent Skills](https://www.philschmid.de/testing-skills)

Corroborating practitioner work, useful mainly for harness shape:

- [Unit Tests for AI Agent Skills](https://blog.mgechev.com/2026/02/26/skill-eval/) — Minko
  Gechev, on task directories, deterministic vs LLM-rubric graders, and `pass@k` / `pass^k`
- [Testing Agent Skills Systematically with Evals](https://developers.openai.com/blog/eval-skills) — OpenAI

This is a summary and analysis, not a reproduction. Quotations are short and attributed.

## What the sources argue

**The premise.** Shipping a skill without an eval is like shipping a feature without tests —
you cannot tell whether it helps, hurts, or merely costs tokens. The reported state of
practice is a vibe-check: two manual runs, a colleague's approval, ship. A survey of a large
public skill corpus reportedly found almost none carrying any evaluation.

**Two kinds of skill, two lifespans.** *Capability* skills teach the model something it
cannot do reliably; they are temporary and should be retired when a model absorbs them.
*Preference* skills encode conventions and workflows; they are durable, and their evals
exist to catch regressions when the model or harness changes underneath.

**The trigger is where the failures are.** The description is the activation surface — the
only text an agent sees for every skill on every turn. A vague description means the skill
does not load when it should, or loads when it should not. The advice is to fix description
problems before instruction problems.

**Negative cases are not optional.** Define when a skill must *not* fire, and test it.

**Write directives, not essays.** Explicit commands beat implication; "Always use X"
outperforms "X is recommended". Lead with examples, give the reason for a rule, and avoid
overfitting to a narrow case.

**Progressive disclosure with navigation.** Frontmatter always, body when triggered,
references on demand; a table of contents once a reference gets long.

**Constrain outcomes, not steps.** Describe the result and the constraints and leave the
agent room to adapt; exact procedures belong in scripts rather than prose.

**Measure properly.** Begin at 10–20 prompts from real usage covering core capability,
guardrails, edge cases and negative controls. Run several trials per case and read the
distribution rather than a single pass. Isolate each run. Extend the suite from real
failures. Gechev adds the useful pair `pass@k` (can it ever?) versus `pass^k` (does it
reliably?), which is a sharper framing than an average.

**Retire deliberately.** Run the evals with the skill unloaded; if they still pass, the
model has absorbed it, so delete it.

**Human-authored beats generated.** Hand-written skills outperform generated ones.

## What we changed

| Source claim | Our response |
|---|---|
| Ship nothing without evals | `SKILL-SPEC.md` S4; `rules/skills/skills-require-evals.md`; `scripts/validate_evals.py` |
| Capability vs preference | `skill_type` required in every suite; S1 |
| Trigger is where failures live | S2; trigger-positive and trigger-negative are first-class eval kinds |
| Negative cases required | Validator **fails** a suite with zero negative cases |
| Directives, lean body, references | S6, S7; `rules/skills/skills-directives-not-essays.md` |
| Outcomes not steps; procedures in scripts | S8 |
| Trials, not a single pass | S9 |
| Retire when absorbed | S10; `rules/skills/skills-declare-lifecycle.md` |
| Human-authored beats generated | S5 — the change we think matters most, below |

### The addition we consider load-bearing: drafts do not count

If generated evals counted as coverage, a repository could reach "100% covered" in an
afternoon and learn nothing. So every case carries `status`, and only `reviewed` cases with
a `reviewed_by` count. `validate_evals.py` prints both numbers.

The scaffolder makes the argument better than the rule does. Asked to derive trigger prompts
from `typo3-v14-reference`'s own description, it produced `"TYPO3 v14"` and `"Upgrades"` — text that
matches nearly every skill in the collection and therefore tests nothing. Those cases exist,
they are valid JSON, they satisfy a case count, and they are worthless. That is precisely
what the split is for.

### The addition the sources do not cover: measured trigger collision

The sources treat description quality per skill. They do not address what happens when
**37 descriptions compete in one collection** — which is our actual situation, and a
different problem: not "is this description good?" but "is it distinguishable from its
neighbours?"

`scripts/trigger_collisions.py` computes a weighted Jaccard overlap over the distinctive
terms of every description pair, IDF-weighted so shared rare vocabulary counts for more than
shared common vocabulary. Three real collisions at threshold 0.13:

| Overlap | Pair | Shared distinctive terms |
|---|---|---|
| 0.155 | `typo3-rector` ↔ `typo3-update` | viewfactory, tca, migrations, events, backend |
| 0.145 | `typo3-conformance` ↔ `typo3-extension-upgrade` | hashservice, ext_tables.php, v14.3, migration |
| 0.139 | `typo3-batch` ↔ `typo3-update` | upgrades, tca, migrations, modernization, fluid |

(Names as measured at the time. Two of these skills have since been renamed — see below.)

Each resolved boundary is a one-line discriminator, now pinned by hand-written negative
evals in both skills:

- **rector ↔ update — automation.** Applying a transformation is Rector; explaining the
  target API is the reference.
- **batch ↔ update — scale.** One API question is the reference; the same change repeated
  across many extensions is batch.
- **conformance ↔ extension-upgrade — both vendored.** We do not edit vendored skills, so
  this one is documented rather than reworded, and pinned from the owned side.

### The limit that turned out to be the biggest finding

The analyser reads **descriptions**. It does not read **names** — and the worst collision in
the collection was a name collision.

`typo3-update` and `typo3-14-update` scored *below* threshold, because their description
vocabularies genuinely diverge. Yet they were the pair users confused most, for a reason no
lexical measure could see: `typo3-update` was the shorter, more obvious name — the one a
person or an agent reaches for when they want to update TYPO3 — and it was only the API
reference. The skill that actually performed upgrades carried the longer, version-pinned
name.

A name is a trigger signal too. Renaming fixed it:

| | before | after |
|---|---|---|
| API reference | `typo3-update` | `typo3-v14-reference` |
| Upgrade orchestrator | `typo3-14-update` | `typo3-upgrade-run` |

The result was measurable, which is the part worth keeping. Renaming, plus rewriting both
descriptions so the opening words disambiguate, removed that pair outright.

### Where it ended up

Two colliding pairs remain, and both involve **vendored** skills we do not edit:

| Overlap | Pair | Why it stands |
|---|---|---|
| 0.167 | `typo3-conformance` ↔ `typo3-extension-upgrade` | both vendored |
| 0.140 | `typo3-extension-upgrade` ↔ `typo3-fractor` | the vendored one recites the tool names Fractor owns |

Both are pinned from the owned side with negative trigger evals, which is the third
resolution S3 allows: measure the confusion when you cannot reword it.

Along the way the analyser caught two collisions we had **created**. Cross-referencing
`typo3-batch` and `typo3-rector` in each other's descriptions made them collide on generic
filler — *many, apply, one, says, large, same*. And `typo3-rector` listed Fractor's whole
territory to exclude it, which is exactly the S2b failure: a lexical router reads an
exclusion as an attraction. Naming the sibling without reciting its vocabulary fixed both.

### Where we deliberately diverge

The sources favour small, composable skills and warn against over-specification.
`typo3-upgrade-run` is unapologetically a process orchestrator with a fixed phase order,
because the order **is** the safety property — a baseline captured after a change cannot
show what the change broke.

We think this is compatible rather than contrary, via S8: the contract, prohibitions and
gates live in the skill; the exact command sequence lives in `scripts/t3u.mjs`. The
prescriptive part became a program, which is what the advice actually points at.

## Current status

```
26 owned skills (11 vendored, exempt)
suites present    : 26/26
human-reviewed    :  4/26   (49/185 cases)
awaiting signature:  2/26   (16/185 cases — not coverage until signed)
lexical grader    : reviewed 100%  ·  proposed 100%  ·  draft 91%  ·  1 xfail
```

The validator's first catch was the flagship. `typo3-upgrade-run` carried twelve carefully
written behaviour cases and **zero** trigger cases — it tested what the skill does once
loaded and never tested whether it loads. Given it is the most expensive skill here to
invoke by mistake, and sits beside five plausible confusions, that was the wrong half to
have covered.

### The scaffold was not partially useful — it was entirely degenerate

Auditing all 132 draft cases before replacing any of them produced a sharper result than
"drafts are circular":

| | Count |
|---|---|
| Verbatim substrings of the skill's own `SKILL.md` | 88 |
| Literal `TODO:` placeholders with no `expect_skill` | 22 |
| The identical Python/EXIF negative, copied into every suite | 22 |

That is all 132. The scaffolder had split each description on commas and used the fragments
as prompts — `"Building"`, `"Content elements"`, `"Axe-core"`, `"Use this skill to audit"`.
So the 89% draft pass rate was never a measurement of anything; it was `prompt in
description`. §6.7 of the dissertation argued drafts are circular *by derivation*. They were
circular by string containment, which is both worse and easier to check — so it is now
checked, in `validate_evals.py`, for every case a human is asked to sign.

### Two instruments that could not go red

Replacing the first suites turned up a second defect, in the grader rather than the cases.
`expect_no_skill` was asserted as `skill not in top[:1] and best_score > 0`. Both halves
were wrong. "This skill is not #1" is trivially true for 21 of the 22 suites carrying the
same case, so the check could not fail; and `best_score > 0` *required* some skill to match,
meaning a prompt that correctly matched nothing would have been reported as a failure.

Empirically, "Write a Python script that renames files in a folder by their EXIF date"
scored `typo3-v14-reference` at 3.44 — the collection firing on a non-TYPO3 task — and the
eval built to catch exactly that reported a pass.

The assertion is now *nothing may score like a real match*, with the floor derived rather
than chosen: the weakest score any passing trigger-positive gives its own skill is 6.18 and
the median is 13.6, so the floor sits at 6.0. Correcting it dropped the reviewed pass rate
from 100% to 97%, because one signed-off case had been passing vacuously.

That case is `typo3-rector-neg-04`, and it is not fixable by rewording: `typo3-batch` scores
6.50 on *"Refactor this React component to use hooks"* via exactly two shared terms, `hook`
and `refactor`, both of which genuinely belong in its description. A lexical grader cannot
tell a React hook from a TYPO3 hook. It is now marked `known_limitation` — excluded from the
rates, printed on its own line, and the build fails if it ever starts passing, so the
annotation cannot outlive the problem.

### The first replacement batch

`typo3-accessibility` and `typo3-wcag22-aa-agentic`, the sharpest owned collision at 0.120.
The boundary is build-vs-run, the same shape the collection already uses for
`typo3-v14-reference` ↔ `typo3-upgrade-run`: one answers *what is the correct accessible
markup*, the other scans a URL and produces reports, CI baselines and the Erklärung zur
Barrierefreiheit.

The 16 new cases scored **50%** on first run against the scaffold's 91% — the circularity
detector firing on live data. Every failure was diagnostic:

- *"Where do the skip link and landmark regions go?"* ranked **8th**, sharing **zero** terms
  with its own skill.
- *"Scan this URL for WCAG 2.2 AA"* lost to its own sibling, because `typo3-accessibility`'s
  description opened with **"Audits…"** — the pattern reference had claimed the auditor's verb.
- *"Tab through the nav, the focus outline vanishes"* lost by 0.25, because the description
  said "focus states" and "keyboard support" where users type "tab" and "focus outline".

The two descriptions had their verbs crossed. Rewriting **the descriptions, not the cases**
took the batch to 94% and dropped the pair's overlap from 0.120 to 0.088.

One case was the author's fault rather than the description's: *"300 contrast errors, which
Fluid templates?"* lost fairly, since it named contrast and Fluid templates — the sibling's
subject — while only implying the mapping step. It was reworded to lead with the axe report
and the grouping operation, and the original wording is recorded in its note rather than
quietly dropped.

### What is left

The remaining 22 suites are scaffold. Replacing them is per-skill work that cannot be
automated: write what a user would actually send, measure, and fix whichever of the two —
case or description — the failure indicts. Extending from real failures (S11) is the cheapest
route, since every bug report is an eval case that has already failed once.
