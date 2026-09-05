# Migration Guide: TYPO3 v13 to v14

TypoScript, TSconfig, and Fluid template changes for the upgrade from TYPO3 v13 to v14.

TYPO3 v14.3 LTS was released 2026-04-21 and is the current target. All items are sourced from
the official TYPO3 Core Changelog. See `deprecations.md` for the complete overview table.

Source: TYPO3 Core Changelog at docs.typo3.org/c/typo3/cms-core/

---

## 1. INCLUDE_TYPOSCRIPT syntax removed

**What changed:** The `<INCLUDE_TYPOSCRIPT: source="...">` syntax, deprecated in v13.4, is removed
in v14. It will be treated as an invalid line in TypoScript parsing.

**Before (v13 and earlier):**
```typoscript
<INCLUDE_TYPOSCRIPT: source="FILE:EXT:my_extension/Configuration/TypoScript/setup.typoscript">
<INCLUDE_TYPOSCRIPT: source="DIR:EXT:my_extension/Configuration/TypoScript/" extensions="typoscript">
```

**After (v14):**
```typoscript
@import 'EXT:my_extension/Configuration/TypoScript/setup.typoscript'
@import 'EXT:my_extension/Configuration/TypoScript/*.typoscript'
```

**Step-by-step migration:**
1. Search all TypoScript records (sys_template) and `.typoscript` files for `<INCLUDE_TYPOSCRIPT:`.
2. Replace every `FILE:` include with the equivalent `@import 'EXT:...'` statement.
3. Replace `DIR:` includes with `@import 'EXT:.../*.typoscript'` wildcard imports.
4. Rename files with outdated extensions (`.ts`, `.txt`) to `.typoscript` before switching.
5. Use the TYPO3 Fractor rule `MigrateIncludeTypoScriptSyntaxFractor` to automate this.

---

## 2. getTSFE() condition function removed

**What changed:** The `getTSFE()` function in TypoScript conditions, which gave access to the
`TypoScriptFrontendController`, was removed in v14. Using it will cause the condition to never
evaluate to true.

**Before (v13):**
```typoscript
[getTSFE() && getTSFE().id == 42]
page.10.variables.isProductPage = 1
[end]

[getTSFE() && getTSFE().type == 100]
config.no_cache = 1
[end]

[getTSFE()?.page['doktype'] == 3]
page.10 = TEXT
page.10.value = External link page
[end]
```

**After (v14):**
```typoscript
[request?.getPageArguments()?.getPageId() == 42]
page.10.variables.isProductPage = 1
[end]

[request?.getPageArguments()?.getPageType() == 100]
config.no_cache = 1
[end]

# For page properties, use the 'page' variable in conditions:
[page["doktype"] == 3]
page.10 = TEXT
page.10.value = External link page
[end]
```

**Step-by-step migration:**
1. Search all TypoScript for `getTSFE(`.
2. Replace page ID checks: `getTSFE().id` → `request?.getPageArguments()?.getPageId()`.
3. Replace page type checks: `getTSFE().type` → `request?.getPageArguments()?.getPageType()`.
4. Replace frontend user checks: use `frontend.user.isLoggedIn` and `frontend.user.userId`
   instead of accessing `getTSFE().fe_user`.
5. Replace `getTSFE()?.page['fieldname']` with `page["fieldname"]`.

---

## 3. Global TSconfig defaults via PHP globals removed

**What changed:** Registering default page TSconfig and user TSconfig via PHP globals is removed.

**Before (v13):**
```php
// In ext_localconf.php
$GLOBALS['TYPO3_CONF_VARS']['BE']['defaultPageTSconfig'] .= '
    TCEFORM.tt_content.header_layout.removeItems = 4,5,6
';
$GLOBALS['TYPO3_CONF_VARS']['BE']['defaultUserTSconfig'] .= '
    options.saveDocNew = 1
';
```

**After (v14) — via Site Sets:**
```yaml
# Configuration/Sets/Default/config.yaml
name: my-vendor/my-extension
label: My Extension
```

```typoscript
# Configuration/Sets/Default/page.tsconfig
TCEFORM.tt_content.header_layout.removeItems = 4,5,6
```

```typoscript
# Configuration/Sets/Default/user.tsconfig
options.saveDocNew = 1
```

**Alternative — Extension registration (for extensions not yet using Site Sets):**
In `Configuration/page.tsconfig` (auto-loaded for all sites using the extension, if registered):
```php
// In ext_tables.php or Configuration/TCA/Overrides/sys_template.php
\TYPO3\CMS\Core\Utility\ExtensionManagementUtility::addPageTSConfig(
    '@import "EXT:my_extension/Configuration/PageTS/setup.tsconfig"'
);
```

Note: `ExtensionManagementUtility::addPageTSConfig()` itself was deprecated in v13; prefer Site
Sets for new code.

**Step-by-step migration:**
1. Search for `$GLOBALS['TYPO3_CONF_VARS']['BE']['defaultPageTSconfig']` in all PHP files.
2. Move the TypoScript content to a `.tsconfig` file in your extension.
3. Register it either through a Site Set or via the `addPageTSConfig()` method (as a bridge).
4. Remove the PHP global assignments.

---

## 4. Default parseFunc configuration removed from fluid_styled_content

**What changed:** The default `parseFunc` configuration that `EXT:fluid_styled_content` provided
globally has been removed. If your TypoScript or Fluid templates relied on the globally set
`lib.parseFunc` or `lib.parseFunc_RTE` from this extension, you must define them yourself.

**Before (v13):**
```typoscript
# This was available globally via EXT:fluid_styled_content
page.10.variables.myText = TEXT
page.10.variables.myText {
    field = bodytext
    parseFunc < lib.parseFunc_RTE
}
```

**After (v14):**
Define your own `lib.parseFunc_RTE` or copy the needed configuration:
```typoscript
lib.parseFunc_RTE {
    # Define parseFunc configuration explicitly
    makelinks = 1
    makelinks.http.keep = path
    makelinks.http.extTarget._blank = 1
    # ... rest of configuration
}

page.10.variables.myText = TEXT
page.10.variables.myText {
    field = bodytext
    parseFunc < lib.parseFunc_RTE
}
```

**Step-by-step migration:**
1. Check if your TypoScript uses `lib.parseFunc` or `lib.parseFunc_RTE`.
2. If so, verify whether the configuration comes from `EXT:fluid_styled_content`.
3. Copy the required `parseFunc` configuration from `EXT:fluid_styled_content`'s TypoScript
   into your own site package setup.
4. Test that RTE content is rendered correctly.

---

## 5. Fluid 5.0 required — breaking changes in templates

**What changed:** TYPO3 v14 requires Fluid 5.0. Fluid 5.0 introduces breaking changes compared to
Fluid 4.x.

**Key breaking changes:**

| Change | Before (Fluid 4.x) | After (Fluid 5.0) |
|--------|-------------------|-------------------|
| CDATA sections | Automatically stripped from templates | Left as-is |
| Variable names with `_` prefix | Allowed | Disallowed; rename variables |
| ViewHelper argument types | Lenient coercion | Strict types enforced |
| `renderStatic()` method | Supported | Use instance `render()` method |
| `true`, `false`, `null` as variable names | Allowed (deprecated in v13) | Disallowed |

**Step-by-step migration:**
1. Rename any Fluid variables starting with `_` (e.g. `_internalVar` → `internalVar`).
2. Do not use `true`, `false`, or `null` as variable names in `<f:variable>` or `assign()`.
3. Remove CDATA sections from Fluid templates if they were used as workarounds (the content
   will now appear verbatim).
4. Ensure ViewHelper arguments receive the correct types — no implicit string-to-int coercion.
5. If you have custom ViewHelpers with `renderStatic()`: migrate to instance `render()` method.

---

## 6. Asset concatenation and compression removed

**What changed:** The built-in CSS/JS concatenation and compression in TYPO3 frontend rendering
was removed in v14. The related TypoScript options have no effect.

**Affected TypoScript options (now non-functional):**
```typoscript
config.concatenateCss = 1      # No longer works
config.concatenateJs = 1       # No longer works
config.compressCss = 1         # No longer works
config.compressJs = 1          # No longer works
```

**Migration:** Use a dedicated build tool (Vite, webpack, esbuild, or similar) to concatenate
and minify assets during the build process. Remove the `config.concatenate*` and
`config.compress*` settings from your TypoScript.

---

## 7. tt_content.list content element removed

**What changed:** The `tt_content.list` content element type and its TypoScript definition were
removed from core. This was the legacy "Plugin" content element type.

**Migration:**
- Extbase plugins should use `EXTBASEPLUGIN` or be registered via `tt_content` overrides.
- Remove any TypoScript that references `tt_content.list` if it relied on the core defaults.
- Check if your `tt_content.list.20.listType` configurations still apply; they may need
  migrating to the new content element registration approach.

---

## 8. TypoScript / TSconfig callables require explicit opt-in

**What changed (Breaking [#108054](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-108054-EnforceExplicitOpt-inForTypoScriptTSconfigCallables.html)):**
`userFunc` / `postUserFunc` / `preUserFunc` / `stdWrap.preUserFunc` and related TSconfig callables now require explicit allow-listing for security. Unlisted callables are silently ignored in v14.

**Before (v13):** Any public callable worked:
```typoscript
lib.greeting = TEXT
lib.greeting.stdWrap.preUserFunc = Vendor\MyExt\TypoScript\Hook->greet
```

**After (v14):** Register explicitly in `ext_localconf.php`:
```php
$GLOBALS['TYPO3_CONF_VARS']['SYS']['allowedFunctions']['typoscript'] ??= [];
$GLOBALS['TYPO3_CONF_VARS']['SYS']['allowedFunctions']['typoscript'][] =
    \Vendor\MyExt\TypoScript\Hook::class . '->greet';
```

**Audit:** grep `*.typoscript` and `*.tsconfig` files for `userFunc`, `preUserFunc`, `postUserFunc`; confirm each referenced callable is allow-listed. Prefer migrating to `DataProcessor` classes or PSR-14 event listeners.

---

## 9. Removed / deprecated TypoScript & TSconfig options

| Removed | Replacement | Ticket |
|---|---|---|
| `config.tx_extbase.persistence.updateReferenceIndex` toggle | always on; remove the line | [#106041](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-106041-TypoScriptExtbaseToggleConfigtx_extbasepersistenceupdateReferenceIndexRemoved.html) |
| TSconfig `options.pageTree.backgroundColor` | CSS custom properties in backend override | [#105377](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-105377-DeprecatedFunctionalityRemoved.html) umbrella |
| `$GLOBALS['TYPO3_CONF_VARS']['BE']['defaultPageTSconfig']` | per-site TSconfig via Site Sets | [#105377](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-105377-DeprecatedFunctionalityRemoved.html) |
| `$GLOBALS['TYPO3_CONF_VARS']['BE']['defaultUserTSconfig']` | global-default: Site Sets `user.tsconfig`; group-scoped: `be_groups.TSconfig` (pick whichever matches the original `defaultUserTSconfig` intent) | [#105377](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-105377-DeprecatedFunctionalityRemoved.html) |
| User TSconfig `auth.BE.redirectToURL` | deprecated, removal v15 | [#106969](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Deprecation-106969-DeprecateUserTSConfigAuthBEredirectToURL.html) |
| User TSconfig `doktypesToShowInNewPageDragArea` | deprecated v14.2 | [#109196](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.2/Deprecation-109196-DoktypesToShowInNewPageDragAreaUserTSconfig.html) |

---

## 10. New TypoScript / expression-language features

| Feature | Ticket | Notes |
|---|---|---|
| Expression `site.locale` | [#107105](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Feature-107105-SiteLocaleExpressionLanguageProvider.html) | `[site.locale == "de_DE"]` |
| Routing `limitToPages` with expression language | [#109263](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.2/Feature-109263-ExpressionLanguageForLimitToPagesInRouting.html) | dynamic page-UID filters |
| `config.htmlTag.attributes.*` supports `stdWrap` | [#106415](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Feature-106415-PossibilityToUseStdWrapInConfightmlTagattributesattr.html) | dynamic `<html>` attributes |
| Page links: array-based `queryParameters` | [#109370](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.2/Feature-109370-SupportArrayInParameterAndQueryParametersInPageLinks.html) | cleaner typolink construction |
