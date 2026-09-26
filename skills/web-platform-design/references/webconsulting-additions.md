# webconsulting integration: web-platform-design

This owned overlay corrects the focus-criteria mapping in the unmodified upstream guide.
Use the general platform patterns for the selected UI; TYPO3 remediation belongs to
`typo3-accessibility`, and a site-wide evidence run to `typo3-wcag22-aa-agentic`.

## WCAG 2.2 focus criteria

Do not report the upstream §1.4 two-pixel-area rule as an AA requirement:

- **2.4.7 Focus Visible (AA):** provide a visible keyboard-focus indicator.
- **2.4.11 Focus Not Obscured, Minimum (AA):** author content must not completely hide
  the focused component. **2.4.12 Enhanced (AAA)** addresses partial obscuring as well.
- **2.4.13 Focus Appearance (AAA):** its area requirement uses a two-CSS-pixel perimeter
  equivalent; the 3:1 measurement compares the same pixels between focused and unfocused
  states, not simply the outline against an adjacent color. Apply the criterion's exceptions.

Use a strong visible outline as design guidance, but distinguish the chosen design standard
from the WCAG level actually required and tested. Check **1.4.11 Non-text Contrast (AA)**
separately where applicable.

Sources: W3C [Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html),
[Focus Not Obscured, Minimum](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html).
Reviewed 2026-09-26; no browser or assistive-technology conformance run is implied.

## Attribution

The upstream platform skill remains credited to **ehmo** and byte-unchanged.
This correction is authored by webconsulting; it does not replace the upstream licence or credits.
