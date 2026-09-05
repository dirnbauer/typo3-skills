# TYPO3 skill collection review — 2026-09-05

## Scope and method

**59 total = 48 `typo3-*` + 11 existing supporting skills.** Ownership is separate:
39 webconsulting-owned, 16 pinned Netresearch, four other existing vendors. This is not a general
101-skill marketplace import. Only the explicit Netresearch allowlist is refreshable by the importer.

Checked all owned skills for frontmatter, lifecycle, size, disclosure/directive rules, references,
eval structure and trigger behavior under the offline router. Added missing lifecycle declarations
using the already-declared suite classifications; retained valid existing declarations. Deep workflow
changes focus on observed upgrade failures, unsafe authority assumptions and repeated verification.
This is not a claim that every TYPO3 API example or every client integration was runtime-tested.

Used the skill-creator guidance and Matt Pocock's current authoring reference to keep instructions
scoped, branch-local and testable. Did not copy a generic essay into each of the 39 skills or edit
upstream Netresearch text to conform to house style. Exact procedures remain in scripts; references
load only when their branch needs them. The main upgrade entry point is now about 280 lines.

## Public research and provenance

- The [webconsulting Wissensbasis](https://www.webconsulting.at/wissensbasis) public search supplied
  “Skills for Real Engineers” (item 3828), “Building Great Agent Skills: The Missing Manual” (3645),
  “Don't Ship Skills Without Evals” (3637) and NVIDIA SkillSpector (3787). No “skill doctor” entry
  was returned on this date; the tool was researched independently.
- [Matt Pocock's writing-for-agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md)
  and its linked skill mechanics were read in full. The current replacement for the older
  write-a-skill name emphasizes explicit scope, useful navigation and completion criteria.
  Runtime/developer invocation rules remain authoritative; no blanket disabling of skills was imported.
- [Skill Doctor](https://github.com/marian2js/skill-doctor) 0.1.0 runs through
  [the pinned advisory wrapper](../scripts/skill_doctor.mjs), with npm integrity verification and
  lifecycle scripts disabled. Other similarly named tools were not installed indiscriminately.
- The two user-provided videos, architecture slide and primary graph/factory sources are documented
  in [the architecture review](../skills/typo3-upgrade-run/references/graph-architecture.md).
  YouTube captions were unavailable; only accessible metadata/chapters and the first author's slide
  deck were used. No full viewing/transcript review is claimed.
- [EXT:solr release metadata](https://packagist.org/packages/apache-solr-for-typo3/solr) shows stable
  14.0.1 on September 3. The owned skill no longer incorrectly says v14 is beta-only.
- The [fleet retrospective](../skills/typo3-upgrade-run/references/run-retrospective-2026-09.md)
  preserves project-level lessons. No customer repository, old verdict, database or live service
  was changed by this collection update.

## All owned skills

“Cases / signed” counts stored cases and genuine existing human signatures, not successful model
trials. All added cases remain **proposed**. Legal/incident legacy drafts remain explicitly drafts;
no signature was manufactured to improve the percentage.

| Owned skill | Lifecycle | Cases / signed | Review/change |
|---|---|---:|---|
| `architecture-decision-records` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `legal-impressum` | capability | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `security-incident-reporting` | capability | 7 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-accessibility` | preference | 8 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-backend-rights` | preference | 24 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-batch` | preference | 9 / 8 | Root-cause batches; targeted unit checks then batch-wide verification; explicit Git authority. |
| `typo3-content-blocks` | preference | 7 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-datahandler` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-design-system-page` | preference | 12 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-fractor` | preference | 9 / 0 | One graph-owned pass; bounded standalone retries and non-progress stop; regression case. |
| `typo3-icon14` | capability | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-idea-extension-blog` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-initial-release` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-news-tags` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-playwright` | capability | 7 / 0 | New small capability skill: real visitor/editor journeys, isolated fixtures, no extra global state matrix. |
| `typo3-powermail` | preference | 7 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-records-list-types` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-rector` | preference | 10 / 8 | Fixed-point proof without nested unbounded loops; oscillation stop; regression case. |
| `typo3-scheduler-jobs` | preference | 15 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-security` | preference | 7 / 0 | Read-only assessment boundary; verify installed configuration/proxy behavior; regression case. |
| `typo3-seo` | preference | 7 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-shadcn-content-elements` | capability | 7 / 0 | Initial/final inventory with targeted repairs between; bounded passes; regression case. |
| `typo3-solr` | preference | 7 / 0 | Stable v14 release correction; no default dev branch or unverified production image; regression case. |
| `typo3-structured-data` | preference | 13 / 0 | Existing lifecycle and suite verified; preserve content-derived mappings and Contract A/B separation. |
| `typo3-translations` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-upgrade-baseline` | preference | 6 / 0 | Keep immutable source evidence and bounded recovery; retain three-state final contract. |
| `typo3-upgrade-closure` | preference | 11 / 0 | Exact source/input epoch, artifact hashes and human acceptance; late acceptance only for timely proof. |
| `typo3-upgrade-intake` | preference | 8 / 1 | Current environment checks and measured runtime admission; no infeasible overnight promise. |
| `typo3-upgrade-migration` | preference | 6 / 0 | One authorized job and shared budget; explicit environment/Deployer/native-JS requirements. |
| `typo3-upgrade-retrospective` | preference | 6 / 0 | Fleet evidence distinguishes implemented v14 code from accepted closure; retain source provenance. |
| `typo3-upgrade-run` | preference | 66 / 26 | Shorter entry point; shared retry limits, lock-aware admission, current closure and timely verification receipt. |
| `typo3-v14-reference` | preference | 11 / 10 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-visual-editor` | preference | 7 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-wcag22-aa-agentic` | preference | 9 / 0 | Root-cause accessibility repairs; targeted feedback and full required final coverage; bounded parent handoff. |
| `typo3-webcomponents` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `typo3-webmcp` | preference | 12 / 0 | Retain secure scoped tools and browser verification; remove obsolete lexical XFAIL after actual XPASS. |
| `typo3-workspaces` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `webconsulting-branding` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |
| `webconsulting-create-documentation` | preference | 6 / 0 | Lifecycle declaration and structural/trigger checks; retain the existing focused workflow. |

## Upgrade architecture and speed controls

The success path is a DAG; bounded recovery edges are its only cycles. The executable authority is
[upgrade-graph.yml](../skills/typo3-upgrade-run/templates/run-directory/config/upgrade-graph.yml),
not a diagram or conversation. Existing small intake/baseline/migration/closure/retrospective leaves
remain sufficient; Playwright is the one new owned specialist for reusable browser journeys.

- One controller, hashed result artifacts, durable state and resource locks. No second parent
  workflow from an imported skill; no autonomous deployment or unsolicited agent/scheduler launch.
- Three starts per node, twelve retry-edge traversals in total, smaller per-edge limits and early
  non-progress stops. Revisited recovery nodes become runnable; historical traversals alone do not
  restart completed work.
- Measured plans include required final reruns, three-run Lighthouse, serialized shared resources
  and uncertainty. Small/large/huge windows remain 8/12/14 hours, with 2/3/4 hours reserved for closure.
  Finished migration does not pay that reserve twice on resumption.
- Affected routes and a reproducible sample for intermediate checks; final declared coverage with
  at most default, keyboard-focus and nav-open globally. Other interactions are targeted journeys.
- A harness failure uses harness recovery, never a new original baseline. A source/data change
  requires reconciled current proof; an evidence-only commit does not invalidate identical source.
- Complete, current proof can be recorded before the deadline and await genuine morning acceptance.
  A missing baseline, skipped checks, stale artifacts or open findings cannot become “closed” merely
  because Core 14 is installed.

## Netresearch maintenance

Fetched the selected repository heads on September 5 and imported their exact content, root licences
and file hashes. The [vendor inventory](../VENDORED.md) and [lock](../vendor-lock.json) pin each revision.
Six heads had advanced since the earlier same-day cache: php-modernization, security-audit,
typo3-core-contributions, typo3-docs, typo3-extension-upgrade and typo3-testing.
The final remote-head check at 13:34 UTC found one further typo3-docs change (an upstream
pre-commit hook pin); that repository was advanced to `44ef44a0e3af3f5677443ddb297c0a21d17ee7d2`.
The imported skill bytes were unchanged by that last commit. No upstream hooks were executed.

The importer refuses dirty pinned files and scope expansion, preserves local overlays and avoids
plugin hooks/installers. Existing DDEV, Vite and testing integration guidance stays in owned overlays:
explicit live-sync authority, safe env handling, compatible Deployer information, current Bootstrap
5.x/native JS where feasible, and real browser/editor checks. No private credentials are included.

## Evidence limits and follow-up

Validation on this revision: `./scripts/check.sh` exited **0** (all eight gates);
`npm test --silent` in the upgrade harness exited **0** (**283/283 tests**, no skips);
`node scripts/skill_doctor.mjs` exited **0** (advisory report); and
`./install.sh --generate-only` exited **0** (59-skill catalogs/client instruction files).
The installer still reports that the optional Gemini extension-manifest generator is absent;
this run does not claim that optional package or every client was installation-tested.

Skill Doctor's latest [report](../catalog/skill-doctor.json) has 714 diagnostics: 689 map to our
separately validated native eval schema, 13 are immutable-upstream advisories, nine are verified
sibling links and three are command examples with arguments. **Zero unresolved owned findings** is
a static-audit result, not a “perfect skill” or live TYPO3 test result.

The 39 owned suites contain 376 cases: 53 reviewed, 310 proposed and 13 draft. Reviewed/proposed
trigger cases are gated separately; behavioral assertions require actual model execution.
Next work that needs real projects or people:

1. Benchmark representative small, large and huge authorized local clones with equivalent coverage;
   retain elapsed time by node, retries and failed first attempts. No 10× speedup is claimed here.
2. Run isolated held-out behavior trials, including interrupted stateful migration, stale closure,
   AJAX navigation and editor save/reopen failures; obtain human review of proposed cases.
3. Reconcile each customer run separately. A missing original baseline may require a qualified
   readiness report; it cannot be reconstructed honestly from already-upgraded code.
4. Test each claimed client with the full bundle. A rule-only mirror cannot substitute for the
   runnable harness, and generated files alone do not prove client compatibility.

Thank you, **Netresearch DTT GmbH**, for maintaining and sharing these skills. Thank you also to
**Matt Pocock**, **Philipp Schmid**, **Lev Selector**, **Alex Sprogis**, the Skill Doctor author and
the other cited authors. Upstream work remains attributed; our adaptations are not their claims.
