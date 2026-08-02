# Webconsulting overlay — `ext_emconf.php` scope on TYPO3 14+

This overlay narrows `ext-emconf-validation.md`; it does not modify the vendored upstream skill.

## Project-local Composer packages

For packages owned by the site under `packages/`, TYPO3 14 upgrade work removes `ext_emconf.php`.
Declare the extension through `composer.json` instead:

```json
{
  "type": "typo3-cms-extension",
  "extra": {
    "typo3/cms": {
      "extension-key": "site_package"
    }
  }
}
```

TYPO3 14 deprecates the file and TYPO3 15 does not evaluate it. A static-analysis warning for
undefined `$_EXTKEY` is therefore not a reason to retain or hardcode the file in a local package.

## Publishable or Classic-mode packages

Apply the vendored TER validation rules only when a package is actually published through
TER/Tailor or must support Classic mode. In that loader context, `$_EXTKEY` is supplied by TYPO3 and
`$EM_CONF[$_EXTKEY]` remains the compatible form. Do not replace it with a hardcoded key merely to
silence a standalone analyser; configure that analyser's loader context instead.

When `typo3-upgrade-run` is active, its local-package removal policy takes precedence. Record any
publishable/Classic exception explicitly and pass its package directory to the audit's
`--publishable` allow-list.
