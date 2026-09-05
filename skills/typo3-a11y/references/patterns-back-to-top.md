# Pattern: Back to Top Button

Scroll-triggered button with smooth scroll, accessible markup, and animation.

## TypeScript

```typescript
// TypeScript/Plugins/backToTop.ts

const SCROLL_THRESHOLD = 400;
const BUTTON_CLASS = 'back-to-top';
const VISIBLE_CLASS = 'back-to-top--visible';

export function initBackToTop(): void {
    const button = document.querySelector<HTMLButtonElement>(`.${BUTTON_CLASS}`);
    if (!button) return;

    let ticking = false;

    const update = (): void => {
        button.classList.toggle(VISIBLE_CLASS, window.scrollY > SCROLL_THRESHOLD);
        ticking = false;
    };

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(update);
            ticking = true;
        }
    }, { passive: true });

    button.addEventListener('click', () => {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        window.scrollTo({ top: 0, behavior });

        // Move focus to skip links / top of page for accessibility
        const skipLink = document.querySelector<HTMLElement>('.visually-hidden-focusable');
        if (skipLink) {
            skipLink.focus({ preventScroll: true });
        }
    });

    // Initial check
    update();
}
```

## Fluid Partial

```html
<!-- PageView/Partials/BackToTop.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<button type="button"
        class="back-to-top"
        aria-label="{f:translate(key: 'backToTop', extensionName: 'my_sitepackage')}">
    <f:image src="EXT:my_sitepackage/Resources/Public/Svg/chevron-up.svg" width="24" height="24" alt="" />
</button>

</html>
```

Include in the page layout before `</body>`:

```html
<!-- PageView/Layouts/Default.html -->
<footer class="main-footer">
    <f:render section="Footer" />
</footer>

<f:render partial="BackToTop" />
```

## SCSS

```scss
// Components/_back-to-top.scss

.back-to-top {
    position: fixed;
    bottom: 2rem;
    right: 2rem;
    z-index: 1050;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    border: none;
    border-radius: 50%;
    background-color: $primary;
    color: $white;
    cursor: pointer;
    box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.2);
    transition: opacity 0.3s ease, transform 0.3s ease, background-color 0.2s ease;

    // Hidden by default
    opacity: 0;
    transform: translateY(1rem);
    pointer-events: none;

    &--visible {
        opacity: 1;
        transform: translateY(0);
        pointer-events: auto;
    }

    &:hover {
        background-color: darken($primary, 10%);
        transform: translateY(-0.125rem);
    }

    &:focus-visible {
        outline: 0.1875rem solid $primary;
        outline-offset: 0.125rem;
    }

    // Hide in print
    @media print {
        display: none !important;
    }

    // Mobile: smaller and closer to edge
    @media (max-width: map-get($grid-breakpoints, md) - 0.02px) {
        bottom: 1rem;
        right: 1rem;
        width: 2.75rem;
        height: 2.75rem;
    }
}

@media (prefers-reduced-motion: reduce) {
    .back-to-top {
        transition: none;
    }
}
```

## Entrypoint

Add to `main.entry.ts`:

```typescript
import { initBackToTop } from '../TypeScript/Plugins/backToTop';

document.addEventListener('DOMContentLoaded', () => {
    initBackToTop();
});
```

## Labels

```xml
<!-- locallang.xlf -->
<trans-unit id="backToTop"><source>Back to top</source></trans-unit>

<!-- de.locallang.xlf -->
<trans-unit id="backToTop">
    <source>Back to top</source>
    <target>Nach oben</target>
</trans-unit>
```

## Playwright E2E Test

```typescript
// tests/e2e/back-to-top.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Back to Top', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('is hidden at top of page', async ({ page }) => {
        await expect(page.locator('.back-to-top')).not.toHaveClass(/back-to-top--visible/);
    });

    test('appears after scrolling', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 500));
        await expect(page.locator('.back-to-top')).toHaveClass(/back-to-top--visible/);
    });

    test('scrolls to top on click', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 500));
        await page.locator('.back-to-top').click({ force: true });
        await expect(page).toHaveURL(/.*/, { timeout: 5000 });
        const scrollY = await page.evaluate(() => window.scrollY);
        expect(scrollY).toBe(0);
    });
});
```
