# Recipe: 404/403 Error Page Setup

> Version: v12+

## What this builds
Custom error page handling for 404 (Not Found), 403 (Forbidden), and 500 (Server Error) responses using TYPO3's site configuration and TypoScript-based error page rendering.

## Site Configuration

File: `config/sites/main/config.yaml`
```yaml
rootPageId: 1
base: 'https://www.example.com/'

errorHandling:
  -
    errorCode: 404
    errorHandler: Page
    errorContentSource: 't3://page?uid=50'
  -
    errorCode: 403
    errorHandler: Page
    errorContentSource: 't3://page?uid=51'
  -
    errorCode: 500
    errorHandler: Page
    errorContentSource: 't3://page?uid=52'
  -
    errorCode: 0
    errorHandler: Page
    errorContentSource: 't3://page?uid=52'

languages:
  -
    title: English
    languageId: 0
    base: /
    locale: en_US.UTF-8
    errorHandling:
      -
        errorCode: 404
        errorHandler: Page
        errorContentSource: 't3://page?uid=50'
      -
        errorCode: 403
        errorHandler: Page
        errorContentSource: 't3://page?uid=51'
  -
    title: Deutsch
    languageId: 1
    base: /de/
    locale: de_DE.UTF-8
    errorHandling:
      -
        errorCode: 404
        errorHandler: Page
        errorContentSource: 't3://page?uid=60'
      -
        errorCode: 403
        errorHandler: Page
        errorContentSource: 't3://page?uid=61'
```

## Error Handler Types

### Page Handler (recommended)
Renders a TYPO3 page as error content:
```yaml
errorHandling:
  -
    errorCode: 404
    errorHandler: Page
    errorContentSource: 't3://page?uid=50'
```

### PHP Handler (custom class)
Uses a custom PHP class for error handling:
```yaml
errorHandling:
  -
    errorCode: 404
    errorHandler: PHP
    errorPhpClassFQCN: Vendor\SitePackage\Error\NotFoundHandler
```

### Fluid Handler
Renders a Fluid template directly:
```yaml
errorHandling:
  -
    errorCode: 404
    errorHandler: Fluid
    errorFluidTemplate: 'EXT:site_package/Resources/Private/Templates/Error/404.html'
    errorFluidTemplatesRootPath: 'EXT:site_package/Resources/Private/Templates/Error/'
    errorFluidLayoutsRootPath: 'EXT:site_package/Resources/Private/Layouts/Error/'
    errorFluidPartialsRootPath: 'EXT:site_package/Resources/Private/Partials/Error/'
```

## TypoScript — Error Page Template

The error page (uid=50) uses the normal page rendering. Add specific content for the 404 page:

```typoscript
# Error page-specific configuration
[traverse(page, "uid") == 50]
    page.meta.robots = noindex, nofollow

    # Add search form to help users find what they need
    lib.errorSearch = COA
    lib.errorSearch {
        10 = TEXT
        10.value = <div class="error-search">

        20 = COA
        20 {
            10 = TEXT
            10.value = <form action="/search" method="get" class="error-search__form">
            20 = TEXT
            20.value = <label for="error-search-input" class="error-search__label">Search our site:</label>
            30 = TEXT
            30.value = <input type="search" id="error-search-input" name="tx_solr[q]" class="error-search__input" placeholder="What are you looking for?">
            40 = TEXT
            40.value = <button type="submit" class="error-search__button">Search</button>
            50 = TEXT
            50.value = </form>
        }

        30 = TEXT
        30.value = </div>
    }
[end]

[traverse(page, "uid") == 52]
    page.meta.robots = noindex, nofollow
[end]
```

## Fluid Template — Custom 404 Page (Fluid Handler)

File: `EXT:site_package/Resources/Private/Templates/Error/404.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>Page Not Found - Example Company</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            display: flex;
            min-height: 100vh;
            align-items: center;
            justify-content: center;
            background-color: #f8f9fa;
        }
        .error-page {
            text-align: center;
            padding: 2rem;
            max-width: 600px;
        }
        .error-page__code {
            font-size: 6rem;
            font-weight: 700;
            color: #dee2e6;
            line-height: 1;
        }
        .error-page__title {
            font-size: 1.5rem;
            margin: 1rem 0;
        }
        .error-page__message {
            color: #6c757d;
            margin-bottom: 2rem;
        }
        .error-page__link {
            display: inline-block;
            padding: 0.75rem 1.5rem;
            background-color: #0d6efd;
            color: #fff;
            text-decoration: none;
            border-radius: 0.25rem;
        }
        .error-page__link:hover {
            background-color: #0b5ed7;
        }
    </style>
</head>
<body>
    <main class="error-page">
        <div class="error-page__code">404</div>
        <h1 class="error-page__title">Page Not Found</h1>
        <p class="error-page__message">
            The page you are looking for might have been removed, had its name changed,
            or is temporarily unavailable.
        </p>
        <p class="error-page__message">
            Requested URL: <code>{url}</code>
        </p>
        <a href="/" class="error-page__link">Go to Homepage</a>
    </main>
</body>
</html>
</html>
```

## Custom PHP Error Handler

File: `EXT:site_package/Classes/Error/NotFoundHandler.php`
```php
<?php

declare(strict_types=1);

namespace Vendor\SitePackage\Error;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Core\Error\PageErrorHandler\PageErrorHandlerInterface;
use TYPO3\CMS\Core\Http\HtmlResponse;
use TYPO3\CMS\Core\Http\RedirectResponse;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use TYPO3\CMS\Fluid\View\StandaloneView;

class NotFoundHandler implements PageErrorHandlerInterface
{
    private int $statusCode;

    public function __construct(int $statusCode, array $configuration)
    {
        $this->statusCode = $statusCode;
    }

    public function handlePageError(
        ServerRequestInterface $request,
        string $message,
        array $reasons = []
    ): ResponseInterface {
        $requestedUrl = (string)$request->getUri();

        // Redirect known old URLs
        $redirectMap = [
            '/old-about-us' => '/about/',
            '/old-contact' => '/contact/',
        ];

        $path = $request->getUri()->getPath();
        if (isset($redirectMap[$path])) {
            return new RedirectResponse($redirectMap[$path], 301);
        }

        // Render 404 template
        $view = GeneralUtility::makeInstance(StandaloneView::class);
        $view->setTemplatePathAndFilename(
            'EXT:site_package/Resources/Private/Templates/Error/NotFound.html'
        );
        $view->assignMultiple([
            'url' => $requestedUrl,
            'statusCode' => $this->statusCode,
            'message' => $message,
        ]);

        return new HtmlResponse($view->render(), $this->statusCode);
    }
}
```

## TSconfig — Hide Error Pages from Navigation

```tsconfig
# Hide error pages in page tree navigation menus
# (alternative: set nav_hide in page properties)
TCEMAIN.table.pages.disableHideAtCopy = 0
```

## TypoScript — Exclude Error Pages from Sitemap

```typoscript
plugin.tx_seo.config.xmlSitemap.sitemaps.pages.config {
    additionalWhere = {#no_index} = 0 AND {#uid} NOT IN (50,51,52,60,61)
}
```

## Notes
- The `Page` error handler fetches the TYPO3 page content via an internal subrequest. This gives full TypoScript/Fluid rendering but requires the error page to be accessible.
- Error code `0` is the catch-all for any HTTP error not explicitly configured.
- Language-specific error handling is configured within each language section of `config.yaml`. This allows different error pages per language.
- The `Fluid` error handler renders a standalone Fluid template without full TYPO3 page rendering. It is faster but lacks TypoScript processing.
- The `PHP` error handler gives maximum flexibility (redirects, logging, custom logic) but requires custom PHP code.
- Error pages should always have `noindex, nofollow` meta tags to prevent search engine indexing.
- Avoid creating circular errors: the error page itself must render without errors. Do not use complex plugins or database-dependent content on error pages.
- In v12+, the site configuration error handling replaces the old `config.typolinkLinkAccessRestrictedPages` approach for 403 errors.
- Test error pages by visiting a non-existent URL. Check that the HTTP status code is actually 404 (not 200) using browser DevTools.
- For v13+, the error handling configuration remains the same in `config.yaml`.
