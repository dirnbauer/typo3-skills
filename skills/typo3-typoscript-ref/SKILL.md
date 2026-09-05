---
name: typo3-typoscript-ref
description: "Use when writing, editing, reviewing or debugging TypoScript, TSconfig or Fluid templates in TYPO3 projects (v14.3 LTS is the current target). Also use for code reviews of .typoscript, .tsconfig and Fluid .html files, v13->v14 migration (INCLUDE_TYPOSCRIPT->@import, userFunc opt-in #108054, getTSFE() condition removed, updateReferenceIndex toggle removed, site.locale expression), Fluid 4->5 breaking changes, and when suggesting improvements or checking for deprecated patterns."
---

# TYPO3 TypoScript, TSconfig and Fluid Reference

Version-aware local lookup with always-on best practices.

## Usage

```bash
scripts/lookup.sh "stdWrap wrap"              # Reference lookup
scripts/lookup.sh "PAGEVIEW" --with-fluid     # With Fluid context
scripts/lookup.sh --recipe page-setup         # Recipe for common tasks
scripts/lookup.sh "FLUIDTEMPLATE" --review    # Adds deprecation warnings
scripts/lookup.sh --deprecations              # Deprecation list
scripts/lookup.sh --checklist typoscript      # Review checklist (typoscript|tsconfig|fluid)
scripts/lookup.sh --lint-rules                # Project lint rules
scripts/lookup.sh --debug "The page is not configured"  # Debug error
scripts/lookup.sh --update                    # Update cache
scripts/lookup.sh "TEXT" --version 12         # Override version
```

## Rules

1. ALWAYS run `lookup.sh` before writing or reviewing TypoScript/TSconfig/Fluid code
2. ALWAYS follow best practice annotations (required/deprecated/recommended/tip)
3. ALWAYS check project lint rules (`--lint-rules`) before writing TypoScript
4. When writing NEW code: use the most modern approach for the detected version
5. When reviewing EXISTING code: flag deprecated patterns, check `--deprecations` for the project's version
6. For combined TypoScript+Fluid tasks: use `--with-fluid` flag
7. Never generate `config.no_cache = 1` in production setups
8. Prefer DataProcessors over CONTENT cObject in Fluid-based templates

## Version-Specific Guidance

- **v12**: Use FLUIDTEMPLATE, sys_template static includes, constants.typoscript
- **v13**: Prefer PAGEVIEW for new page templates, introduce Site Sets, use settings.definitions.yaml
- **v14**: Site Sets mandatory, PAGEVIEW is the standard for page rendering (FLUIDTEMPLATE is legacy, not officially deprecated), @import mandatory (INCLUDE_TYPOSCRIPT removed), getTSFE() conditions removed, prefer PKG: over EXT: resource paths

When answering version-specific questions, always consult `references/review/deprecations.md` and the relevant migration guide (`migration-v12-to-v13.md` or `migration-v13-to-v14.md`).

## Review Workflow

When reviewing TypoScript/TSconfig/Fluid code:

1. Run `--checklist` for the file type (typoscript, tsconfig, or fluid)
2. Run `--deprecations` filtered to project version
3. Cross-reference `references/review/common-mistakes.md` for known pitfalls
4. Check `references/review/security.md` for Fluid XSS patterns (f:format.raw, f:sanitize.html)
5. Check `references/review/performance.md` for COA_INT/USER_INT overuse
6. Use `--review` flag on keyword lookups to append deprecation context

## Reference Index

| Need | Reference |
|------|-----------|
| TypoScript patterns, Fluid best practices | `references/patterns.md` |
| Debugging errors | `references/debugging.md` |
| Deprecation lists | `references/review/deprecations.md` |
| Security (XSS, escaping) | `references/review/security.md` |
| Performance (caching, INT objects) | `references/review/performance.md` |
| Common mistakes | `references/review/common-mistakes.md` |
| Migration v12-v13 | `references/review/migration-v12-to-v13.md` |
| Migration v13-v14 | `references/review/migration-v13-to-v14.md` |
| Trailing slashes, PageTypeSuffix, duplicate content | `references/recipes/trailing-slash.md` |
| Topic index (lookup.sh) | `references/topic-index.md` |

## First Run

```bash
scripts/lookup.sh --update
```
