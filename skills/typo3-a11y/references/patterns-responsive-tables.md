# Pattern: Responsive Tables

Pattern for tables that scroll horizontally on mobile or reflow into a card layout.

## Approach 1: Horizontal Scroll (Default)

Best for data tables where column relationships matter.

### SCSS

```scss
// Basic/_tables.scss

.table-responsive-wrap {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;

    // Visual scroll indicator on mobile
    @media (max-width: map-get($grid-breakpoints, md) - 0.02px) {
        position: relative;

        &::after {
            content: '';
            position: absolute;
            top: 0;
            right: 0;
            bottom: 0;
            width: 2rem;
            background: linear-gradient(to right, transparent, rgba($white, 0.8));
            pointer-events: none;
        }

        // Hide indicator when scrolled to end
        &.is-scrolled-end::after {
            display: none;
        }
    }
}

table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 1.5rem;

    th,
    td {
        padding: 0.75rem;
        border-bottom: 1px solid $border-color;
        text-align: left;
        vertical-align: top;
    }

    th {
        font-weight: $font-weight-bold;
        background-color: $gray-100;
        white-space: nowrap;
    }

    tbody tr:hover {
        background-color: rgba($primary, 0.04);
    }
}
```

### TypeScript

```typescript
// TypeScript/Plugins/responsiveTables.ts

export function initResponsiveTables(): void {
    // Wrap all tables in RTE content with responsive wrapper
    const tables = document.querySelectorAll<HTMLTableElement>(
        '.ce-textmedia table, .news-detail__content table, .accordion-body table',
    );

    tables.forEach((table) => {
        if (table.parentElement?.classList.contains('table-responsive-wrap')) return;

        const wrapper = document.createElement('div');
        wrapper.classList.add('table-responsive-wrap');
        table.parentNode?.insertBefore(wrapper, table);
        wrapper.appendChild(table);

        // Track scroll position for fade indicator
        wrapper.addEventListener('scroll', () => {
            const isEnd = wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 2;
            wrapper.classList.toggle('is-scrolled-end', isEnd);
        }, { passive: true });
    });
}
```

## Approach 2: Card Reflow (for simple tables)

Best for 2-3 column tables where each row is a self-contained record.

### SCSS

```scss
// Components/_table-reflow.scss

@media (max-width: map-get($grid-breakpoints, md) - 0.02px) {
    .table-reflow {
        thead {
            // Visually hide but keep for accessibility
            position: absolute;
            width: 1px;
            height: 1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
        }

        tr {
            display: block;
            margin-bottom: 1rem;
            border: 1px solid $border-color;
            border-radius: $border-radius;
            padding: 0.75rem;
        }

        td {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 0.375rem 0;
            border: none;
            border-bottom: 1px solid $gray-200;

            &:last-child {
                border-bottom: none;
            }

            // Show column header as label
            &::before {
                content: attr(data-label);
                font-weight: $font-weight-bold;
                margin-right: 1rem;
                flex-shrink: 0;
                max-width: 40%;
            }
        }
    }
}
```

### TypeScript

```typescript
// TypeScript/Plugins/tableReflow.ts

export function initTableReflow(): void {
    const tables = document.querySelectorAll<HTMLTableElement>('.table-reflow');

    tables.forEach((table) => {
        const headers = Array.from(table.querySelectorAll('thead th')).map(
            (th) => th.textContent?.trim() || '',
        );

        table.querySelectorAll('tbody td').forEach((td, index) => {
            const headerIndex = index % headers.length;
            if (headers[headerIndex]) {
                td.setAttribute('data-label', headers[headerIndex]);
            }
        });
    });
}
```

## Fluid Usage

Tables from the RTE are automatically wrapped by `initResponsiveTables()`. For content element tables, add the class manually:

```html
<!-- Simple scroll -->
<div class="table-responsive-wrap">
    <table>...</table>
</div>

<!-- Card reflow -->
<table class="table-reflow">...</table>
```

## Entrypoint

Add to `main.entry.ts`:

```typescript
import { initResponsiveTables } from '../TypeScript/Plugins/responsiveTables';

document.addEventListener('DOMContentLoaded', () => {
    initResponsiveTables();
});
```
