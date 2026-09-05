---
name: typo3-upgrade-baseline
description: >-
  Build and seal the deterministic pre-change Baseline A for a whole-site TYPO3 14.3
  upgrade graph. Use when preflight passed and source evidence is ready, or when repeated
  screenshots of an untouched render disagree because of nondeterministic GIF/carousel,
  lazy media, consent state, sitemap, browser session, font, image, or harness input. Owns URL manifest, fingerprints, component journey
  inventory, strict-zero self-test, HTTP/DOM/pixel capture, and the immutable seal. Never
  upgrades code, fixes site regressions, weakens thresholds, or replaces the baseline.
metadata:
  skill_type: preference
---

# TYPO3 upgrade baseline

One job: build a trustworthy source instrument before the first site change.

## Preconditions

- Intake identity and accepted dataset evidence are green.
- No site/configuration/dependency repair has happened before capture.
- The host renderer and DDEV application environment pass `t3u doctor`.

## Workflow

1. Seal environment and source editorial/file fingerprints. Core/PHP are recorded migration
   subjects; renderer/tool/browser/fonts/GFX are comparison inputs.
2. Discover all site/language URLs. If a sitemap is missing/broken, do not repair first: record an
   ADR and use approved page-tree/crawl fallback with uncovered dynamic routes named.
3. Build a sealed manifest: all URLs for HTTP/DOM, tiered visual sample, template clusters, golden
   paths, deterministic seed, viewports, authoritative states, and coverage exclusions.
4. Inventory components and write representative journeys:
   - consent: fresh first visit, settings, reject, no tracker; second fresh context, accept;
   - slider/carousel: settled first, next, previous/return, keyboard, autoplay disabled;
   - nav/dropdown/accordion/modal: open, focus/operate, Escape, restored focus;
   - search: stable query order, empty result, pagination;
   - form: validation and local Mailpit success; external APIs intercepted;
   - login/reset/404/media/language and any project-specific high-value interaction.
5. Stabilize clocks/randomness/animations, fonts, image decode, lazy content, scrollbar, consent,
   video, and two stable layout frames. Configuration is hashed evidence, not hidden test code.
6. Run a seeded diagnostic, then one exhaustive unchanged double-capture with fresh isolated browser
   processes. Require zero HTTP, DOM, and pixel differences.
7. Seal the second exhaustive pass as `A-original` with manifest/checksums/lock. There is no unseal.

## Failure routing

- `invalid`: project/data/environment/manifest drift; return to the corresponding identity node.
- `harness-error`: crash, missing binary, bad artifact, wrong browser/session/worker setup; repair the
  harness, then repeat only the affected proof.
- Non-zero unchanged render: determinism recovery by failure shape, never a site fix.
- Missing component inventory or representative journey: baseline remains open.

Never raise tolerance, shrink sample, quarantine a page, reuse the operator browser, or edit the
site to make the self-test pass. A baseline captured after a repair cannot prove that repair safe.

## Output

Immutable `baseline/A-original/`, sealed manifests/fingerprints/self-test lock, interaction inventory,
coverage gaps, exact commands and exit codes, and a green bounded evidence loop for the graph node.

## Boundaries

Use `typo3-upgrade-intake` for source/project decisions and `typo3-upgrade-closure` for target
comparison. Do not modernize Vite, Bootstrap, markup, accessibility, or security here.
