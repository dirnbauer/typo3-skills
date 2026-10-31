# 7. Testing & Tools / Spot-checking the page you changed

## Contents

- [7.1 Spot check of the page you changed](#71-spot-check-of-the-page-you-changed)
- [7.2 Reusable Audit Script](#72-reusable-audit-script)
- [7.3 Tools](#73-tools)

## 7.1 Spot check of the page you changed

Run this after fixing markup on a page: one URL (plus its other language variants when the fix
touched a shared template), the default viewport and one narrow viewport, WCAG 2.2 A/AA tags.
It proves the fix on that page; it is not a site audit. When the user asks for a WCAG 2.2
conformance audit of a site, a URL inventory, a CI baseline, a report or the accessibility
statement, hand over to `typo3-wcag22-aa-agentic`.

1. Run `scripts/wcag22_audit.cjs` (section 7.2) against the changed URL, then once more with
   `--viewport 390x844`. The script runs axe-core, the structural checks (`lang`, one `h1`, no
   skipped heading levels, landmarks, skip link, `alt`, `user-scalable`) and a Tab-order probe.
2. Fix every `violation` in the template, CSS, JavaScript, TCA or content, and rerun.
3. Review `incomplete` items: resolve `color-contrast` with the computed values the script
   prints, and check `target-size` candidates against the 24x24 CSS px minimum and its spacing
   exception. An `incomplete` item is evidence to review, not a pass.
4. Report the command, the script's version line, the URLs and viewports, each finding with its
   state (fixed, documented, left to a person), and the files changed.

Leave to the user only what a spot check cannot settle: screen-reader confirmation with their
browser and assistive technology (VoiceOver/Safari, NVDA/Firefox, JAWS/Chrome), touch testing on
a real device where a target-size exception depends on it, and the content of PDFs, videos and
third-party embeds on the page.

## 7.2 Reusable Audit Script

Use `scripts/wcag22_audit.cjs` for rendered-page checks. It launches Chrome through Playwright, injects axe-core, runs WCAG 2.0/2.1/2.2 A/AA tags, performs structural checks, reviews resolvable color-contrast `incomplete` nodes, and runs a basic real-Tab keyboard probe.

Install temporary dependencies in the audited project when needed:

```bash
npm install --no-save playwright axe-core
```

Run against one or more DDEV URLs:

```bash
node /path/to/skills/typo3-accessibility/scripts/wcag22_audit.cjs \
  --url https://example.ddev.site/accessibility/ \
  --url https://example.ddev.site/de/barrierefreiheit/ \
  --out var/transient/wcag22-audit.json \
  --markdown var/transient/wcag22-audit.md
```

Options: `--viewport WIDTHxHEIGHT` sets the browser viewport (default `1280x900`; run a second
pass with a narrow viewport such as `390x844` for user-facing pages). `--no-keyboard` skips the
basic Tab-order probe, for pages where a consent dialog or redirect makes the probe meaningless.

Interpretation:

- Exit `0`: no automated axe violations. Still review `incomplete`, script warnings, and human follow-up.
- Exit `2`: axe found violations. Fix or document each one.
- `incomplete` is evidence to review, not evidence to pass. `color-contrast` incomplete items include computed contrast evidence where Chromium exposes parsable foreground/background colors.
- The script separates likely inline-text target-size exceptions from unresolved small target candidates; inspect any remaining candidates before escalating them to the user.

## 7.3 Tools

### Automated Testing

| Tool | Use |
|------|-----|
| `axe-core` / `axe DevTools` | Automated WCAG checks; use tags for WCAG 2.2 A/AA where available |
| `pa11y` | CLI accessibility testing for CI/CD |
| `Lighthouse` | Chrome DevTools audit (Accessibility score) |
| `WAVE` | Browser extension for visual feedback |

### Manual Testing Checklist

1. **Keyboard only**: Navigate entire page using Tab, Shift+Tab, Enter, Escape, Arrow keys
2. **Screen reader**: Test with VoiceOver (macOS), NVDA/JAWS (Windows)
3. **Zoom**: Verify layout at 200% and 400% zoom
4. **Color**: Use browser dev tools to simulate color blindness
5. **Reduced motion**: Enable `prefers-reduced-motion: reduce` in OS settings

### Pa11y CI Integration

```bash
# Run against local DDEV instance
npx pa11y https://mysite.ddev.site --standard WCAG2AA --reporter cli
```

```json
// .pa11yci.json
{
    "defaults": {
        "standard": "WCAG2AA",
        "timeout": 30000,
        "wait": 2000
    },
    "urls": [
        "https://mysite.ddev.site/",
        "https://mysite.ddev.site/contact",
        "https://mysite.ddev.site/news"
    ]
}
```
