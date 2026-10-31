# 17. Accessibility

Continues `typo3-records-list-types` from [full guide](full-guide.md).

## 17. Accessibility

- **Keyboard drag-and-drop**: Space/Enter to grab, arrows to move, Space/Enter to drop, Escape to cancel
- **ARIA live regions**: Announce drag state and position ("Position 3 of 12")
- **Semantic markup (shipped)**: when a table is reorderable, `GridView.html` sets `role="listbox"` with `aria-label` and `aria-describedby` on the card container and `Card.html` sets `role="option" aria-grabbed="false"` on each card; the drag handle is a `role="button"` inside the option (v2.0.2).
- **Proposal, not shipped**: the ARIA grid pattern (`role="grid"` / `role="row"` / `role="gridcell"`) would fit better, because an `option` is not meant to contain separate interactive controls such as drag handles and action buttons. Test the shipped listbox pattern with a screen reader before promising editors a specific announcement.
- **Focus management**: Visible focus indicators, proper tab order
