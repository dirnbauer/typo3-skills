# Agent Skills: what changed since the September review — 2026-10-31

This note covers Anthropic's Agent Skills sources between the [September review](skills-review-2026-09.md)
(2026-09-05) and 2026-10-31, and what this collection did about each change. It is a dated record.
The standing rules derived from it are in [skill-update-rules.md](skill-update-rules.md).

## Contents

- [Method and limits](#method-and-limits)
- [What changed](#what-changed)
- [What did not change](#what-did-not-change)
- [Frontmatter: portable core versus Claude Code extensions](#frontmatter-portable-core-versus-claude-code-extensions)
- [Authoring guidance in force](#authoring-guidance-in-force)
- [Eval tooling](#eval-tooling)
- [What this collection changed](#what-this-collection-changed)
- [Deliberately not adopted](#deliberately-not-adopted)

## Method and limits

Read directly: the Claude Code `CHANGELOG.md`, the Claude Code skills and plugin-eval docs, the
platform skill best-practices page and release notes, the agentskills.io specification, the
`anthropics/skills` repository, and Anthropic's announcement donating the standard. The changelog
has no dates per version. Dates below come from the commit history of `CHANGELOG.md` and are
accurate to a few days. Nothing here was tested against a live model run unless it says so.

## What changed

| When (2026) | Change | Consequence here |
|---|---|---|
| ~Sep 1–4 | Claude Code honours frontmatter `model:` in interactive sessions | None. We do not pin models in skills (portability). |
| ~Sep 4 | `/skill-doctor` built into Claude Code: context cost per skill, never-invoked skills | Use it on an installed collection; complements our pinned `scripts/skill_doctor.mjs`. |
| ~Sep 10–14 | **`claude plugin eval`**: isolated headless runs, with-plugin and without-plugin arms, 3 runs per case by default, JSON/HTML report | Recorded as the path for behaviour trials; see [Eval tooling](#eval-tooling). |
| ~Sep 17 | Skills enabled on claude.ai sync into terminal sessions | Duplicate installs can now appear twice; install from one source. |
| ~Sep 24 | Folders in the `anthropic-skills` or `claude-ai` namespace stop loading | No impact; reserved words are now checked by `audit_skills.py`. |
| ~Sep 24–29 | `/doctor prompt-audit` flags prompting written for older models | Shouting (`CRITICAL`, all-caps `MUST`) audited; see rules. |
| ~Oct 2–6 | Listing shows folder name and `name:`; a `name` over 256 chars is ignored | Already enforced: name equals directory, 64 chars. |
| ~Oct 9–16 | `plugin eval` gains `disallowed_tools`; API-error runs score 0. Names containing bidi/hidden characters, `<` or `>` are not loaded | Angle brackets in descriptions now fail the audit for owned skills. |
| ~Oct 16–21 | Skill list re-sent after compaction | Lead every `SKILL.md` with its most important instructions. |
| Oct 22 | **Agent Skills standard donated to the Agentic AI Foundation** (Linux Foundation). Versioned releases and a proposal process announced; no spec change yet | Keep to the six portable keys; watch for the first versioned release. |
| Oct 29 (local) | The claude.ai-synced `skill-creator` writes test cases as one folder per case (`prompt.md`, `case.yaml`, `graders/`), the layout `plugin eval` reads; an existing `evals/evals.json` runs as a legacy set and must not be converted unless the owner asks | Our `evals.json` suites stay as they are. Converting is an owner decision. |

## What did not change

- The agentskills.io specification: no commit since 2026-08-04.
- `skill-creator` on GitHub (`anthropics/skills`): unchanged since spring 2026. The locally synced
  copy is newer than the public one.
- No new Anthropic engineering post on skill authoring.

## Frontmatter: portable core versus Claude Code extensions

The open specification, the claude.ai upload validator and the Skills API accept exactly six keys.
Anything else is an error there.

| Key | Rule |
|---|---|
| `name` | Required. 1–64 chars, `a-z0-9-`, no leading, trailing or double hyphen, equals the directory. Not `anthropic` or `claude`. |
| `description` | Required. 1–1024 chars. No XML tags or angle brackets. |
| `license` | Optional. |
| `compatibility` | Optional, 1–500 chars. |
| `metadata` | Optional map of string to string. |
| `allowed-tools` | Optional, space-separated, experimental. |

Claude Code also reads `when_to_use`, `argument-hint`, `arguments`, `disable-model-invocation`,
`user-invocable`, `disallowed-tools`, `model`, `effort`, `context: fork`, `agent`, `background`,
`hooks`, `paths` and `shell`. Other clients ignore them, and the upload validator rejects them.
In Claude Code, `description` plus `when_to_use` is cut at 1,536 characters, and the whole skill
listing gets 1 % of the context window. When it overflows, the least-used skills lose their
descriptions first.

## Authoring guidance in force

From the platform best-practices page, agentskills.io and the Claude Code docs:

- The description is written in the **third person**: what the skill does, then when to use it.
  (agentskills.io and skill-creator say "be pushy"; the platform page says third person. We use a
  third-person *what* sentence followed by a direct "Use when…" clause.)
- Add only what the model lacks; match the degree of freedom to how fragile the task is.
- `SKILL.md` body under 500 lines and roughly 5,000 tokens. **After compaction only the first
  ~5,000 tokens of an invoked skill are re-attached**, so the most important instructions come first.
- References one level deep from `SKILL.md`; say *when* to load each one. Reference files over
  **100 lines** get a table of contents.
- A gotchas section in `SKILL.md`; defaults with an escape hatch rather than a menu of options.
- No time-sensitive statements in the main flow; superseded behaviour goes into an "old patterns" note.
- Consistent terminology, concrete examples, copyable checklists and validator feedback loops.
- Scripts solve errors instead of handing them back, have no unexplained constants, and the skill
  says whether to run or read each one. Plan, validate, then execute for batch or destructive work.
- A rule that must always hold belongs in a hook or validator, not in prose.
- Evaluation first: at least three cases, tested across model sizes.

## Eval tooling

- `claude plugin eval` (Claude Code 2.1.269 or later) runs each case 3 times by default with and
  without the plugin. Graders: `regex`, `tool_used` (with `input_match`, `min`, `max`), `tool_order`,
  `file_exists`, `llm`, `baseline`. A trigger check is `tool_used` on `Skill` with
  `input_match: '"skill"\s*:\s*"(?:[\w-]+:)?NAME"'`; a must-not-trigger check uses `arm: both`,
  `min: 0`, `max: 0`.
- Its case format and skill-creator's `evals/evals.json` cannot read each other. Our suites use
  `evals.json` with our own lexical grader; they stay valid and gated by `scripts/check.sh`.
- Description optimisation, as skill-creator runs it: about 20 realistic queries (half near-miss
  negatives), 3 runs each, a fixed 60/40 train/validation split, at most five iterations, keep the
  best validation score. Do not paste failed query words into the description.
- The lexical grader cannot see the listing budget, truncation or least-used-first dropping. Use
  `/skill-doctor` in an installed Claude Code session for that.

## What this collection changed

- `scripts/audit_skills.py` enforces the portable-core rules: name format and reserved words,
  no angle brackets in descriptions, `compatibility` length, string-only `metadata`. Two vendored
  descriptions (`typo3-extension-upgrade`, `typo3-typoscript-ref`) contain `->`; they are reported,
  not edited.
- `scripts/validate_structure.py` requires a table of contents from 100 lines (was 300).
  `scripts/add_reference_toc.py` added one to every owned reference that lacked it.
- Owned descriptions now open in the third person.
- `scripts/skill_doctor.mjs` handles npm 11's array-shaped `npm view` output and verifies sibling
  references that carry an `#anchor`.
- The rewritten [AGENTS.md](../AGENTS.md) and generated client files lead with task routing.

## Deliberately not adopted

- **Claude-Code-only frontmatter keys.** The collection installs into Codex, Cursor, Gemini CLI,
  Windsurf and the ChatGPT plugin, and uploads to claude.ai would reject them.
- **Converting `evals.json` to `plugin eval` case folders.** Our gate, ratchets and signatures live
  in the current format. A conversion is a separate owner decision; the lexical gate stays either way.
