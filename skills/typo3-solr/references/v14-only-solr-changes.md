# v14-Only Solr Changes

Continues `typo3-solr` from [full guide](full-guide.md).

## Contents

- [v14-Only Solr Changes](#v14-only-solr-changes)
- [Search parity across the Solr upgrade](#search-parity-across-the-solr-upgrade)
- [Application context, siteHash and shared cores](#application-context-sitehash-and-shared-cores)

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

## Application context, siteHash and shared cores

### The siteHash depends on the context **[EXT:solr 14]**

**Problem.** EXT:solr 14 computes the siteHash from the application context, the site identifier
and the `encryptionKey`, not from the domain as EXT:solr 12 did
(`SiteHashService::getSiteHashForSiteIdentifier()`):

```php
sha1((string)Environment::getContext() . $siteIdentifier . $GLOBALS['TYPO3_CONF_VARS']['SYS']['encryptionKey'] . 'tx_solr')
```

The siteHash scopes document ids, garbage collection, the re-index cleanup and the `allowedSites`
search filter. A staging copy with the same `encryptionKey` and site identifier is kept apart from
live **only** because its context differs (`Production/Staging` against `Production`). A staging
host that runs as `Production` computes the live hash: its garbage collection and re-index cleanup
then delete live documents, and its search shows them. The web and the CLI context must match,
because the indexer and the scheduler run in the CLI.

**Detect.** Before indexing staging into a shared production core, read-only:

1. Compute the staging hash on the staging host with the effective `encryptionKey` (settings plus
   any `additional.php` or env override), without printing the key:
   ```bash
   php -r '$c = require "config/system/settings.php"; echo sha1($argv[1] . $argv[2] . $c["SYS"]["encryptionKey"] . "tx_solr"), PHP_EOL;' Production/Staging <site-identifier>
   ```
2. Facet the core on siteHash: `select?q=*:*&rows=0&facet=true&facet.field=siteHash&facet.limit=-1`.
3. The staging hash must not equal any live hash. Record the live document count per hash.
4. Index staging, then count again: every live count is unchanged.

**Fix.** A site configuration that points at the production Solr in every context is the trap:
until the comparison above passed, disable Solr in the unverified contexts (`solr_enabled_read`
per context, for example through a `%env()%` placeholder set per host, and no indexing scheduler
task there). The placeholder resolves to a string, and the string `false` is truthy for EXT:solr:
use `0` or an empty value.

### Orphans of an old staging site

An old staging site leaves documents under its own siteHash after it is gone. Remove them with
exactly one delete-by-query on that hash, never a broader query:

```bash
curl -s "$CORE/select?q=*:*&rows=0&facet=true&facet.field=siteHash&facet.limit=-1"   # before
curl -s "$CORE/update?commit=true" -H 'Content-Type: application/json' \
  -d '{"delete":{"query":"siteHash:<orphan-hash>"}}'
curl -s "$CORE/select?q=*:*&rows=0&facet=true&facet.field=siteHash&facet.limit=-1"   # after
```

After the delete the orphan hash is gone and every other hash has exactly its earlier count. A
shared production core is shared infrastructure: the delete needs the owner's approval for that
exact hash and core, and the [safe Solr mutation](../../typo3-upgrade-run/references/recent-run-lessons.md#safe-solr-mutation)
identity steps.

### EXT:solr 14 on an old Solr server

EXT:solr 14 against a Solr 8.11 core is unsupported, but it writes: in one fleet run the documents
were accepted and the fields unknown to the old schema were dropped. That is a stopgap, not a
target. The clean target is a dedicated core on Solr 10 with the `ext_solr_14_0_0` configset.
