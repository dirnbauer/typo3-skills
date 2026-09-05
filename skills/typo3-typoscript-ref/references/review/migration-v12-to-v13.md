# Migration Guide: TYPO3 v12 to v13

TypoScript, TSconfig, and Fluid template changes for the upgrade from TYPO3 v12 to v13.

Only confirmed breaking changes and deprecations are listed. See `deprecations.md` for a complete
table overview. Source: TYPO3 Core Changelog at docs.typo3.org

---

## 1. PAGEVIEW as preferred page template object

**What changed:** TYPO3 v13.1 introduced the `PAGEVIEW` content object as a simpler, convention-
based alternative to `FLUIDTEMPLATE` for rendering full page templates. `FLUIDTEMPLATE` is NOT
deprecated and continues to work in v13 and v14. `PAGEVIEW` is the recommended approach for new
page templates.

**Key difference:** `PAGEVIEW` follows strict conventions (template files in `Pages/` subdirectory,
named after the backend layout), requiring far less TypoScript configuration.

**Before (v12) — FLUIDTEMPLATE:**
```typoscript
page = PAGE
page.10 = FLUIDTEMPLATE
page.10 {
    templateName = TEXT
    templateName.stdWrap.cObject = TEXT
    templateName.stdWrap.cObject {
        data = pagelayout:backend_layout
        required = 1
        split {
            token = pagelayout_
            1.current = 1
            1.wrap = |
        }
    }
    templateRootPaths {
        0 = EXT:my_sitepackage/Resources/Private/Templates/
        1 = {$page.fluidtemplate.templateRootPath}
    }
    partialRootPaths {
        0 = EXT:my_sitepackage/Resources/Private/Partials/
        1 = {$page.fluidtemplate.partialRootPath}
    }
    layoutRootPaths {
        0 = EXT:my_sitepackage/Resources/Private/Layouts/
        1 = {$page.fluidtemplate.layoutRootPath}
    }
    variables {
        contentNormal < styles.content.get
    }
}
```

**After (v13) — PAGEVIEW:**
```typoscript
page = PAGE
page.10 = PAGEVIEW
page.10 {
    paths {
        10 = EXT:my_sitepackage/Resources/Private/
    }
    variables {
        contentNormal < styles.content.get
    }
}
```

**Step-by-step migration:**
1. Ensure your templates are in `Resources/Private/Pages/` (subdirectory of your template root).
2. Name each template file after the backend layout: a layout named `with_sidebar` requires
   `Resources/Private/Pages/With_sidebar.html` (first letter uppercase).
3. Create a `Default.html` fallback for pages without a backend layout.
4. Replace `FLUIDTEMPLATE` with `PAGEVIEW` and set `paths.10` to the template root
   (one level above `Pages/`, `Partials/`, `Layouts/`).
5. Remove `templateRootPaths`, `layoutRootPaths`, `partialRootPaths` — PAGEVIEW resolves
   these automatically from `paths`.
6. Built-in variables `settings`, `site`, `language`, and `page` are available without
   extra TypoScript configuration.

---

## 2. Site Sets replacing sys_template includes and TypoScript constants

**What changed:** TYPO3 v13.1 introduced Site Sets as the new way to provide TypoScript and page
TSconfig. `sys_template` records remain functional but are optional and loaded last. TypoScript
constants are replaced by Site Settings defined in `settings.definitions.yaml`.

**Before (v12) — sys_template + constants:**

In the TYPO3 backend: sys_template record with "Include static" for each extension, and a
constants field like:
```typoscript
page.fluidtemplate.templateRootPath = EXT:my_sitepackage/Resources/Private/Templates/
styles.content.defaultHeaderType = 2
plugin.tx_myext.settings.itemsPerPage = 10
```

**After (v13) — Site Set:**

Directory structure:
```
my_sitepackage/
  Configuration/
    Sets/
      Default/
        config.yaml
        setup.typoscript
        constants.typoscript
        settings.definitions.yaml
```

`config.yaml`:
```yaml
name: my-vendor/my-sitepackage
label: My Site Package
dependencies:
  - typo3/fluid-styled-content
```

`settings.definitions.yaml`:
```yaml
settings:
  itemsPerPage:
    label: 'Items per page'
    type: int
    default: 10
  defaultHeaderType:
    label: 'Default header type'
    type: int
    default: 2
```

`setup.typoscript`:
```typoscript
styles.content.defaultHeaderType = {$defaultHeaderType}
plugin.tx_myext.settings.itemsPerPage = {$itemsPerPage}
```

Site `config.yaml` (for the site itself):
```yaml
base: 'https://example.com/'
dependencies:
  - my-vendor/my-sitepackage
```

**Step-by-step migration:**
1. Create the directory `Configuration/Sets/Default/` in your site package extension.
2. Add a `config.yaml` with `name`, `label`, and `dependencies` (replaces "Include static").
3. Move TypoScript setup from sys_template into `setup.typoscript`.
4. Move constants from sys_template constants field into `constants.typoscript` for backward
   compatibility; additionally define them in `settings.definitions.yaml` for Site Settings.
5. In the TYPO3 site configuration (`config/sites/my-site/config.yaml`), add `sets:` referencing
   your set by name.
6. Test that the site renders correctly.
7. Once stable, remove or disable the old sys_template record. If keeping both during transition,
   uncheck "Clear" flag on the sys_template constants and setup sections.

---

## 3. Removed TypoScript condition functions: loginUser() and usergroup()

**What changed:** The condition functions `[loginUser(...)]` and `[usergroup(...)]` were removed in
v13.0.

**Before (v12):**
```typoscript
[loginUser('*')]
page.10.variables.isLoggedIn = 1
[end]

[usergroup('1,2')]
page.10.variables.userIsEditor = 1
[end]
```

**After (v13):**
```typoscript
[frontend.user.isLoggedIn]
page.10.variables.isLoggedIn = 1
[end]

[frontend.user.isInGroup('1') || frontend.user.isInGroup('2')]
page.10.variables.userIsEditor = 1
[end]
```

**Step-by-step migration:**
1. Search all TypoScript files and sys_template records for `[loginUser` and `[usergroup`.
2. Replace `[loginUser('*')]` with `[frontend.user.isLoggedIn]`.
3. Replace `[loginUser('123')]` (check for specific user) with
   `[frontend.user.userId == 123]`.
4. Replace `[usergroup('1,2')]` with group-based conditions using `frontend.user.isInGroup()`.

---

## 4. Removed config.baseURL

**What changed:** `config.baseURL` was deprecated in v12.1 and removed in v13.0. It set a
`<base href>` tag. TYPO3 site handling generates correct URLs automatically.

**Before (v12):**
```typoscript
config.baseURL = https://example.com/
```

**After (v13):**
```typoscript
# Remove config.baseURL entirely.
# If absolute URLs are needed for all assets/links:
config.forceAbsoluteUrls = 1
```

**Step-by-step migration:**
1. Remove `config.baseURL` from all TypoScript records.
2. If absolute URLs were the goal, add `config.forceAbsoluteUrls = 1`.
3. Verify URL generation with TYPO3's site configuration (`base:` in `config.yaml`).

---

## 5. Removed config.xhtmlDoctype

**What changed:** `config.xhtmlDoctype` was removed in v13.0. Use `config.doctype` instead.

**Before (v12):**
```typoscript
config.xhtmlDoctype = xhtml_trans
```

**After (v13):**
```typoscript
config.doctype = xhtml_trans
```

**Step-by-step migration:**
1. Replace `config.xhtmlDoctype` with `config.doctype`.

---

## 6. INCLUDE_TYPOSCRIPT syntax deprecated

**What changed:** The `<INCLUDE_TYPOSCRIPT: source="...">` syntax was deprecated in v13.4 and will
be removed in v14. The `@import` syntax has been the recommended alternative since v9.

**Before (v12/v13 old style):**
```typoscript
<INCLUDE_TYPOSCRIPT: source="FILE:EXT:my_extension/Configuration/TypoScript/setup.typoscript">
<INCLUDE_TYPOSCRIPT: source="DIR:EXT:my_extension/Configuration/TypoScript/" extensions="typoscript">
```

**After (v13/v14):**
```typoscript
@import 'EXT:my_extension/Configuration/TypoScript/setup.typoscript'
@import 'EXT:my_extension/Configuration/TypoScript/*.typoscript'
```

**Step-by-step migration:**
1. Search for `<INCLUDE_TYPOSCRIPT:` in all TypoScript files.
2. Replace `FILE:` includes with `@import 'EXT:...'`.
3. Replace `DIR:` includes with `@import 'EXT:.../*.typoscript'`.
4. Rename any files with old extensions (`.ts`, `.txt`) to `.typoscript`.
5. Do not use `@import` inside curly braces (object definitions) — this is unsupported since v12.

---

## 7. Removed fe_users.TSconfig and fe_groups.TSconfig fields

**What changed:** The `TSconfig` database fields on `fe_users` and `fe_groups` were removed in v13.

These fields were used for frontend user/group specific TypoScript conditions. They had no
replacement — frontend TSconfig for individual users or groups was rarely used in practice.

**Migration:**
If you relied on these fields, migrate the logic to standard TypoScript conditions using
`frontend.user.isLoggedIn`, `frontend.user.userId`, or `frontend.user.isInGroup()`.

---

## 8. Fluid ViewHelper removals

**What changed:** Several Fluid ViewHelpers were removed in v13.0 (deprecated since v11/v12).

| Removed | Notes |
|---------|-------|
| `<f:be.buttons.csh>` | Backend context-sensitive help, no replacement |
| `<f:be.labels.csh>` | Backend context-sensitive help, no replacement |
| `<f:translate>` `alternativeLanguageKeys` argument | Remove usage of this argument |

**Migration:** Remove usages of these ViewHelpers or arguments from Fluid templates. The CSH
ViewHelpers had no functional impact in modern TYPO3 backends.
