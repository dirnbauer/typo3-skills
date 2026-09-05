# TypoScript/TSconfig/Fluid Deprecations

This file lists confirmed deprecations and removals relevant to TypoScript, TSconfig, and Fluid
templating across TYPO3 versions. Only items affecting frontend TypoScript, TSconfig, or Fluid
templates are listed. PHP API changes are excluded unless they affect template configuration.

Sources: TYPO3 Core Changelog at docs.typo3.org/c/typo3/cms-core/

---

## v12 Removals (deprecated in v11, removed in v12)

| Deprecated | Replacement | Status | Changelog |
|-----------|-------------|--------|-----------|
| `EDITPANEL` content object | Extension-provided cObj or custom implementation | Removed in v12 | #96107 |
| `stdWrap.editPanel` | Extension-provided hook | Removed in v12 | #96107 |
| `stdWrap.editIcons` | Extension-provided hook | Removed in v12 | #96107 |
| `TMENU.JSWindow` and `.params` | Custom JavaScript solution | Removed in v12 | #96107 |
| `config.sword_standAlone` | - | Removed in v12 | #96107 |
| `config.sword_noMixedCase` | - | Removed in v12 | #96107 |
| `_parseFunc.sword` | - | Removed in v12 | #96107 |
| `config.spamProtectEmailAddresses = ascii` | Numeric value (-10 to 10) | ascii option removed in v12 | #90044 |
| `page.includeCSS.*.import` | - | Removed in v12 | #96107 |
| `page.includeCSSLibs.*.import` | - | Removed in v12 | #96107 |
| Fluid: `<f:base>` ViewHelper | - | Removed in v12 | #96107 |
| Fluid: `<f:be.container>` ViewHelper | - | Removed in v12 | #96107 |
| Fluid: `<f:uri.email>` ViewHelper | - | Removed in v12 | #96107 |
| Fluid: `addQueryStringMethod` argument on link/uri ViewHelpers | - | Removed in v12 | #96107 |

### v12 Breaking Syntax Changes (not removals, but behavior changes)

| Area | Change | Changelog |
|------|--------|-----------|
| `@import` inside curly braces | No longer relative to current scope; always top-level | #97816 |
| `@import` path restrictions | Must start with `EXT:`; `../` traversal forbidden | #97816 |
| Nested constants `{$foo{$bar}}` | No longer valid | #97816 |
| Constants in conditions | Not allowed in setup conditions section anymore | #97816 |
| `temp.` top-level object | No longer treated as "temporary"; behaves like any other object | #97816 |
| UTF-8 BOM in TypoScript files | No longer ignored; causes parse errors | #97816 |

---

## v13 Removals (deprecated in v12, removed in v13)

| Deprecated | Replacement | Status | Changelog |
|-----------|-------------|--------|-----------|
| `config.baseURL` | Site handling / `config.forceAbsoluteUrls = 1` | Removed in v13 | #100963 |
| `config.xhtmlDoctype` | `config.doctype` | Removed in v13 | #100963 |
| `config.removePageCss` | - | Removed in v13 | #100963 |
| `[loginUser()]` condition function | `[frontend.user.isLoggedIn]` | Removed in v13 | #100963 |
| `[usergroup()]` condition function | `[frontend.user.isInGroup(...)]` | Removed in v13 | #100963 |
| `fe_users.TSconfig` DB field | User TSconfig in user records | Removed in v13 | #100963 |
| `fe_groups.TSconfig` DB field | Group TSconfig in group records | Removed in v13 | #100963 |
| Fluid: `<f:be.buttons.csh>` ViewHelper | - | Removed in v13 | #100963 |
| Fluid: `<f:be.labels.csh>` ViewHelper | - | Removed in v13 | #100963 |
| Fluid: `<f:translate>` `alternativeLanguageKeys` argument | - | Removed in v13 | #100963 |

## v13 New Deprecations (deprecated in v13, to be removed in v14)

| Deprecated | Replacement | Status | Changelog |
|-----------|-------------|--------|-----------|
| `<INCLUDE_TYPOSCRIPT: source="...">` syntax | `@import 'EXT:...'` | Deprecated in v13.4, removed in v14 | #105171 |
| `ExtensionManagementUtility::addPageTSConfig()` | Site Sets / automatic inclusion | Deprecated in v13 | #101799 |
| `ExtensionManagementUtility::addUserTSConfig()` | Site Sets / automatic inclusion | Deprecated in v13 | #101807 |
| Fluid: `renderStatic()` in ViewHelpers | Instance method `render()` | Deprecated in v13 | - |
| Fluid: `true`, `false`, `null` as variable names | Rename variables | Deprecated in v13 | #104789 |
| Fluid: standalone view classes (`StandaloneView` etc.) | Fluid 4.x API | Deprecated in v13 | #104223 |
| `$GLOBALS['TSFE']` direct access | Request-based TSFE access | Deprecated in v13 | #105230 |

## v13 New Features Replacing Older Patterns

| Old Pattern | New Approach | Introduced | Notes |
|------------|--------------|------------|-------|
| `sys_template` records for TypoScript | Site Sets with `setup.typoscript` / `config.yaml` | v13.1 | #103439 |
| TypoScript constants editor | Site Settings (`settings.definitions.yaml`, `settings.*`) | v13.1 | #103439 |
| `FLUIDTEMPLATE` for page rendering | `PAGEVIEW` content object | v13.1 | #103504; FLUIDTEMPLATE not deprecated, PAGEVIEW is recommended for new page templates |
| Static TypoScript includes via sys_template | Site Sets dependency system | v13.1 | #103439 |

---

## v14 Removals (deprecated in v13, removed in v14)

| Deprecated | Replacement | Status | Changelog |
|-----------|-------------|--------|-----------|
| `<INCLUDE_TYPOSCRIPT: source="...">` syntax | `@import 'EXT:...'` | Removed in v14 | #105377 |
| `getTSFE()` in TypoScript conditions | `request?.getPageArguments()?.getPageId()` etc. | Removed in v14 | #107473 |
| `$GLOBALS['TYPO3_CONF_VARS']['BE']['defaultPageTSconfig']` | Site Sets / extension registration | Removed in v14 | #105377 |
| `$GLOBALS['TYPO3_CONF_VARS']['BE']['defaultUserTSconfig']` | Site Sets / extension registration | Removed in v14 | #105377 |
| Default `parseFunc` config in `fluid_styled_content` | Own parseFunc configuration | Removed in v14 | #107438 |
| `config.absRefPrefix` | `config.forceAbsoluteUrls` (or relative URLs) | Removed in v14 | #108114 |
| `config.tx_extbase.persistence.updateReferenceIndex` toggle | Always on; remove the line | Removed in v14 | #106041 |

## v14 New Deprecations (deprecated in v14, to be removed in v15)

| Deprecated | Replacement | Status | Changelog |
|-----------|-------------|--------|-----------|
| User TSconfig `auth.BE.redirectToURL` | - | Deprecated in v14 | #106969 |
| Fluid: `LenientArgumentProcessor` | Strict argument types | Deprecated in v14 | #108148 |
| Fluid: `<f:debug.render>` ViewHelper | - | Deprecated in v14 | #107208 |

## v14 Breaking Behavior Changes

| Area | Change | Changelog |
|------|--------|-----------|
| TypoScript/TSconfig callables (`userFunc`, `postUserFunc`, ...) | Require explicit opt-in registration | #108054 |
| CDATA sections in Fluid templates | No longer automatically removed | #108148 |
| Fluid variable names with `_` prefix | No longer allowed | #108148 |
| CSS file processing | Comments and whitespace no longer removed automatically | #107944 |
| Asset concatenation/compression | Removed; use build tools instead | #108055 |
| Fluid 5.0 | Required; Fluid 4.x API incompatibilities | #108148 |
| `tt_content.list` content element | Removed from core | #105377 |

## v14 New Features Replacing Older Patterns

| Old Pattern | New Approach | Introduced | Notes |
|------------|--------------|------------|-------|
| `siteLanguage("locale")` comparisons | `site.locale` expression | v14.0 | #107105 |
| `EXT:` resource paths | `PKG:vendor/package:path` format (preferred; `EXT:` still works) | v14 | see syntax/stringformats |
| Static `config.htmlTag.attributes.*` values | `stdWrap` support on `htmlTag.attributes` | v14.0 | #106415 |
