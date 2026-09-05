# TYPO3 Extension Upgrade Patterns

**Source:** Analyzed from georgringer/news extension upgrade history (TYPO3 10→11→12)
**Purpose:** Real-world patterns to inform upgrade effort estimation

## Overview

This document captures common upgrade patterns observed in the news extension, which serves as a reference implementation for TYPO3 best practices.

## Composer Dependency Updates

### Pattern: Progressive PHP Version Requirements

**Example from news:**

```
TYPO3 10: php >= 7.2 < 7.5
TYPO3 11: php >= 7.4 < 8.3
TYPO3 12: php >= 8.1 < 8.4
```

**Estimation Impact:**

- Moving from PHP 7.x → 8.x adds null-safety fixes, type hints, and attribute updates
- Each additional minor PHP version beyond the target minimum adds incremental work

### Pattern: Specific Core Package Requirements

**Example:**

```json
// TYPO3 11
"require": {
  "typo3/cms-core": "^11.5.24 || ^12"
}

// TYPO3 12
"require": {
  "typo3/cms-backend": "^12.4.2 || ^13.1",
  "typo3/cms-core": "^12.4.2 || ^13.1",
  "typo3/cms-extbase": "^12.4.2 || ^13.1",
  "typo3/cms-frontend": "^12.4.2 || ^13.1",
  "typo3/cms-fluid": "^12.4.2 || ^13.1"
}
```

**Estimation Impact:**

- Splitting `cms-core` into specific packages adds composer-dependency work that scales with package count — each split package needs its own version-constraint check

### Pattern: Testing Framework Updates

**Example:**

```
TYPO3 11: testing-framework ~7.0, phpunit ^9
TYPO3 12: testing-framework ^8.0, phpunit ^10
```

**Estimation Impact:**

- A PHPUnit major-version upgrade touches: test syntax (assertions, data providers), mock API changes, deprecation fixes, CI/CD pipeline updates

## Automated Code Modernization (Rector)

### Pattern: Extensive Rector Usage

**Observed Rector Rules Applied:**

- `UseServerRequestInsteadOfGeneralUtilityGetRector`
- `MigrateGeneralUtilityGPRector`
- `SimplifyCheckboxItemsTCARector`
- `ExtbaseActionsWithRedirectMustReturnResponseInterfaceRector`
- `PrivatizeFinalClassPropertyRector`
- `RemoveUnusedPrivateMethodParameterRector`
- `UseLanguageAspectInExtbasePersistenceRector`
- `MigrateConfigurationManagerGetContentObjectRector`
- And 15+ more...

**Estimation Impact:**

- With Rector available: install, configure the rule set, run automated refactoring, then review and fix edge cases before testing
- Without Rector: refactoring is fully manual — search & replace patterns, method-signature updates, request-object migrations, attribute conversions
- See `references/rector-coverage.md` for the model's per-version Rector discount factors

## TCA Configuration Updates

### Pattern: TCA Simplification

**Observed Changes:**

- Simplified checkbox item configuration
- Updated file reference TCA
- Category TCA modernization
- Removed migration helper files (`z_misc_12_adoptions.php`)

**Example Commit Patterns:**

```
[TASK] TCA for tca labels
[TASK] TCA for sys_category images
[TASK] TCA file cleanup
[TASK] Update tca for sys_file_reference
[TASK] Simplify TCA checkbox items
```

**Estimation Impact:**

- Effort scales with TCA file count; inline relations and file-reference configuration take longer than simple field updates
- Migration-helper removal is a one-off cleanup task

## Breaking Changes & Removals

### Pattern: Deprecated Feature Removal

**Examples from news 11→12:**

```
[!!!] Remove usage of LOAD_REGISTER with news values
[!!!] Remove label overlay for categories
[!!!] Remove deprecated sitemap option
[!!!] Replace QueryGenerator
[!!!] Remove switchablecontrolleractions from flexforms
```

**Categories:**

1. **Removed ViewHelper Features** (LOAD_REGISTER)
2. **Removed Utilities** (QueryGenerator, label overlay)
3. **Removed Configuration Options** (sitemap, switchablecontrolleractions)
4. **Removed Legacy Code** (RealURL migration)

**Estimation Impact:**

- Each breaking change requires: finding all usages, implementing a replacement, testing, and updating documentation

**Pattern Recognition:**

- Breaking changes are marked with `[!!!]` in TYPO3 core/extension commit messages — grep changelogs for this marker to find affected APIs
- news 11→12 had roughly 5-10 such breaking-change commits

## Configuration Structure Updates

### Pattern: Backend Module Registration

**Change:**

```
// Before (ext_tables.php) - TYPO3 11
ExtensionManagementUtility::addModule(...);

// After (Configuration/Backend/Modules.php) - TYPO3 12
return [
    'web_NewsNews' => [
        'parent' => 'web',
        'position' => ['after' => 'web_info'],
        ...
    ],
];
```

**Estimation Impact:**

- Effort scales per backend module migrated from `ext_tables.php` to `Configuration/Backend/Modules.php`

### Pattern: Services Configuration

**Changes:**

- Updated DI configuration
- Service tagging updates
- Autowiring improvements

**Estimation Impact:**

- Effort depends on DI configuration complexity and the number of service-tagging changes

### Pattern: Icon Registration

**Changes:**

- Icon provider updates
- SVG icon handling
- Icon registration modernization

**Estimation Impact:**

- Icon provider/registration updates are a fixed, one-off cost regardless of icon count

## FlexForm Updates

### Pattern: FlexForm Modernization

**Observed Changes:**

- Removed `switchablecontrolleractions`
- Updated field configurations
- Simplified settings structure

**Files Updated in news:**

```
Configuration/FlexForms/flexform_category_list.xml (58 changes)
Configuration/FlexForms/flexform_news.xml (275 changes)
Configuration/FlexForms/flexform_news_detail.xml (78 changes)
Configuration/FlexForms/flexform_news_list.xml (212 changes)
Configuration/FlexForms/flexform_tag_list.xml (94 changes)
```

**Estimation Impact:**

- Effort scales with FlexForm count and the presence of `switchableControllerActions` (deprecated, needs removal)

## Testing Infrastructure Modernization

### Pattern: runTests.sh Complete Rewrite

**Major Change:** Docker-compose → Docker

**Key Updates:**

- New database version handling (MariaDB 10.3-11.1)
- Improved network management
- Better container lifecycle
- Wait-for patterns for dependencies

**Estimation Impact:**

- Adopting the community `runTests.sh` pattern (from the Tea extension) covers most of this; custom test-script and CI/CD pipeline changes are additional

### Pattern: Test Suite Updates

**Changes:**

- PHPUnit assertion updates
- Mock syntax modernization
- Data provider updates
- Functional test database handling

**Estimation Impact:**

- Effort scales with test-file count; functional tests with database fixtures take longer than unit tests

## Code Modernization Patterns

### Pattern: Nullable Parameter Fixes

**Example:**

```
[TASK] Avoid implicitly nullable class method parameter
```

**PHP 8.1+ Requirement:** Parameters with default null must be explicitly nullable

```php
// Before (PHP 7.4)
public function process($data = null) { }

// After (PHP 8.1)
public function process(?array $data = null) { }
```

**Estimation Impact:**

- Rector automates this rule; manual fixes are per-occurrence and scale with codebase size

### Pattern: Type Declaration Improvements

**Estimation Impact:**

- Effort scales linearly with class count (property types, method return types)

### Pattern: Server Request Migration

**Change:**

```php
// Before
$params = GeneralUtility::_GP('params');

// After
$params = $request->getQueryParams()['params']
    ?? $request->getParsedBody()['params']
    ?? null;
```

**Estimation Impact:**

- Effort scales with the number of `GeneralUtility::_GP()`/`_GET()`/`_POST()` call sites; Rector automates most of this migration

### Pattern: Template View Replacements

**Change:**

```php
// Before
use TYPO3\CMS\Fluid\View\TemplateView;
use TYPO3\CMS\Fluid\View\StandaloneView;

// After
use TYPO3Fluid\Fluid\View\TemplateView;
```

**Estimation Impact:**

- Requires a namespace-only search & replace, followed by regression testing of affected views

## Documentation Updates

### Pattern: Version Compatibility Updates

**Files Updated:**

- README.md (badges, version info)
- Documentation/Index.rst (compatibility matrix)
- CHANGELOG/migration guides
- Code examples with new syntax

**Estimation Impact:**

- Effort covers README badges/version info, compatibility-matrix updates, code-example refreshes, and a migration guide for extension users

## Observed Commit Patterns

### Frequency Analysis from news 11→12 Upgrade

**Task Distribution:**

```
Rector refactorings:      ~25 commits (automated)
TCA updates:              ~15 commits
Configuration updates:    ~10 commits
Breaking changes:         ~8 commits
Test updates:             ~12 commits
Documentation:            ~10 commits
Bugfixes after upgrade:   ~15 commits
Code cleanup:             ~20 commits
```

**Total Commits:** ~115 commits for major version upgrade

**Estimation Insight:** Plan for 100-150 commits for a complex extension upgrade

## Upgrade Phase Patterns

### Phase 1: Composer & Dependencies (10-15%)

- Composer.json updates
- Testing framework updates
- CI/CD adjustments

### Phase 2: Automated Refactoring (20-30% if Rector available)

- Install and configure Rector
- Run automated refactorings
- Review and commit changes

### Phase 3: Configuration Modernization (15-25%)

- TCA updates
- Backend module registration
- Services configuration
- Icon registration
- FlexForm updates

### Phase 4: Breaking Changes (20-30%)

- Remove deprecated features
- Replace removed APIs
- Update to new APIs

### Phase 5: Testing (20-25%)

- Test suite updates
- PHPUnit migration
- Functional test updates
- Regression testing

### Phase 6: Documentation (5-10%)

- README updates
- Documentation pages
- Migration guides
- CHANGELOG

---

**Last Updated:** 2025-10-23
**Based on:** georgringer/news v11.4.3 → v12.0.0 analysis
**Commit Range Analyzed:** 11.4.3..12.0.0 (~115 commits)
