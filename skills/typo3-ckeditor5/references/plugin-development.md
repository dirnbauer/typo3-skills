# CKEditor 5 Plugin Development for TYPO3

For plugin scaffolding (class structure, schema, converters, commands,
toolbar UI), see the
[CKEditor 5 plugin development guide](https://ckeditor.com/docs/ckeditor5/latest/framework/plugins/plugins.html)
or the Quick Reference in [SKILL.md](../SKILL.md). Before writing upcast/downcast
converters, also read [ckeditor5-architecture.md](ckeditor5-architecture.md#pitfall-view-elements-are-not-dom-elements)
("Pitfall: View Elements Are Not DOM Elements") -- SonarCloud's `javascript:S7761` is a
false positive on `getAttribute('data-*')` calls inside converter
callbacks. This file covers TYPO3-specific plugin wiring and other
gotchas found building CKE5 plugins for TYPO3.

## TYPO3 Integration

### Bundle for TYPO3

```javascript
// Resources/Public/JavaScript/Ckeditor/my-plugin-bundle.js
import MyPlugin from './Plugins/MyPlugin.js';
import MyPluginEditing from './Plugins/MyPluginEditing.js';
import MyPluginUI from './Plugins/MyPluginUI.js';
import MyPluginCommand from './Plugins/MyPluginCommand.js';

// Export all components
export { MyPlugin, MyPluginEditing, MyPluginUI, MyPluginCommand };

// Default export for TYPO3 import
export default { MyPlugin };
```

### Registration in ext_localconf.php

```php
<?php
// ext_localconf.php

defined('TYPO3') or die();

// Register CKEditor 5 plugin
$GLOBALS['TYPO3_CONF_VARS']['RTE']['CKEditor5']['plugins']['my-plugin'] = [
    'entryPoint' => 'EXT:my_extension/Resources/Public/JavaScript/Ckeditor/my-plugin-bundle.js',
    'stylesheets' => [
        'EXT:my_extension/Resources/Public/Css/Ckeditor/my-plugin.css',
    ],
];
```

### YAML Configuration

```yaml
# Configuration/RTE/Default.yaml
editor:
  config:
    toolbar:
      items:
        - heading
        - '|'
        - bold
        - italic
        - '|'
        - myPluginBox      # Button
        - myPluginDropdown # Dropdown
        - myPluginHighlight

    importModules:
      - '@vendor/my_extension/ckeditor/my-plugin-bundle.js'

processing:
  allowTags:
    - div
    - mark
    # ... other tags

  allowAttributes:
    - { attribute: 'class', elements: ['div', 'mark'] }
    - { attribute: 'data-type', elements: 'div' }
    - { attribute: 'data-title', elements: 'div' }
```

## Consumable API - Preventing Duplicate Processing

**Critical pattern for upcast converters** that need to prevent other converters (like GHS - General HTML Support) from processing the same element.

### The Problem: Duplicate Elements

When multiple converters can handle the same HTML element, you get duplicate output:

```html
<!-- Input: linked image -->
<a href="/page"><img src="image.jpg"></a>

<!-- Bug: GHS preserves <a> because your converter didn't consume it -->
<a href="/page"><a href="/page"><img src="image.jpg"></a></a>
```

### The Solution: test() Before consume()

**Always use `consumable.test()` before `consumable.consume()`** to prevent regressions:

```javascript
// ❌ BAD: Consume without testing - may silently fail
conversion.for('upcast').add(dispatcher => {
    dispatcher.on('element:a', (evt, data, conversionApi) => {
        const { consumable, writer } = conversionApi;
        const viewElement = data.viewItem;

        // This might fail if another converter already consumed it!
        consumable.consume(viewElement, { name: true });
        // ... rest of conversion
    });
});

// ✅ GOOD: Test first, then consume - prevents race conditions
conversion.for('upcast').add(dispatcher => {
    dispatcher.on('element:a', (evt, data, conversionApi) => {
        const { consumable, writer } = conversionApi;
        const viewElement = data.viewItem;

        // Test if element is available for conversion
        if (!consumable.test(viewElement, { name: true })) {
            return; // Another converter already handled this
        }

        // Now safe to consume
        consumable.consume(viewElement, { name: true });
        // ... rest of conversion
    });
});
```

### Why test() Matters

1. **Prevents silent failures**: `consume()` returns false if already consumed, but you might not check
2. **Enables proper converter chaining**: Multiple converters can cooperate without conflicts
3. **Avoids duplicate elements**: GHS and other catch-all converters won't process consumed elements
4. **Race condition prevention**: Between `test()` and `consume()`, another converter could consume attributes (but not name)

### Real-World Bug (Issue #565)

```javascript
// Bug: Early return without consuming caused GHS to create duplicate <a>
if (!imgElement) {
    return null; // <a> was NOT consumed - GHS preserves it!
}

// Fix: Always consume the element before returning
if (!consumable.test(viewElement, { name: true }) ||
    !consumable.test(imgElement, { name: true })) {
    return null;
}
consumable.consume(viewElement, { name: true });
consumable.consume(imgElement, { name: true });
```

### Testing for Pre-Consumed Elements

Always test that your converter correctly handles pre-consumed elements:

```javascript
it('returns null when anchor is pre-consumed', () => {
    const { anchor, img } = createLinkedImageView('https://example.com', {});

    // Simulate another converter consuming the element first
    conversionApi.consumable.consume(anchor, { name: true });

    const result = linkedImageUpcastConverter(anchor, conversionApi);

    expect(result).toBeNull();
});
```

## Native DOM Patterns for CKEditor Plugin Dialogs

CKEditor 5 plugins that open TYPO3 backend dialogs (e.g., image manipulation, link browser) must use native DOM -- never jQuery. TYPO3's `rte_ckeditor` sysext already has zero jQuery, and backend JS can drop jQuery without deprecation notice.

### Dialog Element Access

```javascript
// jQuery (old)
const $dialog = dialog.$el;
$dialog.find('.my-class');

// Native DOM (new)
const dialogEl = dialog.el; // HTMLElement, not jQuery object
dialogEl.querySelector('.my-class');
```

### DOM Builder Helper Pattern

Replace jQuery DOM construction with a small helper:

```javascript
/**
 * Create an element, set className, optionally append to parent.
 */
function h(tag, className, parent) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (parent) parent.appendChild(el);
    return el;
}

// Usage
const wrapper = h('div', 'image-manipulation');
const row     = h('div', 'row', wrapper);
const label   = h('label', 'form-label', row);
label.textContent = 'Width';
```

**Security:** Never use `insertAdjacentHTML` with interpolated values -- this triggers CodeQL `js/xss-through-dom` alerts. Always use `createElement` + `textContent` for user-visible strings.

### Promise Instead of $.Deferred

```javascript
// jQuery (old)
const deferred = $.Deferred();
// ... later
deferred.resolve(result);
return deferred.promise();

// Native (new) -- extract resolve/reject for later use
let resolveFn, rejectFn;
const promise = new Promise((resolve, reject) => {
    resolveFn = resolve;
    rejectFn  = reject;
});

// ... later, in a callback or async operation:
if (operationSuccessful) {
    resolveFn(result);
} else {
    rejectFn(error);
}

return promise;
```

### fetch() Instead of $.getJSON

```javascript
// jQuery (old)
$.getJSON(url).done(data => { ... }).fail(err => { ... });

// Native (new)
try {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    // ... do something with data
} catch (error) {
    // ... handle network errors and other issues
}
```

### Event Listeners

```javascript
// jQuery (old)
$element.on('click', handler);
$element.off('click', handler);

// Native (new)
element.addEventListener('click', handler);
element.removeEventListener('click', handler);
```

### Cross-Iframe DOM Access

CKEditor image plugins often interact with iframes (e.g., image manipulation previews):

```javascript
// jQuery (old)
const $iframe = dialog.$el.find('iframe');
const $img = $iframe.contents().find('img');
$img.data('crop-data');

// Native (new)
const iframe = dialogEl.querySelector('iframe');
const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
const img = iframeDoc.querySelector('img');
img.dataset.cropData; // .data('crop-data') → dataset.cropData (camelCase)
```

**Note:** jQuery `.data('foo-bar')` maps to `dataset.fooBar` -- jQuery auto-converts kebab-case to camelCase via the `dataset` API.

### Mousewheel Event

```javascript
// jQuery (old)
$element.on('mousewheel', function(e) {
    e.preventDefault();
    const delta = e.originalEvent.wheelDelta;
    zoom += delta > 0 ? 0.1 : -0.1;
});

// Native (new) -- 'wheel' event with inverted deltaY
element.addEventListener('wheel', (e) => {
    e.preventDefault();
    // deltaY is POSITIVE for scroll-down (opposite of old wheelDelta)
    zoom += e.deltaY < 0 ? 0.1 : -0.1;
}, { passive: false }); // passive: false required to allow preventDefault()
```
