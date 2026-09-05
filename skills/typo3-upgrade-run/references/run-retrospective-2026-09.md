# Fleet upgrade retrospective — 2026-09-05

## Scope and evidence

Read-only audit of local project Git histories, current Composer locks, `.typo3-update` state,
selected latest task results and existing test reports. No customer installations, secrets,
production systems or old run verdicts were changed. Paths below are relative to the operator's
projects directory. Versions are local lockfile evidence, not proof of what is currently deployed.

Nine sites have a Git-recorded v12→v14 requirement transition. Scioflex is an additional v14 site
migration in the prior run review; its original v12 requirement was not independently recoverable
from this checkout. Do not count extension forks, fresh v14 demo installs or duplicate worktrees
as additional upgraded websites.

## Projects, results and remaining evidence gaps

| Project | Local Core / upgrade anchor | What worked | Problems / last recorded closure |
|---|---|---|---|
| OEII (`oeii`) | 14.3.6; `9ddef93e`, later `4692658c` | Native JS `ba3bcc24`; cached-page Solr indexing `99ee08d0`; editorial links preserved `e8f1f222`; September sync and 18 interaction tests | Run state still P05 open. September report uses 0.1% pixels, excluded dynamic regions and single-run Lighthouse; not the strict A certificate |
| FMW (`fmw`) | 14.3.5; `cd76374` | Content Blocks, CKEditor modules `1f46d9f`, Playwright `83dad19`, configurable sync `898b088`, deploy archive exclusions `abdc056` | State P11 blocked, loop 300 invalid. Later task retained jQuery intentionally; do not call it jQuery-free. Sync still has unsafe dotenv sourcing/header stripping |
| Gütezeichen (`guetezeichen-relaunch`) | 14.3.5; `31506560` | Native JS `58ea367e`, Bootstrap Package extraction `3e3bf9cc`, retired BS4 compatibility `ee07741f`, repeatable RTE cleanup `d0234360` | State P11 open with findings. Old sync helper is not the modern safe template. Earlier random/GIF comparisons and data/YAML semantics caused rework |
| Saferinternet (`saferinternet`) | 14.3.6; `191d9e4c` | Content Blocks and large-route parity work; later correct backend front-controller routing `27a908ef` | State P10 open. Mobile facet button failed after AJAX (`584e5b63`), resized sticky navigation, backend FAQ previews (`9a7eb407`); screenshots missed real journeys |
| ÖIAT (`oiat`) | 14.3.5; `7a22ec7` | Upgrade branch and later visual parity repair `434cf2b`; completion/MR documentation | No `.typo3-update` state in this checkout. Git completion text is not a reproducible closure |
| Scioflex Hydrogen (`scioflex-hydrogen`) | 14.3.6; `7941e37` | Isolated theme, custom Content Blocks `102481c`, migrated legacy content `7774627` | Initial empty/wrong dataset in prior review; no graph state. Source-v12 provenance incomplete; redesign must not be described as unchanged appearance |
| Combsol (`combsol`) | 14.3.5; `fc5f08e` → `8d7ed0e` | Explicit 12.4→13.4→14.3 ladder, Mask/native Fluid migration `15bf696`, Deployer 8 recipe port `a683a79` | No graph state. Broad DB cleanup `39524ac` needs exact-scope approvals/restore proof; code success does not establish frontend/rights parity |
| Ernährung/Nutrition (`ernaehrung-nutrition`) | 14.3.5; `796f870` | Preserved content in redesign, subscription flow/staging work `970c190` | Legacy settings migration `c603174`, deployment memory `2febb27`, backend routing `f823258`; no graph closure, mixed redesign/upgrade scope |
| Fischereiverband (`fischerei-verband.at`) | 14.3.5; `8748fc2` | Forms, language attributes and metadata migrated | State P00 open despite v14 code; later redesign/staging branches are distinct from verified invariance |
| Watchlist Internet (`watchlist-internet`) | 14.3.6; `51029a7d`, staging `d067f495`, promotion `7efb7dc6` | Extensive migration and subsequent regression tests; PHP web-runtime correction `04d8b45d` | No graph state. RTE preset/link-handler `417a341b`, import-map cache `f624e5be`, Record/FlexForm previews `3622dc61`/`bf5b31a7`, news/FAL/Solr `54018702`, facet setting `c7b07218`, FSD authentication `780cec45` |

These are ten local implementation records, **not ten proven completed runs**. Five inspected state
files remain open/blocked; five sites have no state file. None of those labels was upgraded to green.
Several worktrees contain user changes, which this audit preserved. The site's next step is targeted
readiness/closure reconciliation; a missing original baseline cannot be fabricated after the fact.

## Latest concrete measurements and their limits

OEII `tmp/live-sync-2026-09-05/README.md` supersedes earlier stale-data performance claims:
262 live/local sitemap pages, 789 visual checks, first command 788 passes plus one DDEV connection
failure, and 18/18 interactions. Three isolated identical-input rechecks of that navigation passed;
the original command remains exit 1. Visual tolerance was 0.1%, not strict zero, and dynamic regions
were excluded. Do not import that result as strict-zero Contract A evidence.

The same report records Lighthouse 13.4.1 **single-run** mobile scores: homepage live 51/local 82,
category live 75/local 94. Hosting differs from DDEV and the refresh changed derivative images;
these are indicative measurements, not a controlled speedup or proof of repeatability.

Watchlist task `01a05c89-cae5-7412-a4b5-2eacd98bc065` (“Fix TYPO3 Solr search errors”) reports seven
multilingual searches and the exact suggest endpoint returning 200 after a scoped UTF-8 correction
retry guard; deleted/missing FAL references received a render fallback. This prevents crashes, but
does not restore missing media or replace data cleanup. Task `01a060ef-7315-74a1-873c-ff0ab4de866b`
(“Fix RTE link insertion error”) also corrected hidden-preview configuration: group-controlled
Admin Panel access, individual editor choices, no globally forced visibility.

## Problem → control → owner

| Root cause | Required change | Owner / evidence |
|---|---|---|
| State and implementation evolved independently | Current-code/dataset epoch, hashed reports, mandatory coverage, actual acceptance before atomic closure; stale evidence fails | Main run + closure; `closure-start`, `closure-check`, closure unit tests |
| Happy-path frontend checks missed editor failures | Save/reopen, RTE link browser, real plugin/FlexForm previews, role-specific hidden preview | New `typo3-playwright`; Netresearch `typo3-ckeditor5`; backend node |
| AJAX replacement invalidated event handlers | Operate the same mobile filter twice, after results replacement, plus resize/reset | Playwright + assets node |
| Search tests only checked some documents existed | UTF-8 queries, exact suggest route, cached-page indexing, order/ties/facets, missing-media fallback | `typo3-solr` bounded specialist + interaction registry |
| Config helpers mixed application and sync credentials | Ignored root env/server injection, precedence tests, native alternative; no shell-source dotenv | P05 `project-environment.md`, DDEV overlay |
| Live refresh overwrote inputs/invalidated comparisons | Staged opt-in local import, DB/media rollback, incremental dry-run verification, new epoch after sync | DDEV `webconsulting-live-sync.md` |
| Installed Core/CLI hid runtime faults | Verify web PHP and backend deep routes; clean build and warm-cache asset requests | Runtime/backend/assets checks |
| Deployment metadata absent; private proof shipped in archives | Require compatible `spooner/deployer-information`; inspect toolbar; exclude run data/traces/env | P05/P12/environment + deployment handover |
| Mandatory Lighthouse was gated behind closure | Separate A verification from B optimization; repeated budgeted runs, raw reports and versions | Lighthouse/axe `--mode verify` |
| Expensive work repeated in nested skill loops | One parent DAG; disjoint bounded specialists; affected/seeded intermediate checks; one final proof epoch and unchanged rerun | Main graph; ≤3 global states; original 8/12/14h policy, now [8/24/48h for new seals](runtime-sizing.md) |

## What else belongs where

The main skill owns verdict/currentness, scoped required modernization and graph routing—not all
implementation details. Playwright is a new bounded leaf because repeatable visitor/editor journeys
span several specialists. Env/Deployer details fit one phase reference; sync belongs in the DDEV
overlay; Bootstrap/native JS in the Vite overlay; RTE in Netresearch's CKEditor skill. New Netresearch
project-upgrade/effort/site-conformance skills are available **on demand**, never second parent loops.

Further site work, not performed by this skill-repository update: reconcile each old run; restore or
clean missing media with exact approvals; verify production deployment/SMTP/CDN separately; check
the seven sites lacking the information package; audit retained jQuery dependencies; obtain missing
human acceptance. Do not mutate historical projects just to make this retrospective look complete.

## Skill maintenance and attribution

The public webconsulting Wissensbasis search found no “skill doctor” entry on this date. It did find
NVIDIA SkillSpector (item 3787), “Don't Ship Skills Without Evals” (3637) and “Building Great Agent
Skills: The Missing Manual” (3645). These support intake-time security review, realistic behavioral
evals, narrow triggers, progressive disclosure and pruning—not blindly chasing a static score.

Skill Doctor 0.1.0 was independently located and run over the collection. Its numeric-id eval schema
differs from this repository's human-review/proposed-case schema; retain the richer local schema
and classify this incompatibility rather than rewriting reviewed cases to silence the tool.

Netresearch's marketplace at `20ff67009ad884a302a2009a995408073a4643dc` contained 40 plugins. The
approved collection selects **16 skills: 13 TYPO3 skills and three existing supporting skills**.
Ten existing skills were refreshed and six TYPO3 skills added; unrelated marketplace imports
were removed from the working tree into a recovery folder. The separately authored Playwright
skill brings this collection to 59 skills, including 48 with the `typo3-` prefix.
All imported regular files are pinned and content-hashed in
`vendor-lock.json`; root licences are preserved, local additions and explicit thanks are overlays.
Broken upstream documentation/licence symlinks are recorded as omissions; their licence texts are
copied from the repository root. No plugin hooks/installers were activated by importing the files.

Thank you, **Netresearch DTT GmbH**, for maintaining and openly sharing this substantial body of work.

Sources: [Netresearch marketplace](https://github.com/netresearch/claude-code-marketplace),
[Skill Doctor](https://github.com/marian2js/skill-doctor),
[Wissensbasis](https://www.webconsulting.at/wissensbasis),
[NVIDIA SkillSpector](https://github.com/NVIDIA/SkillSpector).
