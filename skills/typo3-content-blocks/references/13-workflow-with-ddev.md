# 13. Workflow with DDEV

Continues `typo3-content-blocks` from [full guide](full-guide.md).

## 13. Workflow with DDEV

### Standard Development Workflow

```bash
# 1. Create new Content Block
ddev typo3 make:content-block

# 2. Clear system caches
ddev typo3 cache:flush -g system

# 3. Update database schema
ddev typo3 extension:setup --extension=my_sitepackage

# Alternative: Use Database Analyzer in TYPO3 Backend
# Admin Tools > Maintenance > Analyze Database Structure
```

### Using webprofil/make Extension

If `webprofil/make` is installed. It does not install on TYPO3 v14 without a fork: 1.1.4 and its
dependency `b13/make` 0.1.8 require `typo3/cms-core ^13.0` (Packagist, verified 2026-10-31). On v14
use `make:content-block` above unless the project carries forks of both
([package management](18-package-management-for-v14-compatibility.md)).

```bash
# Create Content Block with webprofil/make
ddev make:content_blocks

# Clear caches and update database (prefer Core CLI)
ddev typo3 cache:flush
ddev typo3 extension:setup --extension=my_sitepackage
# `database:updateschema` exists only with helhum/typo3-console — do not assume it in plain Core projects
```

