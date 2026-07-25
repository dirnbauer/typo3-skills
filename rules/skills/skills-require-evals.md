---
id: skills-require-evals
title: "Ship no skill without evals, and count only human-reviewed cases"
category: skills
severity: error
appliesTo: ["skills/**/SKILL.md", "skills/**/evals/*.json"]
typo3: ">=14.0"
php: ">=8.2"
trigger: "Use when adding a skill, changing a skill's description, or reviewing an eval suite."
---
# Ship no skill without evals, and count only human-reviewed cases

A skill without an eval is indistinguishable from a skill that does nothing: you cannot
tell whether it helps, hurts, or merely burns tokens. Every non-vendored skill ships
`evals/evals.json` with at least six cases, including **both** trigger polarities.

**Do:** draw the first cases from prompts users actually sent.
**Don't:** invent prompts to fill a template — that tests the template.

```bash
python3 scripts/validate_evals.py --min-cases 6
```

Generated cases carry `status: "draft"` and **do not count as coverage**. A human marks a
case `reviewed` with `reviewed_by` only after confirming it reflects real usage. The
validator reports reviewed coverage separately so the number cannot flatter itself.

> Why: skills are shipped on a vibe-check — two manual runs and a colleague's thumbs-up —
> which is why regressions surface in production rather than in review. Human-authored
> cases outperform generated ones, so the two are counted separately rather than pooled.
> Source: Philipp Schmid, *Don't Ship Skills Without Evals*; `references/skill-evals.md`.
