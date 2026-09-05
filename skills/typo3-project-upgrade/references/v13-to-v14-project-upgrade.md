# TYPO3 v13 → v14.3 LTS — Project (Instance) Upgrade Playbook

**Release:** v14.3 LTS, 2026-04-21. **Free support:** bugfix until 2027-12-31, security until 2029-06-30.

**Scope:** deployed instance migration — site config, TypoScript, templates, Docker, DB. For extension code migration, see `typo3-extension-upgrade` skill.

Landing page with the full v14 reference: <https://netresearch.github.io/typo3-conformance-skill/>

---

## 0. Preflight

- **PHP**: 8.2 floor, 8.5 ceiling. If host runtime is < 8.2, bump the base image first.
- **Database**: MariaDB ≥ 10.4.3, MySQL ≥ 8.0.17, PostgreSQL ≥ 10, SQLite ≥ 3.8.3.
- **Composer**: ≥ 2.1.
- **Disk**: tear-down and rebuild `_processed_/` after upgrade; budget a few GB free.
- Snapshot the instance (DB + `fileadmin/` + config) before proceeding.

## 1. Docker / infrastructure bumps

| Component | v13 → v14 |
|---|---|
| PHP runtime image | bump to PHP 8.2+ (recommend 8.4) |
| ImageMagick | still required — re-verify in new image |
| OS base (Alpine/Debian) | refresh to current security release |
| nginx/Apache | no v14-specific changes |

If you use Netresearch's `support-typo3-14-t3re` runtime image, rebuild it against the 14.3 release.

## 2. composer upgrade

```bash
# Bump the core constraint
composer require --no-update typo3/cms-core:^14.3
composer update -W --with-all-dependencies
```

- v14 requires a `composer.json` in classic mode (#108310). Composer projects already have one.
- `ext_emconf.php` is deprecated for extension metadata (#108345) — not your concern here, but any local extension with only `ext_emconf.php` should be flagged to the extension team.

### nr-image-optimize: check what is left before you upgrade it

Most of what this extension was installed for became core during the v14 cycle. Verified against the 14.3 source, not against release notes:

| What it was installed for | Core 14 |
|---|---|
| WebP/AVIF output for processed images | `GFX/imageFileConversionFormats`, core since **14.0** (`GraphicalFunctions::…`) |
| Responsive `srcset` with width descriptors (`400w`) | `f:image.srcset`, core since **14.2** (Feature #102215) |
| Retina / high-DPI variants (`2x`) | same ViewHelper — the density descriptor is what "Retina" means |
| `<source srcset=…>` inside `<picture>` | shown as an intended use in that feature's own changelog |

What core still does **not** have, and the only reasons to keep the extension:

- **lossless post-optimisation** — optipng, jpegoptim, gifsicle. No equivalent anywhere in core.
- **on-demand generation through a `/processed/` middleware** — core generates variants while rendering, not on request. If a project depends on that delivery architecture, it is an architecture decision, not an image-format one.

Convenience, not capability: the extension's `SourceSetViewHelper` emits the whole `<picture>` block in one tag. With core you assemble `<picture>` in Fluid around `f:image.srcset`. That is markup you write once, not a feature you lose.

Note that "we need it for Retina and WebP" was a correct argument under v12/v13 and stopped being one in 14.2. Expect to meet it in existing project plans written before that release — check the version the argument was made against.

Set the format conversion in `additional.php`:

```php
$GLOBALS['TYPO3_CONF_VARS']['GFX']['imageFileConversionFormats'] = ['svg' => 'svg', 'default' => 'webp'];
```

The encoders still have to exist in the image: imagick and GD both built with WebP and AVIF, and AVIF needs ImageMagick's HEIF coder. Without a working AVIF delegate ImageMagick writes an empty `.avif` instead of failing, so assert real bytes rather than capability flags.

## 3. Site Sets (v13+ — unchanged in v14)

If the v13 site already uses Site Sets, no changes needed. Site configurations are now included in `site:show` import/export (Feature #109340 lands in v14.2). Route enhancers can now ship inside Site Sets (Feature #107837 in v14.1).

## 4. Install Tool / setup

- **`typo3/install.php` removed** — integrated into backend routing (#107536). Existing bookmarks pointing at `/typo3/install.php` need updating to the new backend path. BC is maintained via redirect for most setups.
- **`install:password:set`** CLI (Feature #104058) — unattended install admin password rotation.

## 5. Post-upgrade security wizards

### Important #109585 — serialized credential data

**Applies to any site that ran v14.2 (at any point)**. Password changes during v14.2 runtime may have persisted serialized plaintext into `be_users.uc` / `user_settings`.

- Install Tool → Upgrade → Upgrade Wizards
- Wizard auto-appears when applicable
- It unserializes, strips password fields, re-serializes

**Skip**: sites upgrading v13 → v14.3 directly.

### HMAC rotation (#106307)

HMAC algorithm strengthened SHA1 → SHA256 family. Invalidates any HMACs persisted before the upgrade:
- One-time tokens (e.g. password-reset tokens, form tokens)
- Signed serialized payloads in custom extensions

Action: force regeneration at next use (or flush proactively if safe).

## 6. Frontend theme migration (optional)

v14.1 introduced **Camino** as a self-contained default theme (#108539). Four color schemes, configurable nav/footer. Alternative to `bootstrap-package`:

- Opt-in per site: add Camino dependency in `Configuration/Sites/<id>/config.yaml`.
- Camino will move to TER / Packagist in v15, not bundled with core forever.
- Existing bootstrap-package sites stay on bootstrap-package (no forced migration).

## 7. Backend UI changes (operator awareness)

- Redesigned DocHeader (breadcrumb + unified lang selector).
- Modal migrated to native `<dialog>` (#107443) — accessibility improvement.
- Bookmark manager replaces shortcuts (#108796).
- QR Code module (#107756) and Short URL module (#108826) via redirect system.
- Bootstrap Modal → native dialog breaks any custom JS that invoked `Modal.advanced` — verify extension vendors.
- Dark/Light mode in CKEditor RTE enabled by default (#106964).

## 8. TypoScript cleanups (deprecations → removals)

Removed in v14.0 (fix before cutover):

- `<INCLUDE_TYPOSCRIPT: ...>` → `@import`
- `TypoScript condition getTSFE()` removed (#107473)
- `config.tx_extbase.persistence.updateReferenceIndex` (#106041) — remove
- TSconfig `options.pageTree.backgroundColor` — use CSS custom properties
- `$GLOBALS['TYPO3_CONF_VARS']['BE']['defaultPageTSconfig']` + `defaultUserTSconfig` — use site-level TSconfig
- Plugin subtypes: `tt_content.list_type` is gone, `list_type` plugin registrations must become CType-only

New opt-in required:

- TypoScript/TSconfig callables (`userFunc`) require explicit allow-listing (#108054)

## 9. v15-preparation (fix in v14 cycle before v15)

`ext_tables.php` deprecated in v14.3 (#109438). Even for project-level configurations that live in a "sitepackage" extension, split `ext_tables.php` into:

- `Configuration/Backend/Modules.php`
- `Configuration/Backend/Routes.php`
- `ext_localconf.php` (`ExtensionManagementUtility::addUserSetting()` — the Setup module API, not a TCA override)
- `Configuration/TCA/Overrides/pages.php` (`allowedRecordTypes`)

## 10. Smoke tests after cutover

```bash
# FE render
curl -si https://site/ | head -5
# BE login
curl -si https://site/typo3/ | head -5
# Processed images exist
ls public/fileadmin/_processed_/ | wc -l
# No deprecations in log
grep -ic deprecat var/log/typo3_*.log

# DB: no leftover sys_template root=1 records
ddev mysql -e "SELECT uid, pid, title FROM sys_template WHERE root=1 AND deleted=0"  # or: mysql -u${DB_USER} -p${DB_PASSWORD} ${DB_NAME} -e '...'
```

## 11. LTS support window (operational)

| Version | Bugfix end | Security end |
|---|---|---|
| **v14.3 LTS** (today's cutover target) | 2027-12-31 | 2029-06-30 |
| v13 LTS | 2027-10-31 (approx.) | +ELTS |
| v12 LTS | **2026-04-30** (imminent) | +ELTS |
| v11.5 | 2024-10 (ended) | +ELTS 2028-10-31 |

**Do not upgrade a production site to v14.0/14.1/14.2 in the sprint window** — those releases lost support when 14.3 shipped.

---

## Sources

- [TYPO3 Core Changelog 14.x](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog-14.html)
- [Important #109585 — Serialized credential data](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.3/Important-109585-SerializedCredentialDataInBeUsersDatabaseTable.html)
- [Deprecation #109438 — ext_tables.php](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.3/Deprecation-109438-ExtTablesPhpInExtensions.html)
- [Feature #108539 — Camino default theme](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.1/Feature-108539-Default-Theme-Camino.html)
- [Important #107536 — Install Tool backend routing](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Important-107536-InstallToolNowAdaptsToBackendLoginRouting.html)
- [TYPO3 Maintenance Release Schedule](https://typo3.com/typo3-cms/development-roadmap/maintenance-releases)
