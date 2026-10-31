# 7. Search Configuration

Continues `typo3-solr` from [full guide](full-guide.md).

## Contents

- [Essential Settings](#essential-settings)
- [Faceting](#faceting)
- [Suggest / Autocomplete](#suggest--autocomplete)
- [Sorting, Highlighting, Spellcheck](#sorting-highlighting-spellcheck)
- [Route Enhancers](#route-enhancers)

## 7. Search Configuration

### Essential Settings

```typoscript
plugin.tx_solr {
    enabled = 1
    search {
        targetPage = 42
        initializeWithEmptyQuery = 1
        showResultsOfInitialEmptyQuery = 0
        trustedFields = url
        keepExistingParametersForNewSearches = 1
    }
}
```

### Faceting

```typoscript
plugin.tx_solr.search {
    faceting = 1
    faceting {
        facets {
            contentType {
                label = Content Type
                field = type
            }
            category {
                label = Category
                field = category_stringM
            }
            year {
                label = Year
                field = year_intS
                type = queryGroup
                queryGroup {
                    2026 {
                        query = [2026-01-01T00:00:00Z TO 2026-12-31T23:59:59Z]
                    }
                    2025 {
                        query = [2025-01-01T00:00:00Z TO 2025-12-31T23:59:59Z]
                    }
                    2024 {
                        query = [2024-01-01T00:00:00Z TO 2024-12-31T23:59:59Z]
                    }
                }
            }
        }
    }
}
```

**Facet types** (`type`, registered in `FacetRegistry` 14.0.2): `options` (default), `hierarchy`, `queryGroup`, `dateRange`, `numericRange`. Rendering variants such as `OptionsFiltered`, `OptionsPrefixGrouped`, `OptionsSinglemode` or `OptionsToggle` are `partialName` values for the `options` type, not facet types.

### Suggest / Autocomplete

```typoscript
plugin.tx_solr {
    suggest = 1
    suggest {
        numberOfSuggestions = 10
        suggestField = spell
        showTopResults = 1
        numberOfTopResults = 5
        additionalTopResultsFields = url,type
    }
}
```

The built-in suggest in EXT:solr 14 is `suggest_controller.js` with `autocomplete.min.js`, no jQuery (EXT:solr 13 and older used devbridge/jQuery-Autocomplete). For custom markup and request handling, see [SKILL-FRONTEND.md](../SKILL-FRONTEND.md).

### Sorting, Highlighting, Spellcheck

```typoscript
plugin.tx_solr.search {
    sorting = 1
    sorting {
        defaultOrder = asc
        options {
            relevance {
                field = relevance
                label = Relevance
            }
            title {
                field = sortTitle
                label = Title
            }
            created {
                field = created
                label = Date
            }
        }
    }

    results {
        resultsHighlighting = 1
        resultsHighlighting {
            fragmentSize = 200
            wrap = <mark>|</mark>
        }
    }

    spellchecking = 1
}
```

### Route Enhancers

SEO-friendly search URLs:

The enhancer reads `extensionKey`, `routePath`, `_arguments`, `requirements`, `limitToPages` and
`solr` (shape from `Documentation/Routing/FacetsInPathSegment.rst` in 14.0.2); it is not an Extbase
enhancer and ignores `type: Extbase`, `plugin` or `routes`:

```yaml
routeEnhancers:
  products:
    type: SolrFacetMaskAndCombineEnhancer
    limitToPages:
      - 42
    extensionKey: tx_solr
    routePath: '/{productType}'
    # Arguments live in the tx_solr namespace: 'filter-productType' becomes 'tx_solr/filter-productType'
    _arguments:
      productType: filter-productType
    # Configure a requirement for every field; '.*' allows empty values
    requirements:
      productType: '.*'
    solr:
      multiValueSeparator: ';'
```

<!-- SCREENSHOT: frontend-search-facets.png - Search results with facets -->
