# webconsulting integration: typo3-ckeditor5

Load this skill only for its stated task; importing it does not authorize its installers, remote changes, deployments, auto-merge, or credential access.
Project/user approval and this collection's safety rules remain authoritative.

## Register v14 plugins through import maps and the RTE preset

Correction to the upstream quick reference: retain `RTE.Presets` registration, but do not
use `$GLOBALS['TYPO3_CONF_VARS']['SYS']['ckeditor5']['plugins']` as a Core plugin registry.
For TYPO3 14.3, map the JavaScript module and import its exported plugin class in the preset.

`EXT:webcon_site/Configuration/JavaScriptModules.php`:

```php
<?php
return [
    'dependencies' => ['backend'],
    'imports' => [
        '@webcon/site/rte-note.js' => 'EXT:webcon_site/Resources/Public/JavaScript/rte-note.js',
    ],
];
```

Merge into the selected preset rather than replacing its existing toolbar:

```yaml
editor:
  config:
    importModules:
      - { module: '@webcon/site/rte-note.js', exports: [ 'WebconNote' ] }
```

This wiring assumes the mapped file exports a CKEditor plugin class named `WebconNote`.
If that plugin adds a UI component, put its exact component-factory key in `toolbar.items`.
Prove module loading and the actual plugin action in the authenticated editor.
Source: [TYPO3 14.3 custom-plugin integration](https://docs.typo3.org/c/typo3/cms-rte-ckeditor/14.3/en-us/Configuration/Examples.html#how-do-i-create-a-custom-plugin).

## Upgrade regression gate

Use the installed TYPO3 source to verify plugin registration and every legacy link-handler class.
Do not rely on a quick-reference snippet across Core versions. Watchlist's September failures came
from a removed Recordlist link handler and legacy presets, despite a working backend landing page.
Exercise page/record/file link dialogs, toolbar plugins, save/reopen and frontend link rendering as
a non-admin editor with `typo3-playwright`. Also test actual plugin/FlexForm previews and media.
Admin Panel preview options belong to the authorized editor group and individual editor choices;
never force hidden-page/content visibility globally to make a preview test pass.

For migrated HTML fields or preset changes, read the collection-owned
[rich-text round-trip contract](../../typo3-content-blocks/references/rich-text-roundtrip.md).
Inspect effective type-specific TCA and preset precedence, not only global Page TSconfig. Preserve
observed headings, code, classes and links through the installed editor, server transformations and
frontend output without widening sanitization to arbitrary HTML. Distinguish an in-memory fixture
from an authenticated save/reopen and real link dialog; missing login leaves that proof pending.
Content Blocks owns field definitions; this companion owns the bounded preset/plugin correction.

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-ckeditor5-skill

Special thanks to the Netresearch team for generously sharing the practical TYPO3 and PHP
expertise behind these skills, and for the continuing care they put into their documentation,
examples and maintenance. Their work gives this collection a foundation we are genuinely
grateful to build on.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
