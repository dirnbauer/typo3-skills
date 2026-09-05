# Pattern: Scroll to Anchor

Smooth scroll to anchor links with sticky header offset, history update, and deep link support.

## TypeScript

```typescript
// TypeScript/Plugins/scrollToAnchor.ts

const HEADER_SELECTOR = '#main-header';
const SCROLL_OFFSET = 16; // Additional padding in px

function getHeaderHeight(): number {
    const header = document.querySelector<HTMLElement>(HEADER_SELECTOR);
    return header ? header.offsetHeight : 0;
}

function scrollToElement(target: HTMLElement): void {
    const offset = getHeaderHeight() + SCROLL_OFFSET;
    const top = target.getBoundingClientRect().top + window.scrollY - offset;

    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    window.scrollTo({
        top,
        behavior,
    });

    // Move focus to target for accessibility
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
}

export function initScrollToAnchor(): void {
    // Handle click on anchor links
    document.addEventListener('click', (event: MouseEvent) => {
        const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
        if (!link) return;

        const hash = link.getAttribute('href');
        if (!hash || hash === '#') return;

        const target = document.querySelector<HTMLElement>(hash);
        if (!target) return;

        event.preventDefault();
        scrollToElement(target);

        // Update URL without triggering scroll
        history.pushState(null, '', hash);
    });

    // Handle deep links (page load with hash)
    if (window.location.hash) {
        const target = document.querySelector<HTMLElement>(window.location.hash);
        if (target) {
            // Wait for layout to settle (fonts, images)
            requestAnimationFrame(() => {
                setTimeout(() => scrollToElement(target), 100);
            });
        }
    }
}
```

## SCSS

```scss
// Basic/_scroll.scss

// Scroll margin for anchor targets (accounts for sticky header)
:target,
[id] {
    scroll-margin-top: calc(var(--header-height, 5rem) + 1rem);
}

// Smooth scroll (CSS-only fallback)
html {
    scroll-behavior: smooth;
}

@media (prefers-reduced-motion: reduce) {
    html {
        scroll-behavior: auto;
    }
}
```

## Entrypoint

Add to `main.entry.ts`:

```typescript
import { initScrollToAnchor } from '../TypeScript/Plugins/scrollToAnchor';

document.addEventListener('DOMContentLoaded', () => {
    initScrollToAnchor();
});
```

## Playwright E2E Test

```typescript
// tests/e2e/scroll-to-anchor.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Scroll to Anchor', () => {
    test('scrolls to anchor with offset', async ({ page }) => {
        await page.goto('/page-with-anchors');
        await page.locator('a[href="#section-2"]').click();
        await expect(page).toHaveURL(/#section-2/);
        await expect(page.locator('#section-2')).toBeVisible();
    });

    test('handles deep links on page load', async ({ page }) => {
        await page.goto('/page-with-anchors#section-2');
        await expect(page.locator('#section-2')).toBeVisible();
    });
});
```
