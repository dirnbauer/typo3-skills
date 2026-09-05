# Recipe: Multi-Language Setup

> Version: v12+

## What this builds
A complete multi-language TYPO3 setup with language-dependent configuration, hreflang tags for SEO, and a language switcher menu.

## Site Configuration (config/sites/main/config.yaml)

```yaml
base: 'https://www.example.com/'
rootPageId: 1
languages:
  -
    title: English
    enabled: true
    languageId: 0
    base: /
    typo3Language: default
    locale: en_US.UTF-8
    iso-two-letter-iso-code: en
    navigationTitle: EN
    hreflang: en-US
    direction: ltr
    flag: us
    websiteTitle: 'Example Company'
  -
    title: Deutsch
    enabled: true
    languageId: 1
    base: /de/
    typo3Language: de
    locale: de_DE.UTF-8
    iso-two-letter-iso-code: de
    navigationTitle: DE
    hreflang: de-DE
    direction: ltr
    flag: de
    websiteTitle: 'Beispiel Firma'
    fallbackType: strict
  -
    title: 'Francais'
    enabled: true
    languageId: 2
    base: /fr/
    typo3Language: fr
    locale: fr_FR.UTF-8
    iso-two-letter-iso-code: fr
    navigationTitle: FR
    hreflang: fr-FR
    direction: ltr
    flag: fr
    websiteTitle: 'Exemple Entreprise'
    fallbackType: fallback
    fallbacks: '1,0'

errorHandling:
  -
    errorCode: 404
    errorHandler: Page
    errorContentSource: 't3://page?uid=10'
```

## TypoScript — Language-Dependent Configuration

```typoscript
# Base configuration
config {
    sys_language_uid = 0
    language = en
    locale_all = en_US.UTF-8
    htmlTag_langKey = en
}

# Language-specific overrides using conditions
[siteLanguage("languageId") == 1]
    config {
        sys_language_uid = 1
        language = de
        locale_all = de_DE.UTF-8
        htmlTag_langKey = de
    }

    # German-specific date format
    lib.dateFormat = TEXT
    lib.dateFormat.strftime = %d. %B %Y
[end]

[siteLanguage("languageId") == 2]
    config {
        sys_language_uid = 2
        language = fr
        locale_all = fr_FR.UTF-8
        htmlTag_langKey = fr
    }

    lib.dateFormat = TEXT
    lib.dateFormat.strftime = %d %B %Y
[end]
```

## TypoScript — Hreflang Tags

```typoscript
# Automatic hreflang tags in page header
page.headerData {
    100 = HMENU
    100 {
        special = language
        special.value = 0,1,2
        special.normalWhenNoLanguage = 0

        1 = TMENU
        1 {
            NO = 1
            NO {
                stdWrap.cObject = COA
                stdWrap.cObject {
                    10 = LOAD_REGISTER
                    10 {
                        languageHreflang.cObject = TEXT
                        languageHreflang.cObject {
                            value = en-US
                            override = de-DE
                            override.if.value = 1
                            override.if.equals.data = register:sys_language_uid
                            override = fr-FR
                            override.if.value = 2
                            override.if.equals.data = register:sys_language_uid
                        }
                    }

                    20 = TEXT
                    20 {
                        typolink {
                            parameter.data = page:uid
                            additionalParams.data = register:sys_language_uid
                            additionalParams.wrap = &L=|
                            returnLast = url
                            forceAbsoluteUrl = 1
                        }
                        wrap = <link rel="alternate" hreflang="{register:languageHreflang}" href="|" />
                        insertData = 1
                    }
                }
                doNotLinkIt = 1
            }
        }
    }
}
```

## Simpler Hreflang via LanguageMenuProcessor + Fluid (recommended)

```typoscript
page.10 {
    dataProcessing {
        50 = TYPO3\CMS\Frontend\DataProcessing\LanguageMenuProcessor
        50 {
            languages = auto
            as = languageMenu
        }
    }
}
```

File: `EXT:site_package/Resources/Private/Partials/Meta/Hreflang.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:section name="Hreflang">
    <f:for each="{languageMenu}" as="language">
        <f:if condition="{language.available}">
            <link rel="alternate" hreflang="{language.hreflang}" href="{language.link}" />
        </f:if>
    </f:for>

    <f:comment><!-- x-default points to the default language --></f:comment>
    <f:for each="{languageMenu}" as="language">
        <f:if condition="{language.languageId} == 0">
            <f:if condition="{language.available}">
                <link rel="alternate" hreflang="x-default" href="{language.link}" />
            </f:if>
        </f:if>
    </f:for>
</f:section>
</html>
```

Add to the page `<head>` section:
```html
<f:render partial="Meta/Hreflang" section="Hreflang" arguments="{languageMenu: languageMenu}" />
```

## Fluid Template — Language Switcher

File: `EXT:site_package/Resources/Private/Partials/Navigation/Language.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<nav class="language-nav" aria-label="Language selection">
    <ul class="language-nav__list">
        <f:for each="{languageMenu}" as="language">
            <li class="language-nav__item{f:if(condition: language.active, then: ' language-nav__item--active')}{f:if(condition: '!{language.available}', then: ' language-nav__item--unavailable')}">
                <f:if condition="{language.available}">
                    <f:then>
                        <a href="{language.link}"
                           hreflang="{language.hreflang}"
                           class="language-nav__link"
                           {f:if(condition: language.active, then: 'aria-current="true"')}
                           title="{language.title}">
                            {language.navigationTitle}
                        </a>
                    </f:then>
                    <f:else>
                        <span class="language-nav__link language-nav__link--disabled"
                              title="{language.title} - not available">
                            {language.navigationTitle}
                        </span>
                    </f:else>
                </f:if>
            </li>
        </f:for>
    </ul>
</nav>
</html>
```

## TypoScript — Language-Specific Content

```typoscript
# Different footer text per language
lib.footerText = TEXT
lib.footerText {
    value = &copy; {date:U} Example Company. All rights reserved.
    insertData = 1
    strftime = %Y
}

[siteLanguage("languageId") == 1]
    lib.footerText.value = &copy; {date:U} Beispiel Firma. Alle Rechte vorbehalten.
[end]

[siteLanguage("languageId") == 2]
    lib.footerText.value = &copy; {date:U} Exemple Entreprise. Tous droits reserves.
[end]

# Language-aware link to a specific page
lib.imprintLink = TEXT
lib.imprintLink {
    typolink {
        parameter = 15
        # L parameter is set automatically based on site configuration
    }
    value = Imprint
}

[siteLanguage("languageId") == 1]
    lib.imprintLink.value = Impressum
[end]
```

## Notes
- Site configuration (`config.yaml`) is the primary place for language setup since v9+. TypoScript `config.sys_language_*` settings should match the site config but are increasingly handled automatically.
- `fallbackType` options: `strict` (only show translated content), `fallback` (fall back to specified languages), `free` (free content mode).
- The `LanguageMenuProcessor` is the recommended way to build language switchers. It respects page availability per language.
- `languages = auto` in the LanguageMenuProcessor includes all languages defined in the site configuration.
- Hreflang tags should include `x-default` pointing to the primary language for search engines.
- In v12+, the `siteLanguage()` condition function replaces the old `[globalVar = GP:L = 1]` condition syntax.
- Always use `typolink` for links — it automatically generates the correct language prefix based on the site configuration.
- In v13+, language configuration is part of Site Sets and can be managed through `settings.yaml`.
