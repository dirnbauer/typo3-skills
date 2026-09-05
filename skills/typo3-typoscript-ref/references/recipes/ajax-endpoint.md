# Recipe: AJAX/JSON Endpoint via TypoScript PAGE typeNum

> Version: v12+

## What this builds
A JSON API endpoint using a separate PAGE type with a custom typeNum, suitable for AJAX requests from frontend JavaScript, returning structured JSON data with proper headers.

## TypoScript -- JSON Endpoint

```typoscript
# JSON API endpoint (typeNum = 1638)
ajaxPage = PAGE
ajaxPage {
    typeNum = 1638

    config {
        disableAllHeaderCode = 1
        additionalHeaders {
            10.header = Content-Type: application/json; charset=utf-8
            20.header = Cache-Control: no-cache, no-store, must-revalidate
            30.header = Access-Control-Allow-Origin: https://www.example.com
            40.header = Access-Control-Allow-Methods: GET, POST
            50.header = Access-Control-Allow-Headers: Content-Type, X-Requested-With
        }
        debug = 0
        no_cache = 1
        admPanel = 0
    }

    # Simple: Return content elements as JSON
    10 = CONTENT
    10 {
        table = tt_content
        select {
            pidInList = this
            where = {#colPos} = 0
            orderBy = sorting
        }

        renderObj = COA
        renderObj {
            10 = TEXT
            10.field = uid
            10.wrap = "uid":|,

            20 = TEXT
            20.field = header
            20.htmlSpecialChars = 1
            20.wrap = "header":"|",

            30 = TEXT
            30.field = CType
            30.htmlSpecialChars = 1
            30.wrap = "type":"|",

            40 = TEXT
            40.field = bodytext
            40.htmlSpecialChars = 1
            40.replacement {
                10 {
                    search = "
                    replace = \"
                }
                20 {
                    search.char = 10
                    replace = \n
                }
                30 {
                    search.char = 13
                    replace =
                }
            }
            40.wrap = "bodytext":"|"

            stdWrap.noTrimWrap = |{|},|
        }

        stdWrap.wrap = {"status":"ok","items":[|]}
        stdWrap.trimRight = ,

        # Wrap items array properly (remove trailing comma)
        stdWrap.replacement {
            10 {
                search = ,]}
                replace = ]}
            }
        }
    }
}
```

## TypoScript -- Search Endpoint

```typoscript
# Search API endpoint (typeNum = 1639)
searchApi = PAGE
searchApi {
    typeNum = 1639

    config {
        disableAllHeaderCode = 1
        additionalHeaders {
            10.header = Content-Type: application/json; charset=utf-8
            20.header = Cache-Control: private, max-age=300
        }
        debug = 0
        admPanel = 0
    }

    10 = COA
    10 {
        # Check if search query parameter exists
        10 = LOAD_REGISTER
        10 {
            searchQuery.data = GP:q
            searchQuery.htmlSpecialChars = 1
        }

        # Return results
        20 = CONTENT
        20 {
            table = pages
            select {
                pidInList = 1
                recursive = 99
                where.dataWrap = ({#title} LIKE '%{register:searchQuery}%' OR {#description} LIKE '%{register:searchQuery}%')
                andWhere = {#hidden} = 0 AND {#deleted} = 0 AND {#doktype} IN (1,2)
                max = 10
                orderBy = title
            }

            renderObj = COA
            renderObj {
                10 = TEXT
                10.field = uid
                10.wrap = "uid":|,

                20 = TEXT
                20.field = title
                20.htmlSpecialChars = 1
                20.wrap = "title":"|",

                30 = TEXT
                30 {
                    field = description
                    htmlSpecialChars = 1
                    crop = 150|...|1
                    wrap = "description":"|",
                }

                40 = TEXT
                40 {
                    typolink {
                        parameter.field = uid
                        returnLast = url
                        forceAbsoluteUrl = 1
                    }
                    wrap = "url":"|"
                }

                stdWrap.noTrimWrap = |{|},|
            }

            stdWrap {
                wrap = {"status":"ok","query":"{register:searchQuery}","results":[|]}
                insertData = 1
                replacement {
                    10 {
                        search = ,]}
                        replace = ]}
                    }
                }
            }

            # No results fallback
            ifEmpty.cObject = TEXT
            ifEmpty.cObject {
                value = {"status":"ok","query":"{register:searchQuery}","results":[]}
                insertData = 1
            }
        }
    }
}
```

## TypoScript -- Navigation Data Endpoint

```typoscript
# Navigation API (typeNum = 1640)
navApi = PAGE
navApi {
    typeNum = 1640

    config {
        disableAllHeaderCode = 1
        additionalHeaders {
            10.header = Content-Type: application/json; charset=utf-8
            20.header = Cache-Control: public, max-age=3600
        }
        debug = 0
        admPanel = 0
    }

    10 = USER
    10 {
        userFunc = TYPO3\CMS\Extbase\Core\Bootstrap->run
        extensionName = SitePackage
        pluginName = NavigationApi
        vendorName = Vendor
    }
}
```

## JavaScript -- Frontend AJAX Call

```javascript
class AjaxContent {
    constructor(containerId, pageUid) {
        this.container = document.getElementById(containerId);
        this.pageUid = pageUid;
        this.apiUrl = window.location.origin;
    }

    async loadContent() {
        try {
            const url = new URL(this.apiUrl);
            url.searchParams.set('id', this.pageUid);
            url.searchParams.set('type', '1638');

            const response = await fetch(url.toString(), {
                method: 'GET',
                headers: {
                    'X-Requested-With': 'XMLHttpRequest',
                },
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.status === 'ok') {
                this.renderItems(data.items);
            }
        } catch (error) {
            console.error('Failed to load content:', error);
            this.container.textContent = 'Content could not be loaded.';
        }
    }

    renderItems(items) {
        this.container.replaceChildren();
        items.forEach(item => {
            const article = document.createElement('article');
            article.className = 'ajax-item';
            article.dataset.uid = item.uid;

            const heading = document.createElement('h3');
            heading.textContent = item.header;
            article.appendChild(heading);

            const content = document.createElement('div');
            content.className = 'ajax-item__content';
            content.textContent = item.bodytext;
            article.appendChild(content);

            this.container.appendChild(article);
        });
    }
}

// Search autocomplete
class SearchAutocomplete {
    constructor(inputId, resultsId) {
        this.input = document.getElementById(inputId);
        this.results = document.getElementById(resultsId);
        this.debounceTimer = null;

        this.input.addEventListener('input', () => this.onInput());
    }

    onInput() {
        clearTimeout(this.debounceTimer);
        const query = this.input.value.trim();

        if (query.length < 3) {
            this.results.replaceChildren();
            return;
        }

        this.debounceTimer = setTimeout(() => this.search(query), 300);
    }

    async search(query) {
        const url = new URL(window.location.origin);
        url.searchParams.set('type', '1639');
        url.searchParams.set('q', query);

        const response = await fetch(url.toString());
        const data = await response.json();

        this.renderResults(data.results);
    }

    renderResults(results) {
        this.results.replaceChildren();

        if (results.length === 0) {
            const noResults = document.createElement('li');
            noResults.className = 'no-results';
            noResults.textContent = 'No results found';
            this.results.appendChild(noResults);
            return;
        }

        results.forEach(result => {
            const li = document.createElement('li');
            li.className = 'search-result';

            const link = document.createElement('a');
            link.href = result.url;

            const title = document.createElement('strong');
            title.textContent = result.title;
            link.appendChild(title);

            const desc = document.createElement('span');
            desc.textContent = result.description;
            link.appendChild(desc);

            li.appendChild(link);
            this.results.appendChild(li);
        });
    }
}
```

## Site Configuration -- Route Enhancer (optional)

File: `config/sites/main/config.yaml` (append to existing)
```yaml
routeEnhancers:
  JsonApi:
    type: PageType
    map:
      api.json: 1638
      search.json: 1639
      nav.json: 1640
```

This maps `/api.json` to `?type=1638`, making URLs cleaner.

## Notes
- `disableAllHeaderCode = 1` removes the entire HTML structure (doctype, html, head, body tags) -- essential for non-HTML responses.
- Always set `Content-Type: application/json` explicitly. Without it, browsers may misinterpret the response.
- `no_cache = 1` disables TYPO3's page cache for the endpoint. Use sparingly -- for search endpoints it makes sense, for static data use `Cache-Control` headers.
- CORS headers (`Access-Control-Allow-Origin`) are only needed for cross-origin requests. For same-origin AJAX, they are unnecessary.
- Use specific origin values instead of `*` for `Access-Control-Allow-Origin` in production.
- The `PageType` route enhancer creates clean URLs for typeNum pages. The file extension (`.json`) helps with content negotiation.
- For complex JSON responses, consider using an Extbase controller with `JsonView` instead of building JSON via TypoScript string concatenation.
- `GP:q` reads GET/POST parameter `q`. Always sanitize via `htmlSpecialChars` before using in queries.
- The `where.dataWrap` approach uses query builder syntax internally, but for complex queries an Extbase/Doctrine approach is safer.
- typeNum values should be unique across the installation. Common convention: use 4-digit numbers above 1000.
