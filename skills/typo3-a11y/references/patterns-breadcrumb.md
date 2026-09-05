# Pattern: Breadcrumb

Complete breadcrumb pattern with Fluid partial, JSON-LD structured data, and SCSS.

## TypoScript DataProcessor

```typoscript
# Already configured in page.typoscript via PAGEVIEW
page.10.dataProcessing {
    80 = menu
    80 {
        as = breadcrumb
        special = rootline
        special.range = 0|-1
    }
}
```

## Fluid Partial

```html
<!-- PageView/Partials/Header/Breadcrumb.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<f:if condition="{breadcrumb -> f:count()} > 1">
    <nav aria-label="{f:translate(key: 'breadcrumb', extensionName: 'my_sitepackage')}" class="breadcrumb-nav">
        <div class="container">
            <ol class="breadcrumb" itemscope itemtype="https://schema.org/BreadcrumbList">
                <f:for each="{breadcrumb}" as="item" iteration="iter">
                    <li class="breadcrumb-item{f:if(condition: '{iter.isLast}', then: ' active')}"
                        itemprop="itemListElement" itemscope itemtype="https://schema.org/ListItem">
                        <f:if condition="{iter.isLast}">
                            <f:then>
                                <span itemprop="name">{item.title}</span>
                            </f:then>
                            <f:else>
                                <f:link.typolink parameter="{item.link}" itemprop="item">
                                    <span itemprop="name">{item.title}</span>
                                </f:link.typolink>
                            </f:else>
                        </f:if>
                        <meta itemprop="position" content="{iter.cycle}" />
                    </li>
                </f:for>
            </ol>
        </div>
    </nav>

    <!-- JSON-LD Structured Data for SEO -->
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            <f:for each="{breadcrumb}" as="item" iteration="iter">
            {
                "@type": "ListItem",
                "position": {iter.cycle},
                "name": {item.title -> f:format.json()},
                "item": {f:uri.typolink(parameter: item.link) -> f:format.json()}
            }<f:if condition="!{iter.isLast}">,</f:if>
            </f:for>
        ]
    }
    </script>
</f:if>

</html>
```

## SCSS

```scss
// Page/_breadcrumb.scss

.breadcrumb-nav {
    padding: 0.75rem 0;
    background-color: $gray-100;
    border-bottom: 1px solid $border-color;
}

.breadcrumb {
    margin-bottom: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    font-size: 0.875rem;

    .breadcrumb-item {
        display: flex;
        align-items: center;

        + .breadcrumb-item {
            padding-left: 0.5rem;

            &::before {
                display: inline-block;
                padding-right: 0.5rem;
                content: '/';
                color: $text-muted;
            }
        }

        a {
            color: $text-muted;
            text-decoration: none;
            transition: color 0.2s ease;

            &:hover {
                color: $primary;
                text-decoration: underline;
            }
        }

        &.active {
            color: $body-color;
            font-weight: $font-weight-bold;
        }
    }
}

// Mobile: truncate long breadcrumbs
@media (max-width: map-get($grid-breakpoints, md) - 0.02px) {
    .breadcrumb {
        overflow-x: auto;
        flex-wrap: nowrap;
        scrollbar-width: none;

        &::-webkit-scrollbar {
            display: none;
        }

        .breadcrumb-item {
            white-space: nowrap;
        }
    }
}
```

## Include in Page Layout

```html
<!-- PageView/Layouts/Default.html -->
<header class="main-header" id="main-header">
    <f:render section="Header" />
</header>

<f:render partial="Header/Breadcrumb" arguments="{breadcrumb: breadcrumb}" />

<main id="main-content">
    <f:render section="Main" />
</main>
```

## Labels

```xml
<!-- locallang.xlf -->
<trans-unit id="breadcrumb"><source>Breadcrumb</source></trans-unit>

<!-- de.locallang.xlf -->
<trans-unit id="breadcrumb">
    <source>Breadcrumb</source>
    <target>Brotkrumennavigation</target>
</trans-unit>
```

## Key Points

- **Schema.org markup** in both Microdata (HTML) and JSON-LD (script) for maximum SEO compatibility
- **Last item not linked** -- current page is plain text with `active` class
- **Mobile scrollable** -- horizontal scroll instead of wrapping on small screens
- **Accessible** -- `nav` with `aria-label`, semantic `ol` list
- **Hidden on root page** -- only shown when breadcrumb has more than 1 item
