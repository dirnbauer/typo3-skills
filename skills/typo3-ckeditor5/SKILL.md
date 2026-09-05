---
name: typo3-ckeditor5
description: "Use when developing CKEditor 5 custom plugins for TYPO3 v12+ (v14.3 LTS bundles CKE5 v47; v13 shipped 41-42), configuring RTE presets, migrating from CKEditor 4, customizing toolbars, dark/light-mode context (on by default in v14, #106964), or fixing rich text editing issues. Triggers: CKE5, RTE config, YAML preset, editor plugin, jQuery removal, backend JS, CKEditor 47."
---

# TYPO3 CKEditor 5 Skill

CKEditor 5 integration patterns for TYPO3: custom plugins, configuration, and migration.

## Expertise Areas

- **Architecture**: Plugin system, schema/conversion, commands, UI components
- **TYPO3 Integration**: YAML configuration, plugin registration, content elements
- **Migration**: CKEditor 4->5 complete rewrite (no compatibility layer exists)

## Reference Files

- `references/ckeditor5-architecture.md` - Gotchas: figcaption, view-vs-DOM elements
- `references/typo3-integration.md` - TYPO3-specific patterns
- `references/plugin-development.md` - TYPO3 wiring, consumable API, jQuery-free dialogs
- `references/migration-guide.md` - CKEditor 4->5 migration

## Quick Reference

### Plugin Registration (ext_localconf.php)

```php
$GLOBALS['TYPO3_CONF_VARS']['RTE']['Presets']['my_preset'] = 'EXT:my_ext/Configuration/RTE/MyPreset.yaml';
$GLOBALS['TYPO3_CONF_VARS']['SYS']['ckeditor5']['plugins']['my-plugin'] = [
    'entryPoint' => 'EXT:my_ext/Resources/Public/JavaScript/Ckeditor/my-plugin.js',
];
```

### Plugin Structure (Editing/UI Split Required)

```
packages/my-plugin/src/
├── myplugin.js           # Main: requires Editing + UI
├── mypluginediting.js    # Schema, converters, commands
├── mypluginui.js         # Toolbar buttons (ButtonView, componentFactory)
└── myplugincommand.js    # Command: execute() + refresh()
```

### Key Patterns

```javascript
// Schema: always register with allowIn/allowAttributes
schema.register('myElement', { inheritAllFrom: '$block', allowAttributes: ['type'] });

// Converters: both upcast + downcast required
conversion.for('upcast').elementToElement({ view: { name: 'div', classes: 'my-el' }, model: 'myElement' });
conversion.for('downcast').elementToElement({ model: 'myElement', view: 'div' });

// Command: must implement execute() AND refresh()
class MyCommand extends Command {
  refresh() { this.isEnabled = /* check model state */; }
  execute() { this.editor.model.change(writer => { /* ... */ }); }
}
```

## jQuery Removal (Critical)

TYPO3 backend JS is dropping jQuery without deprecation period. CKEditor 5 plugins must use native APIs only:
- `querySelector`/`querySelectorAll` instead of `$()`
- `fetch()` + `async/await` instead of `$.ajax`/`$.getJSON`
- `Promise` instead of `$.Deferred`

## Backend Integration

**Property name mismatch is the #1 bug.** Frontend JS must match exact backend response property names.

```javascript
// Backend returns: { content: "...", model: "...", usage: {...} }
const text = result.content;  // CORRECT (not result.completion)
```

## Migration (CKE4 -> CKE5)

CKEditor 5 is a complete rewrite -- no compatibility layer. Migration requires full plugin rewrite:

- [ ] Audit CKE4 plugins, map features to CKE5 equivalents
- [ ] Convert `CKEDITOR.plugins.add()` to class-based `extends Plugin`
- [ ] Replace `editor.widgets.add()` with schema + converters + commands
- [ ] Convert PageTSConfig to YAML preset (`Configuration/RTE/*.yaml`)
- [ ] Use ES6 modules (no AMD/CommonJS)
- [ ] Remove all jQuery dependencies
- [ ] Verify backend response property names match frontend usage

## Verification

```bash
./scripts/verify-ckeditor5.sh /path/to/extension
```

---

> **Contributing:** https://github.com/netresearch/typo3-ckeditor5-skill
