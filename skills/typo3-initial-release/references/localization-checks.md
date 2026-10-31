# Localization checks for a first release

Load this for workflow step 5, or whenever labels, XLIFF files or hardcoded user-facing text are in
the release diff. `typo3-translations` owns the XLIFF 2.0 and ICU syntax itself.

## Localization checks

Treat localization as part of release readiness:

- Use XLIFF 2.0 for TYPO3 14.3+ extension labels.
- Provide English source labels and German target labels.
- Use ICU messages for labels with variables, pluralization, select-like variants, or context-sensitive grammar.
- Check that English and German labels are easy to understand for editors and administrators. Prefer plain,
  task-oriented backend wording over internal implementation terms.
- Search Fluid templates, PHP classes, JavaScript modules, TSconfig, Page TSconfig, TypoScript, and YAML for hardcoded user-facing strings.
- Replace hardcoded template text with `LLL:` references or Fluid translation ViewHelpers.
- Keep purely technical identifiers, array keys, CSS classes, route names, and machine-readable values out of
  translation files unless they are displayed to users.
- Verify language files are loaded from stable extension paths such as `EXT:my_extension/Resources/Private/Language/`.

Common checks:

```bash
rg -n '>[A-Z][^<{]*<' Resources/Private --glob '*.html'
rg -n 'title|label|description|message|button|placeholder|aria-label' Classes Configuration Resources --glob '*.{php,html,typoscript,tsconfig,yaml,yml,js}'
rg -n 'version="1.2"|xliff version="1.2"' Resources/Private/Language
rg -n '\\{[^}]+,\\s*(plural|select),' Resources/Private/Language
```
