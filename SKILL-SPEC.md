# Skill specification

The normative contract for every skill in this repository.

It derives from a talk by Philipp Schmid (Google DeepMind), *Don't Ship Skills Without
Evals*, and from his written treatments of the same material, [8 Tips for Writing Agent
Skills](https://www.philschmid.de/agent-skills-tips) and [Practical Guide to Evaluating and
Testing Agent Skills](https://www.philschmid.de/testing-skills). `references/skill-evals.md`
records the analysis and what we changed because of it.

The central claim, and the reason this file exists:

> Shipping a skill without an eval is indistinguishable from shipping a feature without
> tests. You cannot tell whether it helps, hurts, or merely burns tokens.

---

## S1 — Every skill declares its lifecycle class

Frontmatter `metadata.skill_type` is one of:

| Class | Meaning | Lifespan | What evals are for |
|---|---|---|---|
| `capability` | Teaches the model something it cannot do reliably on its own | **Temporary** — retire when the model absorbs it | Prove the gap exists |
| `preference` | Encodes our conventions, workflows and house policy | **Durable** | Protect against regression when the model or harness changes |

The distinction is not academic: it decides whether a failing eval means *fix the skill* or
*delete the skill*. Most skills here are `preference` — TYPO3 v14 constraints, the PHP
target, our upgrade contract. A model getting better at TYPO3 does not make our version
policy correct.

## S2 — The description is the trigger, and most failures live there

The description is the only text an agent sees for **every** skill on **every** turn. It is
routing metadata, not marketing.

Required shape: **what the skill does** plus **when to use it**, in concrete terms a user
would actually type.

```yaml
# Weak — the agent cannot route on this
description: "Helps with TYPO3 upgrades."

# Strong — names the artefacts, versions and situations
description: "Automates non-PHP TYPO3 upgrade migrations with Fractor for FlexForms,
  TypoScript, Fluid, YAML and Htaccess. Use when the user mentions Fractor, FlexForm
  migration, TypoScript migration, or non-PHP v13-to-v14 changes."
```

Hard limits, enforced by `scripts/audit_skills.py`: `name` matches the directory,
description ≤ 1024 characters, only the six allowed frontmatter keys.

## S2b — State boundaries without the excluded vocabulary

A description that says what a skill is **not** for hands the router exactly the words that
make it mis-fire. Lexical routing cannot see "not"; it sees the terms.

`typo3-batch` said *"bulk file or data operations outside a TYPO3 codebase are not this
skill"* — and then ranked first for *"Bulk rename 300 image files on my desktop"*, because
the exclusion supplied `bulk` and `file`.

**Do:** state the boundary as a positive requirement, and name the sibling that wins.

```yaml
# Attracts what it meant to repel
"...bulk file operations outside a TYPO3 codebase are not this skill."

# States the same boundary without the bait
"Requires a TYPO3 codebase and more than one extension; a single extension is typo3-rector."
```

A capable model handles negation. The description should not need it to.

## S3 — Overlapping triggers are measured, not assumed

With 37 skills in one collection, descriptions compete. Two skills sharing vocabulary give
the agent no basis for choosing, and the wrong playbook loads — a failure that is invisible
in normal use, because the agent still answers.

```bash
python3 scripts/trigger_collisions.py --threshold 0.13
```

Every pair the analyser reports must be resolved in one of three ways:

1. **Reword** so the distinctive terms differ.
2. **Route explicitly** — the skills name each other and state which wins. `typo3-v14-reference`
   and `typo3-upgrade-run` do this: the API reference defers to the upgrade orchestrator on
   constraints, PHP target and process.
3. **Pin it with negative trigger evals** in both skills, so the confusion is at least
   measured.

**A name is a trigger too, and the analyser cannot see it.** Check by hand that the shorter,
more obvious name belongs to the skill users most often want. In this collection it did not:
`typo3-update` was the API reference while `typo3-14-update` did the upgrading. Renaming them
to `typo3-v14-reference` and `typo3-upgrade-run` removed the pair entirely.

Two pairs remain, both involving vendored skills we do not edit. They are documented rather
than fixed, and pinned from the owned side with negative evals.

Lexical overlap is a signal, not the whole truth. Two skills can collide conceptually while
sharing few words. The analyser finds the cheap cases; judgement covers the rest.

## S4 — Every skill ships evals, and trigger evals come first

`skills/<name>/evals/evals.json`, validated by `scripts/validate_evals.py`.

Three kinds, in priority order:

| Kind | Asks | Why first |
|---|---|---|
| `trigger-positive` | Does the skill fire when it should? | Most problems are in the trigger, not the instructions |
| `trigger-negative` | Does it stay silent when it should? | Prevents a 37-skill collection from firing everything at once |
| `behaviour` | Does it produce the right result once loaded? | Most expensive; add where the stakes justify it |

Start at 10–20 cases drawn from **real usage**, not imagined usage. Negative cases are not
optional: a skill that fires on everything is as broken as one that never fires.

## S5 — A generated eval is a draft until a human signs it off

The talk's finding that human-authored skills outperform generated ones applies to their
evals too. An eval invented to fill a template tests the template.

Every case carries `status`:

- `draft` — scaffolded or generated. **Does not count as coverage.**
- `reviewed` — a human confirmed it reflects real usage. Counts.

`validate_evals.py` reports reviewed coverage separately from total, so the number cannot
flatter itself.

## S6 — Instructions, not essays

Write what the model does not already know. Direct commands over background.

- **"Always target `^14.3`"** — not "`^14.3` is generally recommended."
- Lead with a code example over a paragraph.
- Give the reason for a rule; a rule whose reason is unstated gets discarded under pressure.
- Do not overfit to one project's shape.

## S7 — Progressive disclosure, with navigation

Three layers, loaded on demand: frontmatter always → `SKILL.md` when triggered →
`references/` only when the skill asks.

- `SKILL.md` under 500 lines. Detail moves to `references/`.
- A reference over ~300 lines gets a table of contents.
- One topic per reference file.

Loading everything defeats the mechanism the collection is built on.

## S8 — Constrain outcomes; put exact procedures in scripts

Describe the outcome and the constraints, and leave the agent room to adapt. Where a
sequence genuinely must be exact, that sequence belongs in a **script**, not in prose.

`typo3-upgrade-run` is the worked example: the contract, the prohibitions and the gates are in
the skill; the exact command sequence is `scripts/t3u.mjs`. Prose that must be followed
literally is a program written in the wrong language.

## S9 — Run trials, not a single pass

Agent behaviour is non-deterministic. Run 3–5 trials per case and read the distribution; a
case that passes once in five is not passing.

Isolate each case — a clean context per trial, or the previous case's context becomes part
of the input.

## S10 — Retire skills deliberately

Periodically run the evals **with the skill unloaded**. If they still pass, the model has
absorbed it: delete the skill.

This applies mainly to `capability` skills. A passing unloaded run for a `preference` skill
usually means the eval is testing the model rather than the policy — fix the eval.

## S11 — Every reported failure becomes an eval case

A bug found in use is the highest-quality eval material available: it is real usage, and it
already failed once. Add the case before fixing the skill.

## S12 — Multi-client claims are tested or dropped

This repository claims Claude Code, Cursor, Codex, Gemini CLI and Windsurf support. A skill
depending on `scripts/`, `assets/` or `templates/` does **not** work in an `.mdc`-only
client, which receives the skill body alone.

Either verify the claim or state the degradation in the skill. `typo3-upgrade-run` states it:
an `.mdc`-only client cannot run the harness and must fall back, at a lower evidence bar.

---

## Enforcement

```bash
python3 scripts/audit_skills.py                      # frontmatter, size, naming
python3 scripts/trigger_collisions.py --threshold 0.13
python3 scripts/validate_evals.py --min-cases 6      # eval structure and coverage
python3 scripts/validate_structure.py                # S6 directives, S7 disclosure + TOCs
python3 scripts/check_attribution_guardrails.py      # vendored skills unmodified
```

S6 and S7 were prose-only until a sweep found four owned references over 300 lines with no
navigation. Prose rules do not hold; `validate_structure.py` exists so these two are checked
rather than intended.

Vendored skills are exempt from S1–S12: they are upstream artefacts kept byte-identical.
Their evals, where we add them, live in the overlay and are marked as ours.

## Honest status

```
26 owned skills (11 vendored, exempt)
suites present  : 26/26
human-reviewed  : 4/26   (49/181 cases)
lexical grader  : reviewed 100%  ·  draft 88%
```

`scripts/run_evals.py` grades every trigger case; `evals-baseline.json` pins the numbers and
`--fail-under` gates CI.

Reviewed cases went 60% → 100% in one session, and the useful part is *what* moved it.

**Half the gap was the instrument, not the descriptions.** The first grader scored
set-intersection over √length: it ignored term frequency and punished thorough descriptions
so hard that a careful one lost to a terse one on its own subject. Replacing it with BM25
and adding light stemming — "migrations" and "migration" were different tokens — recovered
most of it. A trailing-'e' step was tried and dropped: it over-stemmed discriminative terms
and measured worse. **Fix the instrument before believing what it says about the work.**

**The other half was real, and self-inflicted.** `typo3-upgrade-run` failed all five of its
own positive cases because its description was written in our vocabulary — invariance,
elevation, loop protocol — and not the user's: update, looks, same, project. `typo3-rector`
lacked "automatically", "fix", "deprecated". Both are S2 failures committed while writing
the rule against them.

**Draft cases now score *below* reviewed ones — 88% against 100%.** Earlier they scored
higher, which was the tell: drafts are derived from the descriptions, so they test a
description against its own vocabulary. As the real cases got fixed, the circular ones fell
behind. That inversion is S5 measured rather than asserted.

The lexical grader is a **router proxy**. It shows whether a description carries the
vocabulary a user would type; it cannot tell you what an agent will do. Use `--grader
claude` for that. Do not tune descriptions past the point where they read naturally — but
"do not tune the proxy" is not a licence to leave a broken instrument in place, which is
what it became for one session here.
