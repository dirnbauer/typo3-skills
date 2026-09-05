# Pattern: Lazy Loading with IntersectionObserver

Pattern for initializing content elements only when they become visible in the viewport. Reduces initial JS execution and improves INP.

## Core Utility

```typescript
// TypeScript/Plugins/lazy-init.ts

interface LazyInitOptions {
    rootMargin?: string;
    threshold?: number;
    once?: boolean;
}

/**
 * Initialize a callback when elements matching the selector become visible.
 * Uses IntersectionObserver for performance -- no scroll event listeners.
 */
export function lazyInit(
    selector: string,
    callback: (element: HTMLElement) => void,
    options: LazyInitOptions = {},
): void {
    const {
        rootMargin = '200px 0px', // Start loading 200px before visible
        threshold = 0,
        once = true,
    } = options;

    const elements = document.querySelectorAll<HTMLElement>(selector);
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
        (entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    callback(entry.target as HTMLElement);
                    if (once) {
                        observer.unobserve(entry.target);
                    }
                }
            });
        },
        { rootMargin, threshold },
    );

    elements.forEach((el) => observer.observe(el));
}
```

## Usage in Entrypoints

### Slider (heavy JS library)

```typescript
// Entrypoints/slider.entry.ts
import '../Scss/ContentElements/_slider.scss';
import { lazyInit } from '../TypeScript/Plugins/lazy-init';

document.addEventListener('DOMContentLoaded', () => {
    lazyInit('.ce-slider', async (element) => {
        // Dynamic import -- only loads Swiper when needed
        const { default: Swiper } = await import('swiper');
        const { Navigation, Pagination } = await import('swiper/modules');

        new Swiper(element.querySelector('.swiper') as HTMLElement, {
            modules: [Navigation, Pagination],
            slidesPerView: 1,
            spaceBetween: 16,
            navigation: {
                nextEl: element.querySelector('.swiper-button-next') as HTMLElement,
                prevEl: element.querySelector('.swiper-button-prev') as HTMLElement,
            },
            pagination: {
                el: element.querySelector('.swiper-pagination') as HTMLElement,
                clickable: true,
            },
        });
    });
});
```

### Video (external embed)

```typescript
// Entrypoints/video.entry.ts
import '../Scss/ContentElements/_video.scss';
import { lazyInit } from '../TypeScript/Plugins/lazy-init';

document.addEventListener('DOMContentLoaded', () => {
    lazyInit('.ce-video[data-src]', (element) => {
        const src = element.dataset.src;
        if (!src) return;

        const iframe = document.createElement('iframe');
        iframe.src = src;
        iframe.setAttribute('allowfullscreen', '');
        iframe.setAttribute('loading', 'lazy');
        iframe.title = element.dataset.title || 'Video';

        const container = element.querySelector('.ce-video__player');
        if (container) {
            // Clear placeholder and insert iframe
            while (container.firstChild) {
                container.removeChild(container.firstChild);
            }
            container.appendChild(iframe);
        }
    });
});
```

### Map (external library)

```typescript
// Entrypoints/map.entry.ts
import '../Scss/ContentElements/_map.scss';
import { lazyInit } from '../TypeScript/Plugins/lazy-init';

document.addEventListener('DOMContentLoaded', () => {
    lazyInit('.ce-map', async (element) => {
        // Load map library only when the map container is visible
        const { initMap } = await import('../TypeScript/Plugins/map');
        initMap(element);
    });
});
```

## Fluid Template Pattern

For video embeds, use a placeholder that gets replaced on visibility:

```html
<!-- ContentElements/Templates/Video.html -->
<vite:asset entry="EXT:my_sitepackage/Resources/Private/Entrypoints/video.entry.ts" />

<div class="ce-video"
     data-src="{data.tx_mask_video_url}"
     data-title="{data.header}">
    <div class="ce-video__player ratio ratio-16x9">
        <f:if condition="{data.tx_mask_video_poster}">
            <f:image image="{data.tx_mask_video_poster}" maxWidth="1200" loading="lazy" alt="" />
        </f:if>
        <button class="ce-video__play-btn" aria-label="{f:translate(key: 'playVideo', extensionName: 'my_sitepackage')}">
            <f:image src="EXT:my_sitepackage/Resources/Public/Svg/play.svg" width="48" height="48" alt="" />
        </button>
    </div>
</div>
```

## SCSS

```scss
// Components/_lazy-placeholder.scss

// Generic placeholder for lazy-loaded content
[data-src]:not(.is-loaded) {
    position: relative;
    background-color: $gray-100;
    min-height: 12rem;

    // Loading indicator
    &::after {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 2rem;
        height: 2rem;
        margin: -1rem 0 0 -1rem;
        border: 0.2rem solid $gray-300;
        border-top-color: $primary;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
}

@keyframes spin {
    to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
    [data-src]:not(.is-loaded)::after {
        animation: none;
        border-top-color: $gray-300;
    }
}
```

## Key Benefits

- **No scroll listeners** -- IntersectionObserver is GPU-accelerated and battery-friendly
- **Dynamic imports** -- heavy libraries (Swiper, map SDKs) load on demand
- **200px margin** -- starts loading before visible, so users rarely see loading states
- **Once mode** -- observer disconnects after initialization, freeing memory
