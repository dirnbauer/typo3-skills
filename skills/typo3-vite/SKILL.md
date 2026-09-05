---
name: typo3-vite
description: "Use when configuring Vite 7 for TYPO3 v13/v14 LTS projects, setting up SCSS architecture with Bootstrap 5.3 theming, creating entrypoints per content element, optimizing SVGs, configuring PostCSS (autoprefixer, cssnano), loading local fonts, or customizing Bootstrap variables. v14 removed core asset concat/compression (#108055) — external build tool is now mandatory. Also triggers for: asset hashing, Gzip/Brotli compression, SCSS import chain, post-v14 frontend build pipelines, stale page cache after a build."
---

# TYPO3 Vite Skill

Vite 7 build configuration for TYPO3 v13 and **v14 LTS** sitepackages with `praetorius/vite-asset-collector`. Gold standard: v14.3 LTS (2026-04-21).

> **v14 context**: TYPO3 v14.0 **removed** the core's built-in frontend CSS/JS concatenation, compression, and CSS comment/whitespace stripping ([Breaking #108055](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-108055-RemovedFrontendAssetConcatenationAndCompression.html), [#107944](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-107944-FrontendCSSFileProcessingNoLongerRemovesCommentsAndWhitespaces.html)). `config.concatenateCss`/`compressCss`/`concatenateJs`/`compressJs` no longer have any effect -- an external build tool is **required** for production-grade asset handling on v14.

## Key Concepts

### Entrypoint-per-CE Pattern

Each content element gets its own Vite entrypoint (`*.entry.ts`) importing its SCSS and TypeScript, enabling code splitting -- only visible content elements' CSS/JS is loaded.

### Selective Bootstrap Imports

Never import Bootstrap as a whole -- import only the components used (`bootstrap/scss/grid`, `bootstrap/scss/buttons`) to minimize CSS size.

### SVG Optimization

Custom `SvgCopyOptimizePlugin` processes SVGs from `Resources/Private/Svg/` through SVGO into `Resources/Public/Svg/`, with dev-mode file watching.

### CSP Compliance

Assets loaded via `<vite:asset>` ViewHelper automatically get nonce attributes for CSP compliance -- no inline `<script>`/`<style>` tags needed.

### Dev Server `allowedHosts` Trap

Vite enforces host-header checks by default: without `allowedHosts: true` and `cors: true` in the `server:` block, the dev server returns HTTP 403 "Blocked request" for any host header other than `localhost` -- breaking HMR behind a reverse proxy (Traefik, nginx). Default since the [GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6) fix (4.5.6/5.4.12/6.0.9); every Vite 7.x/8.x release enforces it. Set both options **inside the single existing `server:` block** -- a second `server: { ... }` literal silently overwrites the first's keys without warning. See `references/vite-configuration.md`.

### Stale Page Cache After a Build Trap

`vite build` mints new content hashes and deletes the old files, but TYPO3's page cache keeps rendering markup with the **old** names -- the browser 404s on `main.entry-<oldhash>.js` and the page loads with no JS/CSS while still rendering normally, looking like a broken feature rather than a broken asset. Run `vendor/bin/typo3 cache:flush` as part of the build and verify what's actually served rather than trusting the build timestamp -- an unloaded bundle and a correctly idle one look identical to a naive check. See `references/vite-configuration.md`.

## Technology Stack

| Layer | Technology |
|---|---|
| Build | Vite 7+ with `praetorius/vite-asset-collector` |
| CSS | Bootstrap 5.3+ (selective imports, custom theming) |
| PostCSS | autoprefixer + cssnano (production) |
| SCSS | Modern Compiler API (`api: 'modern-compiler'`) |
| SVG | Custom SVGO plugin (`SvgCopyOptimizePlugin`) |
| Compression | Gzip + Brotli (production) |
| Package Manager | npm, pnpm, or yarn |

## References

- `references/vite-configuration.md` -- vite.config.ts, entrypoints, SVG plugin, CSP
- `references/scss-architecture.md` -- SCSS structure, import chain, naming, CSS units
- `references/bootstrap-theming.md` -- SCSS theming, CI-color mapping, selective imports
