# 11. Upgrade Process

Continues `typo3-v14-reference` from [full guide](full-guide.md).

## 11. Upgrade Process

### From older majors to v14

```bash
# 1. Create backup
ddev snapshot --name=before-upgrade

# 2. Update composer constraints
ddev composer require "typo3/cms-core:^14.3" --no-update
ddev composer update "typo3/*" --with-all-dependencies

# 3. Run upgrade wizards
ddev typo3 upgrade:list
ddev typo3 upgrade:run

# 4. Clear caches
ddev typo3 cache:flush

# 5. Register extensions and align database schema
ddev typo3 extension:setup
# Schema compare/apply (CLI entry point depends on your project: `typo3`, `vendor/bin/typo3`, typo3-console, etc.)
# `database:updateschema` is from **helhum/typo3-console**, not plain Core — omit if you only have `vendor/bin/typo3`.
ddev typo3 database:updateschema

# 6. Test thoroughly
```

> **Warning — translated sites.** From 14.3.6 Extbase follows each site language's `fallbackType`
> (no key means `strict`). On a `strict` language untranslated records disappear from detail views
> (EXT:news answers 404), from relations and from uid lookups; lists keep their items. A patch
> update from 14.3.0–14.3.5 brings the change too. Before and after the update, count the items of
> every translated Extbase list page and request a sample of detail URLs per language, then settle
> every difference with the owner:
> [Extbase follows fallbackType](13-v14-only-changes-manual-not-handled-by-rector.md#extbase-follows-fallbacktype-v1436).
