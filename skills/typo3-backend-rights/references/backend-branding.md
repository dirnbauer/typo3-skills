# Backend branding and context

Use this reference when the selected TYPO3 installation needs customer branding before and after
login. Keep the changes in the project sitepackage and instance configuration; never patch Core.

## Find the brand source

Use the first authoritative source that exists:

1. `tokens.json`, `design.md`, or documented design tokens;
2. sitepackage CSS custom properties, Sass variables, or Tailwind/theme configuration;
3. the current vector logo;
4. a sampled logo color only when no defined tokens exist.

Record the source and chosen values. Select a dark action shade that reaches at least 4.5:1 against
white because TYPO3 uses white text on the login button. A protected logo color may remain unchanged
in the logo, but do not reuse it for controls when it fails contrast. Do not derive colors from a
JPEG screenshot when a token or vector asset exists.

## Supported Core configuration

Put instance-specific values in `config/system/additional.php`, or use the project's established
configuration layer. Adapt the sitepackage key and asset paths:

```php
<?php

declare(strict_types=1);

use TYPO3\CMS\Core\Core\Environment;

$customerName = 'Customer website';
$applicationContext = (string)Environment::getContext();

$GLOBALS['TYPO3_CONF_VARS']['SYS']['sitename'] = sprintf(
    '%s · %s',
    $customerName,
    $applicationContext,
);

$GLOBALS['TYPO3_CONF_VARS']['EXTENSIONS']['backend'] = array_replace(
    $GLOBALS['TYPO3_CONF_VARS']['EXTENSIONS']['backend'] ?? [],
    [
        'loginLogo' => 'EXT:sitepackage/Resources/Public/Images/Backend/login-logo.svg',
        'loginLogoAlt' => $customerName,
        'loginHighlightColor' => '#34512f',
        'loginBackgroundImage' => 'EXT:sitepackage/Resources/Public/Images/Backend/login-background.webp',
        'loginFootnote' => sprintf('Website by webconsulting.at · %s', $applicationContext),
        'backendLogo' => 'EXT:sitepackage/Resources/Public/Images/Backend/backend-logo.svg',
        'backendFavicon' => 'EXT:sitepackage/Resources/Public/Images/Backend/favicon.svg',
    ],
);

$GLOBALS['TYPO3_CONF_VARS']['BE']['stylesheets']['sitepackage-backend'] =
    'EXT:sitepackage/Resources/Public/Css/Backend/backend.css';
```

`loginFootnote` is plain text: Core strips markup. On wide screens Core positions the footnote at
the lower inline end, so use `Website by webconsulting.at` without overriding the login template.
Keep `loginLogoAlt` meaningful and keep all assets inside the sitepackage.

The application context is read before `additional.php`. Display `Environment::getContext()` but
never set or guess `TYPO3_CONTEXT` here. Adding the exact context to the sitename makes it visible in
the logged-in backend for non-admin editors; the Core system-information dropdown is admin-only.
Appending it to `loginFootnote` makes it visible before login and throughout password-reset/MFA
flows that render the Core footnote.

## Optional stylesheet

Use the registered stylesheet only for modest branding:

- a context/sitename accent using the validated customer action color;
- logo sizing that does not distort its aspect ratio;
- footnote typography and spacing;
- a distinct non-production context treatment that does not rely on color alone.

Do not restyle TYPO3's full backend, hide version/security notices, replace semantic success/warning/
danger colors, reduce focus visibility, or use motion-heavy login backgrounds. Test light and dark
backend color schemes and 200% zoom.

## Verification

Clear system/browser caches and verify:

1. Login, password reset, MFA selection, MFA setup, and MFA authentication.
2. The logo alt text, footnote, button hover/focus/disabled contrast, and background readability.
3. The top-bar logo, favicon, sitename, and exact context after login as a non-admin.
4. Production and non-production contexts are distinguishable by text, not color alone.
5. No asset 404s, CSP errors, console errors, layout overflow, or lost focus indicators occur.
