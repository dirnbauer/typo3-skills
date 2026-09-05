# Pattern: Accessible Navigation

Accessible main navigation using `<nav>` with semantic lists, b13/menus TreeMenu, and proper ARIA attributes. Navigation is a **list of links**, never an ARIA menu.

## TypoScript DataProcessor

```typoscript
page.10.dataProcessing {
    10 = B13\Menus\DataProcessing\TreeMenu
    10 {
        as = mainNavigation
        levels = 3
        expandAll = 1
        includeSpacer = 0
    }
}
```

## Fluid Template

```html
<!-- PageView/Partials/Header/MainNavigation.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<nav id="main-navigation" class="main-nav"
     aria-label="{f:translate(key: 'mainNavigation', extensionName: 'my_sitepackage')}">
    <ul class="main-nav__list" role="list">
        <f:for each="{mainNavigation}" as="item">
            <li class="main-nav__item{f:if(condition: '{item.hasSubpages}', then: ' has-children')}">
                <a href="{item.link}" class="main-nav__link"
                   {f:if(condition: '{item.current}', then: 'aria-current="page"')}>
                    {item.title}
                </a>
                <f:if condition="{item.hasSubpages}">
                    <button class="main-nav__toggle" type="button"
                            aria-expanded="false" aria-controls="subnav-{item.uid}"
                            aria-label="{f:translate(key: 'openSubmenu', extensionName: 'my_sitepackage')}: {item.title}">
                        <span class="main-nav__toggle-icon" aria-hidden="true"></span>
                    </button>
                    <ul class="main-nav__sublist" id="subnav-{item.uid}" role="list">
                        <f:for each="{item.subpages}" as="subitem">
                            <li class="main-nav__subitem">
                                <a href="{subitem.link}" class="main-nav__sublink"
                                   {f:if(condition: '{subitem.current}', then: 'aria-current="page"')}>
                                    {subitem.title}
                                </a>
                            </li>
                        </f:for>
                    </ul>
                </f:if>
            </li>
        </f:for>
    </ul>
</nav>

</html>
```

**Key decisions:**
- `aria-current="page"` on active link -- screen readers announce "current page" (WCAG 2.4.8)
- `role="list"` because `list-style: none` removes semantics in Safari/VoiceOver (WCAG 1.3.1)
- Link + Button pattern for submenus: parent stays a link, separate button toggles children (WCAG 4.1.2)

## Mobile Toggle

```html
<!-- PageView/Partials/Header/MobileNavToggle.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-uri-known-prefixed-attribute="true">

<button class="main-nav-toggle" type="button"
        aria-expanded="false" aria-controls="main-navigation"
        aria-label="{f:translate(key: 'toggleNavigation', extensionName: 'my_sitepackage')}">
    <span class="main-nav-toggle__bar" aria-hidden="true"></span>
    <span class="main-nav-toggle__bar" aria-hidden="true"></span>
    <span class="main-nav-toggle__bar" aria-hidden="true"></span>
</button>

</html>
```

## TypeScript

```typescript
// TypeScript/Plugins/navigation.ts

const TOGGLE_SELECTOR = '.main-nav-toggle';
const NAV_SELECTOR = '#main-navigation';
const SUBMENU_TOGGLE_SELECTOR = '.main-nav__toggle';
const OPEN_CLASS = 'is-open';

export function initNavigation(): void {
    const toggle = document.querySelector<HTMLButtonElement>(TOGGLE_SELECTOR);
    const nav = document.querySelector<HTMLElement>(NAV_SELECTOR);
    if (!toggle || !nav) return;

    toggle.addEventListener('click', () => {
        const isExpanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!isExpanded));
        nav.classList.toggle(OPEN_CLASS);
        if (!isExpanded) {
            nav.querySelector<HTMLAnchorElement>('a')?.focus();
        }
    });

    nav.addEventListener('click', (event: Event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>(SUBMENU_TOGGLE_SELECTOR);
        if (!button) return;
        const isExpanded = button.getAttribute('aria-expanded') === 'true';
        button.setAttribute('aria-expanded', String(!isExpanded));
        const submenuId = button.getAttribute('aria-controls');
        if (submenuId) {
            document.getElementById(submenuId)?.classList.toggle(OPEN_CLASS);
        }
    });

    nav.addEventListener('keydown', (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        const openToggle = nav.querySelector<HTMLButtonElement>(`${SUBMENU_TOGGLE_SELECTOR}[aria-expanded="true"]`);
        if (openToggle) {
            openToggle.setAttribute('aria-expanded', 'false');
            const submenuId = openToggle.getAttribute('aria-controls');
            if (submenuId) {
                document.getElementById(submenuId)?.classList.remove(OPEN_CLASS);
            }
            openToggle.focus();
        }
    });
}
```

## SCSS

```scss
// Navigation/_main-nav.scss

// Link styles + active page highlighting
.main-nav__link,
.main-nav__sublink {
    text-decoration: none;
    color: $body-color;
    padding: 0.5rem 1rem;
    display: block;
    transition: color 0.2s ease, background-color 0.2s ease;

    &:hover {
        color: $primary;
        background-color: $gray-100;
    }

    // Style via aria-current, not a .active class -- couples visual and semantic state
    &[aria-current="page"] {
        color: $primary;
        font-weight: $font-weight-bold;
        border-bottom: 0.1875rem solid $primary;
    }
}

.main-nav__list,
.main-nav__sublist {
    list-style: none;
    margin: 0;
    padding: 0;
}

// Mobile: hidden by default, fullscreen overlay when open
.main-nav {
    @media (max-width: map-get($grid-breakpoints, lg) - 0.02px) {
        display: none;

        &.is-open {
            display: block;
            position: fixed;
            inset: 0;
            z-index: 1050;
            background-color: $white;
            overflow-y: auto;
            animation: navFadeIn 0.3s ease;
        }
    }
}

// Burger button
.main-nav-toggle {
    display: none;
    flex-direction: column;
    justify-content: center;
    gap: 0.3125rem;
    width: 2.75rem;
    height: 2.75rem;
    padding: 0.5rem;
    background: transparent;
    border: none;
    cursor: pointer;

    @media (max-width: map-get($grid-breakpoints, lg) - 0.02px) {
        display: flex;
    }

    &__bar {
        display: block;
        width: 100%;
        height: 0.125rem;
        background-color: $body-color;
        border-radius: 0.0625rem;
        transition: transform 0.3s ease, opacity 0.3s ease;
    }

    &[aria-expanded="true"] {
        .main-nav-toggle__bar:nth-child(1) { transform: translateY(0.4375rem) rotate(45deg); }
        .main-nav-toggle__bar:nth-child(2) { opacity: 0; }
        .main-nav-toggle__bar:nth-child(3) { transform: translateY(-0.4375rem) rotate(-45deg); }
    }
}

// Submenus
.main-nav__sublist {
    display: none;
    &.is-open { display: block; }
}

.main-nav__toggle {
    background: transparent;
    border: none;
    padding: 0.5rem;
    cursor: pointer;

    &-icon {
        display: block;
        width: 0.625rem;
        height: 0.625rem;
        border-right: 0.125rem solid $body-color;
        border-bottom: 0.125rem solid $body-color;
        transform: rotate(45deg);
        transition: transform 0.2s ease;
    }

    &[aria-expanded="true"] .main-nav__toggle-icon {
        transform: rotate(-135deg);
    }
}

// Slide-in animation
@keyframes navFadeIn {
    from { opacity: 0; transform: translateX(-100%); }
    to { opacity: 1; transform: translateX(0); }
}

// Reduced motion: no animation at all
@media (prefers-reduced-motion: reduce) {
    .main-nav.is-open { animation: none; }
    .main-nav-toggle__bar { transition: none; }
    .main-nav__toggle-icon { transition: none; }
}
```

## Labels

```xml
<!-- locallang.xlf (EN) -->
<trans-unit id="mainNavigation"><source>Main navigation</source></trans-unit>
<trans-unit id="toggleNavigation"><source>Toggle navigation</source></trans-unit>
<trans-unit id="openSubmenu"><source>Open submenu</source></trans-unit>
<trans-unit id="closeSubmenu"><source>Close submenu</source></trans-unit>

<!-- de.locallang.xlf (DE) -->
<trans-unit id="mainNavigation">
    <source>Main navigation</source>
    <target>Hauptnavigation</target>
</trans-unit>
<trans-unit id="toggleNavigation">
    <source>Toggle navigation</source>
    <target>Navigation ein-/ausblenden</target>
</trans-unit>
<trans-unit id="openSubmenu">
    <source>Open submenu</source>
    <target>Untermenü öffnen</target>
</trans-unit>
<trans-unit id="closeSubmenu">
    <source>Close submenu</source>
    <target>Untermenü schließen</target>
</trans-unit>
```

## Anti-Pattern: role="menu"

**CRITICAL: Never use `role="menu"` for website navigation.**

`role="menu"` is for application menus (desktop-style File/Edit/View). It changes keyboard expectations: arrow-key navigation between `menuitem` elements, Tab leaves the menu. Website navigation is a **list of links**:

```html
<!-- CORRECT: nav > ul > li > a -->
<nav aria-label="Main navigation">
    <ul role="list">
        <li><a href="/about">About</a></li>
    </ul>
</nav>

<!-- WRONG: Do NOT use menubar/menu/menuitem -->
<nav role="menubar">
    <ul role="menu">
        <li role="none"><a role="menuitem" href="/about">About</a></li>
    </ul>
</nav>
```

## Checklist

| Requirement | Implementation |
|---|---|
| `<nav>` with `aria-label` | Identifies the navigation landmark |
| `<ul>` with `role="list"` | Restores list semantics (Safari/VoiceOver fix) |
| `aria-current="page"` on active link | Screen readers announce "current page" |
| Style via `[aria-current="page"]` | Visual and semantic state coupled |
| Burger toggle: `aria-expanded` + `aria-controls` | Announces state, associates with nav |
| Hidden nav uses `display: none` | Removed from tab order, not just visually hidden |
| Submenu toggle: `aria-expanded` + `aria-controls` | Announces submenu state |
| Escape closes open submenu | Standard keyboard interaction |
| `prefers-reduced-motion` respected | No slide animation for motion-sensitive users |
| No `role="menu/menuitem"` | Navigation is a list of links, not an app menu |
| Bilingual labels (EN + DE) | All aria-labels via locallang.xlf |
| Skip link target `#main-navigation` | See [patterns-skiplinks.md](patterns-skiplinks.md) |
