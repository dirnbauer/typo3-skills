# Recipe: Navigation Menu with MenuProcessor

> Version: v12+

## What this builds
A multi-level navigation menu using the MenuProcessor DataProcessor with active state handling, dropdown support, and accessible markup.

## TypoScript

```typoscript
page.10 {
    dataProcessing {
        # Main navigation (top-level with subpages)
        10 = TYPO3\CMS\Frontend\DataProcessing\MenuProcessor
        10 {
            levels = 3
            expandAll = 0
            includeSpacer = 1
            excludeUidList =
            as = mainNavigation

            # Exclude pages with doktype > 199 (folders, recycler)
            # and pages with nav_hide = 1 (handled automatically)
        }

        # Footer navigation (specific page subtree)
        20 = TYPO3\CMS\Frontend\DataProcessing\MenuProcessor
        20 {
            special = directory
            special.value = 42
            levels = 1
            as = footerNavigation
        }

        # Meta navigation (explicit page list)
        30 = TYPO3\CMS\Frontend\DataProcessing\MenuProcessor
        30 {
            special = list
            special.value = 10,11,12
            as = metaNavigation
        }
    }
}
```

## Fluid Template

File: `EXT:site_package/Resources/Private/Partials/Navigation/Main.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<nav class="main-nav" aria-label="Main navigation">
    <ul class="nav-list nav-list--level-1">
        <f:for each="{mainNavigation}" as="item">
            <li class="nav-item{f:if(condition: item.active, then: ' nav-item--active')}{f:if(condition: item.current, then: ' nav-item--current')}{f:if(condition: item.children, then: ' nav-item--has-children')}{f:if(condition: '{item.spacer}', then: ' nav-item--spacer')}">
                <f:if condition="{item.spacer}">
                    <f:then>
                        <span class="nav-spacer" aria-hidden="true">{item.title}</span>
                    </f:then>
                    <f:else>
                        <a href="{item.link}"
                           class="nav-link{f:if(condition: item.active, then: ' nav-link--active')}"
                           {f:if(condition: item.target, then: 'target="{item.target}"')}
                           {f:if(condition: item.current, then: 'aria-current="page"')}>
                            {item.title}
                        </a>

                        <f:if condition="{item.children}">
                            <f:render partial="Navigation/MainSubmenu"
                                      arguments="{children: item.children, level: 2}" />
                        </f:if>
                    </f:else>
                </f:if>
            </li>
        </f:for>
    </ul>
</nav>
</html>
```

File: `EXT:site_package/Resources/Private/Partials/Navigation/MainSubmenu.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<ul class="nav-list nav-list--level-{level}">
    <f:for each="{children}" as="child">
        <li class="nav-item{f:if(condition: child.active, then: ' nav-item--active')}{f:if(condition: child.current, then: ' nav-item--current')}{f:if(condition: child.children, then: ' nav-item--has-children')}">
            <a href="{child.link}"
               class="nav-link"
               {f:if(condition: child.target, then: 'target="{child.target}"')}
               {f:if(condition: child.current, then: 'aria-current="page"')}>
                {child.title}
            </a>

            <f:if condition="{child.children}">
                <f:render partial="Navigation/MainSubmenu"
                          arguments="{children: child.children, level: '{f:math.sum(a: level, b: 1)}'}" />
            </f:if>
        </li>
    </f:for>
</ul>
</html>
```

File: `EXT:site_package/Resources/Private/Partials/Navigation/Footer.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<nav class="footer-nav" aria-label="Footer navigation">
    <ul class="footer-nav__list">
        <f:for each="{footerNavigation}" as="item">
            <li class="footer-nav__item">
                <a href="{item.link}" class="footer-nav__link">{item.title}</a>
            </li>
        </f:for>
    </ul>
</nav>
</html>
```

## Alternative: HMENU (classic approach)

```typoscript
lib.mainNavigation = HMENU
lib.mainNavigation {
    1 = TMENU
    1 {
        NO {
            wrapItemAndSub = <li class="nav-item">|</li>
            ATagTitle.field = nav_title // title
            stdWrap.htmlSpecialChars = 1
        }
        ACT = 1
        ACT {
            wrapItemAndSub = <li class="nav-item nav-item--active">|</li>
            ATagTitle.field = nav_title // title
            stdWrap.htmlSpecialChars = 1
        }
        CUR = 1
        CUR {
            wrapItemAndSub = <li class="nav-item nav-item--current" aria-current="page">|</li>
            ATagTitle.field = nav_title // title
            stdWrap.htmlSpecialChars = 1
        }
        wrap = <ul class="nav-list nav-list--level-1">|</ul>
    }

    2 = TMENU
    2 {
        NO {
            wrapItemAndSub = <li class="nav-item">|</li>
            stdWrap.htmlSpecialChars = 1
        }
        ACT = 1
        ACT {
            wrapItemAndSub = <li class="nav-item nav-item--active">|</li>
            stdWrap.htmlSpecialChars = 1
        }
        wrap = <ul class="nav-list nav-list--level-2">|</ul>
    }
}
```

## Notes
- `MenuProcessor` is the recommended approach since v9+. It provides a clean data array for Fluid templates.
- The `active` property is `true` for all pages in the current rootline. The `current` property is `true` only for the current page.
- `expandAll = 0` (default) only expands submenus for pages in the active rootline. Set to `1` for mega-menus.
- `includeSpacer = 1` includes pages with doktype 199 (spacer). Handle them in Fluid with `{item.spacer}`.
- Use `nav_title // title` fallback to prefer the navigation title over the page title.
- The recursive partial approach (`MainSubmenu` calling itself) handles unlimited nesting depth cleanly.
- For the classic HMENU approach, states are: `NO` (normal), `ACT` (active/in rootline), `CUR` (current page), `IFSUB` (has submenu), `ACTIFSUB` (active with submenu).
- In v13+, the `MenuProcessor` data structure remains the same, so Fluid templates are forward-compatible.
