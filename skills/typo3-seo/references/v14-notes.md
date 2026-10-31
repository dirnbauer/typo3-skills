# TYPO3 SEO v14 Notes

Continues `typo3-seo` from [full guide](full-guide.md). Everything below was checked against the
installed TYPO3 14.3.7 source (`vendor/typo3/cms-fluid`, `cms-core`, `cms-seo`) on 2026-10-31.

## Sitemap GET Parameters Namespaced **[v14 only]**

Sitemap GET parameters use the `tx_seo[sitemap]` / `tx_seo[page]` namespace (Breaking #104422).
The `PageTypeSuffix` enhancer and the optional custom pagination enhancer are documented once, in
[SKILL.md section 3](../SKILL.md#3-xml-sitemap-configuration); this file does not repeat the YAML.

## Fluid Page Title and Meta ViewHelpers **[v14 only]**

`f:page.title` (#107358) and `f:page.meta` (#107359) ship in `EXT:fluid`
(`Classes/ViewHelpers/Page/TitleViewHelper.php`, `MetaViewHelper.php`). `f:page.meta` takes
`property` (required), `type` (`name`, `property` or `http-equiv`; detected when omitted),
`subProperties` and `replace`:

```html
<f:page.title>{article.title} - My Site</f:page.title>
<f:page.meta property="description">{article.teaser}</f:page.meta>
<f:page.meta property="og:title">{article.title}</f:page.meta>
```

They go through the same `PageTitleProviderManager` and `MetaTagManager` as the PHP APIs, so a
provider or tag set in PHP and in Fluid for the same page still has to be resolved by the
`pageTitleProviders` order or `replace="true"`.

## RecordTitleProvider **[v14 only]**

`TYPO3\CMS\Core\PageTitle\RecordTitleProvider` (#106232) is a page title provider with the
TypoScript identifier `recordTitle`, registered before the `seo` provider. Inject it into an
Extbase controller and call `setTitle($item->getTitle())` in the detail action; no further
registration is needed for the Core order.

## headerData and footerData ViewHelpers **[v14 only]**

`f:page.headerData` and `f:page.footerData` (#107056, `EXT:fluid`
`Classes/ViewHelpers/Page/HeaderDataViewHelper.php`, `FooterDataViewHelper.php`) add their child
content to the page head or footer. Use them for markup that has no dedicated ViewHelper; JSON-LD
belongs to `typo3-structured-data`.

## Regex-based slug replacements **[v14 only]**

`generatorOptions.regexReplacements` in a slug field's TCA (#106072) applies regular expressions
before sanitation, for case-insensitive or wildcard replacements that the plain `replacements`
array cannot express.
