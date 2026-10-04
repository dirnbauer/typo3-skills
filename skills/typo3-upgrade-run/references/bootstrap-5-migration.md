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
| Classes in stored content | `tt_content.bodytext` and other rich-text fields, the RTE preset's styles and `contentsCss` | stored content stays unchanged; the compatibility layer styles it |
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
   evidence lists the commits.
4. **Compare every URL** at the run's viewports:

   ```bash
   t3u capture --loop <MMM> --label bootstrap-5
   t3u compare-all --loop <MMM> --before pre-bootstrap --after bootstrap-5
   ```

   HTTP and DOM cover every URL, the screenshots the sealed sample in its states; repeat the extra
   screenshots of step 2 for the other URLs. The findings are the review's content, not a failure.
5. **Review with the owner.** Build one page under `nodes/vite-assets/review/`: each difference class
   first, with one before/after pair and its affected URLs (a class is one cause: one variable, one
   component default, one markup pattern; [rule 40.2](../rules/40-approval-matrix.md#402-approval-granularity-for-rendering-changes)),
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

## Proof and handover

- The run's own loops: the invariance loop before the change, the final `compare-all` of the
  Bootstrap loop against `A-original` with the declared rules, then P11 as for every run.
- The before/after comparison of every URL that the owner accepted.
- Behaviour journeys through `typo3-playwright` for every interactive component the inventory found
  (navigation toggle, dropdowns, collapse and accordion, tabs, modals, carousel, tooltips, form
  validation): the sentinels intake registered in `config/interactions.yml`, run on the migrated
  site; plus no jQuery request where it was removed, no console error and no failed asset request.
- Keyboard-focus screenshots show Bootstrap 5's focus ring: present it as its own class in the review.

The handover names the invariance proof and the accepted Bootstrap change separately (step 8).
