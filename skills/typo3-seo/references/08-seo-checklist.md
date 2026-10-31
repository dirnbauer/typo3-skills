# 8. SEO Checklist

Continues `typo3-seo` from [full guide](full-guide.md).

## 8. SEO Checklist

TYPO3-specific checks before go-live. Generic on-page SEO (title length, one H1, keyword use) is
not repeated here; the model knows it.

### EXT:seo configuration

- [ ] `typo3/cms-seo` installed and the site set (or static template) included once
- [ ] `config.pageTitleProviders` order checked: `recordTitle` runs before `seo` (14.0, #106232)
- [ ] `seo_title`, `description`, `og_*` and `twitter_*` fields enabled for editors in the page TCA
- [ ] `config.noPageTitle` and `config.pageTitleSeparator` set as intended
- [ ] Every site language has `hreflang` and `locale` in `config/sites/<site>/config.yaml`
- [ ] `x-default` checked on a translated page (points at the first language-menu entry)
- [ ] `canonical_link` only on pages that need an override; `no_index` / `no_follow` not left on from staging

### Sitemap and robots

- [ ] `sitemap.xml` mapped through the `PageTypeSuffix` enhancer and reachable without `?type=`
- [ ] Record sitemaps (`RecordsXmlSitemapDataProvider`) configured for each record table shown in the frontend
- [ ] Child sitemaps paginate with `tx_seo[page]`; a custom enhancer, if any, resolves them
- [ ] `robots.txt` served from the site configuration or a static file, with the sitemap URL
- [ ] Staging and preview hosts return `X-Robots-Tag: noindex` or are closed

### Rendering

- [ ] One `<title>` and one `<meta name="description">` in the rendered HTML (no duplicates from a second extension or TypoScript `headerData`)
- [ ] Images render with `loading="lazy"` from `styles.content.image.lazyLoading`; above-the-fold images set to `eager`
- [ ] Structured data handled through `typo3-structured-data`, not inline JSON-LD in TypoScript
- [ ] Lighthouse pass run on the production build ([11-lighthouse-pass.md](11-lighthouse-pass.md))
