# Relaunch vs. portation of the theme layer (v13/v14)

When the frontend/theme is proprietary or built on libraries with no v14 path,
the estimate is NOT extension-count-driven. A cluster of theme-serving
extensions is *replaced by one sitepackage*, not migrated one by one. Estimating
each as a separate "port this extension" line double-counts and misreads the
shape of the work.

## The cluster that collapses

Under a v14 target these theme-layer packages typically have no forward path and
are absorbed by one new sitepackage build rather than ported. Verify each at
Packagist at estimate time — this table is a pattern, not a fact source.

| Extension (typical) | v14 status | Absorbed into |
|---|---|---|
| gridelements | none (max 12.0.0) | Content Blocks / b13 container |
| laxap bootstrap_grids | none, tied to gridelements | Content Blocks / container CEs |
| fluidtypo3/vhs | no stable v14 | Core ViewHelpers + custom rebuild |
| fluidtypo3/flux | check dev branch | Content Blocks |
| LESS compiler (ws_less …) | none | JS build (Vite) — see note |
| bootstrap_package | has v14 (16.x) | own sitepackage if relaunching |
| proprietary custom theme | n/a | the new sitepackage |

- Vite note: v14 removed core-side asset concatenation/compression (#108055).
  Projects that relied on it need an external build step (e.g. Vite) instead,
  which makes a LESS-compiler extension obsolete.
- bootstrap_package is path-dependent: "keep" under a pure portation, "drop"
  under a relaunch (Bootstrap pulled via npm and built). Do not classify it
  before the portation/relaunch decision is made.

## Decision rule: portation or relaunch

Prefer *relaunch* when any of these hold (each raises portation cost without
delivering v14 value):

- the theme depends on a library with no v14 path (vhs, gridelements, LESS
  compiler) — a port must replace it first, before any v14 benefit exists
- the load-bearing defects (SEO / performance / accessibility) are
  template-level, so a port carries them forward
- the theme is foreign or undocumented proprietary code (unknown quality)

Prefer *portation* when the theme is your own, clean, already on v14-viable
libraries, and free of the defects above.

On relaunch, a whole "port extension X" cluster leaves the estimate and is
replaced by two work-packages: *sitepackage build* (the systematic
underestimator) and *content/CE migration* (see
`flux-to-content-blocks-migration.md`).

## Whole-project path: step-wise upgrade vs. greenfield rebuild

The theme axis above decides *portation vs. relaunch*. A second, independent axis
decides how the **core and data** get to the target version: a step-wise
major-for-major upgrade (one major version at a time, with Rector and the upgrade
wizards each step, the database carried forward) or a **greenfield rebuild**
(fresh target-version install plus a scripted data migration).

Estimate BOTH paths in parallel for every project. Never assume one by reflex —
rough out each, recommend the cheaper/cleaner one, and state why. This also maps
directly to the client-facing "upgrade vs. rebuild" story.

Rule of thumb for the choice:

- **Greenfield wins** when almost all custom code is being replaced anyway (a
  foreign theme cluster plus a replaced functional module) AND the content
  elements are re-typed during the move (e.g. onto Content Blocks). The
  step-wise upgrade's main free benefit — the wizards migrate the data (records
  moved, values rewritten, new columns filled; the schema itself is the Database
  Analyzer's job) — is largely wasted, because the database it carries up is
  transformed afterwards regardless. You pay twice and drag old cruft along.
- **Step-wise upgrade wins** when substantial custom code and the content-element
  structure are *kept*, so the wizard trail does real, reusable work — or when
  the data is unusual (workspaces, many custom tables, complex relations) and the
  wizards' per-major migrations are the safer route.

Greenfield is *not* "re-enter content by hand". It is a fresh install plus a
*scripted data migration* (page tree, content → new CE types, FAL, news,
redirects, users). That migration line carries exactly the work the upgrade
wizard would have done, so it grows accordingly — size it as its own
work-package, not as an afterthought. Frame it to the client as "rebuild with
full data migration", not "greenfield".

Cost shape: greenfield replaces the core-upgrade line (a small fresh-install
setup) and shifts the freed effort into data migration. The total lands in the
same order of magnitude, often slightly *below* the step-wise upgrade because the
per-major Rector/deprecation overhead disappears — an experience heuristic, not a
guarantee; confirm against your own actuals.

## Size the sitepackage bottom-up, not with a flat lump

For the sitepackage-build line do not guess a flat range. Walk the live site,
count the pages and the element types actually in use (a sample of pages is
enough to enumerate the types), and build a per-building-block table with a
low/high range per row. A proven raster:

- foundation (design tokens, icon set, asset build)
- shell (header, nav desktop + mobile, footer, breadcrumb, site search, consent)
- page types (home, standard, news, search results, 404)
- standard content elements (~10 core blocks)
- custom content elements (teaser cards, icon-text, accordions, contact cards,
  filterable lists)
- home stage / hero, layout sections (coloured background bands)
- news list + detail, forms (incl. confirmation mails)
- accessibility (contrast, keyboard, screen-reader — often a legal requirement,
  e.g. public sector or providers covered by the EU Accessibility Act)
- performance (responsive/next-gen images), editor comfort (CE preview)
- design coordination and review loops

Offer two variants when the client has an existing look: Variant A rebuilds the
current appearance (cheaper build, but accessibility is *more* expensive because
contrast fixes must be retrofitted into the old design); Variant B is a new design
(the delta over Variant A is almost entirely the separate design package). Note that a pixel-exact rebuild
is only possible where the current design already meets the contrast thresholds;
where it breaks them, WCAG 1.4.3 forces visible colour changes — flag that up
front.

## Measure the content-migration base, don't assume it

Migration effort scales with the *editorial page count*, not the crawl-URL
count. A crawler hitting its URL limit reflects dynamic module URLs (real-estate
details, news, faceted parameters), not pages an editor must re-lay-out.

- Editorial pages: count the live pages sitemap —
  `curl -s '[site]/sitemap.xml?sitemap=pages&cHash=…' | grep -c '<loc>'`, or
  `SELECT COUNT(*) FROM pages WHERE deleted=0 AND hidden=0 AND doktype IN (1,4)`.
- Exclude from the manual count: records rendered by an extension (EXT:news
  carries over via the database, template-only work) and data-driven detail
  pages (rendered by a module). Count those under their own module or QA line.
- Drop cruft the sitemap reveals (test / template / 404 pages left indexable) —
  a cleanup line, not a migration line.

## Estimate impact

- Estimate by work-package (assessment/spike, core upgrade *or* greenfield
  rebuild per the path decision above, sitepackage relaunch sized bottom-up,
  functional modules, SEO, content migration, QA, PM), not by summing a
  per-extension baseline across the extension count.
- Extension-count calibration anchors only the *core-upgrade* portion, never the
  relaunch.
- Best/worst hinges on the one thing unreadable without system access: the
  quality of the existing theme code. Keep the spread wide until an assessment
  with code access collapses it.
- Verify every extension's v14 status at Packagist
  (`repo.packagist.org/p2/<vendor>/<pkg>.json`, real `require.typo3/cms-core` per
  version). "Legacy" packages get updated (e.g. `friendsoftypo3/typo3db-legacy`
  1.3.0 supports v14); dead-looking ones may have only a dev branch. Never assume
  from memory.
