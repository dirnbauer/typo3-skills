# Internal retrospective — TYPO3 upgrade runs, August 2026

This internal evidence review covers OEII, FMW, Gütezeichen, Saferinternet, OIAT, and Scioflex
Hydrogen plus the visible Saferinternet follow-up tasks. It distinguishes repository/run artifacts
from task summaries. A missing task or run file is an evidence gap, not proof that work did not
happen.

## Executive result

The upgrades produced substantial working TYPO3 14 installations, but the old parent-loop model
mixed discovery, migration, proof, recovery, hosting, and later feature requests. It made three
costs recur:

1. the wrong cause was sometimes repeated through the same loop instead of routed elsewhere;
2. exhaustive browser proof and stale reports consumed hours after the root cause was already known;
3. run state, Git state, and later task outcomes diverged, making resumption and “done” ambiguous.

The replacement is the evidence graph in `rules/10-graph-protocol.md` plus five smaller leaf skills.

## Project matrix

| Project | What the user asked | Questions/decisions needed from the user | Verified result | Open/next step | What cost too much | Good | Bad / risk |
|---|---|---|---|---|---|---|---|
| OEII | Whole v14 upgrade, then Bootstrap/Vite modernization with identical rendering | DB password was unavailable; explicit approval was needed for a dated dataset, sitemap-result acceptance, and capture-budget overrun | Later repository has TYPO3 14.3.6. 266 HTTP + 266 DOM + 798 screenshots per side reached zero; Bootstrap 5.3/Popper and Vite replaced Gulp/Yarn/BS4 JS while compatible CSS preserved pixels | Reconcile stale P05 run status with current HEAD; complete closure/security/accessibility evidence if not already captured | Repeated exhaustive 798-shot runs and sitemap repair; recovery after local data/file sync damage | Strict-zero parity and the compatibility-CSS decision protected Contract A | Sync script contained a hard-coded credential; DB import cleared freshly synced `fileadmin`; credentials and data identity were not separate gates |
| FMW | v14 upgrade, Mask→Content Blocks, consent/sitemap repair, then Gulp→Vite with pixel parity and safe retained jQuery | Whether to keep jQuery; later many staging/Plesk/DNS/rollback decisions expanded scope | TYPO3 14.3.5 and core migration work succeeded; two Content Blocks, consent and 48-URL sitemap repaired; Composer/schema/scanner/audit clean | Contract A remains formally blocked in recorded status; untracked visual-parity files need ownership/commit decision; staging/remote work is outside this skill | Harness repair and later staging rollback dominated time; unsupported DDEV Node 16 forced host Node for Playwright | Real technical blockers were solved and harness defects were identified precisely | Old harness hashed TYPO3/PHP as immutable, used host app environment, failed live recollection, had null hashes/weak content fingerprint/gate-state contradictions; scope escaped into hosting |
| Gütezeichen | Upgrade TYPO3 and migrate 83 Mask elements while retaining the accepted July 16 dataset and visible behavior | Approve dated dataset; decide how to handle extension forks and observed Bootstrap/assets changes | TYPO3 14.3.5/PHP 8.4.20; Content Blocks and many migrations completed; later loops green | Recorded Contract A remains open with approved-but-not-yet-accepted output classes; current status needs reconciliation | 421 URLs × 2,526 screenshots; server shuffle, animated GIF timing, and missing odiff path caused false/repeated findings; stale attempts inflated report to 5,027 | Large migration surfaced durable ordering/data/type lessons | Registration changed before data in places; nullable/YAML typing, Vite base, second migration passes, stale Composer callbacks, and dependency claims needed correction |
| Saferinternet | Whole v14/Solr upgrade, large Mask migration, extension decisions, and exact frontend preservation | Approve degraded page-tree discovery for a second site without sitemap; separately approve destructive schema quarantine; decide extension forks | Later task evidence reports TYPO3 14 + Solr complete/pushed. Baseline covered 1,356 URLs/360 visual captures; 20 Content Blocks/3,058 elements; live comparison checked special and seeded pages; staging release later reached 151 | Reconcile stale P09/P100 state with later completion; retain remaining search-order/approved-index differences explicitly | Full-site discovery/capture; fingerprint redesign; schema quarantine; later hosting/Solr/PHP/Basic-Auth deployment work | Broad baseline, separate destructive approval, production untouched during staging, local YouTube repair, backend login repaired | Search lesson order changed from Solr tie-breaking; Vite artifacts were initially missing on staging; SSH/fail2ban and remote deployment belong to a separate workflow |
| OIAT | A v14 update was started/completed on a feature branch with later visual-parity work | No matching Codex update task was found in the inspected catalog | Git verifies TYPO3 14.3.5 and commits for upgrade, merge-request preparation, completion docs, and visual parity on `feature/typo3-14-update` | Run retrospective/closure against current branch; decide merge only after evidence. No `.typo3-update` state exists | Unknown: absence of task/run telemetry prevents timing attribution | Git history preserves implementation milestones | “Complete” cannot be equated with graph/Contract A closure; missing evidence must stay explicit |
| Scioflex Hydrogen | Upgrade, remove Bootstrap Package/animations/old DeepL, preserve frontend exactly | User decided the removal/replacement scope and accepted retaining an old carousel table name to avoid risky migration | TYPO3 14.3.5; minimal `scioflex-theme`, supported DeepL replacement, 22 de/en routes 200 and nine layout/content/style metrics matched; backup checksums; commit pushed to develop | Add formal graph/closure evidence if a release claim is needed | Initial work against a fresh DB was wasted and invalid; later import corrected the evidence base | Minimal extraction route reduced long-term dependency burden while preserving output | Wrong database invalidated early proof; a broad package removal needs its own extraction branch, not a routine Composer node |

## Root-cause catalogue and graph correction

| Problem | Root cause | How it was solved | New graph control |
|---|---|---|---|
| Credential in sync helper | Secret and executable sync logic shared one committed source | Removed hard-coded value; requested user-controlled credential source; refused disclosure/reuse | credential-origin check in intake; policy-block edge; no implicit `.env` |
| Fresh `fileadmin` cleared after DB import | DB and file sync were treated as one replace-in-place action without staged verification | Corrected script and reran files-only | `dataset-freshness → data-recovery`; staged DB/files, checksums, snapshot, atomic switch |
| Fresh/empty DB used for proof | DDEV reachable was mistaken for correct project data | Imported real DB/files and re-ran route parity | separate project, DB, fileadmin, and known-content identities |
| False security/dependency blocker | Composer prose/solver result was reported as advisory proof | Re-checked locked audit, constraints, `why-not`, and official evidence | dependency diagnosis node; no blocker without advisory id + affected constraint |
| Harness declared healthy site invalid | Mutable core/PHP/schema/GFX/content outputs were in wrong fingerprint classes | Split renderer identity, source editorial epoch, transition ledger, and target epoch | `invalid → harness/content-ledger recovery`; never site-fix route |
| Random/GIF/lazy-slider diffs | Dynamic rendering and missing intrinsic dimensions were not stabilized | Seeded randomness; stable image decode/layout frames; component refresh; correct diff binary path | deterministic-baseline recovery and slider sentinel journey |
| Consent invisible to tests | Accepted cookie state hid first-visit interaction | Added fresh contexts, reject/accept/settings, local tracker interception | component sentinel node blocks closure |
| Solr result order changed | Sort had non-deterministic ties after reindex/version change | Add deterministic tie-breaker and seeded query order assertion | Solr/search node plus interaction proof |
| Redirects/rights omitted | Admin-centric upgrade checked installation, not editor task capability | Make Redirects mandatory; configure least-privilege editor groups; test read/write/denial and frontend response | `redirects-rights` node owned by `typo3-backend-rights` |
| Vite build worked locally but assets missing in staging | Production build artifacts/deployment packaging were not a gate | Build verification and artifact presence checks | Vite node requires clean build + production check; deployment remains separate |
| Thousands of “regressions” persisted after reruns | Reports aggregated attempts and superseded evidence | Cluster by root cause; mark previous attempts superseded | graph node history separates current verdict from historical attempts |
| Completed Git branch lacked run evidence | Code history and proof history were conflated | No honest reconstruction beyond existing artifacts | retrospective node records evidence gaps; closure must be re-executed |

## Saferinternet sidebar-task review

These are later project tasks, not steps that may be silently folded into the upgrade.

| Task | Approx. active runtime | Result | Assessment |
|---|---:|---|---|
| News variant for Start | 74.9 min | Staging release 158 with a 3×2 card layout | Too long for the initial six-news/accordion request, and the final design diverged. A visible-design decision node should have captured the changed acceptance criteria before implementation/deploy. |
| “Alle anzeigen” button | 14.4 min + 2.4 min clarification | 112/112 results checked; commit `7a8ee27e` pushed to develop; no live upload | Good correction after user clarified destination. Destination must be sealed before any external action. |
| Datenschutz box design | 11.1 min | CSS-only responsive Matomo iframe wrapper; build passed | Good narrow task with proportional proof. |
| Offer for Saferinternet changes | roughly 54 min over many iterations | Corrected Billings Pro offer 2026-552 and unsent mail draft | Scope expanded into template redesign, variants, previews, deletion/recreation, and email. Separate commercial-document workflow; checkpoint before destructive recreation. |
| FAL file usage + deletion | 12.6 min inventory + 31 min deletion | 25 references inventoried; after expanded authorization six PDFs, eight active FAL refs, and 21 RTE links removed with backup/proof | Strong inventory/backup/result proof, but changed deletion list required a new exact-scope approval and immediate project/UID recheck. |

## What should become faster

- One diagnostic determinism sample, one exhaustive double-shoot that becomes Baseline A, one final
  proof. Do not repeat exhaustive capture after a cause is localized.
- HTTP/DOM exhaustive first; pixels tiered and cause-driven. Re-capture affected URLs + sentinels
  during repair, not the entire sitemap.
- Treat consent, sliders, search order, forms, and media as component journeys, not global state ×
  URL multiplication.
- Run independent read-only inventory nodes in parallel. Serialize Composer, DDEV state, Solr core,
  backend session, and authoritative browser proof with explicit locks.
- Supersede previous attempt findings; report current root causes first.
- Stop upgrade orchestration at local handover. Hosting, DNS, Plesk, staging rollback, and live FAL
  deletion need separate workflows and approvals.

## Evidence limitations

- Durations above are available for the five inspected Saferinternet sidebar tasks. Upgrade-thread
  summaries exposed scale and repeated work but not a reliable wall-clock total, so none is invented.
- OIAT has Git evidence but no matching inspected Codex task/run state.
- Several `.typo3-update/STATUS.md` files are stale relative to later commits/tasks. They are evidence
  of the last recorded harness state, not the current repository truth.

