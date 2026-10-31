# Backend branding and context

Use this reference when the selected TYPO3 installation needs customer branding before and after
login. Keep the changes in the project sitepackage and instance configuration; never patch Core.

## Contents

- [Three environment colours, each site's own design](#three-environment-colours-each-sites-own-design)
- [Find the brand source](#find-the-brand-source)
- [Supported Core configuration](#supported-core-configuration)
- [Optional stylesheet](#optional-stylesheet)
- [Verification](#verification)

## Three environment colours, each site's own design

Owner preference of 2026-10-21, based on the Ombudsstelle login treatment: retain **three base
colour families**, not the reference site's artwork. Use green for Live (`#0e714b` accent), orange
for Staging (`#a14d00`), blue for DDEV (`#0a5f96`). Backgrounds use lighter/darker tints within the
corresponding family. Logo colours stay intact; do not use the customer's palette to replace the
environment meanings or add a fourth environment colour.

Inspect the target site's actual logo, hero shapes, illustrations and recurring geometry. Record
two or three recognizable motifs with source paths, then adapt them into three matching calm
backgrounds. The reference uses layered curved forms, subtle texture/shadow and a quiet centre;
a river site might supply flowing contours, a technical site its own geometric motif. Do not copy
Ombudsstelle's logo, circles, images or content blindly, and do not invent motifs from the site name.

Keep a generous clear area behind the login/reset/MFA card, readable edges under `cover` cropping,
no embedded text, busy photo, network-line overlay or animation. Use a consistent composition
across the three variants. Prefer reviewed project-owned SVG/WebP assets; when new raster artwork
is needed, use the available image-generation workflow with the observed motifs and these fixed
palettes. Do not claim a newly generated asset is approved before showing its local preview.

Save as `login-live`, `login-staging`, `login-ddev` inside the sitepackage, with source/provenance
and an asset-size budget measured against the existing login. Prepare one shared motif/composition,
derive three variants once, and test them as one backend journey—not three whole-site captures.

## Find the brand source

Use the first authoritative source that exists:

1. `tokens.json`, `design.md`, or documented design tokens;
2. sitepackage CSS custom properties, Sass variables, or Tailwind/theme configuration;
3. the current vector logo;
4. a sampled logo color only when no defined tokens exist.

Record the motif/logo source and the three environment accent values. Verify each control colour
reaches at least 4.5:1 against white; preserve Core focus and semantic status colours. A logo keeps
its protected colours without making them the login-button colour. Do not derive a logo palette
from a JPEG screenshot when tokens or vector assets exist.

## Supported Core configuration

Put instance-specific values in `config/system/additional.php`, or use the project's established
configuration layer. Derive every environment-dependent value from **one** mapping of the real
`Environment::getContext()`. Adapt the sitepackage key, customer assets and the **verified** staging
release-path identity to the project. This is a local configuration recipe, not a deployment recipe.

`config/system/environment-label.php` holds the mapping as a pure function, so it can be tested:

```php
<?php

declare(strict_types=1);

// $isVerifiedStaging comes from this project's inspected configuration/path identity, not its hostname.
return static fn (string $context, bool $isVerifiedStaging): array => match (true) {
    $isVerifiedStaging || $context === 'Production/Staging' => ['label' => 'Staging', 'color' => '#a14d00', 'key' => 'staging'],
    $context === 'Development/Docker' => ['label' => 'Entwicklung (DDEV)', 'color' => '#0a5f96', 'key' => 'ddev'],
    in_array($context, ['Production', 'Production/Live'], true) => ['label' => 'Live', 'color' => '#0e714b', 'key' => 'live'],
    default => ['label' => 'Kontext ' . str_replace('/', ' · ', $context), 'color' => '#0a5f96', 'key' => 'other'],
};
```

`config/system/additional.php` applies it. This integration excerpt requires the project's verified
boolean `$isVerifiedStaging` binding first; it is not a standalone copy-and-run configuration:

```php
<?php

declare(strict_types=1);

use TYPO3\CMS\Core\Core\Environment;

$customerName = 'Customer website';
// Resolve $isVerifiedStaging from the project's existing verified environment identity first.
// Do not default an unresolved staging/live identity to false.
$environment = (require __DIR__ . '/environment-label.php')(
    (string)Environment::getContext(),
    $isVerifiedStaging,
);
$backgroundKey = $environment['key'] === 'other' ? 'ddev' : $environment['key'];

$GLOBALS['TYPO3_CONF_VARS']['SYS']['sitename'] = sprintf('%s · %s', $customerName, $environment['label']);

$GLOBALS['TYPO3_CONF_VARS']['EXTENSIONS']['backend'] = array_replace(
    $GLOBALS['TYPO3_CONF_VARS']['EXTENSIONS']['backend'] ?? [],
    [
        'loginLogo' => 'EXT:sitepackage/Resources/Public/Images/Backend/login-logo.svg',
        'loginLogoAlt' => $customerName,
        'loginHighlightColor' => $environment['color'],
        'loginBackgroundImage' => 'EXT:sitepackage/Resources/Public/Images/Backend/login-' . $backgroundKey . '.webp',
        'loginFootnote' => sprintf('%s · %s · Website von webconsulting.at', $customerName, $environment['label']),
        'backendLogo' => 'EXT:sitepackage/Resources/Public/Images/Backend/backend-logo.svg',
        'backendFavicon' => 'EXT:sitepackage/Resources/Public/Images/Backend/favicon.svg',
    ],
);

$GLOBALS['TYPO3_CONF_VARS']['BE']['stylesheets']['sitepackage-backend'] =
    'EXT:sitepackage/Resources/Public/Css/Backend/backend.css';
```

The mapping rules:

| Real context | Label | Highlight colour |
|---|---|---|
| `Development/Docker` outside verified staging | `Entwicklung (DDEV)` | blue `#0a5f96` |
| `Production/Staging`, or any context on the verified staging release path | `Staging` | orange `#a14d00` |
| `Production` or `Production/Live` outside verified staging | `Live` | green `#0e714b` |
| anything else | `Kontext <readable context>` | reuse blue; never pretend it is DDEV or Live |

- **Never print the raw context string** in the footnote or sitename. A composed text such as
  `Development/Docker - by …` is unreadable and is what this mapping replaces.
- **Never mislabel.** Live requires a production context **and** a release path outside staging.
  A staging release that reports `Production` is a deploy error: the label still says Staging, and
  the deploy must be fixed (it also makes EXT:solr compute the live siteHash, see
  [typo3-solr](../../typo3-solr/references/v14-only-solr-changes.md#application-context-sitehash-and-shared-cores)).
- Every highlight colour reaches at least 4.5:1 against white, because Core puts white text on the
  login button. Colour is a second signal only; the label carries the meaning.
- `loginBackgroundImage` is the corresponding site-specific environment SVG or WebP, keeping the card readable
  in the light and the dark scheme. No photos with busy detail, no motion.
- `backendLogo` is a variant that stays legible on the light and the dark top bar (a single-colour
  mark readable on both, or the logo on its own light plate). An SVG's internal
  `prefers-color-scheme` follows the operating system, not the TYPO3 user's colour-scheme setting,
  so test both settings. Check `loginLogo` against the dark login card the same way.
- `loginFootnote` reads `<customer> · <label> · Website von webconsulting.at`; proofread it, typos ship
  to every login. It is plain text: Core strips markup. On wide screens Core positions it at the
  lower inline end, so do not override the login template.
- Keep `loginLogoAlt` meaningful and keep all assets inside the sitepackage.
- Add a small textual environment badge (`Live`, `Staging`, `DDEV · Entwicklung`) and a subtle
  environment accent at the backend top bar, as in the reference. Derive badge, background,
  highlight and sitename from the same map. A CSS badge is supplementary: retain the real text in
  footnote and sitename for assistive technology; never let separately hard-coded labels drift.

The application context is read before `additional.php`. Display the mapped label but never set or
guess `TYPO3_CONTEXT` here, and never infer it from the hostname. Every environment must get its
context from its existing environment configuration, for the web server **and** the CLI, because scheduler and indexing jobs run in the CLI
context. The sitename makes the label visible in the logged-in backend for non-admin editors (the
Core system-information dropdown is admin-only); the footnote makes it visible before login and
throughout password-reset/MFA flows.

### Evaluate the mapping for every context

The mapping runs once per process, so prove each branch without redeploying: evaluate the closure
file for each simulated context and verified staging flag. No remote access is needed.

```bash
for ctx in Development/Docker Production/Staging Production Production/Live Testing; do
  for staging in 0 1; do
    php -r '$m = require "config/system/environment-label.php"; echo json_encode([$argv[1], $argv[2], $m($argv[1], $argv[2] === "1")]), PHP_EOL;' "$ctx" "$staging"
  done
done
```

Expected: no row says Live with the staging flag; no label contains raw `Development/Docker`;
the unknown context has an explicit readable label and uses blue, not a fourth palette.

## Optional stylesheet

Use the registered stylesheet only for modest branding:

- a context/sitename accent using the mapped environment colour;
- logo sizing that does not distort its aspect ratio;
- footnote typography and spacing;
- a distinct non-production context treatment that does not rely on color alone.

Do not restyle TYPO3's full backend, hide version/security notices, replace semantic success/warning/
danger colors, reduce focus visibility, or use motion-heavy login backgrounds. Test light and dark
backend color schemes and 200% zoom.

## Verification

Clear system/browser caches and verify:

1. The login page needs no login: open `/typo3/` in a fresh browser context with the light and
   the dark colour scheme emulated (Playwright `colorScheme`), per environment (DDEV, staging,
   live simulated locally). Logo, alt text, background, label and footnote are readable in both
   schemes. Real staging/live verification is a separate authorized task.
2. Login, password reset, MFA selection, MFA setup, and MFA authentication.
3. Button hover/focus/disabled contrast with each environment's highlight colour.
4. The top-bar logo in the light and dark backend setting, the favicon, and the sitename
   `<customer> · <label>` after login as a non-admin.
5. Production and non-production environments are distinguishable by text, not colour alone, and
   the [mapping evaluation](#evaluate-the-mapping-for-every-context) passed for every context.
6. No asset 404s, CSP errors, console errors, layout overflow, or lost focus indicators occur.
7. The three backgrounds retain their environment palettes while visibly using the current site's
   own motifs; no reference-client identity remains. Verify desktop/mobile crop and 200% zoom.

These are backend-only declared changes in an upgrade. Record intent and acceptance in its existing
backend node and `backend-environment-branding` journey; do not waive public parity or add global
states. The reference images/configuration were inspected on 2026-10-21; no deployment was reused.
