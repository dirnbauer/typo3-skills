# Recipe: JSON-LD Schema.org Structured Data

> Version: v12+

## What this builds

JSON-LD Schema.org markup generated via TypoScript headerData for Organization, WebSite, BreadcrumbList, and WebPage types to enhance search engine visibility.

## TypoScript — Organization Schema

```typoscript
page.headerData {
    200 = COA
    200 {
        # Organization
        10 = TEXT
        10 {
            value (
<script type="application/ld+json">
{
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Example GmbH",
    "url": "https://www.example.com",
    "logo": {
        "@type": "ImageObject",
        "url": "https://www.example.com/fileadmin/images/logo.svg",
        "width": 280,
        "height": 60
    },
    "contactPoint": {
        "@type": "ContactPoint",
        "telephone": "+49-30-123456",
        "contactType": "customer service",
        "availableLanguage": ["German", "English"]
    },
    "address": {
        "@type": "PostalAddress",
        "streetAddress": "Musterstrasse 42",
        "addressLocality": "Berlin",
        "postalCode": "10115",
        "addressCountry": "DE"
    },
    "sameAs": [
        "https://www.linkedin.com/company/example-gmbh",
        "https://www.xing.com/pages/example-gmbh"
    ]
}
</script>
            )

            # Only on the root page
            if.value = 1
            if.equals.data = page:uid
        }
    }
}
```

## TypoScript — WebSite with SearchAction

```typoscript
page.headerData {
    210 = COA
    210 {
        10 = TEXT
        10 {
            value (
<script type="application/ld+json">
{
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "Example GmbH",
    "url": "https://www.example.com",
    "potentialAction": {
        "@type": "SearchAction",
        "target": {
            "@type": "EntryPoint",
            "urlTemplate": "https://www.example.com/search?q={search_term_string}"
        },
        "query-input": "required name=search_term_string"
    }
}
</script>
            )

            # Only on the root page
            if.value = 1
            if.equals.data = page:uid
        }
    }
}
```

## TypoScript — Dynamic WebPage Schema (every page)

```typoscript
page.headerData {
    220 = COA
    220 {
        10 = COA
        10 {
            wrap = <script type="application/ld+json">|</script>

            10 = TEXT
            10.value = {

            20 = TEXT
            20.value = "@context": "https://schema.org",

            30 = TEXT
            30.value = "@type": "WebPage",

            40 = COA
            40 {
                10 = TEXT
                10 {
                    data = page:title
                    htmlSpecialChars = 1
                    wrap = "name": "|",
                }
            }

            50 = COA
            50 {
                10 = TEXT
                10 {
                    data = page:abstract // page:description
                    htmlSpecialChars = 1
                    wrap = "description": "|",
                    required = 1
                }
            }

            60 = COA
            60 {
                10 = TEXT
                10 {
                    typolink {
                        # page:uid — the TSFE getData key is not available in v14
                        parameter.data = page:uid
                        returnLast = url
                        forceAbsoluteUrl = 1
                    }
                    wrap = "url": "|",
                }
            }

            70 = COA
            70 {
                10 = TEXT
                10 {
                    data = page:lastUpdated // page:tstamp
                    strftime = %Y-%m-%dT%H:%M:%S+00:00
                    wrap = "dateModified": "|",
                }
            }

            80 = TEXT
            80 {
                data = page:crdate
                strftime = %Y-%m-%dT%H:%M:%S+00:00
                wrap = "datePublished": "|"
            }

            90 = TEXT
            90.value = }
        }
    }
}
```

## Fluid-Based Approach (BreadcrumbList + WebPage combined)

For more complex structured data, generating JSON-LD in Fluid templates gives better control.

File: `EXT:site_package/Resources/Private/Partials/Meta/StructuredData.html`

```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:comment><!-- BreadcrumbList --></f:comment>
<f:if condition="{breadcrumb -> f:count()} > 1">
<script type="application/ld+json">
{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [<f:for each="{breadcrumb}" as="item" iteration="iterator">
        {
            "@type": "ListItem",
            "position": {iterator.cycle},
            "name": "<f:format.htmlentitiesDecode>{item.title}</f:format.htmlentitiesDecode>",
            "item": "<f:if condition="{item.current}"><f:then>{f:uri.page(pageUid: item.data.uid, absolute: 1)}</f:then><f:else>{item.link}</f:else></f:if>"
        }<f:if condition="!{iterator.isLast}">,</f:if></f:for>
    ]
}
</script>
</f:if>

<f:comment><!-- LocalBusiness (for location-based businesses) --></f:comment>
<f:if condition="{settings.structuredData.localBusiness}">
<script type="application/ld+json">
{
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": "{settings.company.name}",
    "image": "{settings.company.logoUrl}",
    "telephone": "{settings.company.phone}",
    "email": "{settings.company.email}",
    "url": "{settings.company.url}",
    "address": {
        "@type": "PostalAddress",
        "streetAddress": "{settings.company.street}",
        "addressLocality": "{settings.company.city}",
        "postalCode": "{settings.company.zip}",
        "addressCountry": "{settings.company.country}"
    },
    "geo": {
        "@type": "GeoCoordinates",
        "latitude": "{settings.company.latitude}",
        "longitude": "{settings.company.longitude}"
    },
    "openingHoursSpecification": [
        {
            "@type": "OpeningHoursSpecification",
            "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            "opens": "08:00",
            "closes": "18:00"
        }
    ]
}
</script>
</f:if>
</html>
```

## TypoScript — Settings for Fluid-Based Structured Data

```typoscript
page.10 {
    settings {
        structuredData {
            localBusiness = 1
        }
        company {
            name = Example GmbH
            logoUrl = https://www.example.com/fileadmin/images/logo.svg
            phone = +49-30-123456
            email = info@example.com
            url = https://www.example.com
            street = Musterstrasse 42
            city = Berlin
            zip = 10115
            country = DE
            latitude = 52.5200
            longitude = 13.4050
        }
    }
}
```

## TypoScript — FAQ Page Schema (for FAQ pages)

```typoscript
# Add to specific page or use conditions
[traverse(page, "uid") == 25]
    page.headerData.230 = COA
    page.headerData.230 {
        wrap = <script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[|]}</script>

        10 = CONTENT
        10 {
            table = tt_content
            select {
                where = {#CType} = 'text' AND {#colPos} = 0
                orderBy = sorting
            }
            renderObj = COA
            renderObj {
                10 = TEXT
                10.field = header
                10.htmlSpecialChars = 1
                10.wrap = {"@type":"Question","name":"|",

                20 = TEXT
                20.field = bodytext
                20.stripHtml = 1
                20.htmlSpecialChars = 1
                20.crop = 500
                20.wrap = "acceptedAnswer":{"@type":"Answer","text":"|"}}

                stdWrap.wrap = |,
                stdWrap.trimRight = ,
            }
        }
    }
[end]
```

## Notes

- JSON-LD is Google's preferred format for structured data. It goes in the `<head>` or `<body>` of the page.
- Use `headerData` with numeric keys to organize different schema types. Keep keys spaced (200, 210, 220) for easy insertion.
- Always use absolute URLs in structured data (`forceAbsoluteUrl = 1`).
- Test structured data with Google's Rich Results Test (<https://search.google.com/test/rich-results>) and Schema.org Validator.
- `htmlSpecialChars = 1` is essential for any dynamic data inserted into JSON to prevent XSS and JSON syntax errors.
- For complex dynamic structured data, the Fluid-based approach is cleaner and more maintainable than pure TypoScript.
- The Organization schema should only appear on the homepage (`if.value = 1` / `if.equals.data = page:uid`).
- BreadcrumbList should appear on all pages except the homepage.
- Consider the `schema` extension (EXT:schema) for a more PHP/ViewHelper-based approach to structured data in v12+.
