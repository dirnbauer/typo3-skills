---
name: typo3-a11y
description: "Use when building accessible navigation, forms, filters, tables, skip links, disclosure widgets, or reviewing frontend code for accessibility in TYPO3 v13/v14 LTS projects. Also covers frontend implementation patterns: sticky header, lazy loading, breadcrumb, language switcher, animations, scroll-to-anchor, skeleton loading, toast notifications, back-to-top. Covers WCAG 2.2 AA: ARIA attributes, focus management, keyboard navigation, screen reader support, color contrast, link identification, heading hierarchy, native dialog element modal (#107443), Camino theme a11y."
---

# TYPO3 Accessibility Skill

WCAG 2.2 Level AA compliance standards for TYPO3 v13 and **v14.3 LTS** sitepackage frontend development. EN 301 549 still cites 2.1 AA; 2.2 covers the WCAG part of both, not EN's further clauses.

**v14 a11y wins** (use as reference):

- Native `<dialog>` modal replaces Bootstrap Modal (Breaking [#107443](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-107443-MigrateModalComponentFromBootstrapToNativeDialog.html)) — proper focus trap + Esc-to-close for free.
- DocHeader breadcrumb rework (Feature [#107875](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Feature-107875-DoctypeBasedRouting.html)) improves landmark structure.
- CKEditor 5 v47 dark/light context-aware (Breaking [#106964](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-106964-MakeCkeditorContextAwareByDefault.html)) respects `prefers-color-scheme`.
- Camino theme (v14.1+, Feature [#108539](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.1/Feature-108539-Default-Theme-Camino.html)) is an alternative to `bootstrap-package` with configurable nav/footer — validate a11y when opting in.

## Accessibility Recommendations

These rules should be followed in every TYPO3 sitepackage:

1. **Skip links required** -- first focusable element on every page
2. **Links underlined in body text** -- color alone is not sufficient for link identification
3. **Never disable buttons** -- validate on click, show error messages
4. **No `role="menu"` for navigation** -- use `<nav>` > `<ul role="list">` > `<a>`
5. **`role="list"` on styled lists** -- preserves list semantics when `list-style: none` is applied
6. **Viewport must allow zoom** -- never use `user-scalable=no` or `maximum-scale=1`
7. **`aria-expanded` on disclosure triggers** -- toggles must announce their state

## Content Element Accessibility Checklist

When creating or reviewing content elements, verify:
- Interactive elements have ARIA attributes (`aria-expanded`, `aria-controls`, `aria-label`)
- Images have `alt` text (or `alt=""` for decorative)
- Focus indicators are visible (`:focus-visible` styles)
- `prefers-reduced-motion` is respected for animations
- Color contrast meets WCAG AA: 4.5:1, or 3:1 for UI and large text (>=24px / >=18.66px bold), measured not eyeballed. APCA never waives a WCAG failure
- Keyboard navigation works (Tab, Escape, Enter, Space)

## References

### Core
- `references/accessibility.md` -- WCAG 2.2 AA guide, contrast policy

### Patterns
- `references/patterns-skiplinks.md` -- Mandatory skip link navigation
- `references/patterns-accessible-navigation.md` -- Navigation, submenus, mobile nav
- `references/patterns-accessible-forms.md` -- Form labels, errors, fieldsets, multi-step
- `references/patterns-accessible-filter.md` -- Filtering, pagination, sorting, table accessibility
- `references/patterns-disclosure-widget.md` -- Accordions, collapsible sections, hiding techniques
- `references/patterns-clickable-cards.md` -- Accessible card/teaser click patterns
- `references/patterns-responsive-tables.md` -- Mobile table patterns

### Frontend Patterns
- `references/patterns-sticky-header.md` -- Scroll-triggered header, IntersectionObserver, CSS transitions
- `references/patterns-lazy-loading.md` -- Deferred component init, IntersectionObserver, placeholders
- `references/patterns-breadcrumb.md` -- Breadcrumb nav, JSON-LD structured data
- `references/patterns-language-switcher.md` -- Multi-language nav, b13/menus LanguageMenu, flags
- `references/patterns-animations.md` -- Scroll animations, prefers-reduced-motion support
- `references/patterns-scroll-to-anchor.md` -- Smooth scroll, sticky-header offset compensation
- `references/patterns-skeleton-loading.md` -- CSS placeholder animations, layout stability
- `references/patterns-toast-notification.md` -- Auto-dismiss notifications, ARIA live region
- `references/patterns-back-to-top.md` -- Scroll-to-top button, visibility threshold

## Recommended Reading

*Web Accessibility Cookbook* by Manuel Matuzovic (O'Reilly, 2024)
