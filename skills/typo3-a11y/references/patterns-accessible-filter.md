# Pattern: Accessible Data Filtering & Tables

Patterns for accessible filtering, pagination, sorting, and semantic tables.

## Filter Form

Wrap filters in a `<form>` with `role="search"`. Group related filters with `<fieldset>` + `<legend>`. Always provide a submit button -- never rely solely on auto-submit via `onChange`.

```html
<!-- Partials/Filter/FilterForm.html -->
<form class="filter-form" role="search"
      aria-label="{f:translate(key: 'filter.label', extensionName: 'my_sitepackage')}"
      method="get" action="{filterAction}">
    <fieldset class="filter-form__group">
        <legend class="filter-form__legend">
            <f:translate key="filter.category" extensionName="my_sitepackage" />
        </legend>
        <div class="row g-3">
            <div class="col-12 col-md-4">
                <label class="form-label" for="filter-category">
                    <f:translate key="filter.category" extensionName="my_sitepackage" />
                </label>
                <select id="filter-category" name="category" class="form-select">
                    <option value=""><f:translate key="filter.all" extensionName="my_sitepackage" /></option>
                    <f:for each="{categories}" as="cat">
                        <option value="{cat.uid}" selected="{f:if(condition: '{cat.uid} == {activeCategory}', then: 'selected')}">{cat.title}</option>
                    </f:for>
                </select>
            </div>
            <div class="col-12 col-md-4 d-flex align-items-end">
                <button type="submit" class="btn btn-primary w-100">
                    <f:translate key="filter.submit" extensionName="my_sitepackage" />
                </button>
            </div>
        </div>
    </fieldset>
</form>
```

## Live Region for Results

When filtering updates results via AJAX, announce the count using `aria-live="polite"`. Never use `aria-live="assertive"` for filter results -- too intrusive.

```html
<!-- Partials/Filter/ResultStatus.html -->
<div class="filter-status visually-hidden" aria-live="polite" aria-atomic="true" id="filter-status">
    <f:translate key="filter.resultsFound" extensionName="my_sitepackage" arguments="{0: resultCount}" />
</div>
```

### TypeScript

```typescript
// TypeScript/Plugins/filterStatus.ts
const STATUS_ID = 'filter-status';

export function announceFilterResults(count: number, labelTemplate: string): void {
    let status = document.getElementById(STATUS_ID);
    if (!status) {
        status = document.createElement('div');
        status.id = STATUS_ID;
        status.className = 'filter-status visually-hidden';
        status.setAttribute('aria-live', 'polite');
        status.setAttribute('aria-atomic', 'true');
        document.body.appendChild(status);
    }
    // Clear and re-set to trigger screen reader announcement
    status.textContent = '';
    requestAnimationFrame(() => {
        status!.textContent = labelTemplate.replace('{0}', String(count));
    });
}
```

## Pagination

Wrap in `<nav aria-label="Pagination">`. Active page: `aria-current="page"`. Disabled prev/next: `aria-disabled="true"` (not `disabled` on anchors).

```html
<!-- Partials/Filter/Pagination.html -->
<f:if condition="{pagination.lastPage} > 1">
<nav class="mt-4" aria-label="{f:translate(key: 'pagination.label', extensionName: 'my_sitepackage')}">
    <ul class="pagination justify-content-center">
        <li class="page-item{f:if(condition: '{pagination.currentPage} == 1', then: ' disabled')}">
            <f:if condition="{pagination.currentPage} > 1">
                <f:then>
                    <a class="page-link" href="{f:uri.action(arguments: '{page: pagination.previousPage}')}">
                        <span aria-hidden="true">&laquo;</span>
                        <span class="visually-hidden"><f:translate key="pagination.previous" extensionName="my_sitepackage" /></span>
                    </a>
                </f:then>
                <f:else>
                    <span class="page-link" aria-disabled="true">
                        <span aria-hidden="true">&laquo;</span>
                    </span>
                </f:else>
            </f:if>
        </li>
        <f:for each="{pagination.pages}" as="page">
            <li class="page-item{f:if(condition: '{page.number} == {pagination.currentPage}', then: ' active')}">
                <a class="page-link" href="{f:uri.action(arguments: '{page: page.number}')}"
                   {f:if(condition: '{page.number} == {pagination.currentPage}', then: 'aria-current="page"')}>{page.number}</a>
            </li>
        </f:for>
        <li class="page-item{f:if(condition: '{pagination.currentPage} == {pagination.lastPage}', then: ' disabled')}">
            <f:if condition="{pagination.currentPage} < {pagination.lastPage}">
                <f:then>
                    <a class="page-link" href="{f:uri.action(arguments: '{page: pagination.nextPage}')}">
                        <span aria-hidden="true">&raquo;</span>
                        <span class="visually-hidden"><f:translate key="pagination.next" extensionName="my_sitepackage" /></span>
                    </a>
                </f:then>
                <f:else>
                    <span class="page-link" aria-disabled="true"><span aria-hidden="true">&raquo;</span></span>
                </f:else>
            </f:if>
        </li>
    </ul>
</nav>
</f:if>
```

## Sort Controls

Use `aria-sort` on `<th>` to announce sort direction. Wrap sort trigger in a `<button>` inside `<th>` -- never make `<th>` itself clickable.

### TypeScript

```typescript
// TypeScript/Plugins/sortableTable.ts
type SortDirection = 'ascending' | 'descending';

export function initSortableTable(): void {
    document.querySelectorAll<HTMLTableElement>('.table-sortable').forEach((table) => {
        const headers = table.querySelectorAll<HTMLTableCellElement>('thead th[data-sortable]');
        headers.forEach((th) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'table-sort-btn';
            button.textContent = th.textContent?.trim() || '';
            th.textContent = '';
            th.appendChild(button);

            button.addEventListener('click', () => {
                const current = th.getAttribute('aria-sort') as SortDirection | null;
                const next: SortDirection = current === 'ascending' ? 'descending' : 'ascending';
                headers.forEach((other) => other.removeAttribute('aria-sort'));
                th.setAttribute('aria-sort', next);
                sortColumn(table, Array.from(th.parentElement!.children).indexOf(th), next);
            });
        });
    });
}

function sortColumn(table: HTMLTableElement, col: number, dir: SortDirection): void {
    const tbody = table.querySelector('tbody');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    const mod = dir === 'ascending' ? 1 : -1;
    rows.sort((a, b) => {
        const aT = a.cells[col]?.textContent?.trim() || '';
        const bT = b.cells[col]?.textContent?.trim() || '';
        return aT.localeCompare(bT, undefined, { numeric: true }) * mod;
    });
    rows.forEach((row) => tbody.appendChild(row));
}
```

### SCSS

```scss
// Components/_table-sortable.scss
.table-sort-btn {
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    font-weight: $font-weight-bold;
    white-space: nowrap;

    &::after {
        content: '\2195';
        font-size: 0.75rem;
        opacity: 0.4;
    }

    &:focus-visible {
        outline: 0.125rem solid $primary;
        outline-offset: 0.125rem;
        border-radius: 0.125rem;
    }
}

th[aria-sort='ascending'] .table-sort-btn::after { content: '\2191'; opacity: 1; }
th[aria-sort='descending'] .table-sort-btn::after { content: '\2193'; opacity: 1; }
```

## Semantic Table Structure

Always use `<table>`, `<thead>`, `<tbody>`, `<th>`, `<td>` -- never div-based tables. Add `<caption>` and `scope` attributes on header cells. See `patterns-responsive-tables.md` for mobile handling.

```html
<!-- Partials/Table/DataTable.html -->
<div class="table-responsive-wrap">
    <table class="table table-striped table-sortable">
        <caption class="visually-hidden">
            <f:translate key="table.caption" extensionName="my_sitepackage" />
        </caption>
        <thead>
            <tr>
                <f:for each="{columns}" as="col">
                    <th scope="col" data-sortable="{f:if(condition: col.sortable, then: 'true')}">{col.label}</th>
                </f:for>
            </tr>
        </thead>
        <tbody>
            <f:for each="{rows}" as="row">
                <tr>
                    <f:for each="{row.cells}" as="cell" iteration="iter">
                        <f:if condition="{iter.isFirst}">
                            <f:then><th scope="row">{cell}</th></f:then>
                            <f:else><td>{cell}</td></f:else>
                        </f:if>
                    </f:for>
                </tr>
            </f:for>
        </tbody>
    </table>
</div>
```

For complex tables with multi-level headers, use the `headers` attribute to link cells to their headers.

## Labels

```xml
<!-- locallang.xlf (EN) -->
<trans-unit id="filter.label"><source>Filter</source></trans-unit>
<trans-unit id="filter.category"><source>Category</source></trans-unit>
<trans-unit id="filter.all"><source>All</source></trans-unit>
<trans-unit id="filter.search"><source>Search</source></trans-unit>
<trans-unit id="filter.searchPlaceholder"><source>Search...</source></trans-unit>
<trans-unit id="filter.submit"><source>Apply filter</source></trans-unit>
<trans-unit id="filter.resultsFound"><source>{0} results found</source></trans-unit>
<trans-unit id="pagination.label"><source>Pagination</source></trans-unit>
<trans-unit id="pagination.previous"><source>Previous page</source></trans-unit>
<trans-unit id="pagination.next"><source>Next page</source></trans-unit>
<trans-unit id="table.caption"><source>Data overview</source></trans-unit>

<!-- de.locallang.xlf (DE) -->
<trans-unit id="filter.label"><source>Filter</source><target>Filter</target></trans-unit>
<trans-unit id="filter.category"><source>Category</source><target>Kategorie</target></trans-unit>
<trans-unit id="filter.all"><source>All</source><target>Alle</target></trans-unit>
<trans-unit id="filter.search"><source>Search</source><target>Suche</target></trans-unit>
<trans-unit id="filter.searchPlaceholder"><source>Search...</source><target>Suchen...</target></trans-unit>
<trans-unit id="filter.submit"><source>Apply filter</source><target>Filter anwenden</target></trans-unit>
<trans-unit id="filter.resultsFound"><source>{0} results found</source><target>{0} Ergebnisse gefunden</target></trans-unit>
<trans-unit id="pagination.label"><source>Pagination</source><target>Seitennavigation</target></trans-unit>
<trans-unit id="pagination.previous"><source>Previous page</source><target>Vorherige Seite</target></trans-unit>
<trans-unit id="pagination.next"><source>Next page</source><target>Nächste Seite</target></trans-unit>
<trans-unit id="table.caption"><source>Data overview</source><target>Datenübersicht</target></trans-unit>
```

## Checklist

| Rule | Detail |
|---|---|
| Filter in `<form>` | Use `role="search"` or labeled landmark |
| Submit button | Always provide -- no JS-only filtering |
| `<fieldset>` + `<legend>` | Group related filter controls |
| Live region | `aria-live="polite"` for result count updates |
| Never `assertive` | Filter results are not urgent announcements |
| Pagination in `<nav>` | `aria-label="Pagination"` |
| Active page | `aria-current="page"` on current page link |
| Disabled links | `aria-disabled="true"`, not `disabled` attribute |
| Semantic `<table>` | Never div-based tables |
| `<caption>` | Table title, can be `visually-hidden` |
| `scope` on `<th>` | `scope="col"` or `scope="row"` |
| Sort direction | `aria-sort="ascending"` / `"descending"` on `<th>` |
| Sort buttons | `<button>` inside `<th>`, not clickable `<th>` |
| Mobile tables | See `patterns-responsive-tables.md` |
