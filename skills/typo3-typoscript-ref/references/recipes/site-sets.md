# Recipe: Site Sets Setup

> Version: v13+ only

## What this builds
A complete Site Sets configuration that replaces the traditional sys_template-based TypoScript includes with a file-based, composable configuration approach introduced in TYPO3 v13.

## Directory Structure

```
EXT:site_package/
  Configuration/
    Sets/
      SitePackage/
        config.yaml           # Set definition
        settings.yaml         # Editable settings with defaults
        settings.definitions.yaml  # Settings schema definitions
        setup.typoscript      # TypoScript setup
        constants.typoscript  # TypoScript constants (optional, for migration)
        page.tsconfig         # Page TSconfig
        overrides.typoscript  # TypoScript that loads after dependencies
```

## Set Definition

File: `EXT:site_package/Configuration/Sets/SitePackage/config.yaml`
```yaml
name: vendor/site-package
label: Site Package - Corporate Website
# Dependencies: other sets that must be loaded before this one
dependencies:
  - typo3/fluid-styled-content
  - typo3/seo
```

## Settings Definitions

File: `EXT:site_package/Configuration/Sets/SitePackage/settings.definitions.yaml`
```yaml
settings:
  # Company information
  site_package.company.name:
    label: 'Company Name'
    description: 'The company name used in meta tags and footer'
    type: string
    default: 'Example GmbH'

  site_package.company.email:
    label: 'Contact Email'
    type: string
    default: 'info@example.com'

  site_package.company.phone:
    label: 'Contact Phone'
    type: string
    default: '+49-30-123456'

  site_package.company.street:
    label: 'Street Address'
    type: string
    default: 'Musterstrasse 42'

  site_package.company.city:
    label: 'City'
    type: string
    default: 'Berlin'

  site_package.company.zip:
    label: 'Postal Code'
    type: string
    default: '10115'

  site_package.company.country:
    label: 'Country Code'
    type: string
    default: 'DE'

  # Layout settings
  site_package.layout.maxWidth:
    label: 'Max Content Width'
    description: 'Maximum content width in pixels'
    type: int
    default: 1200

  site_package.layout.showBreadcrumb:
    label: 'Show Breadcrumb'
    type: bool
    default: true

  site_package.layout.footerColumns:
    label: 'Number of Footer Columns'
    type: int
    default: 3

  # Feature toggles
  site_package.features.darkMode:
    label: 'Enable Dark Mode Toggle'
    type: bool
    default: false

  site_package.features.cookieConsent:
    label: 'Enable Cookie Consent Banner'
    type: bool
    default: true

  site_package.features.searchAutocomplete:
    label: 'Enable Search Autocomplete'
    type: bool
    default: true

  # Social media
  site_package.social.linkedIn:
    label: 'LinkedIn URL'
    type: string
    default: ''

  site_package.social.xing:
    label: 'XING URL'
    type: string
    default: ''
```

## Settings Values (site-specific overrides)

File: `EXT:site_package/Configuration/Sets/SitePackage/settings.yaml`
```yaml
# Default values for all sites using this set
# Sites can override these in config/sites/<identifier>/settings.yaml
site_package.company.name: 'Example GmbH'
site_package.company.email: 'info@example.com'
site_package.layout.maxWidth: 1200
site_package.layout.showBreadcrumb: true
site_package.features.cookieConsent: true
```

## TypoScript Setup

File: `EXT:site_package/Configuration/Sets/SitePackage/setup.typoscript`
```typoscript
# Page rendering
page = PAGE
page {
    typeNum = 0

    config {
        doctype = html5
        metaCharset = utf-8
        pageTitleFirst = 1
        pageTitleSeparator = |
        pageTitleSeparator.noTrimWrap = | | |
        absRefPrefix = auto
    }

    includeCSSLibs {
        main = EXT:site_package/Resources/Public/Css/main.css
    }

    includeJSFooterlibs {
        main = EXT:site_package/Resources/Public/JavaScript/main.js
        main.defer = 1
    }

    headerData {
        10 = TEXT
        10.value = <meta name="viewport" content="width=device-width, initial-scale=1">
    }

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

            30 = TYPO3\CMS\Frontend\DataProcessing\MenuProcessor
            30 {
                special = rootline
                special.range = 0|-1
                as = breadcrumb
            }
        }

        variables {
            # Access settings via {settings.site_package.company.name} in Fluid
            companyName = TEXT
            companyName.value = {$site_package.company.name}

            showBreadcrumb = TEXT
            showBreadcrumb.value = {$site_package.layout.showBreadcrumb}

            maxWidth = TEXT
            maxWidth.value = {$site_package.layout.maxWidth}
        }
    }
}

# Dynamic content rendering
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

# Global configuration
config {
    no_cache = 0
    sendCacheHeaders = 1
    # contentObjectExceptionHandler = 0  # DEV ONLY — shows exceptions. Remove in production!
}
```

## Page TSconfig

File: `EXT:site_package/Configuration/Sets/SitePackage/page.tsconfig`
```tsconfig
# RTE preset
RTE.default.preset = SitePackage

# Backend layout configuration
mod.web_layout.BackendLayouts {
    default {
        title = Default Layout
        icon = EXT:site_package/Resources/Public/Icons/BackendLayouts/default.svg
        config {
            backend_layout {
                colCount = 1
                rowCount = 1
                rows {
                    1 {
                        columns {
                            1 {
                                name = Content
                                colPos = 0
                            }
                        }
                    }
                }
            }
        }
    }

    twoColumns {
        title = Two Columns
        icon = EXT:site_package/Resources/Public/Icons/BackendLayouts/two-columns.svg
        config {
            backend_layout {
                colCount = 2
                rowCount = 1
                rows {
                    1 {
                        columns {
                            1 {
                                name = Main Content
                                colPos = 0
                                colspan = 8
                            }
                            2 {
                                name = Sidebar
                                colPos = 1
                                colspan = 4
                            }
                        }
                    }
                }
            }
        }
    }
}

# Default backend layout
mod.web_layout.defaultBackendLayout = default

# New content element wizard customization
mod.wizards.newContentElement.wizardItems {
    common.show = header,text,textmedia,image,bullets,table
    special.show = uploads,menu_subpages,menu_section,shortcut,html
}

# Restrict available CTypes
TCEFORM.tt_content.CType.removeItems = menu_recently_updated,menu_related_pages,menu_sitemap
```

## Site Configuration — Using the Set

File: `config/sites/main/config.yaml`
```yaml
base: 'https://www.example.com/'
rootPageId: 1

dependencies:
  - vendor/site-package

languages:
  -
    title: English
    languageId: 0
    base: /
    locale: en_US.UTF-8
```

## Site-Specific Settings Override

File: `config/sites/main/settings.yaml`
```yaml
# Override defaults from the set for this specific site
site_package.company.name: 'Specific Brand Name'
site_package.company.email: 'contact@specificbrand.com'
site_package.features.darkMode: true
site_package.social.linkedIn: 'https://www.linkedin.com/company/specificbrand'
```

## Fluid Template — Using Settings

File: `EXT:site_package/Resources/Private/Templates/pages/Default.html`
```html
<f:layout name="Default" />

<f:section name="Main">
    <header class="site-header" style="max-width: {settings.site_package.layout.maxWidth}px">
        <div class="site-header__branding">
            <a href="/" class="site-header__logo">
                {settings.site_package.company.name}
            </a>
        </div>
        <nav class="site-header__nav">
            <f:render partial="Navigation/Main" arguments="{mainNavigation: mainNavigation}" />
        </nav>
    </header>

    <f:if condition="{settings.site_package.layout.showBreadcrumb}">
        <f:render partial="Navigation/Breadcrumb" arguments="{breadcrumb: breadcrumb}" />
    </f:if>

    <main class="site-content" style="max-width: {settings.site_package.layout.maxWidth}px">
        <f:cObject typoscriptObjectPath="lib.dynamicContent" />
    </main>

    <footer class="site-footer">
        <div class="site-footer__info">
            <p>{settings.site_package.company.name}</p>
            <p>{settings.site_package.company.street}, {settings.site_package.company.zip} {settings.site_package.company.city}</p>
            <p>
                <a href="mailto:{settings.site_package.company.email}">{settings.site_package.company.email}</a>
                | <a href="tel:{settings.site_package.company.phone}">{settings.site_package.company.phone}</a>
            </p>
        </div>

        <f:if condition="{settings.site_package.social.linkedIn}">
            <div class="site-footer__social">
                <a href="{settings.site_package.social.linkedIn}" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            </div>
        </f:if>
    </footer>

    <f:if condition="{settings.site_package.features.cookieConsent}">
        <div class="cookie-consent" id="cookie-consent" hidden>
            <p>We use cookies to improve your experience.</p>
            <button class="cookie-consent__accept">Accept</button>
            <button class="cookie-consent__decline">Decline</button>
        </div>
    </f:if>
</f:section>
```

## Composable Sub-Sets

For modular setups, split into multiple sets:

File: `EXT:site_package/Configuration/Sets/SitePackageBase/config.yaml`
```yaml
name: vendor/site-package-base
label: Site Package - Base Configuration
dependencies:
  - typo3/fluid-styled-content
```

File: `EXT:site_package/Configuration/Sets/SitePackageBlog/config.yaml`
```yaml
name: vendor/site-package-blog
label: Site Package - Blog Extension
dependencies:
  - vendor/site-package-base
  - typo3/seo
```

Then in site config:
```yaml
dependencies:
  - vendor/site-package-base
  - vendor/site-package-blog
```

## Notes
- Site Sets were introduced in TYPO3 v13. They replace the `sys_template` database records for including TypoScript.
- `dependencies` in `config.yaml` define the loading order. Dependencies are loaded before the current set.
- Settings defined in `settings.definitions.yaml` are available in TypoScript as constants (`{$setting.name}`) and in Fluid as `{settings.setting.name}`.
- Site-specific overrides in `config/sites/<identifier>/settings.yaml` take precedence over the set defaults.
- `setup.typoscript` replaces `ext_typoscript_setup.typoscript` and `sys_template` setup fields.
- `page.tsconfig` replaces `ext_typoscript_setup.tsconfig` and the Page TSconfig field in `sys_template`.
- The `PAGEVIEW` content object works hand-in-hand with Site Sets, resolving templates from the `pages/` directory.
- When migrating from v12: Move TypoScript from `sys_template` records into `setup.typoscript`, constants into `settings.yaml`, and TSconfig into `page.tsconfig`.
- Multiple sets can be composed to build modular site packages (base + blog + shop, etc.).
- Settings appear in the TYPO3 backend under Site Management > Settings, where editors can modify them without touching files.
