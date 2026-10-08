# Recent-run lessons: fast, secure, representative proof

This is the mandatory correction sheet for the current fleet. Read it with the P00 playbook. It
records repeatable failure modes, not customer names or one-off inventories. A symptom still needs
to be confirmed on the project in front of you.

At intake, also apply the [September 16 feature contracts](fleet-regression-contracts.md). They
cover later mail/DOI/CAPTCHA, tracking/CSP, patch-level backend, cache, route and data regressions
without adding global states or nested workflows. Their plan/result accounting is enforced for
new graphs through [feature evidence](feature-evidence.md); older sealed runs remain historical.
The [September 17 delta](run-retrospective-2026-09-17.md) adds effective RTE/save-load contracts and
the user's verified push-destination boundary. Apply [native tools first](native-tools-first.md)
before new scripts/dependencies; this does not add phases or global browser states. Run the intake
detections of the [TYPO3 14 fix pack](typo3-14-fix-pack.md) and put the approvals it needs into the
[intake question round](overnight-controller.md#batch-the-owner-decisions).

## Where a day and a half went

On one fleet site the TYPO3 migration itself (13.4 rung to 14.3 rung) took about three hours and
the whole run about a day and a half. Five causes took the rest:

| Cause | Cost | Counter-measure |
|---|---|---|
| Scope added mid-run: jQuery removal and Bootstrap 5, proven pixel-identical | Correct work, but it pushed the run past its window | Decide Bootstrap and jQuery at intake ([migration intake](bootstrap-5-migration.md#intake-inventory-estimate-ask)). A mid-run addition is weighed against the deadline first: re-forecast with its estimate, state the cost to the owner, and prefer a separately authorized follow-up run when it does not fit before the migration cutoff |
| Baseline A captured from a dev-server render, unstyled | A whole run lost: a sealed baseline cannot be repaired | [Fix pack item 9](typo3-14-fix-pack.md#9-dev-server-render-before-baseline-a) before `deterministic-baseline`: production build, manifest mode, no `/@vite/client` in the DOM, one look at a pilot screenshot |
| Over-detailed worker evidence: more than 100 files and 20–40 minutes per node | Hours across the graph for proof that ten files gave | The [lean evidence profile](graph-runner.md#evidence-file): about 120 lines, hashed proof artifacts only, earlier artifacts cited, one probe artifact, stop at the [time box](graph-runner.md#trivial-nodes-run-in-the-controller) |
| Nodes run one after another although `graph-next` offered them together | Intake and final proof took their serial sum | [Dispatch every offered set at once](parallel-execution.md#dispatch-what-the-graph-offers); in the final proof one full capture first, then the comparisons together |
| Known TYPO3 14 problems, solved on an earlier fleet site, rediscovered node by node | One diagnosis round per problem per node | The [TYPO3 14 fix pack](typo3-14-fix-pack.md) applied at the start of the rung, its approvals asked at intake |

The closure of a later fleet run added five lessons, each now in its reference:

| Cause | Cost | Counter-measure |
|---|---|---|
| A monitoring module rewrote `settings.php` on every open | Every admin sweep dirtied the epoch's worktree | Back it up and restore it around admin steps; commit the synced file before staging ([known problem](known-problems.md#a-backend-module-is-gone-for-admins-or-fails-on-a-protected-method)) |
| The target was sealed against the last stage's ledger, and `_processed_` grew between seals | One review round-trip | [One cumulative ledger](closure-currentness.md#target-content-epoch-one-cumulative-ledger) with derived files |
| `keyboard-focus` and `nav-open` silently equalled `default` | The open menu was never in the pixel proof | [Check that the states differ](visual-regression.md) at intake |
| A fleet-wide answer could not be recorded for another project | An owner round-trip during the closure | [Ask every fleet decision per project](../rules/40-approval-matrix.md#404-scope-of-an-approval) at intake |
| The staging host existed only in `.hosts.yaml` | No staging deploy after acceptance | [Check the host at intake](live-dataset-and-staging.md#publishing-to-staging) |

Planning anchors for the next run are in [runtime sizing](runtime-sizing.md#measured-fleet-durations).

## Where the minutes went on a small shop site (2026-10-07)

A 60-URL shop site on 12.4 reached the 14.3 rung with four parallel workers approved. The TYPO3
work was quick (`rung-13` 35 min, `manual-migration` with Mask → Content Blocks 45 min); the node
overhead was not. The owner, mid-run: "timelimit MUST be much faster!! whats going on here?"
Measured from the run's journal:

| Cause | Measured cost | Counter-measure |
|---|---|---|
| Every node, trivial ones included, went to a fresh full worker that loaded its skill, re-measured and wrote 58–124 lines of evidence | 14–23 min per small intake node; `solr-search` on a site without any search extension 15 min against a 1-min forecast | [Trivial nodes run in the controller](graph-runner.md#trivial-nodes-run-in-the-controller); a node forecast at 15 min or less stops at 1× its forecast |
| Each `not-applicable` and **R** node got a full fresh reviewer, 25–63-line reviews | 4–7 min per `not-applicable` review, about 14 min per **R** review | The [short review](graph-runner.md#trivial-nodes-run-in-the-controller) for trivial nodes: hash plus three spot checks, 30 lines at most, a smaller model is acceptable |
| All P10 nodes hold `project-write` | One chain: `solr-search` alone took 15 min of it before `vite-assets` could start | [Serialized P10 nodes](parallel-execution.md#dispatch-what-the-graph-offers): trivial ones back to back, `vite-assets` last |
| Two predictable approvals asked mid-run: the asset-bundle URLs after Breaking #108055 (listed for round 1, not asked) and the DDEV throwaway admin (two earlier fleet runs asked the same) | `rung-14` held `project-write` 64 min waiting for the first answer | [Round 1 must include them](overnight-controller.md#batch-the-owner-decisions) |
| A worker was stopped in the middle of a capture | Orphaned harness browsers and a capture without an index: 17 min to a usable capture instead of 6.5 | Below |

**After an interrupted capture** the stopped capture has no `capture-index.json`, so no comparison
can use it. Kill the orphaned browsers of the pinned harness first, and only those: its own
Playwright build, matched by path. Playwright's Chromium runs as "Google Chrome for Testing", so a
match by name can hit the user's Chrome. Then recapture under a new label (`<label>-r2`); the
harness reclaims the dead process's visual lock itself. On macOS, from the pinned harness's
`scripts/` directory:

```bash
rev=$(node -p "require('./node_modules/playwright-core/browsers.json').browsers.find(b => b.name === 'chromium').revision")
ps -A -o pid=,ppid=,args= | awk -v p="ms-playwright/chromium-$rev/" '$2 == 1 && index($0, p)'   # orphans only; read them first
pids=$(ps -A -o pid=,ppid=,args= | awk -v p="ms-playwright/chromium-$rev/" '$2 == 1 && index($0, p) { print $1 }')
[ -n "$pids" ] && kill $pids
```

## Why a small site took so long (2026-10-08)

A 33-URL fleet site with one real migration (Mask → Content Blocks, 40 rows) was sealed huge and
forecast at 18 hours. The owner: "why it takes soooo long". Six causes, each with its counter-measure:

| Cause | Counter-measure |
|---|---|
| Dev-only packages, unused extensions and a wrapper swap counted as compatibility blockers | Only used blockers that need a fork, a local or a data migration count ([blocker rule](runtime-sizing.md#compatibility-blockers)) |
| The forecast copied measured minutes from earlier runs whose nodes were dominated by rework and recoveries | Copy the work, not the wall clock: drop recovery attempts, rework and owner waits from a [measured node](runtime-sizing.md#measured-fleet-durations) before using its minutes |
| Proof scripts written anew per site | Reuse the previous fleet run's component sentinels, backend operations, cache journey and closure-manifest builder, adapted per site (selectors, accounts, routes) |
| Predictable decisions asked mid-run | [Round 1](overnight-controller.md#batch-the-owner-decisions) asks every decision the inventory already predicts |
| Full captures after every intermediate step | Intermediate checks on affected routes plus a stable sample ([feasibility](runtime-sizing.md#feasibility-before-mutation)); one full capture per rung end |
| Composer, Rector and code work waited for browser captures | Run them beside the capture: the capture reads the running site, the code work happens in [isolated preparation](parallel-execution.md#independent-implementation-preparation) and lands after the capture index is complete |

Before the first stateful proof, mark the DDEV-generated tracked files skip-worktree
([closure trap 1](#closure-deploy-and-backend-proof-traps-from-a-fleet-run-2026-10-07)); doing it
only at `closure-start` is too late when an earlier snapshot restore already dirtied the tree.

## Processed images darker locally than live (2026-10-07)

On a two-language shop-check site DDEV ran ImageMagick where live runs GraphicsMagick, with TYPO3
12.4's default `processor_colorspace` `RGB`, which ImageMagick reads as linear: the same 64×64 PNG
icons were 28–44 % darker locally (`identify` means: red 129 → 92, green 100 → 56, a grey icon
104 → 61, saved as Gray). Baseline A came from that render, so before and after were equally dark;
the stale derivatives survived both rungs (a processed file's name ignores the processor). With
GraphicsMagick in DDEV and the files regenerated, `scripts/gfx-colour-parity.mjs` passed (12 pairs,
at most 0.8 L* apart). Run it at [intake item 12](../../typo3-upgrade-intake/SKILL.md#evidence-checklist),
before Baseline A; item 12 also covers a run whose baseline is already sealed.

## A Bootstrap 5 review rejected: renames are not a migration (2026-10-07)

A Bootstrap 4.6 → 5.3 migration went to the owner as pixel-identical screenshots plus a list of class
renames. He rejected it: "are you sure that changing the classes is enough?" Stored content, untouched
templates, scripts, behaviour and components outside the sample were unproven. The review now waits for
the [migration checklist](bootstrap-5-migration.md#renaming-classes-is-not-enough--the-migration-checklist):
leftover audit over sources and database, behaviour matrix, fixture page, Contract A identity for JS.

## Closure, deploy and backend-proof traps from a fleet run (2026-10-07)

Eight traps from one fleet run's closure and deploy preparation. Each cost a stale epoch, a false
finding or a lost hour; each counter-measure below is cheap when applied before the trap.

1. **A DDEV snapshot restore rewrites tracked DDEV-generated files.** `ddev snapshot restore`
   (through the restart it triggers) regenerates `.ddev/traefik/certs/<project>.crt` and `.key`
   and reorders the routers in `.ddev/traefik/config/<project>.yaml`. When the project tracks them,
   the first stateful proof makes the working tree dirty and the closure epoch goes **STALE**.
   Before `closure-start`, mark the certificate files local-only and restore the router file after
   every restore:

   ```bash
   git update-index --skip-worktree .ddev/traefik/certs/<project>.crt .ddev/traefik/certs/<project>.key
   git checkout -- .ddev/traefik/config/<project>.yaml   # after every snapshot restore
   ```

   Recommend untracking these generated files in the project; that is an owner decision, recorded
   in the handover, not a change the run makes on its own.
2. **`t3u content-fingerprint --assert` needs the real fileadmin path.** Pass
   `--fileadmin public/fileadmin` (and `--ddev-project <name>`). Without it the harness resolves
   `fileadmin` relative to the working directory, finds nothing, hashes an empty file tree (the
   empty-string hash) and reports content drift that does not exist. Check the file count in the
   fingerprint before believing a drift report.
3. **Redirects sharing host and path: the lowest uid wins.** EXT:redirects serves the first match:
   `RedirectCacheService` orders by `respect_query_parameters` descending, then `uid` ascending, and
   `matchRedirect()` returns the first hit. 12.4 and 14.3 behave identically, so a shadowed row is
   not an upgrade regression. Redirect sentinels must expect the winning row's target for every
   shadowed row; report the duplicates to the owner as data cleanup.
4. **Deployer 8 changes the shared files, and deploys run no upgrade wizards.** The Deployer 8
   `typo3` recipe shares `config/system/settings.php` by default (Deployer 7 shared
   `public/.htaccess`), and a project's `add('shared_files', ['.env'])` keeps that default. When
   `settings.php` is tracked, restore the 12.4 behaviour explicitly with
   `set('shared_files', ['public/.htaccess', '.env'])`. Deploy recipes usually run no upgrade
   wizards: add a task after `typo3:extension:setup` that runs the explicit list of wizard
   identifiers the DDEV run executed (the scheduler wizard needs `extension:setup` first). Never a
   blanket `upgrade:run`: on CLI it marks every wizard whose `updateNecessary()` is false as done,
   and `formFileFormsToDatabaseMigration` reports "No file-based form definitions found" on CLI
   (ConfigurationManager not initialised, "No request given") even when file-based forms exist,
   so a blanket run marks it done without migrating anything. After the first deploy, the
   deploying party runs `upgrade:list` on the server ([deployment handover](deployment-handover.md)).
5. **EXT:form on 14.3 loses the editors' Forms module.** `web_FormFormbuilder` is now a container
   with the submodules `form_manager` and `form_editor` (access `user`), and the core
   `UserPermissionsForRenamedModulesMigration` grants neither, so an editor's "Forms" entry
   redirects to the page module. Fix it with an idempotent project upgrade wizard (DataHandler, admin
   CLI context) that adds both identifiers to the group's `groupMods`, after the owner's approval
   (the same class as [fix pack item 8](typo3-14-fix-pack.md#8-renamed-modules-and-editor-rights)).
6. **Backend proof scripts on 14.3.**
   - The Install Tool modules (`system_maintenance`, `system_settings`, `system_upgrade`,
     `system_environment`) answer **303** to
     `<siteUrl>?__typo3_install&install[controller]=…&install[context]=backend`. Accept exactly that
     hand-over, nothing broader. Each needs about 18 s.
   - A Playwright step time limit must **abort** the step. An overrun step that kept running raced
     the later steps and looked like a lost session.
   - The element browser (`wizard/record/browse?mode=file`) opens with no folder selected for a fresh
     editor: choose the mount in the folder tree first.
   - A FormEngine field on a non-default tab needs that tab activated before the click.
   - CKEditor 47's `getData()` differs from the stored field (attribute order, entities,
     whitespace). Compare text strictly and markup with documented normalisations; record both
     hashes and the first difference ([RTE round-trip proof](measurement-recipes.md#rte-round-trip-proof)).
7. **Measure the cache journey with an unrelated content edit.** A page-title change invalidates
   every cached page whose menu renders that page (`pageId_<uid>` tags), so "no full purge" cannot be
   proven after a title change. Edit a content element on an unrelated page instead. DDEV puts the
   core caches on `NullBackend` ([fix pack item 14](typo3-14-fix-pack.md#14-caches-on-nullbackend-in-ddev)):
   inside a snapshot, enable `Typo3DatabaseBackend` temporarily (an `additional.php` block plus
   `ddev typo3 database:updateschema '*.add'`) when the journey needs database cache tags, then
   restore the snapshot and the file byte-identically.
8. **axe verify mode without a 12.4 axe baseline reports every serious cluster.** Prove a cluster
   pre-existing rather than accepting it on sight: compare the computed colours with the source CSS
   from Git and with the Baseline A DOM markup. Matching values on both sides make it
   `pre-existing`; any difference is classified like every other finding.

## What failed and what now prevents a repeat

| Failure mode | Cost or risk | Mandatory correction |
|---|---|---|
| A Composer solver sentence was reported as a confirmed TYPO3 security blocker | The update stopped for a false reason and the target release was misrepresented | A blocker needs `composer audit --locked --format=json`, advisory identifiers and affected constraints, the project policy source, `why-not`, and the official TYPO3 release/advisory evidence. Resolver prose alone is not a diagnosis. |
| A generic Solr endpoint cleared another DDEV project's `core_de` | Cross-project data loss; the intended project was unharmed only by chance | Resolve and record DDEV project, container/service, Solr origin, site/language core and document count. Back up that exact core. Refuse mutation when any identity is generic, ambiguous or belongs to another project. |
| Schema, wizard, GFX and generated-image changes invalidated the same fingerprint used for editorial freeze | Technically healthy upgrades became formally unjudgeable | Keep the source editorial fingerprint immutable, record every stateful migration in a content-transition ledger, then seal a target editorial epoch. Schema/GFX/generated derivatives are migration subjects or rendering outputs, not silent editor input. |
| A selected browser carried a production backend session and injected the Admin Panel | Every page appeared structurally different | Every proof uses a new isolated context. Refuse frontend evidence containing a TYPO3 Admin Panel/debug toolbar or a backend-session cookie. Never reuse the operator's interactive browser profile. |
| Consent was hidden from ordinary screenshots and therefore not really tested | A broken or restyled first-visit dialog could ship behind green page captures | Seed accepted consent only for ordinary page parity. Add a fresh-context consent sentinel that captures first visit and details, exercises reject/accept, and proves tracking is blocked before consent. |
| A lazy Owl/slider image had no intrinsic height, so the library measured the wrong viewport | Cropped or collapsed hero despite apparently stable CSS | Wait for load, fonts, image decode and two stable layout frames; refresh the component; capture its settled first item; operate next/previous once; assert intrinsic dimensions and no image-caused shift. |
| Search rendered and indexed, but ordering changed on tied results | Functional regression escaped status, DOM and screenshot sampling | Test a seeded query with expected first-page identity/order, empty results and pagination. Record live-content drift separately from code ordering. |
| A missing sitemap or wrong local site base was discovered after capture started | Baseline work was repeated | Validate every local origin/site variant and sitemap at P00. Use the declared page-tree fallback before sealing, with dynamic routes named as uncovered. |
| Two exhaustive proofs queued behind the same machine-wide browser lock | Hours were spent waiting, then repeating equivalent work | Inspect the lock owner and planned release time before starting. While occupied, do renderer-free fetch, comparison or migration work. Run one diagnostic, one exhaustive double-shoot that becomes Baseline A, and one final proof—no duplicate exhaustive capture. |
| One ticket was created per affected URL although hundreds shared a template cause | Reporting took longer than diagnosis and obscured root causes | Cluster findings by cause, template signature, component, state and viewport. Create one parent finding/ticket with representative URLs and a machine-readable affected-URL list. |
| A sync/import helper embedded credentials and a later database import cleared the freshly synchronized `fileadmin` | Secret exposure plus destructive loss of the intended source dataset | Credentials have one explicit origin and are never committed or printed. Split DB and files into staged artifacts; checksum both; snapshot the current local target; import to a temporary/staged location; verify project/database/file counts; switch only after both pass. Route any mismatch to `data-recovery`. |
| An upgrade began against a fresh/empty database rather than the project's imported content | Healthy routes were “proved” against the wrong site | `project-identity` and `dataset-freshness` must pass independently before baseline or mutation. Record database identity, row/content timestamps, fileadmin count/hash and one known content sentinel. |
| The run state said P09/P11 open while Git and later tasks showed newer completed work | Resumption from stale status could repeat destructive work or misreport completion | Reconcile graph state, repository HEAD, installed core, run artifacts and last successful commands before resuming. Stale state routes to retrospective/reconciliation; Git history alone cannot create a closure certificate. |
| A completed upgrade branch had no `.typo3-update` graph or Codex task evidence | The implementation existed, but its invariance and operational claims could not be audited | Run `typo3-upgrade-retrospective`, reconstruct only verifiable facts, mark missing proof as an evidence gap, and execute `typo3-upgrade-closure` before merge/release. Never infer green from an upgrade commit message. |
| A task changed destination or destructive scope mid-conversation | A safe local/push request could drift toward live deployment or broader deletion | Destination and exact target ids are sealed node preconditions. A changed environment, UID/file list, or customer message invalidates the prior approval and opens a new decision node. Re-check identity immediately before action. |
| Modern Bootstrap SCSS changed every screenshot although the new JS/runtime was correct | Rebuilding styles threatened Contract A and consumed the closure budget | Separate runtime modernization from visual redesign. Prove the TYPO3 update invariant with a full loop first; then move Bootstrap to the latest 5.x with old-look variables and an audited compatibility layer, and declare only differences the owner accepted from a before/after review ([Bootstrap 5 migration](bootstrap-5-migration.md)). A redesign stays approved Contract B work. |
| Removing a large theme/package was attempted as a normal dependency update | Hidden templates, CType registrations and behavior made the blast radius unclear | Route to an extraction node: inventory rendered dependencies, create the smallest local sitepackage/theme that reproduces them, move data/registration in fixed-point steps, then remove the package and prove all representative routes. |
| Visual comparison reported thousands of stale or superseded findings | Review time and client reports were dominated by already-explained noise | Every rerun supersedes prior artifacts by node/attempt. Reports show current open root causes first and retain historical counts separately; never sum attempts into “current regressions.” |

After the final stateful migration reaches a fixed point, copy and complete
`config/content-transition.example.json`, then run:

```bash
t3u content-fingerprint --write-target --transition .typo3-update/config/content-transition.json
```

This activates the target epoch for live freeze checks without rewriting the source fingerprint
bound to Baseline A. It is not re-baselining: HTTP, normalized DOM and pixels still compare against
the untouched source rendering.

## The fast representative matrix

The global visual product stays fixed at three authoritative states: `default`,
`keyboard-focus`, and `nav-open`. Do not multiply every sitemap URL by every widget state.

At P00, create `config/interactions.yml` from inventory and name one or two representative URLs for
each component actually present:

| Component | Required sentinel journey |
|---|---|
| Consent | Fresh context: initial banner, details/settings, reject, tracker remains blocked; second fresh context: accept, expected local interception fires. Never contact the third party. |
| Carousel/slider/rotator | Settled first item at all three viewports; next once; previous/return once; keyboard control where exposed; no crop, missing intrinsic dimensions or layout shift. |
| Navigation/dropdown/accordion | Open, focus through exposed controls, close with Escape, restore focus. Global `nav-open` covers only the primary navigation. |
| Search | Seeded normal query with stable ordering, zero results and pagination. Solr/indexed_search must contain documents before the journey starts. |
| Form/newsletter | Empty validation plus one successful Mailpit submission. External APIs are intercepted locally; a missing credential is a named coverage gap, never a simulated pass. |
| Modal/filter/quiz/embed | Open or activate the project's real high-value interaction, assert visible content/state, close and restore focus. |

Run the sentinel journeys before sealing Baseline A and after the target is stable. A component found
by the capture settle report but absent from `interactions.yml` blocks closure: stabilising a widget
is not the same as testing it.

## Secure dependency diagnosis

Use the exact application environment and preserve the output:

```bash
ddev composer audit --locked --format=json
ddev composer show --all typo3/cms-core
ddev composer why-not typo3/cms-core "^14.3"
ddev composer config --list --source
```

Classify a release as affected only when the audit or official TYPO3 advisory names the package and
constraint. Record the advisory ID, installed/candidate version, source and command exit code. Do
not disable Composer policy, add an ignore, use `--no-blocking`, or hard-pin an old patch to make the
solver move. The root requirement remains `^14.3`; `composer.lock` records the tested patch.

## Safe Solr mutation

Before clear, delete, reload, configset replacement or full reindex:

1. Record `ddev describe -j`, the DDEV project name and the exact Solr origin reached from that
   project. A host port or generic `localhost` endpoint is not identity.
2. Read the TYPO3 site/language Solr configuration and list cores from that origin. Require an exact
   core match and record its current document count.
3. Create and checksum a rollback archive for that exact core/configset. A database snapshot is not
   a Solr backup.
4. Re-resolve identity immediately before the destructive request. Any mismatch is exit 5,
   `BLOCKED_BY_POLICY`.
5. Reindex, then prove queue errors are zero, expected document classes/counts exist, and real
   search ordering, empty results and pagination work.

## Vite, HTML, Lighthouse and axe quality profile

When the user requests the secure/fast/modern outcome, Contract B is explicitly in scope after A:

1. Plain Vite owns every project CSS/JS entry, bundling and minification. Run a clean production
   build and `scripts/vite-production-check.mjs`; then crawl the representative matrix with zero
   missing assets, failed requests, dev/HMR clients, stale legacy bundles or severe console errors.
2. Validate generated HTML and run axe in each representative **visible state**, not only on the
   closed/default document. Target zero serious/critical findings; triage every moderate/minor and
   every `incomplete` result. Automated green is not WCAG conformance.
3. Run Lighthouse three times per fixed URL in mobile and desktop modes and report medians plus
   min–max. Target 100 accessibility, SEO and best-practices; target at least 95 mobile and 100
   desktop performance. A miss remains a measured finding, never a rounded-up success.
4. Re-run Contract A after each approved visual improvement. Brand colour or layout changes need
   their own B baseline; an accessibility goal does not silently override the visual contract.

The goal is perfect evidence and explicit residuals. Never translate a local lab score into field
performance, an axe run into WCAG conformance, or a justified miss into a pass.
