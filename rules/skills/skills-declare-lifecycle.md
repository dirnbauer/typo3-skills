---
id: skills-declare-lifecycle
title: "Declare whether a skill is capability or preference, and retire capability skills"
category: skills
severity: warning
appliesTo: ["skills/**/SKILL.md", "skills/**/evals/*.json"]
typo3: ">=14.0"
php: ">=8.2"
trigger: "Use when creating a skill, or when reviewing whether an existing skill still earns its context budget."
---
# Declare whether a skill is capability or preference, and retire capability skills

`skill_type` in the eval suite is `capability` or `preference`. The distinction decides what
a failing eval means.

| Class | Teaches | Lifespan | A failing eval means |
|---|---|---|---|
| `capability` | Something the model cannot do reliably yet | **Temporary** | Fix it — or the gap has closed, so delete it |
| `preference` | Our conventions, versions and workflows | **Durable** | Fix it; the model getting better does not make our policy correct |

**Do:** re-run the suite periodically with the skill unloaded.
**Don't:** keep a capability skill whose evals pass without it — it is now pure context cost.

If a `preference` skill passes unloaded, suspect the eval rather than the skill: it is
probably testing the model instead of the policy.

> Why: every loaded skill spends context on every turn. Capability skills have a natural end
> of life as models improve, and a collection that never retires anything degrades for
> everyone using it.
> Source: Philipp Schmid, *Don't Ship Skills Without Evals*; `references/skill-evals.md`.
