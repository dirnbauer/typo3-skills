# Recipe: Breadcrumb Navigation

> Version: v12+

## What this builds
A breadcrumb navigation using the MenuProcessor with rootline type, including a Fluid template with accessible markup and JSON-LD structured data for SEO.

## TypoScript

```typoscript
page.10 {
    dataProcessing {
        40 = TYPO3\CMS\Frontend\DataProcessing\MenuProcessor
        40 {
            special = rootline
            special.range = 0|-1
            includeNotInMenu = 0
            as = breadcrumb

            # Remove spacer pages from breadcrumb
            excludeDoktypes = 199,254
        }
    }
}
```

## Fluid Template

File: `EXT:site_package/Resources/Private/Partials/Navigation/Breadcrumb.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:if condition="{breadcrumb -> f:count()} > 1">
    <nav class="breadcrumb" aria-label="Breadcrumb">
        <ol class="breadcrumb__list" itemscope itemtype="https://schema.org/BreadcrumbList">
            <f:for each="{breadcrumb}" as="item" iteration="iterator">
                <li class="breadcrumb__item{f:if(condition: item.current, then: ' breadcrumb__item--current')}"
                    itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
                    <f:if condition="{item.current}">
                        <f:then>
                            <span class="breadcrumb__text" itemprop="name" aria-current="page">
                                {item.title}
                            </span>
                        </f:then>
                        <f:else>
                            <a href="{item.link}" class="breadcrumb__link" itemprop="item">
                                <span itemprop="name">{item.title}</span>
                            </a>
                        </f:else>
                    </f:if>
                    <meta itemprop="position" content="{iterator.cycle}" />
                    <f:if condition="!{item.current}">
                        <span class="breadcrumb__separator" aria-hidden="true">/</span>
                    </f:if>
                </li>
            </f:for>
        </ol>
    </nav>

    <f:comment><!-- JSON-LD structured data for breadcrumb --></f:comment>
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [<f:for each="{breadcrumb}" as="item" iteration="iterator">
            {
                "@type": "ListItem",
                "position": {iterator.cycle},
                "name": "{item.title -> f:format.htmlentitiesDecode()}",
                "item": "<f:if condition="{item.current}"><f:then>{f:uri.page(pageUid: item.data.uid, absolute: 1)}</f:then><f:else>{item.link}</f:else></f:if>"
            }<f:if condition="!{iterator.isLast}">,</f:if></f:for>
        ]
    }
    </script>
</f:if>
</html>
```

## Alternative: Classic HMENU Breadcrumb

```typoscript
lib.breadcrumb = HMENU
lib.breadcrumb {
    special = rootline
    special.range = 0|-1

    1 = TMENU
    1 {
        NO {
            wrapItemAndSub = <li class="breadcrumb__item">|</li>
            ATagTitle.field = nav_title // title
            stdWrap.htmlSpecialChars = 1
        }
        CUR = 1
        CUR {
            wrapItemAndSub = <li class="breadcrumb__item breadcrumb__item--current" aria-current="page">|</li>
            doNotLinkIt = 1
            stdWrap.htmlSpecialChars = 1
        }
        wrap = <nav aria-label="Breadcrumb"><ol class="breadcrumb__list">|</ol></nav>
    }
}
```

## Breadcrumb with Home Icon

File: `EXT:site_package/Resources/Private/Partials/Navigation/BreadcrumbWithHome.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:if condition="{breadcrumb -> f:count()} > 1">
    <nav class="breadcrumb" aria-label="Breadcrumb">
        <ol class="breadcrumb__list">
            <f:for each="{breadcrumb}" as="item" iteration="iterator">
                <li class="breadcrumb__item{f:if(condition: item.current, then: ' breadcrumb__item--current')}">
                    <f:if condition="{item.current}">
                        <f:then>
                            <span class="breadcrumb__text" aria-current="page">
                                {item.title}
                            </span>
                        </f:then>
                        <f:else>
                            <a href="{item.link}" class="breadcrumb__link">
                                <f:if condition="{iterator.isFirst}">
                                    <f:then>
                                        <span class="breadcrumb__home-icon" aria-hidden="true">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                                                <polyline points="9 22 9 12 15 12 15 22"></polyline>
                                            </svg>
                                        </span>
                                        <span class="sr-only">Home</span>
                                    </f:then>
                                    <f:else>
                                        {item.title}
                                    </f:else>
                                </f:if>
                            </a>
                            <span class="breadcrumb__separator" aria-hidden="true">
                                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </span>
                        </f:else>
                    </f:if>
                </li>
            </f:for>
        </ol>
    </nav>
</f:if>
</html>
```

## Notes
- `special.range = 0|-1` starts from the root page (0) and goes to the current page (-1). Use `1|-1` to skip the root page.
- The `breadcrumb` array from `MenuProcessor` provides `title`, `link`, `active`, `current`, and `data` (full page record) for each item.
- Only show the breadcrumb when there are more than one item (root + current page at minimum) to avoid showing just "Home".
- JSON-LD structured data for breadcrumbs is recommended by Google. It appears as breadcrumb rich snippets in search results.
- Microdata attributes (`itemscope`, `itemprop`) in the HTML provide an additional structured data signal but JSON-LD is preferred.
- `aria-label="Breadcrumb"` and `aria-current="page"` on the current item ensure screen reader accessibility.
- `nav_title // title` in HMENU uses the navigation title if set, falling back to the page title.
- For the JSON-LD output, use `f:format.htmlentitiesDecode()` to ensure clean text without HTML entities in the JSON.
