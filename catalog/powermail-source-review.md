# Powermail source review — 2026-09-26

Scope: existing `typo3-powermail` skill, supplements, references and bounded example probes.
No new skill, extension implementation, project database mutation or upstream modification.

## Sources cloned and inspected

| Repository | Branch/release inspected | Exact commit |
|---|---|---|
| [in2code-de/powermail](https://github.com/in2code-de/powermail) | public default branch | `1e66d181b01f42460f3c87432ccf7b910691dd92` |
| [in2code-de/powermail_cond](https://github.com/in2code-de/powermail_cond) | public default branch | `1a5231c0c1e96ba0bf88738ed1f25c0310d5d20b` |
| [dirnbauer/powermail](https://github.com/dirnbauer/powermail) | typo3-v14 / tag 14.0.3.4 | `f58c5ff2b927f471985c19e6e366216df68cf54d` |
| [dirnbauer/powermail_cond](https://github.com/dirnbauer/powermail_cond) | typo3-v14 | `fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1` |

Public stable versions from Packagist metadata:
[Powermail 13.3.0](https://repo.packagist.org/p2/in2code/powermail.json)
at `0fec762232a57c49f854f3c3fe6606ce47ac3a9f`;
[conditions 13.1.2](https://repo.packagist.org/p2/in2code/powermail_cond.json)
at `0307d5e8a3b62755f949ca6cb0252074f47f0ebb`.
Do not confuse the subsequently inspected branch code with these older release commits.
Git tag refs confirmed Powermail fork 14.0.3.4 points to the reviewed HEAD;
no v14 release tag was observed for the conditions fork.

All four Composer manifests declare GPL-2.0-or-later for extension source.
The skill's examples are independently authored integrations, not relicensed copies of extension
implementation. in2code and contributor thanks remain explicit in the main skill.

## Corrected claims and examples

| Topic | Evidence / correction |
|---|---|
| Version selection | Distinguish public v13, vendor v14 Early Access and independent v14 forks. Prefer the tagged Powermail fork over stale blanket dev-branch advice; configure both root VCS repositories. |
| Runtime floor | Fork Powermail requires Core ^14.3.6/PHP >=8.3 <8.6; conditions requires Core ^14.3/PHP ^8.4/Powermail ^14.0. |
| Inverted Other rule | Condition::apply/negate: action 1 shows on a match; action 0 hides on a match. Added proposed regression eval before replacing the inverted recipe. |
| Contains versus equality | Comparison.php operators 8/9 are contains, not equality; 6/7 integer-cast; zero is empty for 0/1. Replaced misleading email-repeat recipe. |
| Multistep | Both upstream and fork implement conditional wizard handling. MoreStepForm.js and PowermailCondition.js are byte-identical across the inspected pairs. The README blanket conflict line is stale; this is not a fork-added feature. |
| Multistep edge | Actual shared navigation skips one hidden neighbor only. Source unit probe reproduces a consecutive-hidden-step limitation in both pairs. |
| Mandatory validation | ConditionAwareValidator overrides mandatory checks, not all validation/business rules. |
| Workspace support | Powermail TCA enables versioning; all condition tables set versioningWS=false. Removed fabricated SQL workspace/staging instructions and whole-graph support promise. |
| TypoScript | Correct main.moresteps and cObject email overrides; remove full stale spam/upload configuration copy. |
| Data safety | Replace 1,900-line raw SQL/CLI shop seed, UID arithmetic, permission bypasses and generic legal guarantees with bounded recipes and a pure DataHandler payload builder. |
| Fork extension point | Existing EvaluateRuleEvent supports operator >=100 in reviewed fork. A separately labelled exact-match listener uses that real API; not claimed for public upstream. |
| Progressive disclosure | Main workflow is concise; detailed condition semantics, recipe examples and focused references link to pinned sources. |
| Metadata | Remove supplement frontmatter that pretended supplements were separate skills. Retain the existing skill's lifecycle/description and proposed eval status. |

## Reproducible checks and observed outcomes

Run from repository root:

```bash
php -l skills/typo3-powermail/examples/ConditionDataMap.php
php -l skills/typo3-powermail/examples/ExactFieldMatchListener.php
php skills/typo3-powermail/scripts/check-examples.php
php skills/typo3-powermail/scripts/check-comparison.php /clone/upstream-conditions
php skills/typo3-powermail/scripts/check-comparison.php /clone/fork-conditions
node skills/typo3-powermail/scripts/check-multistep.mjs /clone/upstream-powermail /clone/upstream-conditions
node skills/typo3-powermail/scripts/check-multistep.mjs /clone/fork-powermail /clone/fork-conditions
```

Observed on the review machine: PHP syntax checks exit **0**; seven payload/guard checks exit
**0**. Both actual comparator probes exit **0** for 11 cases (zero, equality, checkbox arrays,
integer truncation and field-to-field contains direction), using minimal model doubles.
Both JS source probes exit **0**, proving forward/backward single-hidden-step navigation,
step-control hide/show and disabled/required restore with minimal DOM doubles. Both report the
same consecutive-hidden-step limitation. The probe imports source from the supplied clones,
not a local rewrite of the algorithm. It does not change extension source.

`diff -u` of the two MoreStepForm.js files and the two PowermailCondition.js files produced
no differences (exit 0). Repository identity checked through GitHub's repository listing.
The case-sensitive conditions README path is `readme.md`; the Powermail README is `Readme.md`.

Collection checks also completed with exit **0**: `audit_skills.py`,
`validate_structure.py`, `validate_evals.py --min-cases 6`, targeted
`run_evals.py --grader lexical --skill typo3-powermail --fail-under-proposed 1.0`
(6/6 proposed trigger cases), and `git diff --check`. The lexical result is routing-proxy
evidence, not behavior-trial coverage. The audit script regenerates its two catalog outputs.

## Limits: not executed or not proved

- No Composer solve for a complete project, TYPO3 installation, database fixture, real browser,
  mail transport, opt-in delivery, workspace publish or localized form submission.
- No PHP runtime integration test of the custom event listener with TYPO3 DI/TCA.
- The Playwright snippet is a proposed acceptance-test template, not an executed test.
- New behavior evals are **proposed**, not human-reviewed or passed model trials.
- Source review supports the rewritten bounded claims, not a claim that every application
  configuration or every extension path is safe.

Keep these gaps in handover; run the project-specific acceptance matrix before deployment.
