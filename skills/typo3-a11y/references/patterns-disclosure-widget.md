# Pattern: Disclosure Widgets & Accordions

Accessible show/hide patterns for disclosure widgets and accordions.

## Content Hiding Decision Matrix

| Technique | Visually Hidden | Hidden from AT | Keeps Space | Use Case |
|---|---|---|---|---|
| `display: none` | Yes | Yes | No | Fully hidden content |
| `visibility: hidden` | Yes | Yes | Yes | Hidden with transitions (animatable) |
| `clip-path` / sr-only | Yes | No | No | Screen reader only text |
| `aria-hidden="true"` | No | Yes | -- | Decorative visuals irrelevant for AT |
| `hidden` attribute | Yes | Yes | No | Semantic `display: none` equivalent |
| `inert` attribute | No | Partially | -- | Non-interactive (behind modals) |

**Safari/VoiceOver caveat:** `list-style: none` removes list semantics. Fix with `role="list"`.

## Native Disclosure Widget

Use `<details>`/`<summary>` for simple toggles without animation needs:

```html
<details class="disclosure">
    <summary class="disclosure__toggle">More information</summary>
    <div class="disclosure__content">
        <p>Hidden content revealed on toggle.</p>
    </div>
</details>
```

Screen reader behavior varies: some announce "expanded/collapsed", others "open/closed". The `<summary>` always receives an implicit button role. No JavaScript required.

## Custom Disclosure Widget

Use when you need animations or full control over behavior:

```html
<div class="disclosure">
    <button class="disclosure__toggle"
            aria-expanded="false"
            aria-controls="disclosure-panel-1">
        Show details
    </button>
    <div class="disclosure__content"
         id="disclosure-panel-1"
         role="region"
         aria-labelledby="disclosure-heading-1"
         hidden>
        <p>Toggled content.</p>
    </div>
</div>
```

```typescript
export function initDisclosure(container: HTMLElement): void {
    const toggle = container.querySelector<HTMLButtonElement>('.disclosure__toggle');
    const content = container.querySelector<HTMLElement>('.disclosure__content');
    if (!toggle || !content) return;

    toggle.addEventListener('click', () => {
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!isExpanded));
        content.hidden = isExpanded;
    });
}
```

## Accordion -- Fluid ContentElement Template

```html
<!-- ContentElement/Accordion.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<f:layout name="ContentElement" />

<f:section name="Main">
<div class="accordion" data-accordion>
    <f:for each="{data.items}" as="item" iteration="iter">
        <div class="accordion__item">
            <h3 class="accordion__header">
                <button class="accordion__toggle"
                        id="accordion-heading-{data.uid}-{iter.index}"
                        aria-expanded="false"
                        aria-controls="accordion-panel-{data.uid}-{iter.index}"
                        type="button">
                    {item.header}
                    <span class="accordion__icon" aria-hidden="true"></span>
                </button>
            </h3>
            <div class="accordion__panel"
                 id="accordion-panel-{data.uid}-{iter.index}"
                 role="region"
                 aria-labelledby="accordion-heading-{data.uid}-{iter.index}"
                 hidden>
                <div class="accordion__body">
                    <f:format.html>{item.bodytext}</f:format.html>
                </div>
            </div>
        </div>
    </f:for>
</div>
</f:section>

</html>
```

## SCSS

```scss
// Components/_accordion.scss

.accordion {
    border: 0.0625rem solid $border-color;
    border-radius: $border-radius;
    overflow: hidden;

    &__item {
        border-bottom: 0.0625rem solid $border-color;

        &:last-child {
            border-bottom: none;
        }
    }

    &__header {
        margin: 0;
    }

    &__toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 1rem 1.25rem;
        border: none;
        background: none;
        font-size: 1rem;
        font-weight: $font-weight-semibold;
        text-align: left;
        cursor: pointer;
        transition: background-color 0.2s ease;

        &:hover {
            background-color: $gray-100;
        }

        &:focus-visible {
            outline: 0.1875rem solid $primary;
            outline-offset: -0.1875rem;
        }

        &[aria-expanded="true"] .accordion__icon {
            transform: rotate(180deg);
        }
    }

    &__icon {
        flex-shrink: 0;
        width: 1.25rem;
        height: 1.25rem;
        margin-left: 1rem;
        background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='none' stroke='currentColor' stroke-width='2' d='M2 5l6 6 6-6'/%3E%3C/svg%3E") center / contain no-repeat;
        transition: transform 0.3s ease;
    }

    &__panel {
        &:not([hidden]) {
            animation: accordion-expand 0.3s ease;
        }
    }

    &__body {
        padding: 0 1.25rem 1rem;
    }
}

@keyframes accordion-expand {
    from { opacity: 0; }
    to { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
    .accordion__icon,
    .accordion__panel {
        transition: none;
        animation: none;
    }
}
```

## TypeScript

```typescript
// TypeScript/Plugins/accordion.ts

export function initAccordion(): void {
    document.querySelectorAll<HTMLElement>('[data-accordion]').forEach((accordion) => {
        const toggles = accordion.querySelectorAll<HTMLButtonElement>('.accordion__toggle');

        toggles.forEach((toggle) => {
            toggle.addEventListener('click', () => {
                const panelId = toggle.getAttribute('aria-controls');
                const panel = panelId ? document.getElementById(panelId) : null;
                if (!panel) return;

                const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
                toggle.setAttribute('aria-expanded', String(!isExpanded));
                panel.hidden = isExpanded;
            });
        });

        // Arrow key navigation between accordion headers
        accordion.addEventListener('keydown', (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            if (!target.classList.contains('accordion__toggle')) return;

            const items = [...toggles];
            const index = items.indexOf(target as HTMLButtonElement);
            let next: HTMLButtonElement | undefined;

            if (event.key === 'ArrowDown') {
                next = items[(index + 1) % items.length];
            } else if (event.key === 'ArrowUp') {
                next = items[(index - 1 + items.length) % items.length];
            } else if (event.key === 'Home') {
                next = items[0];
            } else if (event.key === 'End') {
                next = items[items.length - 1];
            }

            if (next) {
                event.preventDefault();
                next.focus();
            }
        });
    });
}
```

## Labels

```xml
<!-- locallang.xlf (EN) -->
<trans-unit id="accordion.expand"><source>Expand section</source></trans-unit>
<trans-unit id="accordion.collapse"><source>Collapse section</source></trans-unit>

<!-- de.locallang.xlf (DE) -->
<trans-unit id="accordion.expand">
    <source>Expand section</source>
    <target>Bereich aufklappen</target>
</trans-unit>
<trans-unit id="accordion.collapse">
    <source>Collapse section</source>
    <target>Bereich zuklappen</target>
</trans-unit>
```

## Playwright E2E Test

```typescript
// tests/e2e/accordion.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Accordion', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/accordion-test');
    });

    test('panels are hidden by default', async ({ page }) => {
        const panels = page.locator('.accordion__panel');
        for (const panel of await panels.all()) {
            await expect(panel).toHaveAttribute('hidden', '');
        }
    });

    test('expands panel on toggle click', async ({ page }) => {
        await page.locator('.accordion__toggle').first().click();
        await expect(page.locator('.accordion__toggle').first()).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.accordion__panel').first()).not.toHaveAttribute('hidden');
    });

    test('collapses panel on second click', async ({ page }) => {
        const toggle = page.locator('.accordion__toggle').first();
        await toggle.click();
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.locator('.accordion__panel').first()).toHaveAttribute('hidden', '');
    });

    test('supports arrow key navigation between headers', async ({ page }) => {
        await page.locator('.accordion__toggle').first().focus();
        await page.keyboard.press('ArrowDown');
        await expect(page.locator('.accordion__toggle').nth(1)).toBeFocused();
    });

    test('each panel has role="region" and aria-labelledby', async ({ page }) => {
        const panels = page.locator('.accordion__panel');
        for (const panel of await panels.all()) {
            await expect(panel).toHaveAttribute('role', 'region');
            await expect(panel).toHaveAttribute('aria-labelledby');
        }
    });
});
```

## Key Rules

1. **No forced single-open** -- let users open multiple panels simultaneously
2. **Button inside heading** -- toggle must be a `<button>` inside an `<h2>`/`<h3>`
3. **`aria-expanded` on button** -- not on the panel
4. **`aria-controls` + `id`** -- button points to its panel
5. **`role="region"` + `aria-labelledby`** -- panel points back to its heading
6. **Arrow keys** -- Up/Down/Home/End navigate between accordion headers
7. **`prefers-reduced-motion`** -- disable animations for users who request it
8. **`hidden` attribute** -- use it instead of CSS-only hiding for correct AT behavior
