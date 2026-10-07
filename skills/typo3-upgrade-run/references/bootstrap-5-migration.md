# Bootstrap 5.x in every upgrade run

Owner preference, 2026-10-04: every site that uses Bootstrap leaves the upgrade run on the latest
stable Bootstrap 5.x. A Bootstrap 5 site updates within 5.x. A Bootstrap 3 or 4 site migrates to
5.x in the `vite-assets` node, after a full loop has proven the TYPO3 update itself invariant. This
reference is that procedure. Version selection follows [latest stable is the default](latest-version-policy.md);
the build follows the `typo3-vite` overlay.

The aim does not change: the old look on the new framework. Bootstrap 5 is configured to the old
values and the site's Sass gets a small compatibility layer. Whatever still differs is shown to the
owner and declared only after the owner has accepted it.

## Contents

- [Intake: inventory, estimate, ask](#intake-inventory-estimate-ask)
- [Sequence inside the run](#sequence-inside-the-run)
- [Keep the design](#keep-the-design)
- [Class mapping: Bootstrap 3 to 5](#class-mapping-bootstrap-3-to-5)
- [Bootstrap 4 to 5 in short](#bootstrap-4-to-5-in-short)
- [Pitfalls](#pitfalls)
- [Renaming classes is not enough — the migration checklist](#renaming-classes-is-not-enough--the-migration-checklist)
- [Proof and handover](#proof-and-handover)

## Intake: inventory, estimate, ask

Read-only, inside the P00 intake evidence. Inventory how Bootstrap is used, not only which package
is listed: an unused `bootstrap*` dependency is not usage, and a frontend without Bootstrap never
gets it.

| Inventory | Where | Why it matters |
|---|---|---|
| Version and source language | `package.json`, banners of vendored `bootstrap*.css`/`.js`, `bootstrap-sass`, LESS sources, a theme extension that ships Bootstrap | Bootstrap 5 ships Sass only, so a LESS site ports its own styles: the largest single effort. A theme extension's TYPO3 14 release decides its 5.x; a gap to the newest 5.x is a recorded exception |
| Bootstrap mixins and variables in the site's styles | `@include`/`.mixin()` calls, `$screen-*`, `$brand-*`, `$gray-*`, `$line-height-computed` | each one needs the compatibility layer or a rewrite |
| Classes in templates | Fluid templates, partial and layout overrides, Content Blocks templates, menu templates, TypoScript wraps | markup work in `vite-assets` |
| Classes in stored content | `tt_content.bodytext` and other rich-text fields, the RTE preset's styles and `contentsCss` | stored content stays unchanged; the compatibility layer styles it. The full count over sources and database is [checklist item 1](#1-leftover-audit-over-every-source-the-database-included) |
| Form framework classes | powermail `plugin.tx_powermail.settings.styles.framework.*`, EXT:form YAML (`*ClassAttribute`) and template overrides | forms change shape twice: TYPO3 14 templates, then Bootstrap 5 |
| Bootstrap JS components | `data-toggle`, `data-target`, `data-ride`, `data-spy`, `data-dismiss`, plugin calls such as `.modal(` or `.affix(` in templates, stored content and scripts | each needs `data-bs-*` attributes and a behaviour journey |
| jQuery consumers | project scripts, inline scripts in templates and TypoScript (files and `sys_template` rows), jQuery plugins | replaced by native code; a retained plugin is an explicit, accepted exception |

```bash
# Version, wherever it comes from (host, read-only; the site package lives in packages/ here)
grep -rE --include=package.json --exclude-dir=node_modules --exclude-dir=vendor '"bootstrap(-sass)?": *"' .
grep -rlE --include='*.css' --include='*.js' 'Bootstrap +v[345]\.' packages/
# Bootstrap 3/4 classes in templates, counted per class token
grep -rhoE --include='*.html' 'class="[^"]*"' packages/ | tr ' "' '\n\n' \
  | grep -xE 'col-xs-[0-9]+|col-(sm|md|lg)-(offset|push|pull)-[0-9]+|img-responsive|pull-(left|right)|(hidden|visible)-(xs|sm|md|lg)|btn-(default|xs)|panel(-[a-z]+)?|well|form-group|help-block|control-label|has-(error|warning|success)|input-group-addon|glyphicon(-[a-z-]+)?|sr-only|navbar-(default|inverse|header|toggle)' \
  | sort | uniq -c | sort -rn
# Bootstrap JS data attributes in templates
grep -rhoE --include='*.html' 'data-(toggle|target|ride|slide|spy|dismiss|parent)=' packages/ | sort | uniq -c
# Stored rich text and database TypoScript
ddev mysql -N -e "SELECT COUNT(*) FROM tt_content WHERE deleted = 0 AND bodytext REGEXP 'img-responsive|pull-(left|right)|col-xs-|btn-default|glyphicon|data-toggle'"
ddev mysql -N -e "SELECT uid FROM sys_template WHERE deleted = 0 AND CONCAT_WS(' ', constants, config) REGEXP 'styles.framework|bootstrap|jquery'"
```

**Estimate** from these counts, not from the page count. The LESS port, the number of distinct
template patterns (navbar, panels, forms) and jQuery plugins without a native replacement drive
the effort; stored-content classes are cheap because they get aliases. Enter the estimate as the
`vite-assets` minutes in `nodes/intake/runtime-plan.json` with the inventory as its `source`,
including the invariance loop, two full captures and the review ([unattended controller](overnight-controller.md)).
`graph-forecast` then shows whether the migration fits before the migration cutoff. When it does
not, name that as the blocker before any mutation and let the owner decide, for example on a
separately authorized follow-up run ([runtime sizing](runtime-sizing.md#feasibility-before-mutation));
never extend the deadline.

**Ask the owner** before the run goes unattended and record the answer as an intent approval
([approval matrix](../rules/40-approval-matrix.md)):

- approval to migrate in this run, and when the owner can review the result: `vite-assets` waits for
  the acceptance, so the review slot has to fall before the migration cutoff;
- what the owner gets: the old look configured on Bootstrap 5, yet every page may look slightly
  different; a before/after review of every URL comes before any acceptance, and a rejected
  difference goes back to repair.

```bash
t3u approval --id APR-<nnn> --stage intent --scope "Bootstrap 3 to the latest 5.x in vite-assets" \
  --question "<the question as asked>" --answer "<the answer as given>" --granted
```

A declined migration keeps the current Bootstrap as a recorded exception under the
[version policy](latest-version-policy.md#exceptions-must-be-visible): blocker, approval reference,
exit condition. It is never a silent skip.

## Sequence inside the run

1. **TYPO3 first.** `rung-14` activates `vite-assets` together with the other P10 nodes. They all
   take the exclusive `project-write` lock, so they run one after another in the order you pick from
   `graph-next`: `content-blocks`, `solr-search`, `rte-visual-editor`, the Redirects rights branch and
   the parity nodes first, `vite-assets` last. Open it early enough that the migration, its captures
   and the review finish before the migration cutoff ([runtime sizing](runtime-sizing.md)); the time
   after the cutoff is closure reserve, not migration time.
2. **Prove the upgrade invariant before the first Bootstrap edit.** Inside `vite-assets`, finish a
   pipeline move to Vite first (it must be pixel-identical) and commit. Run a full Contract A loop at
   that commit ([loop protocol](../rules/10-loop-protocol.md)):

   ```bash
   t3u capture --loop <NNN> --label pre-bootstrap
   t3u compare-all --loop <NNN> --before A-original --after pre-bootstrap
   ```

   It must be green: this loop is the invariance proof of the upgrade itself. Write its loop id and
   commit into the node evidence. A finding here is an upgrade regression, not Bootstrap work:
   repair a CSS or asset cause inside this node, return `blocked` for any other cause, and never
   start the Bootstrap change on an unproven upgrade. The harness screenshots only the sealed visual
   sample, so before the first edit also screenshot the remaining URLs at the run's viewports with
   the pinned browser (`typo3-playwright`): the before half of the review.
3. **Migrate in steps**, one commit each, in a second loop of the node: Bootstrap package → old-look
   variables → compatibility layer → template markup → JavaScript (`data-bs-*`, native code instead
   of jQuery) → form framework classes → RTE `contentsCss`. After each step compare an intermediate
   capture of the affected URLs (`t3u capture --scope intermediate --affected-file …`) with
   `pre-bootstrap` and read the diffs. Remove every difference you can before the review. A framework
   migration exceeds a worker's usual one-cause size; the intent approval names the scope and the
   evidence lists the commits. Before the first edit, run the
   [leftover audit](#1-leftover-audit-over-every-source-the-database-included) and the old half of the [behaviour matrix](#2-behaviour-matrix-in-a-real-browser) and build the
   old [fixture page](#3-a-fixture-page-for-components-outside-the-sample): all three need the
   `pre-bootstrap` state.
4. **Compare every URL** at the run's viewports:

   ```bash
   t3u capture --loop <MMM> --label bootstrap-5
   t3u compare-all --loop <MMM> --before pre-bootstrap --after bootstrap-5
   ```

   HTTP and DOM cover every URL, the screenshots the sealed sample in its states; repeat the extra
   screenshots of step 2 for the other URLs. The findings are the review's content, not a failure.
5. **Review with the owner** only after the [migration checklist](#renaming-classes-is-not-enough--the-migration-checklist)
   is complete. Build one page under `nodes/vite-assets/review/`: the audit, behaviour and fixture
   results first, then each difference class with one before/after pair and its affected URLs (a
   class is one cause: one variable, one component default, one markup pattern; [rule 40.2](../rules/40-approval-matrix.md#402-approval-granularity-for-rendering-changes)),
   then the pairs of every URL at every viewport. The owner decides class by class; a rejected class
   goes back to step 3. Record what the owner accepted as its own approval, separate from the intent.
   One record lists every accepted class with its pair, because each rule in step 6 cites exactly
   one approval:

   ```bash
   t3u approval --id APR-<nnn> --stage acceptance --scope "Bootstrap <old> to <new>: <accepted classes>" \
     --question "<the question as asked>" --answer "<the answer as given>" \
     --evidence nodes/vite-assets/review/index.html --granted
   ```

6. **Declare** the accepted differences as rules in `decisions/declared-changes.json`
   ([rule 30.8](../rules/30-finding-classification.md#308-declared-changes-are-rules-not-edits)), each
   citing the acceptance: `dom` rules for mechanical renames where they explain all of a page's DOM
   differences, and one `whole_document` rule per page whose DOM or screenshots differ beyond them,
   its `url` anchored to that one page. Take the URLs from the step 4 findings, never a catch-all
   pattern. A `whole_document` rule declares everything on its page; on a site whose layout markup
   changed, that is every page, and the invariance loop of step 2 is what proves the upgrade changed
   nothing else there. Two entries of the file's `changes` array:

   ```json
   { "id": "DC-011", "approval_ref": "APR-014", "stage": "dom", "before": "data-toggle=", "after": "data-bs-toggle=",
     "reason": "Bootstrap 5 reads only data-bs-* attributes (accepted Bootstrap 5 migration)" },
   { "id": "DC-012", "approval_ref": "APR-014", "stage": "dom", "whole_document": true,
     "url": "^https://acme\\.ddev\\.site/contact/$", "reason": "Accepted Bootstrap 5 rendering of this page" }
   ```

   Then `t3u compare-all --loop <MMM> --before A-original --after bootstrap-5` must be green before
   `vite-assets` closes `pass`.
7. **Freeze.** From the acceptance on, a change that touches accepted pages needs a new comparison of
   those URLs and a new acceptance; never stretch an existing one. P11 proves the target against
   Baseline A with these rules like any other declared change.
8. **Hand over two results.** The invariance proof of the upgrade (loop id, commit) and the accepted
   Bootstrap change (versions before and after, its commits, intent and acceptance ids, declared-change
   ids, review path, retained exceptions such as a kept jQuery plugin) are named separately.

**A Bootstrap 5 site** updates within 5.x in `vite-assets` in the order of
[P04 loop 030](phases/p04-pre-update-stabilisation.md#loop-030--bootstrap-in-order) and aims at
strict zero: restore what moved with variables and compatibility rules. When the inventory makes
visible differences likely (an early 5.x with many overrides), plan it like a migration: invariance
loop first, then review, acceptance and declaration.

## Keep the design

Configure Bootstrap 5 to the old values and keep the site's own Sass working through a small
compatibility layer; do not rewrite every component. Take each value from the site's own Bootstrap
3/4 variables first; the table gives the framework defaults for what the site never overrode.
Overrides go after `bootstrap/scss/functions` and before `bootstrap/scss/variables`, Bootstrap's
documented import order and the variables file of the `typo3-vite`
[theming flow](../../typo3-vite/references/bootstrap-theming.md).

| Variable | Bootstrap 3 look | Bootstrap 4 look | Bootstrap 5.3 default |
|---|---|---|---|
| `$grid-breakpoints` | `(xs: 0, sm: 768px, md: 992px, lg: 1200px)` | `(xs: 0, sm: 576px, md: 768px, lg: 992px, xl: 1200px)` | adds `xxl: 1400px` |
| `$container-max-widths` | `(sm: 750px, md: 970px, lg: 1170px)` | `(sm: 540px, md: 720px, lg: 960px, xl: 1140px)` | adds `xxl: 1320px` |
| `$grid-gutter-width` | `30px` | `30px` | `1.5rem` |
| `$font-size-base` | `.875rem` (14px) | `1rem` | `1rem` |
| `$line-height-base` | `1.428571429` | `1.5` | `1.5` |
| `$h1-font-size` … `$h6-font-size` | 36, 30, 24, 18, 14, 12 px | `2.5rem` … `1rem` | `2.5rem` … `1rem` |
| `$headings-line-height` | `1.1` | `1.2` | `1.2` |
| `$headings-margin-bottom`, `$paragraph-margin-bottom` | `10px`, `10px` | `.5rem`, `1rem` | `.5rem`, `1rem` |
| `$font-family-sans-serif` | `"Helvetica Neue", Helvetica, Arial, sans-serif` | system stack | system stack |
| `$body-color` | `#333` | `#212529` | `#212529` |
| `$link-color`, `$link-hover-color` | `#337ab7`, `#23527c` | `#007bff`, `#0056b3` | `#0d6efd`, shaded 20 % |
| `$link-decoration`, `$link-hover-decoration` | `none`, `underline` | `none`, `underline` | `underline`, `null` |
| `$primary`, `$success`, `$info`, `$warning`, `$danger` | `#337ab7`, `#5cb85c`, `#5bc0de`, `#f0ad4e`, `#d9534f` | `#007bff`, `#28a745`, `#17a2b8`, `#ffc107`, `#dc3545` | `#0d6efd`, `#198754`, `#0dcaf0`, `#ffc107`, `#dc3545` |
| `$border-radius` (`-sm`, `-lg`) | `4px` (`3px`, `6px`) | `.25rem` (`.2rem`, `.3rem`) | `.375rem` (`.25rem`, `.5rem`) |
| `$enable-rfs` | `false` | `false` | `true` |
| `$enable-smooth-scroll` | `false` | `false` | `true` |

With the Bootstrap 3 map, `col-sm/md/lg` and `navbar-expand-sm` keep the old meaning. Bootstrap's
own grid example drops `xl` and `xxl` the same way; markup must then not use those tiers
(`col-xl-*`, `container-xxl`, and `modal-xl`, which then loses its media query). A
Bootstrap 4 site keeps Bootstrap 5's map but sets `xxl` in `$container-max-widths` to `1140px`, or
every page widens on screens of 1400 px and more.

The compatibility layer sits after Bootstrap's mixins and before the site's own Sass. It holds only
what the site's Sass and stored content use:

```scss
// _bootstrap3-compat.scss
$screen-sm-min: map-get($grid-breakpoints, sm);
$screen-md-min: map-get($grid-breakpoints, md);
$screen-lg-min: map-get($grid-breakpoints, lg);
$screen-xs-max: $screen-sm-min - 1;
$brand-primary: $primary;
$line-height-computed: 20px;

@mixin make-sm-column($columns) {
  @include make-col-ready();
  @include media-breakpoint-up(sm) { @include make-col($columns); }
}

// Bootstrap 3 rules the old look and stored rich text still rely on
h1, h2, h3 { margin-top: 20px; }
h4, h5, h6 { margin-top: 10px; }
.img-responsive { display: block; max-width: 100%; height: auto; }
.pull-left { float: left !important; }
.pull-right { float: right !important; }
```

Copy the Bootstrap 3 rule itself rather than `@extend`-ing its Bootstrap 5 successor: the two differ
in detail (`.img-fluid` lacks the `display: block` of `.img-responsive`). Do not load the whole obsolete
distribution next to the new one ([`typo3-vite` overlay](../../typo3-vite/references/webconsulting-additions.md)).
A LESS site ports its own styles to Sass first (`@var` → `$var`, `.mixin();` → `@include mixin;`).

## Class mapping: Bootstrap 3 to 5

With the Bootstrap 3 breakpoint map above, the grid tiers keep their names. With Bootstrap 5's
default map every tier shifts one step: Bootstrap 3 `sm` (from 768 px) is Bootstrap 5 `md`, `md`
(992 px) is `lg`, `lg` (1200 px) is `xl`; rename every grid, offset, order and display class one
tier up, and use `navbar-expand-md`.

| Bootstrap 3 | Bootstrap 5 | Note |
|---|---|---|
| `col-xs-N` | `col-N` | an unmapped `col-xs-*` silently becomes full width (`.row > *`) |
| `col-*-offset-N` | `offset-*-N` | `col-xs-offset-N` → `offset-N` |
| `col-*-push-N`, `col-*-pull-N` | `order-*-N`, `order-*-first`, `order-*-last` | flex order, not offsets |
| `img-responsive`, `img-rounded`, `img-circle` | `img-fluid`, `rounded`, `rounded-circle` | |
| `pull-left`, `pull-right` | `float-start`, `float-end` | |
| `text-left`, `text-right` | `text-start`, `text-end` | |
| `hidden-*`, `visible-*`, `hidden` | `d-none` with `d-*-block`, `d-*-flex`, `d-*-inline` | keep the element's own display value; `hidden-print` → `d-print-none` |
| `sr-only` | `visually-hidden` | `sr-only sr-only-focusable` → `visually-hidden-focusable` alone |
| `center-block` | `d-block mx-auto` | |
| `btn-default` | `btn-secondary`, `btn-light` or a site class | Bootstrap 5's secondary is grey, not white |
| `btn-xs`, `btn-block` | `btn-sm` or a site rule, `w-100` | both removed |
| `label label-*` | `badge text-bg-*` | Bootstrap 3 `badge` (grey pill) → `badge rounded-pill text-bg-secondary` |
| `panel`, `panel-heading`, `panel-body`, `panel-footer` | `card`, `card-header`, `card-body`, `card-footer` | `panel-group` accordions → `accordion` markup |
| `well`, `thumbnail`, `media`, `jumbotron` | `card card-body`, `card` or `img-thumbnail`, `d-flex`, utilities | all four removed |
| `form-group` | `mb-3` | removed |
| `help-block`, `control-label` | `form-text`, `form-label` or `col-form-label` | |
| `has-error`, `has-success` | `is-invalid`, `is-valid` on the control | message in `invalid-feedback` |
| `checkbox`, `radio`, `checkbox-inline` | `form-check` with `form-check-input` and `form-check-label`, `form-check-inline` | |
| `input-group-addon`, `input-group-btn` | `input-group-text`, the button directly inside `input-group` | |
| `select.form-control` | `form-select` | `form-control` hides the select arrow in Bootstrap 5 |
| `input-lg`, `input-sm` | `form-control-lg`, `form-control-sm` | |
| `navbar-default`, `navbar-inverse` | background utilities with `data-bs-theme` | |
| `navbar-header`, `navbar-toggle`, `icon-bar` | `navbar-expand-sm`, `navbar-toggler`, `navbar-toggler-icon` | `navbar-expand-sm` collapses below 768 px with the Bootstrap 3 map |
| `nav navbar-nav > li > a` | `navbar-nav > .nav-item > .nav-link` | `active` moves to the link; `navbar-right` → `ms-auto` |
| `dropdown-menu > li > a` | `dropdown-item` on the link | |
| `breadcrumb > li`, `pagination > li > a`, `list-inline > li` | `breadcrumb-item`, `page-item` with `page-link`, `list-inline-item` | |
| `table-condensed` | `table-sm` | |
| `glyphicon glyphicon-*` | the site's icon font or SVG | Glyphicons are gone; remove the dead `@font-face` |
| `caret` | `dropdown-toggle::after` | or keep the site's caret and set `$enable-caret: false` |
| `in` (collapse, fade, modal state) | `show` | CSS and scripts that test `.in` |
| `close`, `affix` | `btn-close`, `sticky-top` | the affix plugin is gone |
| `carousel .item`, `carousel-control left/right` | `carousel-item`, `carousel-control-prev/-next` | |
| `data-toggle`, `data-target`, `data-dismiss`, `data-ride`, `data-slide(-to)`, `data-parent`, `data-spy` | `data-bs-*` | |

## Bootstrap 4 to 5 in short

- Grid: `xxl` (1400 px) is new with a 1320 px container (see above); the gutter drops from 30 px to
  1.5rem.
- Logical names: `ml-*`/`mr-*` → `ms-*`/`me-*`, `pl-*`/`pr-*` → `ps-*`/`pe-*`,
  `float-left/right` → `float-start/end`, `text-left/right` → `text-start/end`,
  `border-left/right` and `rounded-left/right` → `-start`/`-end`, `dropdown-menu-right` →
  `dropdown-menu-end`.
- Forms: `custom-select` → `form-select`; `custom-control custom-checkbox/radio` → `form-check`,
  `custom-switch` → `form-check form-switch`, `custom-file` → `form-control`, `custom-range` →
  `form-range`; `form-group`, `form-row`, `form-inline` and `input-group-prepend/-append` are gone,
  and labels lose reboot's bottom margin (`form-label` has it).
- Utilities and components: `no-gutters` → `g-0`, `badge-*` → `text-bg-*`, `badge-pill` →
  `rounded-pill`, `sr-only` → `visually-hidden`, `font-weight-*` → `fw-*`, `font-italic` →
  `fst-italic`, `btn-block` → `d-grid` or `w-100`, `embed-responsive` → `ratio`, `close` →
  `btn-close`; `media`, `jumbotron` and `card-deck` are removed.
- JavaScript: `data-*` → `data-bs-*`; jQuery is dropped, see the pitfalls.
- Sass defaults: links underlined, RFS on, larger radius; use the Bootstrap 4 column above.

## Pitfalls

- **Flexbox rows.** Columns are flex items: they stretch to equal height (backgrounds and borders
  grow; `align-items-start` restores content height), wrap cleanly where floats used to staircase,
  and every direct child of `.row` becomes a padded full-width column (`.row > *`), including a
  heading or clearfix div placed straight inside a row.
- **Reboot.** Line height 1.5, underlined links, headings without top margin, `p` with 1rem bottom
  margin, `label` no longer bold, list indent 2rem, `blockquote` unstyled, table captions at the
  bottom, `legend` resized and floated, `hr` at 25 % opacity. Bootstrap 3 also sets
  `html { font-size: 10px }`: site CSS written in `rem` against that root grows by 1.6 on Bootstrap
  5's browser-default root, so convert it.
- **RFS.** With `$enable-rfs: true`, headings above 1.25rem shrink below 1200 px viewport width:
  the mobile screenshots change while the desktop ones match.
- **Removed `.sr-only`.** Skip links and visually hidden labels in templates and stored content turn
  into visible text unless renamed or aliased. `visually-hidden` together with
  `visually-hidden-focusable` never appears on focus.
- **Glyphicons.** The font is gone: icons render as nothing, and a leftover `@font-face` points at
  deleted files, a failed request wherever an icon still asks for it.
- **Same name, different mixin.** A removed Bootstrap 3 mixin or variable fails the build, which is
  the good case. One that kept its name compiles and renders differently: `button-variant($color,
  $background, $border)` became `button-variant($background, $border, …)`, and `box-shadow()` emits
  nothing unless `$enable-shadows: true`.
- **JavaScript.** Bootstrap 5 reads only `data-bs-*` attributes and needs no jQuery; dropdowns,
  tooltips and popovers need Popper (`bootstrap.bundle` or `@popperjs/core`), and events are DOM
  events (`el.addEventListener('shown.bs.collapse', …)`). While jQuery is still on the page,
  Bootstrap 5 also registers its jQuery plugins, so `$(…).modal()` keeps working and hides a missed
  migration: test the journeys after jQuery is gone.
- **Forms.** powermail's `styles.framework.*` constants and EXT:form's `*ClassAttribute` properties
  still carry Bootstrap 3 classes. TYPO3 14's EXT:form templates already emit Bootstrap 5 markup that
  the invariance work taught the old CSS ([known problems](known-problems.md#forms-lose-their-styling-inputs-collapse-to-browser-default-width));
  after the switch, Bootstrap 5 styles that markup itself. Review every form page.
- **RTE.** Point the preset's `contentsCss` at the new build output. Keep every class stored content
  uses allowed in the preset: CKEditor drops a class the preset does not allow on the next save
  ([RTE round trip](measurement-recipes.md#rte-round-trip-proof)). `vite-assets` is a code node and
  does not rewrite stored content.
- **Version lookup.** npm's `latest-5` dist-tag is stale: on 2026-10-04 it named 5.3.3 while the
  newest 5.x was 5.3.8. Resolve the target from the version list, as the
  [version policy](latest-version-policy.md) says.
- **Sass warnings.** Current Dart Sass prints hundreds of deprecation warnings (`import`,
  `global-builtin`, `color-functions`, `if-function`) for Bootstrap 5.3's sources; the CSS is the
  same with or without them. Silence them for the dependency (`quietDeps`, `silenceDeprecations`)
  instead of pinning an old Sass.

## Renaming classes is not enough — the migration checklist

Pixel-identical screenshots plus a list of class renames is not a finished migration. The owner
rejected exactly that review with the question: are you sure that changing the classes is enough?
It is not. Screenshots cover the sealed sample in three states; renames cover the templates
somebody opened. Neither proves stored content, untouched templates, scripts, behaviour or
components that the sample never showed. All six items below are done before the owner review of
step 5, and the review page shows their results.

### 1. Leftover audit over every source, the database included

Count every Bootstrap-4-only class and attribute in every place markup comes from: Fluid
templates, partials and layouts; Content Blocks templates; EXT:form YAML (form definitions in
their storage folders, `*ClassAttribute` settings) and form partials; TypoScript and TSconfig
(wraps, `ATagParams`, RTE class lists); XLIFF (labels with markup); PHP (ViewHelpers, TCA items
such as frame classes); JavaScript; CSS and Sass. In the database: `tt_content.bodytext` (HTML
elements included), `header_link` and `pi_flexform`, `sys_template` constants and setup,
`pages` (TSconfig and rich-text fields), the form definitions, and every other text column, via a
fresh dump.

The list, with breakpoint infixes (`ml-md-3`, `text-lg-right`):

| Group | Bootstrap-4-only tokens |
|---|---|
| JavaScript attributes | `data-toggle`, `data-target`, `data-dismiss`, `data-parent`, `data-ride`, `data-slide(-to)`, `data-spy`, and `dataset.toggle`/`.target`/`.dismiss`/`.parent` in scripts |
| Spacing and direction | `ml-*`, `mr-*`, `pl-*`, `pr-*` (negative `mr-n1` included), `float-left/right`, `text-left/right`, `rounded-left/right`, `border-left/right(-0)`, `dropdown-menu-right/left` |
| Typography and helpers | `sr-only`, `sr-only-focusable`, `font-weight-*`, `font-italic` |
| Components | `badge-*` (colours, `badge-pill`), `btn-block`, `close`, `jumbotron(-fluid)`, `media`, `media-body`, `card-deck`, `card-columns`, `embed-responsive(-*)` |
| Grid and forms | `no-gutters`, `form-group`, `form-row`, `form-inline`, `custom-select`, `custom-control`, `custom-checkbox`, `custom-radio`, `custom-switch`, `custom-file`, `custom-range` (with their `-input`/`-label` parts), `input-group-append`, `input-group-prepend` |

```bash
A=.typo3-update/nodes/vite-assets/audit; mkdir -p "$A"
cat > "$A/bs4-leftovers.pl" <<'PL'
#!/usr/bin/env perl
# Prints "source<TAB>token" per Bootstrap-4-only occurrence. A mysqldump file is split per table.
use strict; use warnings;
my $tok = qr/data-(?:toggle|target|dismiss|parent|ride|slide(?:-to)?|spy)|dataset\.(?:toggle|target|dismiss|parent)
  |[mp][lr](?:-(?:sm|md|lg|xl))?-(?:n?[0-5]|auto)|(?:float|text)(?:-(?:sm|md|lg|xl))?-(?:left|right)
  |sr-only(?:-focusable)?|badge-(?:primary|secondary|success|danger|warning|info|light|dark|pill)
  |btn-block|no-gutters|form-(?:group|row|inline)|custom-(?:select|control|checkbox|radio|switch|file|range)(?:-[a-z]+)*
  |input-group-(?:append|prepend)|embed-responsive(?:-[a-z0-9]+)*|jumbotron(?:-fluid)?|media-body|card-(?:deck|columns)
  |dropdown-menu(?:-(?:sm|md|lg|xl))?-(?:left|right)|font-weight-[a-z]+|font-italic|(?:rounded|border)-(?:left|right)(?:-0)?/x;
my $noise = qr/^(?:cache_|cf_|sys_log|sys_history|sys_refindex|sys_http_report|index_|tx_solr_|be_sessions|fe_sessions)/;
my ($file, $table) = ('', '');
while (my $l = <>) {
  ($file, $table) = ($ARGV, '') if $ARGV ne $file;
  $table = $1 if $l =~ /^INSERT INTO `(\w+)`/;
  next if $table =~ $noise;
  my $src = $table ne '' ? "db:$table" : $file;
  print "$src\t$1\n" while $l =~ /(?<![\w\$\@-])($tok)(?![\w-])/g;
  # "media" and "close" are English words too: count them only as a class or a selector
  while ($l =~ /class(?:Attribute|Name)?\s*[=:]\s*\\?["']([^"'\\]*)/g) {
    print "$src\t$_\n" for grep { /^(?:media|close)$/ } split /\s+/, $1;
  }
  print "$src\t$1\n" while $l =~ /(?:\.|classList\.\w+\(\s*["'])(media|close)(?![\w(-])/g;
}
PL
# Sources: own code and form storages; build output and the vendored framework are not sources
{ find packages config -type f \( -name '*.html' -o -name '*.yaml' -o -name '*.yml' \
      -o -name '*.typoscript' -o -name '*.tsconfig' -o -name '*.txt' -o -name '*.xlf' -o -name '*.php' \
      -o -name '*.js' -o -name '*.mjs' -o -name '*.ts' -o -name '*.css' -o -name '*.scss' -o -name '*.less' \) \
    -not -path '*/node_modules/*' -not -path '*/vendor/*' \
    -not -path '<the build output directory>/*' -not -name 'bootstrap*' -print0
  find public/fileadmin -type f -name '*.form.yaml' -print0; } \
  | xargs -0 perl "$A/bs4-leftovers.pl" > "$A/hits.tsv"
# Database: every table except caches, logs and indexes (the script skips them)
ddev export-db --gzip=false --file="$A/db.sql"
perl "$A/bs4-leftovers.pl" "$A/db.sql" >> "$A/hits.tsv"
# Token x source kind (file extension or db:<table>) x count: the audit table of the review
awk -F'\t' '{ k = $1; if (k !~ /^db:/) { n = split(k, p, "."); k = "*." p[n] } c[$2 "\t" k]++ }
  END { for (x in c) print x "\t" c[x] }' "$A/hits.tsv" | sort > "$A/leftovers.tsv"
```

For the records behind a `db:` count, query the table itself. Workspace rows count as content:

```bash
ddev mysql -N -B -e "SELECT uid, pid, sys_language_uid, t3ver_wsid FROM tt_content WHERE deleted = 0
  AND CONCAT_WS(' ', bodytext, header_link, pi_flexform) REGEXP '(^|[^a-z0-9_-])(data-(toggle|target|dismiss|parent)|[mp][lr]-((sm|md|lg|xl)-)?(n?[0-5]|auto)|(float|text)-((sm|md|lg|xl)-)?(left|right)|sr-only(-focusable)?|badge-[a-z]+|btn-block|no-gutters|form-(group|row|inline)|custom-(select|control|checkbox|radio|switch|file|range)(-[a-z]+)*|input-group-(append|prepend)|embed-responsive(-[a-z0-9]+)*|jumbotron(-fluid)?|media-body|card-(deck|columns)|dropdown-menu-((sm|md|lg|xl)-)?(left|right)|font-weight-[a-z]+|font-italic|(rounded|border)-(left|right))([^a-z0-9_-]|$)|class=\"([^\"]* )?(media|close)( [^\"]*)?\"'" \
  > "$A/tt_content-rows.tsv"
```

Each row of `leftovers.tsv` gets exactly one disposition, and the audit runs again on the migrated
state:

- **Renamed** — template, script and style sources. The source count on the rerun is zero.
- **Aliased** (preferred for editor content: no data change) — the compatibility layer carries the
  class with Bootstrap 4.6's own rule, copied as for the Bootstrap 3 rules above, never an
  `@extend` of the Bootstrap 5 successor. CSS cannot alias an attribute: stored `data-toggle` and
  friends need either a small native shim in the site's script that sets the matching `data-bs-*`
  attribute before first use, or the wizard below. Keep every aliased class allowed in the RTE
  preset ([pitfall](#pitfalls)).
- **Migrated** — only with an owner approval for the data change: an upgrade wizard that is
  idempotent (a second run changes zero rows), covers workspace and translated rows, and is recorded
  in the [content-transition ledger](closure-currentness.md#target-content-epoch-one-cumulative-ledger).
  It runs in a data-migration node, never inside `vite-assets`. The rerun shows zero for those rows.
- **Exception** — a token kept as it is, with its reason and owner approval.

The audit is complete when no row lacks a disposition and the rerun matches every disposition.

### 2. Behaviour matrix in a real browser

Screenshots alone do not prove behaviour. Run every interaction in the pinned browser
(`typo3-playwright`) at every viewport of the run, once on the `pre-bootstrap` commit and once on the
migrated state, and record what is observable, not "works":

| Component | Interactions | Observed per viewport, old and new |
|---|---|---|
| Navbar toggler | click, Enter, Space, Escape, Tab through the open menu | open state, `aria-expanded`, focus target after each key, whether Escape closes |
| Every collapse and submenu | open, close, keyboard, open-one-closes-other (`data-parent`) | visible state, `aria-expanded`, transition time |
| Dropdowns | click, Enter, arrow keys, Escape, click outside | open state, focused item, menu alignment |
| Modals, tooltips, popovers (if present) | open, Tab inside, Escape, close button | focus trap, focus return, backdrop |
| Sliders | autoplay, arrows, dots, swipe (touch emulation), hover | measured autoplay interval and transition time, active item, pause on hover |
| Focus rings, skip links | Tab from page start | ring geometry and colour on links, buttons and inputs; skip target receives focus |
| Forms | empty submit, one invalid field, valid submit | error classes and messages, summary or confirmation step |

Measure timings instead of eyeballing them, for example a slider's autoplay interval:

```js
// Playwright: the intervals between three changes of the active slide, in ms
const intervals = await page.evaluate(({ root, item, active }) => new Promise((resolve) => {
  const box = document.querySelector(root), items = [...box.querySelectorAll(item)], stamps = [];
  let last = items.findIndex((el) => el.classList.contains(active));
  new MutationObserver(() => {
    const now = items.findIndex((el) => el.classList.contains(active));
    if (now === last) return;
    last = now; stamps.push(performance.now());
    if (stamps.length === 4) resolve(stamps.slice(1).map((t, i) => Math.round(t - stamps[i])));
  }).observe(box, { subtree: true, attributeFilter: ['class'] });
}), { root: '.carousel', item: '.carousel-item', active: 'active' });
```

A cell where old and new differ is a regression unless the owner accepts it as its own class in the
review. Write the matrix to `nodes/vite-assets/review/behaviour.json` and put the same table on the
review page.

### 3. A fixture page for components outside the sample

The captured sample shows what its pages contain. Dropdowns, pagination, badges, `custom-file`,
alerts, input groups, form error states, summary or confirmation tables and similar components
often appear on no sampled page, or only in a state that was never captured. List every component
that the audit, the site's Sass or the templates name, then build an offline fixture page:

- `fixture-old.html` holds the markup the old templates emit, linked to the CSS built at the
  `pre-bootstrap` commit; `fixture-new.html` holds the migrated templates' markup, linked to the new
  build. Take the markup from rendered output, not from the Bootstrap documentation.
- Each component in its states: default, hover, focus, active, disabled, invalid (`is-invalid`,
  `was-validated`), and open for dropdowns.
- No network: local fonts, no CDN, served from a local static server or `file://`.
- Screenshot each component's box at every viewport with the pinned browser, then compare old and
  new with the harness's own comparator (`pixelmatch` and `pngjs` in the harness's `node_modules`).
  Strict zero, or the difference becomes a review class like any other.

### 4. Contract A identity for JavaScript behaviour

A native replacement for a jQuery or Bootstrap 4 plugin reproduces the old plugin exactly, quirks
included: timings and easing, start item, wrap-around, pause on hover, resize handling, the
attributes and classes it wrote into the DOM (they are part of the DOM comparison), and its
accessibility behaviour. A slider that ignored `prefers-reduced-motion` keeps ignoring it; honouring
it is a separate, optional Contract B change with its own approval after Contract A closes.

The same holds for incidental network requests. When the old plugin loaded a loading GIF or a
sprite, the replacement requests the same resource at the same moment, for instance by keeping the
CSS rule that referenced it. Otherwise the media adapters record a different source set and the
comparison reports `visual-media-source` findings, which no declared-change rule can cover:
declarations apply to the HTTP and DOM stages only.

### 5. No toolchain version pins as a shortcut

When the latest Sass (or PostCSS, Vite, Lightning CSS) computes a value differently, keep the latest
compiler and encode the old output. Example: a newer Sass shifts a colour computed with
`darken()`. Read the old value from the CSS built at `pre-bootstrap` and pin it as a literal in the
compatibility layer, with the expression it replaces in a comment:

```scss
// _bootstrap4-compat.scss: values the old compiler produced, kept literally
$link-hover-color: #1d5a8c; // was darken($primary, 15%) under the old Sass
```

The same rule applies to Vite's CSS output ([fix pack item 10](typo3-14-fix-pack.md#10-vite-5-to-8-rewrites-the-css)):
configuration and literal values, never an old toolchain version.

### 6. The review page shows the evidence, not only screenshots

`nodes/vite-assets/review/index.html` opens with the three results, before any screenshot pair:

1. the leftover audit: token × source × count before, count after, disposition;
2. the behaviour matrix: every component × interaction × viewport, old and new, differences first;
3. the fixture comparison: every component and state, with its pair and diff result.

The difference classes and the per-URL pairs follow. The owner's acceptance cites this page; an
acceptance given on screenshots alone does not cover a migration.

### What the checklist found on a real site

A two-language site, Bootstrap 4.6 → 5.3.8. Screenshots were identical at every viewport; the
checklist still found differences they did not show. Each was measured, then fixed:

1. Bootstrap 4's `a:hover` colour on linked cards was lost: restored in the compat layer.
2. Bootstrap 5 adds a 0.15 s colour transition on nav links and pagination links: removed.
3. Pagination focus and hover colours and the focus ring differ: Bootstrap 4 values restored.
4. An open dropdown toggle (`.btn.show`, `.btn.active`) lost its active shade while focused: restored.
5. Popper 1 set `will-change: transform` on open dropdown menus, which changes rendering: restored.
6. `form-group` was left in form partials (felogin included): replaced by `mb-3`; unused compat
   rules removed.
7. The native slider replacement kept the old plugin's quirks: autoplay despite
   `prefers-reduced-motion`, and the plugin's loading-class step that requests its loading GIF
   (otherwise undeclarable media-source findings, see section 4).

Dart Sass newer than 1.78 rounds tint and shade colours differently. The fix was a
`_bs4-literal-shades.scss` layer with the literal Bootstrap 4 button and alert shades, not a pinned
compiler (Sass 1.105.1 stayed in use).

Result after the fixes: database 0 Bootstrap 4 occurrences, 24/24 behaviour journeys identical at 3
viewports, 36/36 component fixture pairs identical, 360/360 screenshots identical. A
computed-style hover comparison over every link and button found items 1 and 2; run that check
explicitly, since neither shows in a screenshot of the resting state.

## Proof and handover

- The run's own loops: the invariance loop before the change, the final `compare-all` of the
  Bootstrap loop against `A-original` with the declared rules, then P11 as for every run.
- The before/after comparison of every URL that the owner accepted.
- The [migration checklist](#renaming-classes-is-not-enough--the-migration-checklist) results: the
  leftover audit with its rerun, the behaviour matrix and the fixture comparison.
- Behaviour journeys through `typo3-playwright` for every interactive component the inventory found
  (navigation toggle, dropdowns, collapse and accordion, tabs, modals, carousel, tooltips, form
  validation): the sentinels intake registered in `config/interactions.yml`, run on the migrated
  site; plus no jQuery request where it was removed, no console error and no failed asset request.
- Keyboard-focus screenshots show Bootstrap 5's focus ring: present it as its own class in the review.

The handover names the invariance proof and the accepted Bootstrap change separately (step 8).
