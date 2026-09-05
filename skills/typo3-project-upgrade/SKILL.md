---
name: typo3-project-upgrade
description: "Use when upgrading a deployed TYPO3 project/instance to a new LTS version (v14.3 LTS is the current target, released 2026-04-21) — migrating site configuration, TypoScript, templates, Docker infrastructure, and database. Includes #109585 post-upgrade wizard and Camino theme migration. Not for extension code upgrades (use typo3-extension-upgrade instead)."
---

# TYPO3 Project Upgrade

Phases: **Inventory** -> **Infrastructure** -> **Site Sets** -> **Visual Parity** -> **Review** (+ **Phase 6** for v14 targets)

## Phase 1: Inventory

Query sys_template (uid, pid, root, include_static_file), tt_content CType distribution, extension list. Document all root=1 templates and their TypoScript constants/config.

## Phase 2: Infrastructure

**ImageMagick required** — without it, ALL images serve unprocessed originals (10-30x size). Install in Docker, configure GFX processor in `config/system/settings.php`, then `TRUNCATE sys_file_processedfile`, `rm -rf public/fileadmin/_processed_/*`, `cache:flush`.

## Phase 3: sys_template to Site Sets (v13+)

Structure: `packages/my-site/Configuration/Sets/MySite/` with config.yaml, settings.yaml, setup.typoscript.

**config.yaml**: name, label, dependencies (e.g. `bootstrap-package/full`).

**Site config** (`config/sites/default/config.yaml`): add `dependencies: [vendor/my-site]`.

**CRITICAL**: `DELETE FROM sys_template` — ALL records. A surviving root=1 template with `include_static_file` overrides site sets, causing "No page configured for type=0". Common mistake: only checking `config` column while `include_static_file` also conflicts.

**settings.yaml** — map old constants (page.logo.file, page.theme.navigation.style, page.theme.breadcrumb.enable) directly.

### SCSS Variable Injection

BS Package injects ALL `plugin.bootstrap_package.settings.scss.*` as SCSS variables — even unlisted ones. Prefer over CSS overrides:

```yaml
plugin.bootstrap_package.settings.scss.primary: '#585961'
plugin.bootstrap_package.settings.scss.secondary: '#2f99a4'
plugin.bootstrap_package.settings.scss.link-decoration: 'none'
plugin.bootstrap_package.settings.scss.min-contrast-ratio: '3'
```

Check BS5 `_variables.scss` for available `!default` variables.

### Per-Page Behavior

Replace per-page sys_templates with TypoScript conditions: `[traverse(page, "uid") == 99]`.

## Phase 4: BS Package v12-v16 / BS4-BS5

**Color contrast**: `min-contrast-ratio: 4.5` (BS5 default) changes text colors vs v11. Set to `3` to restore v11 behavior.

**Cards in colored frames** inherit white text (invisible on white bg). Fix with CSS custom properties:
```css
.frame-background-secondary .card {
    --frame-color: var(--bs-body-color);
}
```

**Navigation**: split `<a>` into `<a class="nav-link-main">` + `<button class="nav-link-toggle">` (accessibility). Hover dropdowns removed — restore with `:hover > .dropdown-menu { display: block }` scoped to nav-style-simple/mega.

**Scroll flicker** ([#1468](https://github.com/benjaminkott/bootstrap_package/issues/1468)): sticky navbar transition changes document height. Fix with `margin-bottom` compensation (default-height minus transition-height).

**Accept**: split nav link/button, data-bs-*, 3 skip links, individual JS/CSS, frame-height-default class.

## Phase 5: Review

Compare old/new sites with curl (HTTP status, content element IDs, frame classes, _processed_ count). Categorize differences as **MIGRATION GAP** (fix), **BS5 CHANGE** (accept), or **CSS OVERRIDE** (document why).

**DB fixes**: carousel autoplay (BS Package v16 defaults off) via pi_flexform UPDATE.

## Phase 6: v14 post-upgrade

- **#109585 wizard** (if instance ever ran v14.2): Install Tool → Upgrade Wizards
- **`composer.json` required** in classic mode (#108310)
- **HMAC rotation** SHA1 → SHA256 (#106307)
- **Camino theme** optional (v14.1+, #108539)

See `references/v13-to-v14-project-upgrade.md`.

## Common Mistakes

| Mistake | Fix |
|---|---|
| CSS hacks instead of SCSS variables | Override via `plugin.bootstrap_package.settings.scss.*` |
| Partial sys_template cleanup | `DELETE FROM sys_template` (all columns matter) |
| Missing ImageMagick in Docker | 10-30x image file sizes |
| Fighting BS5 accessibility | Accept split nav, skip links, semantic HTML |
| position:fixed for scroll flicker | Use margin-bottom compensation |
