# Design-system page anatomy

Read this reference before drafting or reviewing the overview page.

## Observed reference features

The Scioflex Hydrogen reference page demonstrates this complete flow:

1. Branded intro hero with version, system purpose, main claim, and material visual.
2. Contrast evidence that separates protected logo color from accessible functional color.
3. Semantic swatches and a labelled 950–50 brightness ramp.
4. Display and body typography specimens plus licence and embedding guidance.
5. Foundation/component rules demonstrated with real controls and visible focus behavior.
6. A restrained signature visual that connects the brand story to the subject matter.
7. Downloads for a one-page PDF, `design.md`, and `tokens.json`.
8. An immediately readable fact overview before the complete source documents.
9. Accessible accordions and converted/original tabs for both source documents.
10. A creator credit and separate normal site footer.

Use this as an anatomy checklist, not as content to copy. Derive every word, number, token, font,
and visual rule from the selected TYPO3 installation.

## Intro contract

Answer four questions above the fold:

- Whose system is this?
- What artifacts and channels does it govern?
- What is the single main message?
- What visual evidence makes the system recognizable?

Use a real version identifier. Keep the supporting visual text-free so the page remains responsive
and localizable.

## Conditional contrast evidence

Show a dedicated proof when a protected brand color cannot serve a common functional role or when
the distinction prevents misuse. Include:

- foreground and background tokens/hex values;
- calculated ratio;
- WCAG threshold and affected text/UI size;
- allowed uses of the protected color;
- accessible replacement with its ratio.

If all intended pairs pass and roles are unambiguous, integrate the ratios into the color section
instead of inventing a warning panel.

## Colors, type, and foundations

Document semantic roles before raw hex values. A useful color system normally distinguishes brand,
action, hover/active, link, focus, text, muted text, canvas, surface, border, success, warning, and
error. Include the project's full ramp rather than extrapolating unapproved shades.

Show typography as used, not as a font list. Include H1–H4, body, small text, labels, method/code or
data styles, weights, line heights, tracking, fallbacks, self-hosting, web licence, print licence,
and PDF embedding rights.

Move from foundations to representative components: spacing/grid, surfaces, borders, focus and
targets; then links, buttons, fields, selects, navigation, tables, alerts, cards/containers, and
project-specific Content Blocks. Use rendered examples where they teach more than prose.

## “Das System im Überblick” facts

Publish eight compact, evidence-backed facts in this order:

1. **Brand attitude:** voice, evidence standard, and claims to avoid.
2. **Logo:** master asset, protected invariants, clear space, minimum size, and backgrounds.
3. **Color:** protected brand role versus functional roles and key contrast decisions.
4. **Typography:** display/body/data roles, weights, tracking, licences, and forbidden substitutes.
5. **Imagery:** preferred subjects, lighting/treatment, and clichés to avoid.
6. **Layout and signature:** grid, axes, surfaces, whitespace, and distinctive motif.
7. **Components:** action height, focus, links, state communication, and grouping logic.
8. **Accessibility and media:** contrast, targets, alternatives, headings, keyboard, zoom, motion,
   print, and PDF/UA status.

Do not treat these facts as marketing cards. Use plain articles with headings, strong alignment,
and sufficient separation. Each fact must trace back to `design.md`, `tokens.json`, or an audited
asset/implementation.

## Files and document viewers

Place direct download links before the long documents. Then expose each source in an accessible
`details` element. If both a formatted view and original source are offered, implement them as a
real tablist with unique IDs, correct `aria-selected`, roving `tabindex`, arrow-key support, and a
no-JavaScript-readable fallback.

## Creator credit

Separate the creator credit from the normal site footer. Use the current Webconsulting logo and a
short scope statement such as design system, implementation, web, and print. Keep the block quiet,
link the logo when approved, and omit full-width teal rules or unrelated decorative branding.
