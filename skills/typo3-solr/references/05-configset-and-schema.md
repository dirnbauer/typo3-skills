# 5. Configset & Schema

Continues `typo3-solr` from [full guide](full-guide.md).

## 5. Configset & Schema

The configset defines how Solr processes and indexes text. EXT:solr ships configsets at `Resources/Private/Solr/configsets/ext_solr_14_0_0/`.

### Structure

```
Resources/Private/Solr/
├── configsets/
│   └── ext_solr_14_0_0/
│       └── conf/
│           ├── solrconfig.xml
│           ├── english/
│           │   └── schema.xml
│           ├── german/
│           │   └── schema.xml
│           └── ... (other languages)
└── typo3lib/                 # at Solr root level, not inside the configset
```

Each language has its own `schema.xml` with language-specific analyzers (stemmer, stop words).

### Dynamic Field Types

Use dynamic field suffixes to add custom fields without modifying the schema:

| Suffix | Type | Multi | Example |
|--------|------|-------|---------|
| `_stringS` | string (not analyzed) | No | `category_stringS` |
| `_stringM` | string (not analyzed) | Yes | `tags_stringM` |
| `_textS` | text (analyzed) | No | `description_textS` |
| `_textM` | text (analyzed) | Yes | `keywords_textM` |
| `_intS` | integer | No | `year_intS` |
| `_floatS` | float | No | `price_floatS` |
| `_dateS` | date | No | `published_dateS` |
| `_boolS` | boolean | No | `active_boolS` |

Full reference: [Dynamic Fields Appendix](https://docs.typo3.org/p/apache-solr-for-typo3/solr/main/en-us/Appendix/DynamicFieldTypes.html)

### Site hash / multi-site indexing

**EXT:solr** stores a **site hash** in every document so separate TYPO3 sites sharing a core do not see each other's results. In 14.0.2 `SiteHashService::getSiteHashForSiteIdentifier()` computes `sha1(applicationContext . siteIdentifier . encryptionKey . 'tx_solr')`; the domain is not part of it, and there is no `siteHashStrategy` setting. See [application context, site hash and shared cores](v14-only-solr-changes.md#application-context-sitehash-and-shared-cores).

If searches return no hits after a migration, compare the **`TYPO3_CONTEXT`** of the indexer and the web request, the **site identifier** and the **`encryptionKey`** between the two installations, then **re-index**.
