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
suites present : 26/26
human-reviewed : 4/26   (49/181 cases)
```

The validator's first catch was the flagship. `typo3-upgrade-run` carried twelve carefully
written behaviour cases and **zero** trigger cases — it tested what the skill does once
loaded and never tested whether it loads. Given it is the most expensive skill here to
invoke by mistake, and sits beside five plausible confusions, that was the wrong half to
have covered.

The 22 scaffolded suites are **drafts**. They give every skill a structure, negative-case
slots and a lifecycle class, and they do not yet count as coverage. The four reviewed suites
are `typo3-upgrade-run` (11 trigger + 12 behaviour cases) plus the three
collision-critical skills: `typo3-v14-reference`, `typo3-batch` and `typo3-rector`.

The next work is per-skill and cannot be automated: replace each draft prompt with something
a user actually sent, then mark it reviewed. Extending from real failures (S11) is the
cheapest way to get there — every bug report is a free eval case that has already failed once.
