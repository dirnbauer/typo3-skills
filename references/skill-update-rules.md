# Skill update rules

How to update a skill in this collection. Follow these rules in order for every change, from a
one-line fix to a full review pass. [SKILL-SPEC.md](../SKILL-SPEC.md) is the normative contract;
this file is the working checklist. The research behind the October revision is in
[anthropic-skills-update-2026-10.md](anthropic-skills-update-2026-10.md).

## Contents

- [1. Ownership: what you may touch](#1-ownership-what-you-may-touch)
- [2. Before editing](#2-before-editing)
- [3. Frontmatter](#3-frontmatter)
- [4. Description](#4-description)
- [5. SKILL.md body](#5-skillmd-body)
- [6. References, scripts and templates](#6-references-scripts-and-templates)
- [7. Facts and versions](#7-facts-and-versions)
- [8. Evals](#8-evals)
- [9. Verify](#9-verify)
- [10. Commit and publish](#10-commit-and-publish)
- [11. Periodic review](#11-periodic-review)
- [Checklist](#checklist)

## 1. Ownership: what you may touch

- **Edit only skills owned by webconsulting** (`source_owner: webconsulting` in
  `catalog/skill-sources.json`). Owner and author is webconsulting.at / Kurt Dirnbauer.
- **Never edit vendored files**: Netresearch (16 skills), Anthropic (`typo3-simplify`), Supabase,
  Vercel, ehmo and Cursor. Their bytes are pinned in `vendor-lock.json` and checked by
  `scripts/check_attribution_guardrails.py`. Improvements go into
  `skills/<skill>/references/webconsulting-additions.md`, which says what it adds and what it
  does not change.
- **Keep every credit.** Each Netresearch overlay ends with the `## Credits & Attribution` block
  thanking Netresearch DTT GmbH by name; never shorten or remove it. The README credits and the
  AGENTS.md acknowledgements stay too.
- **Never post upstream.** No issues, pull requests or comments on Netresearch or other vendor
  repositories. Fix an upstream defect through our overlay.
- Re-sync vendored skills only on an explicit owner decision, with `scripts/sync_netresearch.py`
  (see [VENDORED.md](../VENDORED.md)).

## 2. Before editing

- Read the whole `SKILL.md`, its evals and the references the change touches.
- If the change fixes a reported failure, **add the failing eval case first** (SKILL-SPEC S11).
- Check the sibling skills named in the description and AGENTS.md routing so a fix in one skill
  does not create a collision with another.

## 3. Frontmatter

Use only the six portable keys: `name`, `description`, `license`, `compatibility`, `metadata`,
`allowed-tools`. Claude Code extras such as `when_to_use`, `paths` or `context` are rejected by the
claude.ai upload and the Skills API, and other clients ignore them.

- `name`: equals the directory; `a-z0-9-`, at most 64 chars; never contains `claude` or `anthropic`.
- `description`: at most 1024 chars; no `<`, `>` or XML.
- `metadata`: strings only. `skill_type` is `capability` or `preference` (SKILL-SPEC S1).
- `compatibility`: at most 500 chars.

## 4. Description

The description is the trigger. Every agent reads it on every turn.

- **Third person.** "Builds and seals…", not "Build and seal…", "I help…" or "You can…".
- **What, then when.** One sentence on what it does, then "Use when…" with the words a user
  actually types: symptoms, file names, extension keys, error messages.
- **Distinctive terms first.** Listings truncate long descriptions.
- **Boundaries without bait** (S2b). Name the sibling that wins; do not list the excluded vocabulary.
- After any change, run the trigger evals and the collision check (rule 9). A description edit that
  drops a reviewed or proposed case is a regression, not progress.

## 5. SKILL.md body

- **Most important instructions first.** After compaction Claude Code re-attaches only about the
  first 5,000 tokens of an invoked skill. Prohibitions, the done condition and the main workflow
  belong at the top, background last.
- **Under 500 lines** (enforced) and **about 5,000 tokens / 20,000 characters** (target). Move
  detail into `references/`.
- **Add only what the model lacks.** No TYPO3 or PHP tutorials the model already knows.
- **Directives, not essays** (S6): "Always target `^14.3`", with the reason. No hedging.
- **Calm, exact wording.** No shouting (`CRITICAL`, all-caps `MUST`/`NEVER` in prose). Current models
  follow plain instructions and overreact to shouted ones. State the rule and why.
- **One default plus an escape hatch**, not a menu of equal options.
- **A gotchas section** for the failures that actually happened.
- **Inputs, permitted changes, evidence and done condition** are explicit for workflow skills.
- **Consistent terms.** One word per concept across the skill and its references.

## 6. References, scripts and templates

- References are **one level deep** from `SKILL.md`, one topic per file, and the skill says **when**
  to load each one.
- A reference over **100 lines** has a `## Contents` list (enforced). Generate it with
  `python3 scripts/add_reference_toc.py --write`.
- A sequence that must be exact belongs in a script (S8). The skill says whether to **run** or
  **read** each script. Scripts handle their own errors, pin dependencies and explain constants.
- Cross-skill links point at a file that exists, with an anchor that exists.

## 7. Facts and versions

- **Verify every TYPO3 class, method, event and config key against an installed v14 source**
  (`vendor/typo3/cms-*` of a 14.3 project), never from memory. Cite the version you checked.
- `^14.3`, never `^14.0`; PHP 8.4 standard; 8.5 attempted and recorded; 8.2 as the reusable floor.
- Third-party package versions: check Packagist or the official release metadata on the day and
  write the date beside the version ("verified 2026-10-31"). Example versions are illustrations.
- Superseded behaviour goes into a clearly labelled "old patterns" or migration note, never mixed
  into the current instructions.
- Keep customer names out of skills. Use the existing Site A–L aliases for project lessons.

## 8. Evals

- Every owned skill keeps `evals/evals.json` with at least six meaningful cases, including
  trigger-negative cases that name the winning sibling (`expect_skill`) or `expect_no_skill`.
- New cases are `proposed`. Only a person can mark a case `reviewed`, with `reviewed_by`. Never
  carry a signature onto a changed assertion.
- Prompts come from real usage, not from the skill's own wording (the circularity check enforces
  this).
- Do not convert `evals.json` to `claude plugin eval` case folders without an owner decision; the
  two formats cannot read each other.

## 9. Verify

Run these, read the output, and quote the exit codes in the commit or report:

```bash
./scripts/check.sh                 # all gates, must exit 0
./install.sh --generate-only       # refresh catalogs, AGENTS/README tables, client files
node scripts/skill_doctor.mjs      # advisory; zero inspect-owned findings expected
```

The lexical grader is a router proxy. A behaviour claim needs an isolated model trial; a file that
contains assertions is not a passed run.

## 10. Commit and publish

- One concern per commit; message says what changed and why; end with the agreed attribution line.
- Push only when the owner asks, and only to `github.com/dirnbauer/typo3-skills` (`origin`) or
  `gitlab.webconsulting.at/dirnbauer/typo3-skills` (`gitlab`). Run the
  [push preflight](../skills/typo3-upgrade-run/references/push-policy.md) first.
- Never include unrelated working-tree changes. Never force-push `main`.

## 11. Periodic review

At least once per quarter, and after any Anthropic or agentskills.io announcement:

1. Read the Claude Code changelog, the platform skill best-practices page, the agentskills.io spec
   and `anthropics/skills` `skill-creator` since the last dated note in `references/`.
2. Write a dated note like [the October one](anthropic-skills-update-2026-10.md): change, source,
   consequence, decision.
3. Update this file and SKILL-SPEC.md only for changes adopted; make each new rule enforceable by a
   script where possible (S13).
4. Walk every owned skill against the checklist below.
5. Check the 16 Netresearch heads for news; re-sync only on an explicit decision.

## Checklist

Copy into the review note and tick per skill:

```text
[ ] owner is webconsulting (else: overlay only)
[ ] frontmatter: six portable keys, name = dir, metadata strings, skill_type set
[ ] description: third person, what + "Use when…", distinctive terms first, no bait, ≤ 1024, no < >
[ ] body: key instructions first, < 500 lines, ~5k tokens, gotchas, no shouting, no hedging
[ ] references: one level deep, "when to load" stated, contents list over 100 lines
[ ] facts: APIs checked against installed 14.3 source; versions dated; no customer names
[ ] evals: ≥ 6 cases, negatives name the winner, new cases proposed, failure cases added first
[ ] check.sh exit 0; install.sh --generate-only run; skill_doctor zero inspect-owned
```
