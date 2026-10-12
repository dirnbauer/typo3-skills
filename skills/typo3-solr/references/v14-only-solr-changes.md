# v14-Only Solr Changes

Continues `typo3-solr` from [full guide](full-guide.md).

## v14-Only Solr Changes

> The following Solr-related changes are relevant when running EXT:solr on **TYPO3 v14**.

### EXT:solr v14 Compatibility **[v14 only]**

The published [Version Matrix](https://docs.typo3.org/p/apache-solr-for-typo3/solr/main/en-us/Appendix/VersionMatrix.html) lists **EXT:solr 14.0** for **TYPO3 14.3**. Stable **14.0.1** was published on 2026-09-03; prefer compatible stable constraints instead of `@beta` or `dev-main`. Re-check [Packagist](https://packagist.org/packages/apache-solr-for-typo3/solr) and [GitHub releases](https://github.com/TYPO3-Solr/ext-solr/releases) at execution time and verify server/configset compatibility separately.

### Fluid 5.0 in Search Templates **[v14 only]**

Search result templates and facet partials must comply with Fluid 5.0 strict typing:
- ViewHelper arguments are strictly typed.
- No underscore-prefixed template variables.
- Review custom result and facet templates for type mismatches.

### TypoScriptFrontendController Removal **[v14 only]**

Custom indexer or search plugins referencing `$GLOBALS['TSFE']` must migrate to request attributes. This affects:
- Custom `IndexQueueInitializer` implementations
- PSR-14 event listeners for `AfterSearchHasBeenExecutedEvent`
- Custom `ResultParser` classes

### TCA `searchFields` Migration **[v14 only]**

If your custom record TCA uses `ctrl.searchFields` for Solr indexing configuration, note that `searchFields` is removed from `ctrl` in v14. Use per-column `'searchable' => true` instead. This does not directly affect Solr Index Queue configuration (which uses its own field mapping), but may affect backend search behavior.

## Search parity across the Solr upgrade

A whole-site upgrade from EXT:solr 12 (Solr 9) to EXT:solr 14 (Solr 10) passes the 13.4 rung with
EXT:solr 13. Three changes alter search results without any error; one fleet run found all three
in its search sentinel (seeded query, expected first-page order).

### Lucene 10 German analysis **[Solr 10]**

**Problem.** In Lucene 10, `DictionaryCompoundWordTokenFilter` defaults to
`onlyLongestMatchIgnoreSubwords=true`, so a compound yields fewer dictionary parts, and the German
stemmer keeps `system` unstemmed. Token counts and ranking change on `core_de`.

**Detect.** The seeded German query returns a different order or count than Baseline A. The Solr
Analysis screen for the `text` field type shows fewer compound parts and `system` unchanged.

**Fix.** Overlay `german/schema.xml` in the project's configset copy, in every analyzer that has the
compound filter:

```xml
<filter class="solr.DictionaryCompoundWordTokenFilterFactory"
    dictionary="german/german-common-nouns.txt"
    minWordSize="5" minSubwordSize="4" maxSubwordSize="15"
    onlyLongestMatch="false"
    onlyLongestMatchIgnoreSubwords="false"/>
<!-- … -->
<filter class="solr.PatternReplaceFilterFactory" pattern="system$" replacement="syst" replace="first"/>
<filter class="solr.SnowballPorterFilterFactory" language="German2" protected="german/protwords.txt"/>
```

The `PatternReplaceFilter` goes before the stemmers, after lowercasing and normalisation. Deploy the
same overlay on the target Solr 10 (DDEV and every later environment) **before** the full reindex,
then reindex and rerun the search sentinel. Treat it as a configset change: back up the exact core
first ([safe Solr mutation](../../typo3-upgrade-run/references/recent-run-lessons.md#safe-solr-mutation)).

### Page title from the SEO title **[EXT:solr 13+]**

**Problem.** Since EXT:solr 13 the page indexer takes the title from TYPO3's
`PageTitleProviderManager`, so a page with an SEO title is indexed with that title instead of
`pages.title`. Result titles and title-boosted ranking change.

**Detect.** Result titles in the search sentinel differ from Baseline A on pages with `seo_title`.

**Fix.** For parity, map the field explicitly:

```typoscript
plugin.tx_solr.index.queue.pages.fields.title = title
```

### `lastSearches` disabled by default **[EXT:solr 13+]**

**Problem.** EXT:solr 13 disabled `lastSearches` by default. A search no longer starts a frontend
session, so the `fe_typo_user` cookie the 12.4 site set after a search is gone.

**Detect.** The HTTP proof (or the consent/cookie inventory) misses `fe_typo_user` after a search
request.

**Fix.** Restore the old behaviour when parity requires it:

```typoscript
plugin.tx_solr.search.lastSearches.mode = user
```

Dropping the cookie can be a deliberate improvement; then it is a declared change the owner accepts,
not a silent difference.
