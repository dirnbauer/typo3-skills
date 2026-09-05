# Recipe: Basic Page Rendering Setup

> Version: v13+ / v14 (PAGEVIEW — standard) · v12 (FLUIDTEMPLATE — legacy)

## What this builds

A complete page rendering setup with HTML5 output, asset inclusion, and Fluid template rendering. Use PAGEVIEW for all new projects (v13+, standard in v14); the FLUIDTEMPLATE variant is kept for v12 legacy projects.

## TypoScript (v13+ / v14 — PAGEVIEW approach)

```typoscript
page = PAGE
page {
    typeNum = 0

    # HTML5 doctype
    config {
        doctype = html5
        htmlTag_setParams = class="no-js" lang="en" dir="ltr"
        pageTitleFirst = 1
        pageTitleSeparator = |
        pageTitleSeparator.noTrimWrap = | | |
        # absRefPrefix was removed in v14 (#108114).
        # Use forceAbsoluteUrls = 1 only if absolute URLs are required.
    }

    # Include CSS
    includeCSS {
        main = EXT:site_package/Resources/Public/Css/main.css
    }

    # Include JavaScript
    includeJSFooter {
        main = EXT:site_package/Resources/Public/JavaScript/main.js
        main.defer = 1
    }
    # Note: core asset concatenation/compression was removed in v14 (#108055).
    # Use an external build tool (Vite, Webpack) for asset optimization.

    # Header data
    headerData {
        10 = TEXT
        10.value = <meta name="viewport" content="width=device-width, initial-scale=1">
    }

    # PAGEVIEW rendering (v13+)
    10 = PAGEVIEW
    10 {
        paths {
            10 = EXT:site_package/Resources/Private/Templates/
        }

        dataProcessing {
            10 = TYPO3\CMS\Frontend\DataProcessing\MenuProcessor
            10 {
                levels = 2
                includeSpacer = 1
                as = mainNavigation
            }

            20 = TYPO3\CMS\Frontend\DataProcessing\LanguageMenuProcessor
            20 {
                languages = auto
                as = languageNavigation
            }
        }

        variables {
            copyrightYear = TEXT
            copyrightYear.data = date:U
            copyrightYear.date = Y
        }
    }
}

config {
    no_cache = 0
    sendCacheHeaders = 1
    # contentObjectExceptionHandler = 0  # DEV ONLY — shows exceptions. Remove in production!
}
```

## TypoScript (v12 — FLUIDTEMPLATE approach, legacy)

Do not use this variant for new v13/v14 projects — PAGEVIEW is the standard. FLUIDTEMPLATE remains valid for non-page rendering (e.g. emails, standalone snippets).

```typoscript
page = PAGE
page {
    typeNum = 0

    # HTML5 doctype
    config {
        doctype = html5
        htmlTag_setParams = class="no-js" lang="en" dir="ltr"
        pageTitleFirst = 1
        pageTitleSeparator = |
        pageTitleSeparator.noTrimWrap = | | |
        absRefPrefix = auto
        removeDefaultJS = external
        # v12 only: removed in v14 (#108055) — use external build tools instead.
        compressJs = 1
        compressCss = 1
        concatenateJs = 1
        concatenateCss = 1
    }

    # Include CSS
    includeCSS {
        main = EXT:site_package/Resources/Public/Css/main.css
    }

    # Include JavaScript
    includeJSFooter {
        main = EXT:site_package/Resources/Public/JavaScript/main.js
    }

    # Header data
    headerData {
        10 = TEXT
        10.value = <link rel="icon" href="/favicon.ico" type="image/x-icon">

        20 = TEXT
        20.value = <meta name="viewport" content="width=device-width, initial-scale=1">
    }

    # Body tag
    bodyTagCObject = COA
    bodyTagCObject {
        10 = TEXT
        10.data = pagelayout
        10.wrap = <body class="layout-|">
    }

    # Main content rendering with FLUIDTEMPLATE
    10 = FLUIDTEMPLATE
    10 {
        templateName = Default
        templateRootPaths {
            10 = EXT:site_package/Resources/Private/Templates/Page/
        }
        partialRootPaths {
            10 = EXT:site_package/Resources/Private/Partials/Page/
        }
        layoutRootPaths {
            10 = EXT:site_package/Resources/Private/Layouts/Page/
        }

        dataProcessing {
            10 = TYPO3\CMS\Frontend\DataProcessing\MenuProcessor
            10 {
                levels = 2
                includeSpacer = 1
                as = mainNavigation
            }

            20 = TYPO3\CMS\Frontend\DataProcessing\LanguageMenuProcessor
            20 {
                languages = auto
                as = languageNavigation
            }
        }

        variables {
            pageTitle = TEXT
            pageTitle.data = page:title

            rootPageId = TEXT
            rootPageId.data = leveluid:0

            copyrightYear = TEXT
            copyrightYear.data = date:U
            copyrightYear.date = Y
        }
    }
}

# Global configuration
config {
    no_cache = 0
    sendCacheHeaders = 1
    # contentObjectExceptionHandler = 0  # DEV ONLY — shows exceptions. Remove in production!
}
```

## Fluid Template (v13+ — PAGEVIEW)

With PAGEVIEW, the template is resolved automatically based on the backend layout. The directory structure matters:

```
Resources/Private/Templates/
  pages/
    Default.html          ← fallback
    Layout1.html          ← for backendLayout "Layout1"
    layouts/
      Default.html        ← layout file
    partials/
      Navigation/
        Main.html
```

File: `EXT:site_package/Resources/Private/Templates/pages/Default.html`

```html
<f:layout name="Default" />

<f:section name="Main">
    <header class="site-header">
        <nav class="main-navigation">
            <f:render partial="Navigation/Main" arguments="{mainNavigation: mainNavigation}" />
        </nav>
    </header>

    <main class="site-content" id="content">
        <f:cObject typoscriptObjectPath="lib.dynamicContent" data="{pageUid: '{data.uid}', colPos: 0}" />
    </main>

    <footer class="site-footer">
        <p>&copy; {copyrightYear} My Company</p>
    </footer>
</f:section>
```

## Fluid Template (v12 — FLUIDTEMPLATE, legacy)

File: `EXT:site_package/Resources/Private/Layouts/Page/Default.html`

```html
<f:layout name="Default" />

<f:section name="Main">
    <header class="site-header">
        <nav class="main-navigation">
            <f:render partial="Navigation/Main" arguments="{mainNavigation: mainNavigation}" />
        </nav>
        <f:render partial="Navigation/Language" arguments="{languageNavigation: languageNavigation}" />
    </header>

    <main class="site-content" id="content">
        <f:render section="Content" />
    </main>

    <footer class="site-footer">
        <p>&copy; {copyrightYear} My Company</p>
    </footer>
</f:section>
```

File: `EXT:site_package/Resources/Private/Templates/Page/Default.html`

```html
<f:layout name="Default" />

<f:section name="Content">
    <f:cObject typoscriptObjectPath="lib.dynamicContent" data="{pageUid: '{data.uid}', colPos: 0}" />
</f:section>
```

## Dynamic Content Library (both versions)

```typoscript
lib.dynamicContent = COA
lib.dynamicContent {
    10 = CONTENT
    10 {
        table = tt_content
        select {
            orderBy = sorting
            where = {#colPos}=0
        }
    }
}
```

## Notes

- v13+ uses `PAGEVIEW` with a convention-based directory structure under `pages/`; templates resolve by backend layout identifier. This is the standard for v14.
- v12 uses `FLUIDTEMPLATE` with explicit `templateRootPaths`, `partialRootPaths`, and `layoutRootPaths`. FLUIDTEMPLATE is legacy for page rendering — not officially deprecated, still valid for non-page use cases.
- `compressJs`, `compressCss`, `concatenateJs`, `concatenateCss` were removed in v14 (#108055). Use external build tools (Vite, Webpack) instead.
- `config.absRefPrefix` was removed in v14 (#108114). Use `config.forceAbsoluteUrls = 1` only when absolute URLs are required; in v12/v13 prefer `absRefPrefix = auto`.
- Language and locale are configured in the Site Configuration (since v10) — not via `config.language` / `config.sys_language_uid` / `config.locale_all` in TypoScript.
- `contentObjectExceptionHandler = 0` is commented out by default. Only enable in development for debugging. In production, keep `1` (the default) to prevent broken pages.
- The `lib.dynamicContent` helper is commonly used to render content columns from within Fluid templates.
