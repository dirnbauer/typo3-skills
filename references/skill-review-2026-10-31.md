# Skill review, second pass (2026-10-31)

A second, independent walk over all 40 webconsulting-owned skills, run the same day as the first
pass ([anthropic-skills-update-2026-10.md](anthropic-skills-update-2026-10.md)) with a different
reviewing model. The first pass fixed form (frontmatter, descriptions, size, contents lists, dated
facts). This pass looked for substance: wrong facts, contradictions between a skill and its
references or siblings, instructions a model cannot follow, stale content, shouting, and evals
that do not count.

## Contents

- [Method](#method)
- [Results](#results)
- [Applied](#applied)
- [Decided and not applied](#decided-and-not-applied)
- [Deferred](#deferred)
- [Checks](#checks)

## Method

- Five parallel read-only reviews, eight skills each, with one brief
  (`skills/<name>/` only; verify before reporting; quote and cite the check; no finding without
  evidence). TYPO3 facts were checked against an installed 14.3.7 source tree
  (`vendor/typo3/cms-*`), extension facts against the installed extension or Packagist on the day.
- A collection-wide link sweep: 628 external URLs from owned skills, HEAD-checked.
- Five parallel fixers, one per batch, confined to their own skills, no commits. Every fixer re-ran
  the gate scripts and reported exit codes.
- Everything landed in one PR after the full gate and `./install.sh --generate-only`.

## Results

About 250 findings. By category: wrong or unverifiable facts 57, contradictions 45, unfollowable
instructions 49, stale content 30, trigger wording 11, shouting/filler 38, evals 20. Three skills
(`typo3-scheduler-jobs`, `typo3-upgrade-intake`, `typo3-upgrade-migration`) had none.

The findings that would have misled a model most:

| Skill | Defect | Fix |
|---|---|---|
| typo3-v14-reference | `'access' => 'user,group'` in a Modules.php example; 14.3's access gates reject it | `'access' => 'user'` |
| typo3-v14-reference | TCA override on `pages.columns.disabled`; the column is `hidden` | corrected |
| typo3-workspaces | "live edit" comment attached to `edit_allow_notificaton_settings` | `live_edit` |
| typo3-backend-rights | audit tested `publish_access === 2`; the field is a bitmask | `& 2` |
| typo3-backend-rights | group script writes `be_groups` with the Connection API while the rule forbade SQL | rule reworded; `referenceindex:update` added |
| legal-impressum | Gewerbe/Behörde/Kammer attributed to § 63 GewO; OG/KG partner names stated as always required | moved to § 5 ECG with Z-numbers; § 14 UGB condition |
| typo3-solr | suggest sent `tx_solr[q]`; `getField()` on Solarium documents; facet "types" that are partials; route-enhancer YAML with unread keys; jQuery premise | corrected against EXT:solr 14.0.2 |
| typo3-records-list-types | phantom listeners, services and ViewHelper; a11y note called the shipped `listbox/option` wrong | regenerated from the v2.0.2 checkout |
| typo3-upgrade-run | `rules/00` forbade the live pull and staging deploy its own scripts perform | rule carves out the two authorized scripts |
| typo3-upgrade-baseline | failure routes did not match `upgrade-graph.yml` | prose matches the graph |
| typo3-design-system-page | token audit script rejected the `audited_existing` ramp the skill prescribes | warning for that status |
| typo3-news-tags | example command selected a Mask-only column | plain EXT:news defaults, Mask behind a constant |
| typo3-rector | `addFieldsToUserSettings` → "use TCA"; the replacement is `addUserSetting()` | corrected |
| typo3-content-blocks | `addPlugin()` called deprecated; `cb:link.editRecord contextual` does not exist | corrected |
| typo3-accessibility / typo3-wcag22-aa-agentic | both claimed the axe audit | accessibility keeps a single-URL spot check; the programme skill owns inventory, baseline, reports, statement |

## Applied

- All high-confidence findings in categories 1–4, 6 and 7 across the 40 skills.
- 43 `Source:` footers repointed from the archived `webconsulting-skills` repository to this one.
- 46 stale "— line N" markers removed from four contents lists.
- Dead or private links: the ECC-Net URL replaced; `typo3-powermail` now says its 37 source links
  point at private fork repositories and names the installed vendor copy as the public equivalent.
- Hub files that nothing linked (`full-guide.md`, `appendix.md`, one-line `credits-and-attribution.md`)
  deleted where SKILL.md already lists every reference, or linked once as the index where they
  carry references SKILL.md does not list (`typo3-solr`, `typo3-translations`, `typo3-v14-reference`).
- `legal-impressum` and `security-incident-reporting` evals promoted from `draft` to `proposed`
  (they were counting as zero coverage); new negatives and behaviour cases in eight skills.
- Customer name in `typo3-backend-rights` replaced by Site K.
- Verified by the fixer and kept against the review: the FAQ documentation removal date stays
  2026-06-15 (Search Central changelog); `addInlineLanguageDomain()` stays a 14.2 deprecation
  (#108963); #98453 is a 14.0 changelog entry.

## Decided and not applied

- **Description rewording (category 5).** Eleven descriptions end with excluded vocabulary
  ("not X; X belongs to Y"). SKILL-SPEC S2b discourages it, but every one of these pairs is either
  in the collision allowlist or holds 100% on the trigger evals. Changing descriptions in a bulk
  pass trades a known routing state for an unknown one; do it one skill at a time with the eval
  run beside it.
- **Graph changes.** Two findings suggested new outcomes or `requires` edges in
  `upgrade-graph.yml`. The prose was aligned to the graph instead; the harness and its tests stay
  as they are.
- **Rewriting `apply-backend-rights.php` to DataHandler.** The script writes `be_groups` through
  the Connection API by design (CLI, no backend user context); the rule now says so.

## Deferred

Real work, each its own change:

- `typo3-rector/SKILL.md` §4–§5 (~190 lines) duplicate `typo3-v14-reference`; cut to what Rector
  cannot do.
- `typo3-solr/SKILL-FRONTEND.md`: reframe around EXT:solr 14's vanilla controllers (the jQuery
  section is now labelled "EXT:solr 13 and older"); re-verify `SKILL-SOLRFAL.md` worker, table and
  field names against solrfal 14 (only a 2022 checkout was available).
- `typo3-accessibility/references/07-testing-and-tools.md` §7.1 still reads as a full audit
  protocol; shorten to the spot check.
- `typo3-shadcn-content-elements/references/shadcn-preset-workflow.md`: the 30-step exact procedure
  belongs in a script (S8).
- `typo3-records-list-types`: re-check every reference against the next tagged release; the
  extension moves faster than the skill.

## Checks

`./scripts/check.sh` 8/8, `./install.sh --generate-only` exit 0, `node scripts/skill_doctor.mjs`
with the same single pre-existing inspect-owned finding as `main` (a description in a skill this
collection does not own). Exit codes are in the PR.
