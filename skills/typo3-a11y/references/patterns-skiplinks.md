# Pattern: Skip Link Navigation

Skip links are mandatory in every sitepackage. They allow keyboard users and screen reader users to jump directly to main content sections, bypassing repetitive navigation.

## Fluid Partial

```html
<!-- PageView/Partials/Header/Skiplinks.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<nav class="skiplinks" aria-label="{f:translate(key: 'skiplinks', extensionName: 'my_sitepackage')}">
    <ul class="skiplinks__list">
        <li>
            <a href="#main-content" class="skiplinks__link">
                <f:translate key="skipToContent" extensionName="my_sitepackage" />
            </a>
        </li>
        <li>
            <a href="#main-navigation" class="skiplinks__link">
                <f:translate key="skipToNavigation" extensionName="my_sitepackage" />
            </a>
        </li>
        <li>
            <a href="#main-footer" class="skiplinks__link">
                <f:translate key="skipToFooter" extensionName="my_sitepackage" />
            </a>
        </li>
    </ul>
</nav>

</html>
```

## Page Layout Integration

Skip links must be the **first focusable element** on the page:

```html
<!-- PageView/Layouts/Default.html -->
<f:layout />
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      xmlns:vite="http://typo3.org/ns/Praetorius/ViteAssetCollector/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<f:render section="Assets" />

<!-- Skip links: MUST be first focusable element -->
<f:render partial="Header/Skiplinks" />

<header class="main-header" id="main-header">
    <nav id="main-navigation" aria-label="{f:translate(key: 'mainNavigation', extensionName: 'my_sitepackage')}">
        <f:render section="Header" />
    </nav>
</header>

<main id="main-content">
    <f:render section="Main" />
</main>

<footer class="main-footer" id="main-footer">
    <f:render section="Footer" />
</footer>

<f:render partial="BackToTop" />

</html>
```

## Required Target IDs

Every page layout must have these landmark IDs:

| ID | Element | Purpose |
|---|---|---|
| `#main-content` | `<main>` | Primary content area |
| `#main-navigation` | `<nav>` | Primary navigation |
| `#main-footer` | `<footer>` | Page footer |
| `#main-header` | `<header>` | Page header (optional skip target) |

## SCSS

```scss
// Basic/_accessibility.scss

.skiplinks {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 9999;

    &__list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        gap: 0.5rem;
        justify-content: center;
    }

    &__link {
        // Hidden by default, visible on focus
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;

        // Visible on focus (keyboard Tab)
        &:focus {
            position: static;
            width: auto;
            height: auto;
            overflow: visible;
            clip: auto;
            display: inline-block;
            padding: 0.75rem 1.5rem;
            background-color: $primary;
            color: $white;
            font-weight: $font-weight-bold;
            font-size: 0.875rem;
            text-decoration: none;
            border-radius: 0 0 $border-radius $border-radius;
            box-shadow: 0 0.25rem 0.5rem rgba(0, 0, 0, 0.2);
            outline: 0.1875rem solid $white;
            outline-offset: -0.1875rem;
            z-index: 9999;
        }

        &:hover {
            background-color: darken($primary, 10%);
        }
    }
}

// Scroll margin for skip link targets
#main-content,
#main-navigation,
#main-footer {
    scroll-margin-top: calc(var(--header-height, 5rem) + 1rem);
}
```

## Labels

```xml
<!-- locallang.xlf (EN) -->
<trans-unit id="skiplinks"><source>Skip links</source></trans-unit>
<trans-unit id="skipToContent"><source>Skip to content</source></trans-unit>
<trans-unit id="skipToNavigation"><source>Skip to navigation</source></trans-unit>
<trans-unit id="skipToFooter"><source>Skip to footer</source></trans-unit>
<trans-unit id="mainNavigation"><source>Main navigation</source></trans-unit>

<!-- de.locallang.xlf (DE) -->
<trans-unit id="skiplinks">
    <source>Skip links</source>
    <target>Sprungnavigation</target>
</trans-unit>
<trans-unit id="skipToContent">
    <source>Skip to content</source>
    <target>Zum Inhalt springen</target>
</trans-unit>
<trans-unit id="skipToNavigation">
    <source>Skip to navigation</source>
    <target>Zur Navigation springen</target>
</trans-unit>
<trans-unit id="skipToFooter">
    <source>Skip to footer</source>
    <target>Zum Seitenende springen</target>
</trans-unit>
<trans-unit id="mainNavigation">
    <source>Main navigation</source>
    <target>Hauptnavigation</target>
</trans-unit>
```

## Playwright E2E Test

```typescript
// tests/e2e/skiplinks.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Skip Links', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('has skip link as first focusable element', async ({ page }) => {
        await page.keyboard.press('Tab');
        const focused = page.locator(':focus');
        await expect(focused).toHaveClass(/skiplinks__link/);
    });

    test('skip to content link points to #main-content', async ({ page }) => {
        await expect(page.locator('.skiplinks__link').first()).toHaveAttribute('href', '#main-content');
    });

    test('target elements have correct IDs', async ({ page }) => {
        await expect(page.locator('#main-content')).toBeAttached();
        await expect(page.locator('#main-navigation')).toBeAttached();
        await expect(page.locator('#main-footer')).toBeAttached();
    });

    test('skip link is visible on focus', async ({ page }) => {
        await page.locator('.skiplinks__link').first().focus();
        await expect(page.locator('.skiplinks__link').first()).toBeVisible();
    });
});
```

## Key Rules

1. **Always the first focusable element** -- before logo, navigation, search
2. **At least "Skip to content"** -- navigation and footer links are recommended
3. **Hidden until focused** -- uses clip/overflow technique, not `display: none`
4. **High z-index** -- must appear above everything when visible
5. **High contrast** -- primary color background with white text
6. **Bilingual labels** -- DE + EN in locallang.xlf
7. **Target IDs are mandatory** -- `#main-content`, `#main-navigation`, `#main-footer`
