# Existing-skill curation — 2026-09-26

Scope: improve the existing TYPO3 collection. **No new skills, QA pack, Matt Pocock pack or
Corey Haines pack are imported.** The recommendations below are curation judgments, not claims
that every upstream statement or every local behavior has been verified.

## QA and engineering practices

Read the existing `typo3-playwright`, `typo3-testing` (including its owned overlay), and
`typo3-upgrade-closure` instructions. They already cover isolation, red/green evidence, bounded
retries, real application behavior, explicit coverage and closure ownership. Do not duplicate
these controls in new orchestration skills.

| Approach | Existing home | Disposition |
|---|---|---|
| Minimal reproducible browser defect | `typo3-playwright` | Added a bounded review reference |
| Requirements versus assertion-quality review | `typo3-playwright` | Added separate finding dimensions, with no automatic fix/publication authority |
| Test ordering based on affected behavior and risk | `typo3-playwright` | Added ordering guidance; final coverage remains unchanged |
| PHP-level regression and mutation checks | `typo3-testing` | Already present; keep its upstream files immutable |
| Release evidence and missing-feature checks | `typo3-upgrade-closure` | Already present; no second closure decision-maker |
| Domain glossary and durable decision rationale | `architecture-decision-records` | Reuse the existing owner when a genuine architectural decision occurs |
| Lean routing and progressive disclosure | `SKILL-SPEC.md` | Existing policy; no writing-for-agents skill needed |

The new reference is linked from `typo3-playwright/SKILL.md`. Its example is not an executed
TYPO3 browser test. Existing behavior cases cover AJAX repetition, persistent editor changes,
missing shards and retries; a proposed case covers the new two-dimension review boundary.
No case is labelled human-reviewed and no behavior trial is reported as passed.

## Source inspection and limits

Cloned the following public upstream repositories for read-only inspection and inspected their
MIT licence notices. These commits make the curation reproducible; they are not installed pins:

| Source | Observed commit | Inspection scope |
|---|---|---|
| [Petr Kindlmann / qa-skills](https://github.com/petrkindlmann/qa-skills) | `b3bb61bd268b147476252c6ed5a0440c87b97441` | Enumerated 50 skill entrypoints; sampled testing/reproduction/strategy/release guidance and scanned entrypoints for risky operations |
| [Matt Pocock / skills](https://github.com/mattpocock/skills) | `c55ee46073ed923f86ce59a5eb3b6d895095d1b7` | Reviewed code-review, domain-modeling, writing-for-agents, research and merge-conflict instructions |
| [Corey Haines / marketingskills](https://github.com/coreyhaines31/marketingskills) | `5b2c0007766c6a1cf1d53fd8fc73e979e0821022` | Enumerated entrypoints; sampled marketing-plan, attribution and offers |

Do not blindly copy source claims or autonomy. Examples needing adaptation: QA strategy's
unqualified defect-cost multipliers and test ratios, release instructions that execute rollback,
and Matt's merge-conflict instruction to stage everything and commit. Source popularity or a
permissive licence does not verify correctness or authorize those actions.

## Corey Haines

The author is **Corey Haines**. His marketing collection can complement client strategy work,
but that is separate from this TYPO3 engineering collection. If a future task explicitly asks,
evaluate `product-marketing`, `content-strategy`, `copywriting`, `marketing-plan` and `attribution`
for the actual workflow. Do not add marketing orchestrators here or let their recommendations
silently rewrite TYPO3 SEO, structured-data, consent or legal requirements.

## Notable TYPO3 coverage already available

The [Netresearch marketplace](https://netresearch.github.io/claude-code-marketplace/en/) offers
TypoScript reference, project/site conformance, CKEditor 5 and upgrade-effort guidance. All four
areas are already represented here by `typo3-typoscript-ref`, `typo3-site-conformance`,
`typo3-ckeditor5` and `typo3-upgrade-effort-model`; refresh and route them instead of duplicating
them. Keep project-upgrade advice subordinate to the local upgrade graph.

Strengthen cases inside existing skills when an actual gap appears: conditional form branches in
`typo3-powermail`, non-admin denials in `typo3-backend-rights`, rich-text round trips in
`typo3-playwright`, and translated routes/metadata in `typo3-seo`. These are testable extensions
of current responsibilities, not recommendations to grow the skill count.
