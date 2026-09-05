# Recipe: XML Sitemap Configuration

> Version: v12+

## What this builds
An XML sitemap with configurable providers for pages, custom record types, and additional sitemap entries, used by search engines for crawling and indexing.

## TypoScript — Basic Sitemap Setup

```typoscript
plugin.tx_seo {
    config {
        xmlSitemap {
            sitemaps {
                # Pages sitemap (built-in provider)
                pages {
                    provider = TYPO3\CMS\Seo\XmlSitemap\PagesXmlSitemapDataProvider
                    config {
                        # Exclude specific pages by UID
                        excludedDoktypes = 3,4,6,7,199,254,255

                        # Additional pages to exclude
                        # excludePagesRecursive = 42,100

                        # Only include pages with certain conditions
                        additionalWhere = {#no_index} = 0
                    }
                }

                # News records sitemap
                news {
                    provider = TYPO3\CMS\Seo\XmlSitemap\RecordsXmlSitemapDataProvider
                    config {
                        table = tx_news_domain_model_news
                        sortField = datetime
                        lastModifiedField = tstamp
                        changeFreqField = sitemap_changefreq
                        priorityField = sitemap_priority
                        additionalWhere = {#hidden} = 0 AND {#deleted} = 0 AND {#datetime} > 0
                        pid = 15
                        recursive = 2
                        url {
                            pageId = 12
                            fieldToParameterMap {
                                uid = tx_news_pi1[news]
                            }
                            additionalGetParameters {
                                tx_news_pi1.controller = News
                                tx_news_pi1.action = detail
                            }
                            useCacheHash = 1
                        }
                    }
                }

                # Blog posts sitemap
                blog {
                    provider = TYPO3\CMS\Seo\XmlSitemap\RecordsXmlSitemapDataProvider
                    config {
                        table = tx_blogexample_domain_model_post
                        sortField = crdate
                        lastModifiedField = tstamp
                        additionalWhere = {#hidden} = 0 AND {#deleted} = 0
                        pid = 30
                        recursive = 0
                        url {
                            pageId = 28
                            fieldToParameterMap {
                                uid = tx_blog_pi1[post]
                            }
                            additionalGetParameters {
                                tx_blog_pi1.controller = Post
                                tx_blog_pi1.action = show
                            }
                        }
                    }
                }
            }
        }
    }
}
```

## TypoScript — Per-Language Sitemap Configuration

```typoscript
# Default sitemap config applies to all languages
plugin.tx_seo {
    config {
        xmlSitemap {
            sitemaps {
                pages {
                    provider = TYPO3\CMS\Seo\XmlSitemap\PagesXmlSitemapDataProvider
                    config {
                        excludedDoktypes = 3,4,6,7,199,254,255
                    }
                }
            }
        }
    }
}

# German-specific news sitemap with different storage page
[siteLanguage("languageId") == 1]
    plugin.tx_seo.config.xmlSitemap.sitemaps.news.config {
        additionalWhere = {#hidden} = 0 AND {#deleted} = 0 AND {#sys_language_uid} = 1
    }
[end]
```

## Site Configuration — Route Enhancer for Sitemap

The SEO extension registers the sitemap route automatically. The sitemap is available at:
- `https://www.example.com/sitemap.xml` (index)
- `https://www.example.com/sitemap.xml?sitemap=pages&type=1533906435` (pages sitemap)
- `https://www.example.com/sitemap.xml?sitemap=news&type=1533906435` (news sitemap)

For clean URLs, add to `config/sites/main/config.yaml`:
```yaml
routeEnhancers:
  PageTypeSuffix:
    type: PageType
    map:
      sitemap.xml: 1533906435
```

## robots.txt Reference

File: `public/robots.txt` (or generate via TypoScript)
```
User-agent: *
Allow: /

Sitemap: https://www.example.com/sitemap.xml
```

## TypoScript — Dynamic robots.txt

```typoscript
robotsTxt = PAGE
robotsTxt {
    typeNum = 1533906437
    config {
        disableAllHeaderCode = 1
        additionalHeaders.10.header = Content-Type: text/plain; charset=utf-8
    }

    10 = COA
    10 {
        10 = TEXT
        10.value (
User-agent: *
Allow: /
Disallow: /typo3/
Disallow: /typo3conf/

        )

        20 = TEXT
        20 {
            typolink {
                parameter = 1
                returnLast = url
                forceAbsoluteUrl = 1
                additionalParams = &type=1533906435
            }
            wrap = Sitemap: |
        }
    }
}
```

## Custom Sitemap DataProvider (PHP)

For complex sitemap logic, create a custom data provider:

File: `EXT:site_package/Classes/XmlSitemap/ProductSitemapDataProvider.php`
```php
<?php

declare(strict_types=1);

namespace Vendor\SitePackage\XmlSitemap;

use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Utility\GeneralUtility;
use TYPO3\CMS\Seo\XmlSitemap\AbstractXmlSitemapDataProvider;

class ProductSitemapDataProvider extends AbstractXmlSitemapDataProvider
{
    public function getItems(): array
    {
        $connectionPool = GeneralUtility::makeInstance(ConnectionPool::class);
        $queryBuilder = $connectionPool->getQueryBuilderForTable('tx_shop_product');

        $products = $queryBuilder
            ->select('uid', 'title', 'slug', 'tstamp')
            ->from('tx_shop_product')
            ->where(
                $queryBuilder->expr()->eq('hidden', 0),
                $queryBuilder->expr()->eq('deleted', 0),
                $queryBuilder->expr()->gt('stock', 0)
            )
            ->orderBy('title')
            ->executeQuery()
            ->fetchAllAssociative();

        $items = [];
        foreach ($products as $product) {
            $items[] = [
                'loc' => $this->defineUrl($product),
                'lastMod' => (int)$product['tstamp'],
                'changefreq' => 'weekly',
                'priority' => 0.7,
            ];
        }

        return $items;
    }

    protected function defineUrl(array $product): string
    {
        $pageId = (int)($this->config['url']['pageId'] ?? 1);
        return $this->getPageUrl($pageId, [
            'tx_shop_pi1' => [
                'product' => $product['uid'],
                'controller' => 'Product',
                'action' => 'show',
            ],
        ]);
    }

    private function getPageUrl(int $pageId, array $additionalParams): string
    {
        $request = $GLOBALS['TYPO3_REQUEST'] ?? null;
        if ($request instanceof ServerRequestInterface) {
            $site = $request->getAttribute('site');
            $router = $site->getRouter();
            $uri = $router->generateUri(
                (string)$pageId,
                $additionalParams
            );
            return (string)$uri;
        }
        return '';
    }
}
```

Register in TypoScript:
```typoscript
plugin.tx_seo.config.xmlSitemap.sitemaps {
    products {
        provider = Vendor\SitePackage\XmlSitemap\ProductSitemapDataProvider
        config {
            url {
                pageId = 50
            }
        }
    }
}
```

## Notes
- The `seo` system extension must be installed (`composer require typo3/cms-seo`). It is included by default in v12+.
- The sitemap index is automatically generated at `/sitemap.xml` and lists all configured sitemap providers.
- `excludedDoktypes` removes page types from the sitemap. Default doktypes to exclude: 3 (external URL), 4 (shortcut), 6 (backend user section), 7 (mount point), 199 (spacer), 254 (folder), 255 (recycler).
- The `RecordsXmlSitemapDataProvider` is the standard provider for any database table. Configure `fieldToParameterMap` to map record fields to URL parameters.
- `additionalWhere` uses query builder syntax with `{#fieldname}` for proper field quoting.
- For large sitemaps (>50,000 URLs), TYPO3 automatically splits them into multiple sitemap files referenced by the index.
- Sitemap generation respects the `no_index` field on pages when using the `PagesXmlSitemapDataProvider`.
- In v13+, sitemaps work the same way. The SEO extension configuration has not changed significantly.
- Always test the sitemap output in a browser and validate it with Google Search Console.
