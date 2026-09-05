# Pattern: Language Switcher

Complete language switcher pattern using b13/menus LanguageMenu, with flag SVGs and accessible markup.

## TypoScript DataProcessor

```typoscript
# Page/page.typoscript
page.10.dataProcessing {
    # ... other processors

    90 = B13\Menus\DataProcessing\LanguageMenu
    90 {
        as = languageNavigation
    }
}
```

## Fluid Partial

### Desktop (Dropdown)

```html
<!-- PageView/Partials/Header/LanguageSwitcher.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<f:if condition="{languageNavigation -> f:count()} > 1">
    <div class="language-switcher dropdown">
        <f:for each="{languageNavigation}" as="lang">
            <f:if condition="{lang.active}">
                <button class="btn btn-sm dropdown-toggle language-switcher__toggle"
                        type="button"
                        data-bs-toggle="dropdown"
                        aria-expanded="false"
                        aria-label="{f:translate(key: 'changeLanguage', extensionName: 'my_sitepackage')}">
                    <f:image src="EXT:my_sitepackage/Resources/Public/Flags/{lang.twoLetterIsoCode}.svg"
                             alt=""
                             width="20"
                             height="15"
                             class="language-switcher__flag" />
                    <span class="language-switcher__label">{lang.twoLetterIsoCode}</span>
                </button>
            </f:if>
        </f:for>

        <ul class="dropdown-menu dropdown-menu-end language-switcher__menu">
            <f:for each="{languageNavigation}" as="lang">
                <f:if condition="!{lang.active}">
                    <li>
                        <f:if condition="{lang.available}">
                            <f:then>
                                <f:link.typolink parameter="{lang.link}" class="dropdown-item language-switcher__item"
                                                 hreflang="{lang.hreflang}" title="{lang.navigationTitle}">
                                    <f:image src="EXT:my_sitepackage/Resources/Public/Flags/{lang.twoLetterIsoCode}.svg"
                                             alt=""
                                             width="20"
                                             height="15"
                                             class="language-switcher__flag" />
                                    <span>{lang.navigationTitle}</span>
                                </f:link.typolink>
                            </f:then>
                            <f:else>
                                <span class="dropdown-item language-switcher__item disabled" aria-disabled="true">
                                    <f:image src="EXT:my_sitepackage/Resources/Public/Flags/{lang.twoLetterIsoCode}.svg"
                                             alt=""
                                             width="20"
                                             height="15"
                                             class="language-switcher__flag" />
                                    <span>{lang.navigationTitle}</span>
                                </span>
                            </f:else>
                        </f:if>
                    </li>
                </f:if>
            </f:for>
        </ul>
    </div>
</f:if>

</html>
```

### Mobile (List)

```html
<!-- PageView/Partials/Header/LanguageSwitcherMobile.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<f:if condition="{languageNavigation -> f:count()} > 1">
    <ul class="language-switcher-mobile list-unstyled d-flex gap-2">
        <f:for each="{languageNavigation}" as="lang">
            <li>
                <f:if condition="{lang.available}">
                    <f:then>
                        <f:link.typolink parameter="{lang.link}"
                            class="language-switcher-mobile__item{f:if(condition: '{lang.active}', then: ' active')}"
                            hreflang="{lang.hreflang}"
                            aria-current="{f:if(condition: '{lang.active}', then: 'true')}"
                            aria-label="{lang.navigationTitle}">
                            <f:image src="EXT:my_sitepackage/Resources/Public/Flags/{lang.twoLetterIsoCode}.svg"
                                     alt="{lang.navigationTitle}"
                                     width="24"
                                     height="18" />
                        </f:link.typolink>
                    </f:then>
                    <f:else>
                        <span class="language-switcher-mobile__item disabled" aria-disabled="true">
                            <f:image src="EXT:my_sitepackage/Resources/Public/Flags/{lang.twoLetterIsoCode}.svg"
                                     alt="{lang.navigationTitle}"
                                     width="24"
                                     height="18"
                                     class="opacity-50" />
                        </span>
                    </f:else>
                </f:if>
            </li>
        </f:for>
    </ul>
</f:if>

</html>
```

## SCSS

```scss
// Page/_language-switcher.scss

.language-switcher {
    &__toggle {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        background: transparent;
        border: 1px solid $border-color;
        border-radius: $border-radius;
        padding: 0.25rem 0.5rem;
        font-size: 0.8125rem;
        text-transform: uppercase;
        font-weight: $font-weight-bold;
        color: $body-color;

        &:hover {
            border-color: $primary;
            color: $primary;
        }
    }

    &__flag {
        border-radius: 0.125rem;
        object-fit: cover;
    }

    &__menu {
        min-width: auto;
    }

    &__item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.75rem;
        font-size: 0.875rem;

        &.disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    }
}

// Mobile variant
.language-switcher-mobile {
    &__item {
        display: block;
        padding: 0.25rem;
        border: 2px solid transparent;
        border-radius: 0.25rem;
        transition: border-color 0.2s ease;

        &.active {
            border-color: $primary;
        }

        &:hover:not(.disabled) {
            border-color: $primary;
        }

        img {
            display: block;
            border-radius: 0.125rem;
        }
    }
}
```

## Flag SVGs

Place country flag SVGs in `Resources/Public/Flags/`:

```
Resources/Public/Flags/
├── de.svg    # German
├── en.svg    # English
├── fr.svg    # French
├── es.svg    # Spanish
└── ...
```

Flag SVGs should use ISO 3166-1 alpha-2 codes (lowercase), matching the TYPO3 `twoLetterIsoCode` from the language configuration.

A good source for flag SVGs is the `flag-icons` npm package or similar collections. Ensure:
- Consistent dimensions (e.g., 4:3 aspect ratio)
- Optimized with SVGO
- No inline styles

## Labels

```xml
<!-- locallang.xlf -->
<trans-unit id="changeLanguage"><source>Change language</source></trans-unit>

<!-- de.locallang.xlf -->
<trans-unit id="changeLanguage">
    <source>Change language</source>
    <target>Sprache wechseln</target>
</trans-unit>
```

## Key Points

- **b13/menus LanguageMenu** provides `available`, `active`, `link`, `hreflang`, `twoLetterIsoCode`, `navigationTitle`
- **Unavailable languages** are shown but disabled (greyed out)
- **hreflang attribute** on links for SEO
- **aria-current** on active language for accessibility
- **Desktop vs. Mobile** variants: dropdown for desktop, inline list for mobile nav
- **Flag images** use `alt=""` when text label is present, `alt="{lang}"` when used alone
