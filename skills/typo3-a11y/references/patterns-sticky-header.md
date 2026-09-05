# Pattern: Sticky Header

Complete pattern for a scroll-triggered sticky header with performance-optimized event handling.

## TypeScript

```typescript
// TypeScript/Plugins/stickyheader.ts

const SCROLL_THRESHOLD = 100;
const HEADER_SELECTOR = '#main-header';
const STICKY_CLASS = 'stickyheader';

export function initStickyHeader(): void {
    const header = document.querySelector<HTMLElement>(HEADER_SELECTOR);
    if (!header) return;

    let lastScrollY = 0;
    let ticking = false;

    const update = (): void => {
        const scrollY = window.scrollY;

        if (scrollY > SCROLL_THRESHOLD) {
            header.classList.add(STICKY_CLASS);
        } else {
            header.classList.remove(STICKY_CLASS);
        }

        lastScrollY = scrollY;
        ticking = false;
    };

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(update);
            ticking = true;
        }
    }, { passive: true });

    // Initial check (page might load scrolled)
    update();
}
```

## SCSS

```scss
// Page/_header.scss

.main-header {
    position: relative;
    z-index: 1030; // Above Bootstrap dropdowns
    transition: transform 0.3s ease, box-shadow 0.3s ease;

    &.stickyheader {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        box-shadow: 0 0.125rem 0.5rem rgba(0, 0, 0, 0.1);
        background-color: $white;
        animation: slideDown 0.3s ease;
    }
}

@keyframes slideDown {
    from {
        transform: translateY(-100%);
    }
    to {
        transform: translateY(0);
    }
}

// Compensate for fixed header height
body.has-sticky-header {
    padding-top: var(--header-height, 5rem);
}

// Respect reduced motion
@media (prefers-reduced-motion: reduce) {
    .main-header {
        transition: none;

        &.stickyheader {
            animation: none;
        }
    }
}
```

## Entrypoint Integration

The sticky header is typically part of `main.entry.ts` (loaded on every page):

```typescript
// Entrypoints/main.entry.ts
import { initStickyHeader } from '../TypeScript/Plugins/stickyheader';

document.addEventListener('DOMContentLoaded', () => {
    initStickyHeader();
});
```

## Playwright E2E Test

```typescript
// tests/e2e/sticky-header.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Sticky Header', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('is not sticky at top of page', async ({ page }) => {
        await expect(page.locator('#main-header')).not.toHaveClass(/stickyheader/);
    });

    test('becomes sticky when scrolling past threshold', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 200));
        await expect(page.locator('#main-header')).toHaveClass(/stickyheader/);
    });

    test('removes sticky when scrolling back to top', async ({ page }) => {
        await page.evaluate(() => window.scrollTo(0, 200));
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator('#main-header')).not.toHaveClass(/stickyheader/);
    });
});
```

## Advanced: Hide on Scroll Down, Show on Scroll Up

```typescript
export function initStickyHeaderAdvanced(): void {
    const header = document.querySelector<HTMLElement>(HEADER_SELECTOR);
    if (!header) return;

    let lastScrollY = 0;
    let ticking = false;

    const update = (): void => {
        const scrollY = window.scrollY;

        if (scrollY > SCROLL_THRESHOLD) {
            header.classList.add(STICKY_CLASS);

            // Hide on scroll down, show on scroll up
            if (scrollY > lastScrollY) {
                header.classList.add('header-hidden');
            } else {
                header.classList.remove('header-hidden');
            }
        } else {
            header.classList.remove(STICKY_CLASS, 'header-hidden');
        }

        lastScrollY = scrollY;
        ticking = false;
    };

    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(update);
            ticking = true;
        }
    }, { passive: true });
}
```

```scss
.main-header.header-hidden {
    transform: translateY(-100%);
}
```
