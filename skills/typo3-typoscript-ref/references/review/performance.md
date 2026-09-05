# TypoScript & Fluid Performance Patterns

## Caching Overview

### Page Cache
- PAGE objects produce full-page cached output
- Cache is invalidated automatically on content changes (cache tags)
- Default TTL controlled via `config.cache_period`

### COA vs COA_INT
- `COA` — cached content object, output stored in page cache
- `COA_INT` — uncached content object, rendered on every request within an otherwise cached page
- **Note**: Pages with `COA_INT` are still cached, but contain placeholder markers. On each request the cached page is loaded and only the INT sections are re-rendered. This is more efficient than disabling the page cache entirely.

### USER vs USER_INT
- Same principle as COA/COA_INT, but for PHP userFunc calls
- `USER` — result is cached with the page
- `USER_INT` — called on every request; the page is cached with a placeholder that is replaced per request
- Only use `USER_INT` when genuinely dynamic content is required (e.g., personalized output)

### stdWrap.cache
- Per-element caching independent of the page cache
- Supports TTL and cache tags for granular invalidation
- Use for expensive computations that do not need to be truly dynamic

```typo3_typoscript
lib.expensiveElement = COA
lib.expensiveElement {
    stdWrap.cache {
        key = myExpensiveElement
        lifetime = 3600
        tags = pages
    }
}
```

---

## Content Queries

### CONTENT.select limits
- Always set `max` and optionally `begin` to avoid unbounded queries
- Missing limits on large tables cause full table scans

```typo3_typoscript
lib.news = CONTENT
lib.news {
    table = tx_news_domain_model_news
    select {
        max = 10
        begin = 0
        orderBy = datetime DESC
    }
}
```

### DatabaseQueryProcessor pidInList
- Avoid recursive `pidInList` queries on large page trees (`pid_list_recursive = 1`)
- Recursive resolution traverses the entire subtree on every request
- Prefer explicit PID lists or limit recursion depth where possible

### select.where with proper indexing
- Ensure columns used in `where` conditions are indexed in the database
- Common unindexed pitfalls: custom fields added by extensions without migrations

### Avoid N+1 patterns
- Nested `CONTENT` queries (one inner query per outer record) cause N+1 database hits
- Use `DatabaseQueryProcessor` with a JOIN, or load related data in a single custom DataProcessor

---

## DataProcessors

### DatabaseQueryProcessor vs CONTENT cObject
- `DatabaseQueryProcessor` integrates directly with Fluid template variables — no TypoScript rendering overhead
- More efficient than a `CONTENT` cObject when output is consumed by Fluid
- Supports `dataProcessing` chaining for complex scenarios

### Lightweight Processors
- `SiteProcessor`, `SiteLanguageProcessor` — read from cached site configuration, negligible cost
- Use freely without performance concerns

### FilesProcessor
- FAL (File Abstraction Layer) queries can be expensive for large file collections
- Prefer file references over direct file queries where possible
- Use `references` rather than `files` to avoid redundant FAL lookups

### Custom DataProcessors
- Cache expensive operations internally (e.g., using the TYPO3 cache framework)
- Avoid blocking I/O or external API calls in DataProcessors without caching

---

## Fluid Rendering

### Partials vs Inline Templates
- Partial includes (`<f:render partial="...">`) have file I/O and parsing overhead on the first request
- Partials are compiled and cached after the first run — subsequent requests are fast
- For very small, frequently reused snippets, inline rendering may be faster in development but partials are preferred for maintainability

### f:render vs f:section
- `<f:render section="...">` within the same template file is faster than rendering a separate partial
- Use sections for layout-internal reuse, partials for reuse across multiple templates

### Partial Nesting Depth
- Avoid nesting partials more than 3 levels deep
- Deep nesting increases call stack depth and makes cache key computation more expensive

### ViewHelper Compilation
- ViewHelpers are compiled to PHP classes and cached after the first render
- Compilation overhead only occurs on the first request or after cache clearing
- Custom ViewHelpers should avoid expensive operations in constructors

---

## TypoScript Tips

### Conditions
- Conditions are evaluated on every page load regardless of caching
- Keep condition expressions simple — avoid complex PHP expressions or database queries inside conditions
- Use `[traverse(page, "layout") == 1]` style over custom condition classes where possible

### stdWrap Chain Length
- Long `stdWrap` property chains are processed sequentially — each step adds overhead
- Prefer direct property assignments over wrapping simple values through many stdWrap steps
- Profile with TYPO3 Admin Panel to identify hot paths

### parseFunc
- `parseFunc` (used for RTE output processing) is an expensive operation
- Results should be cached — `parseFunc_RTE` is applied during rendering, not storage
- Avoid calling `parseFunc` on large text blocks outside of cached contexts

### imgResource
- Image processing results are cached in `typo3temp/assets/images/`
- Avoid re-processing: use consistent `width`/`height`/`quality` settings so cache hits occur
- Use `file.treatIdAsReference = 1` to work with FAL references and benefit from FAL caching

---

## Quick Reference Table

| Pattern | Impact | Alternative |
|---------|--------|-------------|
| `USER_INT` | Per-request rendering of this object (page cached with placeholders) | `USER` + cache tags |
| `COA_INT` | Per-request rendering of this object (page cached with placeholders) | `COA` |
| `config.no_cache = 1` | All pages permanently uncacheable | Never use in production |
| Nested `CONTENT` queries | N+1 database queries | JOIN or single DataProcessor |
| Large `stdWrap` chains | Sequential processing overhead | Direct property assignment |
| Recursive `pidInList` | Full subtree traversal per request | Explicit PID list |
| Deep partial nesting (>3) | Increased call stack and cache key cost | Flatten partial hierarchy |
| `FilesProcessor` without references | Multiple FAL lookups | Use `references` mode |
