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
before new scripts/dependencies; this does not add phases or global browser states.

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
| Modern Bootstrap SCSS changed every screenshot although the new JS/runtime was correct | Rebuilding styles threatened Contract A and consumed the closure budget | Separate runtime modernization from visual redesign. For Contract A, a frozen audited compatibility stylesheet may preserve pixels while Vite and supported JS replace Gulp/legacy runtime. Modernize SCSS only as approved Contract B work. |
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
