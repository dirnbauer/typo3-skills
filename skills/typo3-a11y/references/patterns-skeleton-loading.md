# Pattern: Loading / Skeleton States

CSS-only skeleton placeholders for asynchronously loaded content.

## SCSS

```scss
// Components/_skeleton.scss

.skeleton {
    position: relative;
    overflow: hidden;
    background-color: $gray-200;
    border-radius: $border-radius;

    // Shimmer animation
    &::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        left: 0;
        background: linear-gradient(
            90deg,
            transparent 0%,
            rgba($white, 0.4) 50%,
            transparent 100%
        );
        animation: skeleton-shimmer 1.5s ease-in-out infinite;
        transform: translateX(-100%);
    }
}

@keyframes skeleton-shimmer {
    100% {
        transform: translateX(100%);
    }
}

// Skeleton variants
.skeleton-text {
    @extend .skeleton;
    height: 1rem;
    margin-bottom: 0.5rem;
    border-radius: 0.25rem;

    &--short {
        width: 60%;
    }

    &--medium {
        width: 80%;
    }
}

.skeleton-heading {
    @extend .skeleton;
    height: 1.5rem;
    width: 40%;
    margin-bottom: 1rem;
}

.skeleton-image {
    @extend .skeleton;
    aspect-ratio: 16 / 9;
    width: 100%;
}

.skeleton-avatar {
    @extend .skeleton;
    width: 3rem;
    height: 3rem;
    border-radius: 50%;
}

.skeleton-button {
    @extend .skeleton;
    height: 2.5rem;
    width: 8rem;
    border-radius: $border-radius;
}

// Card skeleton
.skeleton-card {
    border: 1px solid $border-color;
    border-radius: $border-radius;
    padding: 1rem;

    .skeleton-image {
        margin-bottom: 1rem;
    }
}

// Reduced motion
@media (prefers-reduced-motion: reduce) {
    .skeleton::after {
        animation: none;
    }
}
```

## HTML Templates

### Card Grid Skeleton

```html
<!-- Partials/Skeleton/CardGrid.html -->
<div class="row g-4" aria-busy="true" aria-label="{f:translate(key: 'loading', extensionName: 'my_sitepackage')}">
    <f:for each="{0: 0, 1: 1, 2: 2}" as="i">
        <div class="col-md-4">
            <div class="skeleton-card">
                <div class="skeleton-image"></div>
                <div class="skeleton-heading"></div>
                <div class="skeleton-text"></div>
                <div class="skeleton-text skeleton-text--short"></div>
                <div class="skeleton-button mt-3"></div>
            </div>
        </div>
    </f:for>
</div>
```

### List Skeleton

```html
<!-- Partials/Skeleton/List.html -->
<div aria-busy="true" aria-label="{f:translate(key: 'loading', extensionName: 'my_sitepackage')}">
    <f:for each="{0: 0, 1: 1, 2: 2, 3: 3}" as="i">
        <div class="d-flex gap-3 mb-3">
            <div class="skeleton-avatar"></div>
            <div class="flex-grow-1">
                <div class="skeleton-text skeleton-text--medium"></div>
                <div class="skeleton-text skeleton-text--short"></div>
            </div>
        </div>
    </f:for>
</div>
```

## TypeScript Usage

```typescript
// Show skeleton, load content, replace skeleton with result
export async function loadContent(
    container: HTMLElement,
    fetchFn: () => Promise<DocumentFragment>,
): Promise<void> {
    const skeleton = container.querySelector('.skeleton-placeholder');
    if (skeleton) {
        skeleton.removeAttribute('hidden');
    }
    container.setAttribute('aria-busy', 'true');

    try {
        const fragment = await fetchFn();

        if (skeleton) {
            skeleton.setAttribute('hidden', '');
        }
        Array.from(container.children).forEach((child) => {
            if (child !== skeleton) {
                child.remove();
            }
        });
        container.appendChild(fragment);
    } catch {
        if (skeleton) {
            skeleton.setAttribute('hidden', '');
        }
        const error = document.createElement('p');
        error.className = 'text-danger';
        error.textContent = 'Content could not be loaded.';
        container.appendChild(error);
    } finally {
        container.removeAttribute('aria-busy');
    }
}
```

## Accessibility

- `aria-busy="true"` on containers while loading
- `aria-label` with loading text for screen readers
- Skeleton elements are purely decorative (no ARIA roles needed)
- Animation respects `prefers-reduced-motion`
