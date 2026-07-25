---
id: skills-trigger-is-the-contract
title: "Treat the description as the trigger, and prove it with negative cases"
category: skills
severity: error
appliesTo: ["skills/**/SKILL.md", "skills/**/evals/*.json"]
typo3: ">=14.0"
php: ">=8.2"
trigger: "Use when writing or changing a skill description, or when two skills could answer the same request."
---
# Treat the description as the trigger, and prove it with negative cases

The description is the only text an agent sees for every skill on every turn. It is routing
metadata: **what the skill does** and **when to use it**, in words a user would type. Most
skill failures are trigger failures, not instruction failures.

**Do:** name the artefacts, versions and situations.
**Don't:** describe the skill's ambition — "helps with upgrades" routes nothing.

```yaml
description: "Automates non-PHP TYPO3 upgrade migrations with Fractor for FlexForms,
  TypoScript, Fluid and YAML. Use when the user mentions Fractor, FlexForm migration,
  TypoScript migration, or non-PHP v13-to-v14 changes."
```

Every skill needs `trigger-negative` cases naming the sibling that should win instead. In a
collection this size, a skill that fires on everything is as broken as one that never fires.

```bash
python3 scripts/trigger_collisions.py --threshold 0.13
```

Resolve every reported pair by rewording, by explicit reciprocal routing, or by negative
evals in both skills. Lexical overlap is a signal, not the whole truth — two skills can
collide conceptually while sharing few words.

> Why: a mis-fired skill is invisible in normal use, because the agent still answers — just
> from the wrong playbook. Measured overlap turns that into something reviewable.
> Source: Philipp Schmid, *Don't Ship Skills Without Evals*; `references/skill-evals.md`.
