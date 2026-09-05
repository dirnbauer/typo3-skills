# Pattern: Scroll Animations

Standard scroll-triggered animations with `prefers-reduced-motion` support and IntersectionObserver.

## TypeScript

```typescript
// TypeScript/Plugins/scroll-animations.ts

type AnimationType = 'fade-in' | 'slide-up' | 'slide-left' | 'slide-right' | 'scale-in';

interface AnimationOptions {
    rootMargin?: string;
    threshold?: number;
    staggerDelay?: number; // ms between children animations
}

const DEFAULT_OPTIONS: AnimationOptions = {
    rootMargin: '0px 0px -50px 0px', // Trigger 50px before fully visible
    threshold: 0.1,
    staggerDelay: 100,
};

/**
 * Initialize scroll-triggered animations.
 * Elements with data-animate="<type>" will animate when scrolled into view.
 * Elements with data-animate-stagger will stagger their children.
 */
export function initScrollAnimations(options: AnimationOptions = {}): void {
    // Respect reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // Show all elements immediately without animation
        document.querySelectorAll<HTMLElement>('[data-animate]').forEach((el) => {
            el.classList.add('is-visible');
        });
        return;
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    const element = entry.target as HTMLElement;

                    if (element.hasAttribute('data-animate-stagger')) {
                        // Stagger children
                        const children = element.querySelectorAll<HTMLElement>('[data-animate]');
                        children.forEach((child, index) => {
                            setTimeout(() => {
                                child.classList.add('is-visible');
                            }, index * (opts.staggerDelay ?? 100));
                        });
                    } else {
                        element.classList.add('is-visible');
                    }

                    observer.unobserve(element);
                }
            });
        },
        {
            rootMargin: opts.rootMargin,
            threshold: opts.threshold,
        },
    );

    // Observe individual animated elements
    document.querySelectorAll<HTMLElement>('[data-animate]:not([data-animate-stagger] [data-animate])').forEach((el) => {
        observer.observe(el);
    });

    // Observe stagger containers
    document.querySelectorAll<HTMLElement>('[data-animate-stagger]').forEach((el) => {
        observer.observe(el);
    });
}
```

## SCSS

```scss
// Components/_animations.scss

// Base state: hidden before animation
[data-animate] {
    opacity: 0;
    transition: opacity 0.6s ease, transform 0.6s ease;
    will-change: opacity, transform;
}

// Visible state (added by JS)
[data-animate].is-visible {
    opacity: 1;
    transform: none;
}

// Animation types
[data-animate='fade-in'] {
    // Only opacity change, no transform
}

[data-animate='slide-up'] {
    transform: translateY(2rem);
}

[data-animate='slide-left'] {
    transform: translateX(2rem);
}

[data-animate='slide-right'] {
    transform: translateX(-2rem);
}

[data-animate='scale-in'] {
    transform: scale(0.95);
}

// Custom durations via data attribute
[data-animate-duration='fast'] {
    transition-duration: 0.3s;
}

[data-animate-duration='slow'] {
    transition-duration: 1s;
}

// Reduced motion: show everything immediately
@media (prefers-reduced-motion: reduce) {
    [data-animate] {
        opacity: 1;
        transform: none;
        transition: none;
    }
}
```

## Fluid Usage

### Single Element

```html
<div class="ce-teaser" data-animate="fade-in">
    <!-- Content fades in when scrolled into view -->
</div>
```

### Staggered Grid

```html
<div class="row g-4" data-animate-stagger>
    <f:for each="{items}" as="item">
        <div class="col-md-4" data-animate="slide-up">
            <!-- Each card slides up with 100ms delay between them -->
        </div>
    </f:for>
</div>
```

### Custom Duration

```html
<h2 data-animate="fade-in" data-animate-duration="slow">
    Slow fade in headline
</h2>
```

## Entrypoint Integration

Add to `main.entry.ts` (loaded on every page):

```typescript
import { initScrollAnimations } from '../TypeScript/Plugins/scroll-animations';

document.addEventListener('DOMContentLoaded', () => {
    initScrollAnimations();
});
```

## Playwright E2E Test

```typescript
// tests/e2e/scroll-animations.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Scroll Animations', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('animates elements when scrolled into view', async ({ page }) => {
        const firstAnimated = page.locator('[data-animate]').first();
        await expect(firstAnimated).not.toHaveClass(/is-visible/);
        await firstAnimated.scrollIntoViewIfNeeded();
        await expect(firstAnimated).toHaveClass(/is-visible/);
    });

    test('respects reduced motion preference', async ({ browser }) => {
        const context = await browser.newContext({
            reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await page.goto('/');
        await expect(page.locator('[data-animate]').first()).toHaveClass(/is-visible/);
        await context.close();
    });
});
```

## Guidelines

1. **Always respect `prefers-reduced-motion`** -- animations are removed entirely
2. **Use `will-change` sparingly** -- only on elements that will animate
3. **Keep animations subtle** -- max 2rem translation, 0.6s duration
4. **Don't animate above-the-fold content** -- it should be immediately visible
5. **Stagger delay max ~100ms** -- longer feels sluggish
6. **No animation on text content** -- only on containers, cards, images
