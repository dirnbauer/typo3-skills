---
id: skills-directives-not-essays
title: "Write directives, keep SKILL.md lean, and put exact procedures in scripts"
category: skills
severity: warning
appliesTo: ["skills/**/SKILL.md", "skills/**/references/*.md"]
typo3: ">=14.0"
php: ">=8.2"
trigger: "Use when writing or editing skill instructions."
---
# Write directives, keep SKILL.md lean, and put exact procedures in scripts

Write what the model does not already know, as commands rather than background.

**Do:** "Always target `^14.3`." Lead with a code example. Give the reason for each rule.
**Don't:** "`^14.3` is generally recommended." Soft phrasing is discarded under pressure.

Three layers, loaded on demand: frontmatter always → `SKILL.md` when triggered →
`references/` only when the skill asks. Keep `SKILL.md` under 500 lines; give a reference
over ~300 lines a table of contents.

Describe outcomes and constraints, not step-by-step procedure — the agent needs room to
adapt. Where a sequence genuinely must be exact, it belongs in a **script**:

```text
skill:   the contract, the prohibitions, the gates
script:  the exact command sequence
```

Prose that must be followed literally is a program written in the wrong language.

Put a reference beside the branch that needs it, and define the job's inputs, authority,
evidence and completion condition. A specialist returns its bounded result to the parent;
it does not create a second outer retry controller. Link the canonical guard instead of
copying it into every skill. See `SKILL-SPEC.md` S6 and the September collection review.

> Why: loading everything defeats progressive disclosure, which is the mechanism the whole
> collection depends on; and an over-specified skill cannot handle the case its author did
> not foresee.
> Sources: Philipp Schmid, *8 Tips for Writing Agent Skills*; Matt Pocock, *writing-for-agents*;
> `references/skill-evals.md`; `references/skills-review-2026-09.md`.
