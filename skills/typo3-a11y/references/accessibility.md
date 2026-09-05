# Accessibility Standards

WCAG 2.2 Level AA compliance for TYPO3 sitepackage frontend code.

Where EN 301 549 conformance is contractually required: as of August 2026 the
harmonised version cited in the EU Official Journal is still
[v3.2.1](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/03.02.01_60/en_301549v030201p.pdf)
(cited 2021-08-12), which references WCAG 2.1 AA. Version 4.1.x adopts WCAG 2.2
AA and has cleared its approval vote, but it is not the cited version yet;
citation in the Official Journal is expected around late 2026. Check the current
citation before promising conformance to a particular version.

Building to WCAG 2.2 covers the WCAG part of both versions: everything in 2.1 is
also in 2.2, and the one criterion 2.2 dropped (4.1.1 Parsing) is treated as
always satisfied in 2.1 as well — see "WCAG 2.2 Additions" below. It is **not**
full EN 301 549 conformance on its own: the standard carries further clauses
(non-web documents and software, hardware, support documentation, ICT with
two-way voice or video) that WCAG does not address.

## Table of Contents

1. [Language and Page Metadata](#language-and-page-metadata) -- WCAG 3.1.1, 2.4.2
2. [Page Structure and Landmarks](#page-structure-and-landmarks) -- WCAG 1.3.1, 2.4.1
3. [Headings](#headings) -- WCAG 2.4.6, 1.3.2
4. [Links](#links) -- WCAG 2.4.4, 1.4.1
5. [Buttons](#buttons) -- WCAG 4.1.2, 1.3.1
6. [Color and Contrast](#color-and-contrast) -- WCAG 1.4.3
7. [CSS Units and User Preferences](#css-units-and-user-preferences) -- WCAG 1.4.4
8. [Focus Management](#focus-management) -- WCAG 2.4.7, 2.4.3, 2.1.2
9. [ARIA Reference](#aria-reference) -- WCAG 4.1.2
10. [Automated Accessibility Testing](#automated-accessibility-testing) -- incl. hover/focus states
11. [WCAG 2.2 Additions](#wcag-22-additions) -- WCAG 2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8
12. [Responsive Accessibility](#responsive-accessibility) -- WCAG 2.5.8
13. [Content Element Checklist](#content-element-checklist)

Cross-references to dedicated pattern files:
- `patterns-skiplinks.md` -- Skip link navigation
- `patterns-clickable-cards.md` -- Clickable card patterns
- `patterns-accessible-navigation.md` -- Navigation patterns
- `patterns-disclosure-widget.md` -- Disclosure and accordion
- `patterns-accessible-forms.md` -- Form patterns
- `patterns-accessible-filter.md` -- Filtering and tables
- `patterns-responsive-tables.md` -- Mobile table patterns

---

## Language and Page Metadata

### Natural Language

Set `lang` on `<html>` -- affects screen reader pronunciation, hyphenation, quotation marks, and translation tools. In TYPO3, this is handled via site configuration.

```html
<html lang="{siteLanguage.locale.languageCode}">
```

For inline foreign-language text, set `lang` on the containing element:

```html
<p>The term <span lang="ja-Latn">Kaizen</span> means continuous improvement.</p>
```

Use sparingly -- frequent voice profile switches interrupt reading flow. Well-established loanwords (Download, Workshop, Link) don't need it.

### Page Title

Every page must have a unique, descriptive `<title>`, under 60 characters, page name first (`Products - Shop Name`, not `Shop Name - Products`). In TYPO3, this comes from `config.pageTitleFirst = 1` and the page title field. Include context where it matters, e.g. `Checkout (step 3 of 4) - Shop Name` or `21 results for "term" - Site Name`.

### Viewport

Only this viewport meta tag is allowed:

```html
<meta name="viewport" content="width=device-width, initial-scale=1">
```

**Never use:**
- `user-scalable=no` -- disables zoom for low-vision users
- `maximum-scale=1` -- disables zoom in some browsers
- Fixed width values like `width=500`

---

## Page Structure and Landmarks

### Landmarks

Every page layout must contain these semantic regions: `<header id="main-header">` (banner), `<nav>` (navigation), `<main id="main-content">` (main), `<aside>` (complementary), `<footer id="main-footer">` (contentinfo). These ids are the skip-link targets -- see `patterns-skiplinks.md`.

### Navigation Landmarks

Significant groups of links must be wrapped in `<nav>` with a label:

```html
<nav aria-label="{f:translate(key: 'mainNavigation', extensionName: 'my_sitepackage')}">
<nav aria-label="{f:translate(key: 'breadcrumb', extensionName: 'my_sitepackage')}">
<nav aria-label="{f:translate(key: 'footerNavigation', extensionName: 'my_sitepackage')}">
```

### Form Landmarks

Search forms are landmarks -- use `role="search"` or the `<search>` element:

```html
<search>
    <form action="/search" method="get">
        <label for="search-input" class="visually-hidden">
            <f:translate key="searchLabel" extensionName="my_sitepackage" />
        </label>
        <input type="search" id="search-input" name="q"
               placeholder="{f:translate(key: 'searchPlaceholder', extensionName: 'my_sitepackage')}">
        <button type="submit">
            <f:translate key="searchSubmit" extensionName="my_sitepackage" />
        </button>
    </form>
</search>
```

### Label Landmarks

When multiple landmarks of the same type exist, label them to differentiate:

```html
<nav aria-label="Main navigation">...</nav>
<nav aria-label="Footer navigation">...</nav>
```

Without labels, screen reader users cannot distinguish between multiple `<nav>` elements.

---

## Headings

- Exactly one `<h1>` per page
- Never skip heading levels (`<h1>` then `<h3>` without `<h2>`)
- Headings create the document outline -- screen reader users navigate by headings
- Every content section should start with a heading

DOM order must match visual order -- see [Preserve Order](#preserve-order) below for the CSS properties that break this.

---

## Links

### Link vs. Button Decision

Use `<a href>` to navigate (URL, anchor, download), `<button>` to trigger an action on the current page (toggle, submit, open dialog).

**Never:**
- Use `<div onclick>` or `<span onclick>` as links or buttons
- Use `<a>` without `href` (removes it from tab order)
- Use `<a href="javascript:void(0)">` -- use `<button>` instead
- Use `<button>` for navigation -- use `<a>` instead

### Link Styling

Links in body text **must be underlined**. Color alone is not sufficient -- 8% of men have color vision deficiencies and cannot distinguish link color from text color.

```scss
// Basic/_links.scss

// Links in running text must be underlined
.ce-textmedia,
.news-detail__content,
.accordion-body {
    a:not([class]) {
        text-decoration: underline;
        text-underline-offset: 0.1875rem;

        &:hover {
            text-decoration-thickness: 0.125rem;
        }
    }
}

// Navigation links are exempted (context makes purpose obvious)
.nav-link,
.btn {
    text-decoration: none;
}
```

### Download and Email Links

Download links must state file type and size: `<a href="/files/report.pdf" download>Annual Report 2024 (PDF, 2.4 MB)</a>`. Email links must show the address as visible text -- `<a href="mailto:info@example.com">info@example.com</a>`, not `<a href="mailto:info@example.com">Contact us</a>`.

### Linked Images

The image `alt` text becomes the link's accessible name:

```html
<!-- Logo link to homepage -->
<a href="/">
    <img src="/logo.svg" alt="Company Name - Back to homepage">
</a>

<!-- Image + text link: empty alt to avoid redundancy -->
<a href="/products/widget">
    <img src="/widget.jpg" alt="">
    Widget Pro 3000
</a>
```

### Links Opening in New Window

When using `target="_blank"`, inform users:

```html
<a href="https://external.com" target="_blank"
   rel="noopener noreferrer">
    External Resource
    <span class="visually-hidden">(opens in new tab)</span>
</a>
```

Never open links in new tabs without indication.

### Client-Side Rendering

Not applicable for standard TYPO3 sitepackages (server-side rendering). If using JS-heavy frontend components that manipulate history: ensure focus management on route changes and update `<title>` dynamically.

### Clickable Card Patterns

See `references/patterns-clickable-cards.md` for the recommended pseudo-element stretch pattern and why the naive alternatives (wrap-in-`<a>`, duplicate links, overlay) fail.

---

## Buttons

### Button Labeling

Every button must have an accessible name -- text content is best (`<button>Save changes</button>`). For icon-only buttons, prefer visually-hidden text over `aria-label`:

```html
<button type="button">
    <svg aria-hidden="true">...</svg>
    <span class="visually-hidden">Close dialog</span>
</button>
```

**Never** use `title` as the only accessible name for buttons.

### Resetting Button Styles

When buttons need custom styling, reset properly but keep focus styles:

```scss
.btn-reset {
    appearance: none;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;

    &:focus-visible {
        outline: 0.1875rem solid $primary;
        outline-offset: 0.125rem;
    }
}
```

CSS `all: unset` also works but removes ALL styles including focus -- always re-add focus styles.

### Button States and Properties

Toggle buttons (`aria-expanded` + `aria-controls`) and disclosure triggers are covered with full Fluid/TS implementations in `patterns-disclosure-widget.md` and `patterns-accessible-navigation.md`. For toolbar toggles (bold/italic), use `aria-pressed`; for buttons that open a popup or menu, add `aria-haspopup`. Update the attribute via JavaScript on every toggle, not just on init.

### Don't Disable Buttons

**Never use `disabled` on submit buttons.** Disabled buttons:
- Are not focusable -- keyboard users cannot find them
- Have no hover state -- users get no feedback why they can't submit
- Have low contrast by default -- hard to read
- Provide no explanation of WHY they are disabled

Instead: keep the button enabled, validate on click, and show error messages:

```html
<!-- Bad -->
<button type="submit" disabled>Submit</button>

<!-- Good: always enabled, show errors on click -->
<button type="submit">Submit</button>
```

---

## Color and Contrast

### Minimum Contrast Ratios (WCAG AA)

| Element | Ratio |
|---|---|
| Normal text (<24px, or <18.66px bold) | 4.5:1 |
| Large text (>=24px, or >=18.66px bold) | 3:1 |
| UI components (borders, icons, focus indicators) | 3:1 |

The large-text threshold is 18pt / 14pt bold, which is **24 CSS px and
18.66 CSS px** — not 18px. A 16px/600 button label is normal text and needs
4.5:1, which is where most brand palettes fail.

### Two goals, not one

Contrast evaluation answers two independent questions. Keep them apart:

1. **Compliance.** Every text-bearing combination MUST meet WCAG 2.2 AA. Where
   EN 301 549 applies, WCAG 2.1 AA is the referenced baseline; its contrast
   requirements are identical.
2. **Perceptual readability.** APCA (the Accessible Perceptual Contrast
   Algorithm) SHOULD additionally be measured for saturated colours, dark mode,
   light-on-dark text, borderline WCAG pairs and small or thin typography. Its
   Lc thresholds are read against the actual font size and weight — there is no
   single "Lc 60 is fine" value.

**An APCA pass MUST NOT waive a WCAG failure** where WCAG or EN conformance is
required. APCA is not a normative standard: the
[WCAG 3 working draft of 2026-03-03](https://www.w3.org/TR/wcag-3.0/) names no
contrast algorithm, so "APCA will be the WCAG 3 algorithm" is not a claim to
build a policy on.

Two things that are commonly said about this and are wrong:

- *"WCAG tracks blue poorly because its blue coefficient is only 0.0722."* The
  coefficients model human luminance perception, and APCA uses the same ones
  (0.2126 / 0.7152 / 0.0722). APCA differs in the transfer curve, in treating
  light-on-dark and dark-on-light asymmetrically, in its handling of very dark
  colours, and in factoring in font size and weight — not in the coefficients.
- *"Use your own eyeballs."* Personal visual preference is not an accessibility
  test. A developer with typical vision is not the population whose borderline
  cases are being judged. Measure WCAG, measure APCA in addition, and where a
  case stays contentious, test with affected users.

Rules:
- Never convey information through color alone -- always add icons, patterns, underlines, or text
- Test all Bootstrap theme color combinations against their backgrounds
- Test with Chrome DevTools color contrast tools and emulated color deficiencies
- Measure the **rendered** page, not the stylesheet: a translucent colour has no
  ratio of its own, and an element over a gradient has no `backgroundColor` to
  read. Run axe-core against the built output, in a real browser, in both colour
  schemes.

```scss
// Verify these combinations in your theme:
$primary: #0069b4;    // Must have 4.5:1 against $white for text
$secondary: #d1530f;  // Must have 4.5:1 against $white for text
$danger: #dc3545;     // Must have 4.5:1 against $white for text
```

---

## CSS Units and User Preferences

### Relative Units Only

`rem` for font sizes/spacing/margins/media queries, `em` for component-relative sizing (icon size relative to text), never `px` except 1px borders and box-shadows. Users who set larger browser font sizes must get proportionally larger layouts; at 200% zoom, no content loss or horizontal scrolling may occur.

### Media Queries for User Settings

Respond to these user preferences via CSS media queries: `prefers-color-scheme: dark` (swap colors, adjust image brightness/contrast), `prefers-contrast: more` (thicken borders, remove subtle backgrounds), `prefers-reduced-transparency: reduce` (replace semi-transparent overlays with solid colors).

`forced-colors: active` (Windows High Contrast Mode) is the one that trips projects up: the browser overrides all colors, so custom backgrounds and box-shadows disappear -- ensure layouts still work with borders as the primary visual structure, and don't override system colors.

```scss
// Basic/_accessibility.scss
@media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
}
```

When adding animations, provide a subtle fallback (e.g., opacity fade) for reduced-motion users instead of removing all animation. For animation patterns with `prefers-reduced-motion` support, see `references/patterns-animations.md`.

### `display: contents` Danger

`display: contents` removes the element's box from layout but **also removes its semantics** from the accessibility tree in some browsers.

**Never use on:**
- `<button>` -- loses button role
- `<a>` -- loses link role
- `<table>`, `<tr>`, `<td>` -- loses table structure
- Any interactive element

**Safe to use on:**
- Wrapper `<div>` or `<span>` that exist only for layout purposes

### `list-style: none` Removes List Semantics

Safari + VoiceOver removes list semantics when `list-style: none` is applied. Fix by adding `role="list"` explicitly:

```scss
// When using list-style: none, ALWAYS add role="list" in the template
.nav-list,
.skiplinks__list,
.breadcrumb,
.pagination {
    list-style: none;
}
```

```html
<!-- Required in Fluid when list-style: none is used -->
<ul class="nav-list" role="list">
    <li>...</li>
</ul>
```

---

## Focus Management

### Focus Styles

All interactive elements must have visible focus indicators:

```scss
// Basic/_accessibility.scss
*:focus-visible {
    outline: 0.1875rem solid $primary;
    outline-offset: 0.125rem;
}

*:focus:not(:focus-visible) {
    outline: none;
}
```

`:focus-visible` shows focus only for keyboard navigation, not mouse clicks. The outline must have 3:1 contrast against adjacent colors.

### Making Elements Focusable

| Attribute | Behavior | Use case |
|---|---|---|
| No tabindex | Native focusable elements (`<a href>`, `<button>`, `<input>`) | Default |
| `tabindex="0"` | Adds to natural tab order | Custom interactive elements |
| `tabindex="-1"` | Focusable via JS `.focus()` only | Programmatic focus targets |
| `tabindex="1+"` | **Never use** | Overrides natural order, creates chaos |

### Moving Focus

When opening modals, drawers, or overlays:
1. Save the previously focused element
2. Move focus to the new content (first focusable element or the container itself)
3. When closing, return focus to the saved element

```typescript
function openDialog(dialog: HTMLElement, trigger: HTMLElement): void {
    const previousFocus = document.activeElement as HTMLElement;

    dialog.removeAttribute('hidden');
    dialog.querySelector<HTMLElement>('[autofocus], button, a, input')?.focus();

    dialog.addEventListener('close', () => {
        previousFocus?.focus();
    }, { once: true });
}
```

### Focus Containment with `inert`

The modern alternative to manual focus trapping is the `inert` attribute:

```typescript
function openModal(modal: HTMLElement): void {
    document.querySelectorAll('body > *:not(.modal-overlay)').forEach((el) => {
        el.setAttribute('inert', '');
    });
    modal.removeAttribute('inert');
    modal.querySelector<HTMLElement>('[autofocus], button')?.focus();
}

function closeModal(modal: HTMLElement, trigger: HTMLElement): void {
    document.querySelectorAll('[inert]').forEach((el) => {
        el.removeAttribute('inert');
    });
    trigger.focus();
}
```

`inert` makes elements non-focusable AND invisible to screen readers. For legacy browser support, keep the manual `trapFocus()` function as fallback:

```typescript
function trapFocus(element: HTMLElement): void {
    const focusable = element.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    element.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });
    first?.focus();
}
```

### Preserve Order

DOM order must match visual order -- content must make sense without CSS. CSS properties that break this:
- `order` in Flex/Grid (visual reorder for responsive layout is OK if DOM stays logical)
- `flex-direction: row-reverse` / `column-reverse`
- `tabindex` values > 0 to override tab order
- `position: absolute` moving elements visually out of sequence
- CSS `float` tricks that put content before its heading in the DOM

### Skip Links

See `references/patterns-skiplinks.md`. Mandatory for every page.

### Keyboard Navigation Summary

| Key | Action |
|---|---|
| `Tab` / `Shift+Tab` | Sequential focus navigation |
| `Enter` / `Space` | Activate button or link |
| `Escape` | Close dropdown, modal, popover |
| Arrow keys | Navigate within tabs, accordions (optional enhancement) |

---

## ARIA Reference

### Core ARIA Patterns

ARIA creates relationships between elements using ID references:

```html
<!-- aria-labelledby: element labeled BY another element -->
<div role="region" aria-labelledby="section-title">
    <h2 id="section-title">Latest News</h2>
</div>

<!-- aria-describedby: element described BY another element -->
<input type="email" aria-describedby="email-help">
<p id="email-help">We'll never share your email.</p>
```

`aria-controls` follows the same ID-reference pattern -- see `patterns-disclosure-widget.md` and `patterns-accessible-navigation.md` for real `aria-expanded`/`aria-controls` toggles.

### ARIA Rules

1. **Don't use ARIA if native HTML works** -- `<button>` over `<div role="button">`
2. **Don't change native semantics unnecessarily** -- don't add `role="button"` to `<a>`
3. **All interactive ARIA elements must be keyboard accessible**
4. **Don't use `role="presentation"` or `aria-hidden="true"` on focusable elements**
5. **All interactive elements must have an accessible name**

### Images

```html
<!-- Informative image -->
<img src="..." alt="Description of what the image shows">

<!-- Decorative image (empty alt is sufficient, role="presentation" is optional) -->
<img src="..." alt="">
```

Complex images (charts, infographics) need a longer description: pair a brief `alt` with a `<figcaption>` referenced via `aria-describedby`.

### Live Regions

For dynamic content updates that screen readers should announce:

```html
<!-- Polite: announced at next pause (filter results, form/process status) -->
<div aria-live="polite" aria-atomic="true">
    3 results found
</div>

<!-- Assertive: interrupts immediately (errors, urgent alerts) -->
<div role="alert">
    Session expires in 2 minutes
</div>
```

`role="status"` is shorthand for `aria-live="polite" aria-atomic="true"` -- use it for form/save confirmations.

---

## Automated Accessibility Testing

### axe-core Integration

Add automated accessibility testing to Playwright:

```typescript
// tests/e2e/accessibility.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const pages = ['/', '/contact', '/news'];

for (const page of pages) {
    test(`has no critical a11y violations on ${page}`, async ({ page: browserPage }) => {
        await browserPage.goto(page);
        const results = await new AxeBuilder({ page: browserPage })
            .withTags(['wcag2a', 'wcag2aa', 'best-practice'])
            .analyze();
        expect(results.violations).toEqual([]);
    });
}
```

Install: `npm install --save-dev @axe-core/playwright` in the root project, and run it as part of the CI pipeline.

### Custom Debugging Selectors

```css
/* Find images without alt */
img:not([alt]) { outline: 0.25rem solid red !important; }

/* Find links without accessible text */
a:empty:not([aria-label]):not([aria-labelledby]) { outline: 0.25rem solid red !important; }

/* Find buttons without accessible text */
button:empty:not([aria-label]):not([aria-labelledby]) { outline: 0.25rem solid red !important; }

/* Find missing lang attribute */
html:not([lang]) { outline: 0.25rem solid red !important; }
```

### Interactive states are not covered by any of the above

axe, a static CSS checker and a screenshot all measure the page at rest. A hover,
focus or active colour is a different set of pairs, it is where a generic rule
quietly repaints something it was never meant to touch, and nothing above will
ever look at it. Three real AA failures found this way in one sitepackage, none
of them visible to a resting-page audit: a skip link at 1.77:1 because `a:hover`
overrode its own white label, CTA buttons at 1.13:1 for the same reason (a button
is usually an anchor), and white hero text at 2.00:1 in dark mode because the
gradient's second stop borrowed a text token, which lifts on a dark surface.

Force the states through the Chrome DevTools Protocol and measure the resolved
cascade:

```javascript
const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable'); await cdp.send('CSS.enable');

// A transition makes getComputedStyle return the value from BEFORE the change,
// so a probe reports "nothing changed" and passes everything. Kill them first.
await page.addStyleTag({ content: '*,*::before,*::after{transition:none !important;animation:none !important}' });

const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
const { nodeIds } = await cdp.send('DOM.querySelectorAll', {
    nodeId: root.nodeId,
    selector: 'a, button, input, textarea, select, summary, [tabindex]',
});

for (const state of ['hover', 'focus-visible']) {
    for (const nodeId of nodeIds) {
        // One element at a time. Forcing the whole set at once produces a state a
        // user can never reach — every control hovered simultaneously — and any
        // ancestor, sibling or :has() selector then resolves against that fiction.
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [state] });
        try {
            // …measure this one element's contrast here
        } finally {
            // Always reset, or the forced state leaks into every later measurement
            // and into the screenshots taken afterwards.
            await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
        }
    }
}
```

Two rules that decide whether the result means anything:

- **Force the pseudo-state; do not apply the rule's declarations inline.** An
  inline style beats more specific rules, so `a:hover` gets applied to a footer
  link that `.footer a:hover` actually governs, and the probe invents failures
  that do not exist.
- **One element at a time, and always reset.** Forcing every control at once is a
  state no user can reach, and a `:has()`, sibling or ancestor selector will
  resolve against it; a forced state left behind then contaminates everything
  measured after it.
- **Make the probe prove it can move something.** Read one known colour before
  and after forcing, and report that alongside the result. A run that finds
  nothing because it changed nothing looks exactly like a clean run.

### Linter Rules

Add accessibility Stylelint rules to `Build/.stylelintrc.json`:

```json
{
    "plugins": ["stylelint-a11y"],
    "rules": {
        "a11y/media-prefers-reduced-motion": true,
        "a11y/no-outline-none": true,
        "a11y/no-text-size-adjust": true
    }
}
```

---

## WCAG 2.2 Additions

These success criteria are new in WCAG 2.2 and affect sitepackage frontend code
directly. The table states each criterion in the short form you need while
writing code. Every one of them carries exceptions that decide real cases; the
links go to the W3C Understanding pages, which are informative — the normative
wording is in [WCAG 2.2](https://www.w3.org/TR/WCAG22/) itself. Read one of the
two before calling something a failure.

| SC | Level | What it requires |
|---|---|---|
| [2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html) | AA | A focused element must not be entirely hidden by author content. A sticky header is the usual offender — see `patterns-sticky-header.md` and `scroll-padding-top`. |
| [2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) | AA | Anything operated by dragging (sliders, reorderable lists, map panning) also works with a single pointer without dragging — unless the dragging is **essential**, or the behaviour is the **user agent's** and unmodified by the author (scrollbars, touch scrolling). |
| [2.5.8 Target Size (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | AA | Pointer targets are at least 24x24 CSS px, with five exceptions (below). |
| [3.2.6 Consistent Help](https://www.w3.org/WAI/WCAG22/Understanding/consistent-help.html) | A | Help mechanisms repeated across pages appear in the same relative order. |
| [3.3.7 Redundant Entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html) | A | Do not ask for the same information twice in one process — auto-populate it or offer it for selection. |
| [3.3.8 Accessible Authentication (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html) | AA | No cognitive-function test (puzzle, transcription, memorisation) in an authentication step, unless that step offers an **Alternative** method without one, a **Mechanism** that assists in completing it, or the test is **Object Recognition** or **Personal Content** the user supplied. Do not block paste into password fields. |

SC 2.5.8's five exceptions, of which only the first two come up in a
sitepackage: **Spacing** (a 24px circle centred on each undersized target's
bounding box does not intersect another target's), **Inline** (the target sits
in a sentence, or its size is constrained by the line-height of surrounding
non-target text), **Equivalent** (the same function is reachable through a
conforming control on the page), **User Agent Control** (the size is the user
agent's and the author does not modify it) and **Essential**.

4.1.1 Parsing is the only criterion 2.2 **removed**, and it is not a gap when
working to a 2.1 obligation: the WCAG 2.0 and 2.1 errata carry the same note,
"[This Success Criteria should be considered as always satisfied for any content
using HTML or XML](https://www.w3.org/WAI/standards-guidelines/wcag/faq/)". So
duplicate `id` values no longer fail on their own under any current version —
keep them unique anyway, because what used to fail here may fail other criteria,
such as 1.3.1 or 4.1.2.

## Responsive Accessibility

### Touch Targets

WCAG 2.2 SC 2.5.8 (Target Size, Minimum) requires 24x24 CSS px at AA; 44x44 is
the AAA target of SC 2.5.5 and the sensible default for touch:

```scss
@media (pointer: coarse) {
    .btn,
    .nav-link,
    .dropdown-item,
    .form-check-label {
        min-height: 2.75rem;
        min-width: 2.75rem;
    }
}
```

---

## Content Element Checklist

For every new content element, verify:

- [ ] Page has unique, descriptive `<title>`
- [ ] `lang` attribute set on `<html>` (and inline foreign text where needed)
- [ ] Viewport allows zoom (no `user-scalable=no` or `maximum-scale=1`)
- [ ] Heading hierarchy is correct (no skipped levels, one `<h1>`)
- [ ] DOM order matches visual order
- [ ] All images have meaningful `alt` text (or `alt=""` if decorative)
- [ ] Links in body text are underlined
- [ ] Download links show file type and size
- [ ] Links opening in new tab inform users
- [ ] Buttons have accessible names (no empty icon buttons)
- [ ] Buttons are never `disabled` -- validate on click instead
- [ ] Interactive elements use correct element (`<a>` vs `<button>`)
- [ ] Interactive elements are keyboard-accessible
- [ ] ARIA attributes are correct and complete
- [ ] `aria-expanded` toggles on disclosure triggers
- [ ] Color contrast meets WCAG AA (4.5:1 normal text, 3:1 large text >=24px / >=18.66px bold, 3:1 UI), measured on the rendered page
- [ ] Information is not conveyed by color alone
- [ ] Focus order follows visual/DOM order
- [ ] Focus indicator is visible (3:1 contrast)
- [ ] `prefers-reduced-motion` disables animations
- [ ] `forced-colors` does not break layout
- [ ] Touch targets are at least 44x44px
- [ ] `list-style: none` lists have `role="list"`
- [ ] Form fields have associated `<label>`
- [ ] Error messages are announced to screen readers (`aria-live` or `role="alert"`)
- [ ] Live regions announce dynamic content updates
- [ ] Labels exist in both DE and EN
- [ ] axe-core Playwright test passes

---

## Recommended Reading

*Web Accessibility Cookbook* by Manuel Matuzovic (O'Reilly, 2024) -- comprehensive guide to web accessibility with practical recipes.
