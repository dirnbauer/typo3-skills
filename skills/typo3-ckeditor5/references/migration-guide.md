# CKEditor 4 to 5 Migration Guide

## Overview

CKEditor 5 is a complete rewrite with different architecture. Migration requires:
1. Understanding architectural differences
2. Converting custom plugins
3. Updating configuration
4. Testing content compatibility

## Architectural Differences

### CKEditor 4 Architecture

```javascript
// CKEditor 4: Plugin structure
CKEDITOR.plugins.add('myplugin', {
    requires: 'widget',
    icons: 'myplugin',

    init: function(editor) {
        editor.widgets.add('myWidget', {
            template: '<div class="my-widget">{content}</div>',
            editables: {
                content: '.my-widget-content'
            },
            upcast: function(element) {
                return element.name === 'div' &&
                       element.hasClass('my-widget');
            }
        });

        editor.addCommand('insertMyWidget', {
            exec: function(editor) {
                editor.insertHtml('<div class="my-widget">Content</div>');
            }
        });

        editor.ui.addButton('MyWidget', {
            label: 'Insert Widget',
            command: 'insertMyWidget',
            toolbar: 'insert'
        });
    }
});
```

### CKEditor 5 Architecture

```javascript
// CKEditor 5: Class-based plugin
import { Plugin } from '@ckeditor/ckeditor5-core';
import { Widget, toWidget } from '@ckeditor/ckeditor5-widget';
import { Command } from '@ckeditor/ckeditor5-core';
import { ButtonView } from '@ckeditor/ckeditor5-ui';

export default class MyPlugin extends Plugin {
    static get requires() {
        return [Widget];
    }

    init() {
        this._defineSchema();
        this._defineConverters();
        this._defineCommands();
        this._defineUI();
    }

    _defineSchema() {
        const schema = this.editor.model.schema;
        schema.register('myWidget', {
            inheritAllFrom: '$blockObject'
        });
    }

    _defineConverters() {
        const conversion = this.editor.conversion;

        conversion.for('upcast').elementToElement({
            view: { name: 'div', classes: 'my-widget' },
            model: 'myWidget'
        });

        conversion.for('editingDowncast').elementToElement({
            model: 'myWidget',
            view: (modelElement, { writer }) => {
                const div = writer.createContainerElement('div', {
                    class: 'my-widget'
                });
                return toWidget(div, writer);
            }
        });
    }

    _defineCommands() {
        this.editor.commands.add('insertMyWidget',
            new InsertMyWidgetCommand(this.editor));
    }

    _defineUI() {
        this.editor.ui.componentFactory.add('myWidget', locale => {
            const button = new ButtonView(locale);
            button.set({ label: 'Insert Widget', tooltip: true });
            button.on('execute', () => {
                this.editor.execute('insertMyWidget');
            });
            return button;
        });
    }
}
```

## Key Differences

| Aspect | CKEditor 4 | CKEditor 5 |
|--------|-----------|------------|
| Plugin System | Object-based registration | ES6 class-based |
| Data Model | DOM-based | Abstract MVC model |
| Commands | Simple exec functions | Command class pattern |
| UI | jQuery-based | Observable View classes |
| Conversion | Upcast/downcast in one | Separate upcast/downcast |
| Widgets | Widget plugin | Built-in widget system |
| Configuration | JavaScript object | YAML (TYPO3) + JS |

## Migration Checklist

### Pre-Migration Assessment

- [ ] Audit all CKEditor 4 plugins in use
- [ ] List custom plugins requiring conversion
- [ ] Identify configuration customizations
- [ ] Document existing content formats
- [ ] Test content rendering requirements
- [ ] Plan testing strategy

### Plugin Migration Steps

#### 1. Convert Plugin Structure

```javascript
// CKEditor 4
CKEDITOR.plugins.add('infobox', {
    init: function(editor) {
        // All logic here
    }
});

// CKEditor 5
export default class InfoBox extends Plugin {
    static get requires() { return [InfoBoxEditing, InfoBoxUI]; }
    static get pluginName() { return 'InfoBox'; }
}

export class InfoBoxEditing extends Plugin {
    init() {
        // Schema, converters, commands
    }
}

export class InfoBoxUI extends Plugin {
    init() {
        // UI components
    }
}
```

#### 2. Convert Schema/Data Model

```javascript
// CKEditor 4: Allowed content rules
CKEDITOR.plugins.add('infobox', {
    init: function(editor) {
        editor.filter.allow('div[class,data-type]{*}');
    }
});

// CKEditor 5: Schema registration
_defineSchema() {
    const schema = this.editor.model.schema;

    schema.register('infoBox', {
        inheritAllFrom: '$blockObject',
        allowAttributes: ['infoType']
    });
}
```

#### 3. Convert Data Conversion

```javascript
// CKEditor 4: Widget upcast
CKEDITOR.plugins.add('infobox', {
    init: function(editor) {
        editor.widgets.add('infobox', {
            upcast: function(element) {
                return element.name === 'div' &&
                       element.hasClass('info-box');
            },
            data: function() {
                this.element.setAttribute('data-type', this.data.type);
            }
        });
    }
});

// CKEditor 5: Conversion
_defineConverters() {
    const conversion = this.editor.conversion;

    // Upcast (view -> model)
    conversion.for('upcast').elementToElement({
        view: {
            name: 'div',
            classes: 'info-box'
        },
        model: (viewElement, { writer }) => {
            return writer.createElement('infoBox', {
                infoType: viewElement.getAttribute('data-type')
            });
        }
    });

    // Downcast (model -> view)
    conversion.for('downcast').elementToElement({
        model: 'infoBox',
        view: (modelElement, { writer }) => {
            return writer.createContainerElement('div', {
                class: 'info-box',
                'data-type': modelElement.getAttribute('infoType')
            });
        }
    });
}
```

#### 4. Convert Commands

```javascript
// CKEditor 4: Command
CKEDITOR.plugins.add('infobox', {
    init: function(editor) {
        editor.addCommand('insertInfoBox', {
            exec: function(editor) {
                var element = new CKEDITOR.dom.element('div');
                element.addClass('info-box');
                editor.insertElement(element);
            }
        });
    }
});

// CKEditor 5: Command class
export class InsertInfoBoxCommand extends Command {
    execute(options = {}) {
        const model = this.editor.model;

        model.change(writer => {
            const infoBox = writer.createElement('infoBox', {
                infoType: options.type || 'default'
            });

            model.insertObject(infoBox, null, null, {
                setSelection: 'on'
            });
        });
    }

    refresh() {
        const model = this.editor.model;
        const selection = model.document.selection;

        const allowedIn = model.schema.findAllowedParent(
            selection.getFirstPosition(),
            'infoBox'
        );

        this.isEnabled = allowedIn !== null;
    }
}
```

#### 5. Convert UI Components

```javascript
// CKEditor 4: Button
CKEDITOR.plugins.add('infobox', {
    init: function(editor) {
        editor.ui.addButton('InfoBox', {
            label: 'Insert Info Box',
            command: 'insertInfoBox',
            toolbar: 'insert',
            icon: this.path + 'icons/infobox.png'
        });
    }
});

// CKEditor 5: ButtonView
_defineUI() {
    const editor = this.editor;

    editor.ui.componentFactory.add('infoBox', locale => {
        const command = editor.commands.get('insertInfoBox');
        const button = new ButtonView(locale);

        button.set({
            label: editor.t('Insert Info Box'),
            icon: infoBoxIcon,
            tooltip: true
        });

        button.bind('isEnabled').to(command);

        button.on('execute', () => {
            editor.execute('insertInfoBox');
            editor.editing.view.focus();
        });

        return button;
    });
}
```

## Configuration Migration

### CKEditor 4 Configuration (PageTSConfig)

```typoscript
# TYPO3 CKEditor 4 configuration
RTE.default {
    showStatusBar = 0

    buttons {
        bold.hotKey = ctrl+b
        italic.hotKey = ctrl+i
    }

    proc {
        allowedClasses = info-box, warning-box
        allowTags = p, br, strong, em, ul, ol, li, a, div
    }

    contentCSS = EXT:my_extension/Resources/Public/Css/rte.css
}
```

### CKEditor 5 Configuration (YAML)

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
        - bulletedList
        - numberedList
        - '|'
        - link
        - infoBox

    # Keyboard shortcuts
    keystrokes:
      - [ctrl, 66, 'bold']      # Ctrl+B
      - [ctrl, 73, 'italic']    # Ctrl+I

    importModules:
      - '@vendor/my_extension/ckeditor/info-box.js'

processing:
  allowTags:
    - p
    - br
    - strong
    - em
    - ul
    - ol
    - li
    - a
    - div

  allowAttributes:
    - { attribute: 'class', elements: 'div' }
    - { attribute: 'data-type', elements: 'div' }
```

## TYPO3-Specific Migration

### ext_localconf.php Changes

```php
<?php
// CKEditor 4 (old)
$GLOBALS['TYPO3_CONF_VARS']['RTE']['Presets']['my_preset'] =
    'EXT:my_extension/Configuration/RTE/CKEditor4.yaml';

// CKEditor 5 (new)
$GLOBALS['TYPO3_CONF_VARS']['RTE']['Presets']['my_preset'] =
    'EXT:my_extension/Configuration/RTE/Default.yaml';

// Register CKEditor 5 plugin
$GLOBALS['TYPO3_CONF_VARS']['RTE']['CKEditor5']['plugins']['info-box'] = [
    'entryPoint' => 'EXT:my_extension/Resources/Public/JavaScript/Ckeditor/info-box.js',
    'stylesheets' => [
        'EXT:my_extension/Resources/Public/Css/Ckeditor/info-box.css',
    ],
];
```

### Processing Rules Migration

```yaml
# CKEditor 4 processing (TYPO3 v11)
processing:
  mode: default
  HTMLparser_db:
    allowTags: p,br,strong,em,a,ul,ol,li

  HTMLparser_rte:
    allowTags: p,br,strong,em,a,ul,ol,li

# CKEditor 5 processing (TYPO3 v12+)
processing:
  mode: default
  allowTags:
    - p
    - br
    - strong
    - em
    - a
    - ul
    - ol
    - li

  allowAttributes:
    - { attribute: 'href', elements: 'a' }
    - { attribute: 'target', elements: 'a' }
```

## Content Compatibility

### Existing Content Testing

```php
<?php
// Test script to validate content rendering

use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Utility\GeneralUtility;

$connection = GeneralUtility::makeInstance(ConnectionPool::class)
    ->getConnectionForTable('tt_content');

$rows = $connection->select(
    ['uid', 'bodytext'],
    'tt_content',
    ['CType' => 'text']
)->fetchAllAssociative();

foreach ($rows as $row) {
    $content = $row['bodytext'];

    // Check for CKEditor 4 specific patterns
    $issues = [];

    // Check for deprecated widgets
    if (strpos($content, 'data-cke-widget') !== false) {
        $issues[] = "CKEditor 4 widget markup in uid {$row['uid']}";
    }

    // Check for deprecated classes
    if (strpos($content, 'cke_') !== false) {
        $issues[] = "CKEditor 4 class names in uid {$row['uid']}";
    }

    if (!empty($issues)) {
        echo implode("\n", $issues) . "\n";
    }
}
```

### Content Migration Script

```php
<?php
// Migration command for content updates

namespace Vendor\MyExtension\Command;

use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Output\OutputInterface;
use TYPO3\CMS\Core\Database\ConnectionPool;
use TYPO3\CMS\Core\Utility\GeneralUtility;

final class MigrateRteContentCommand extends Command
{
    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $connection = GeneralUtility::makeInstance(ConnectionPool::class)
            ->getConnectionForTable('tt_content');

        $rows = $connection->select(
            ['uid', 'bodytext'],
            'tt_content',
            []
        )->fetchAllAssociative();

        $updated = 0;

        foreach ($rows as $row) {
            $content = $row['bodytext'];
            $originalContent = $content;

            // Remove CKEditor 4 widget wrappers
            $content = preg_replace(
                '/<div[^>]*data-cke-widget[^>]*>(.*?)<\/div>/s',
                '$1',
                $content
            );

            // Convert deprecated markup
            $content = str_replace(
                ['<b>', '</b>', '<i>', '</i>'],
                ['<strong>', '</strong>', '<em>', '</em>'],
                $content
            );

            // Update if changed
            if ($content !== $originalContent) {
                $connection->update(
                    'tt_content',
                    ['bodytext' => $content],
                    ['uid' => $row['uid']]
                );
                $updated++;
                $output->writeln("Updated uid {$row['uid']}");
            }
        }

        $output->writeln("Updated $updated records");

        return Command::SUCCESS;
    }
}
```

## Common Migration Issues

### Issue 1: Widget Markup Differences

```html
<!-- CKEditor 4 widget output -->
<div class="cke_widget_wrapper" data-cke-widget-id="0">
    <div class="info-box" data-widget="infobox">
        Content here
    </div>
</div>

<!-- CKEditor 5 output (cleaner) -->
<div class="info-box" data-type="info">
    Content here
</div>
```

### Issue 2: Link Handling

```javascript
// CKEditor 4: Link dialog
editor.on('doubleclick', function(evt) {
    var element = evt.data.element;
    if (element.is('a')) {
        evt.data.dialog = 'link';
    }
});

// CKEditor 5: Built-in link handling via linkConfig
// Configuration in YAML
editor:
  config:
    link:
      decorators:
        openInNewTab:
          mode: manual
          label: 'Open in new tab'
          attributes:
            target: '_blank'
```

### Issue 3: Table Handling

```yaml
# CKEditor 5 table configuration
editor:
  config:
    table:
      contentToolbar:
        - tableColumn
        - tableRow
        - mergeTableCells
        - tableProperties
        - tableCellProperties

      tableProperties:
        borderColors:
          - { color: 'hsl(0, 0%, 0%)', label: 'Black' }
          - { color: 'hsl(0, 0%, 30%)', label: 'Dim grey' }
          - { color: 'hsl(0, 0%, 60%)', label: 'Grey' }
```

## Testing Strategy

### Unit Tests for Converted Plugins

```javascript
import { expect } from 'chai';
import { ClassicEditor } from '@ckeditor/ckeditor5-editor-classic';
import { Paragraph } from '@ckeditor/ckeditor5-paragraph';
import InfoBox from '../src/infobox';

describe('InfoBox Plugin Migration', () => {
    let editor;

    beforeEach(async () => {
        editor = await ClassicEditor.create(
            document.createElement('div'),
            { plugins: [Paragraph, InfoBox] }
        );
    });

    afterEach(async () => {
        await editor.destroy();
    });

    it('should upcast CKEditor 4 markup', () => {
        // CKEditor 4 format
        editor.setData('<div class="info-box" data-type="warning">Test</div>');

        const root = editor.model.document.getRoot();
        const infoBox = root.getChild(0);

        expect(infoBox.name).to.equal('infoBox');
        expect(infoBox.getAttribute('infoType')).to.equal('warning');
    });

    it('should downcast to clean HTML', () => {
        editor.model.change(writer => {
            const infoBox = writer.createElement('infoBox', {
                infoType: 'info'
            });
            const paragraph = writer.createElement('paragraph');
            writer.insertText('Test', paragraph);
            writer.append(paragraph, infoBox);
            writer.insert(infoBox, editor.model.document.getRoot(), 0);
        });

        const output = editor.getData();

        expect(output).to.include('class="info-box"');
        expect(output).to.include('data-type="info"');
        expect(output).not.to.include('cke_');
    });
});
```

### Integration Tests

```php
<?php
// TYPO3 functional test for RTE output

namespace Vendor\MyExtension\Tests\Functional;

use TYPO3\TestingFramework\Core\Functional\FunctionalTestCase;

final class RteOutputTest extends FunctionalTestCase
{
    protected array $testExtensionsToLoad = [
        'typo3conf/ext/my_extension',
    ];

    /**
     * @test
     */
    public function rteContentRendersCorrectly(): void
    {
        $this->importCSVDataSet(__DIR__ . '/Fixtures/pages.csv');
        $this->importCSVDataSet(__DIR__ . '/Fixtures/tt_content.csv');

        $this->setUpFrontendRootPage(
            1,
            ['EXT:my_extension/Configuration/TypoScript/setup.typoscript']
        );

        $response = $this->executeFrontendSubRequest(
            new InternalRequest('https://example.com/')
        );

        $body = (string)$response->getBody();

        // Verify CKEditor 5 output format
        self::assertStringContainsString('class="info-box"', $body);
        self::assertStringNotContainsString('data-cke-widget', $body);
    }
}
```

## Rollback Strategy

### Feature Flag Implementation

```php
<?php
// ext_localconf.php

// Use feature flag for gradual rollout
if (\TYPO3\CMS\Core\Utility\GeneralUtility::makeInstance(
    \TYPO3\CMS\Core\Configuration\Features::class
)->isFeatureEnabled('myExtension.useCkeditor5')) {
    // CKEditor 5 configuration
    $GLOBALS['TYPO3_CONF_VARS']['RTE']['Presets']['default'] =
        'EXT:my_extension/Configuration/RTE/CKEditor5.yaml';
} else {
    // CKEditor 4 fallback (TYPO3 v11)
    $GLOBALS['TYPO3_CONF_VARS']['RTE']['Presets']['default'] =
        'EXT:my_extension/Configuration/RTE/CKEditor4.yaml';
}
```

```yaml
# config/system/settings.php
$GLOBALS['TYPO3_CONF_VARS']['SYS']['features']['myExtension.useCkeditor5'] = true;
```

## jQuery Removal Migration

TYPO3 backend JS is dropping jQuery. The `rte_ckeditor` system extension already has zero jQuery. Backend JS is **NOT** covered by the deprecation policy, so jQuery can vanish without notice. Migrate proactively.

### Step-by-Step Migration Order (Lowest Risk First)

Migrate in this order to keep each step small and testable:

1. **`$.extend`** → `Object.assign()` or spread syntax `{ ...a, ...b }`
2. **`$.each(collection, callback)`** → `for...of` / `Array.prototype.forEach`
3. **`$.getJSON` / `$.ajax`** → `fetch()` with `response.ok` check
4. **`$.Deferred()`** → `new Promise()` with extracted resolve/reject refs
5. **Iframe DOM access** → `querySelector` + `contentDocument` + `dataset`
6. **Dialog DOM builder** → `h(tag, className, parent)` helper (see plugin-development.md)
7. **Remove `import $ from 'jquery'`** — only after all usages are gone

### Critical: `$.each` to `for...of` and Variable Scoping

**CRITICAL:** When converting `$.each(callback)` to `for...of`, `var` declarations inside the callback lose per-iteration function scope. You **must** convert `var` to `let`/`const` simultaneously, or closures that capture loop variables will break.

```javascript
// jQuery with var -- WORKS because $.each creates a new function scope per iteration
$.each(items, function(i, item) {
    var value = item.name;
    setTimeout(function() {
        console.log(value); // Correct: each iteration has its own 'value'
    }, 100);
});

// BROKEN: for...of with var -- var is function-scoped, NOT block-scoped
for (const item of items) {
    var value = item.name;
    setTimeout(function() {
        console.log(value); // BUG: always logs last item's name
    }, 100);
}

// CORRECT: for...of with let -- let is block-scoped
for (const item of items) {
    let value = item.name;       // or: const value = item.name;
    setTimeout(function() {
        console.log(value); // Correct: each iteration has its own 'value'
    }, 100);
}
```

### Event Migration: `mousewheel` → `wheel`

The `mousewheel` event is non-standard (WebKit/IE). Use the standard `wheel` event:

```javascript
// Old (jQuery + mousewheel)
$element.on('mousewheel', function(e) {
    e.preventDefault();
    zoom += e.originalEvent.wheelDelta > 0 ? step : -step;
});

// New (native + wheel) -- deltaY is INVERTED vs wheelDelta
element.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom += e.deltaY < 0 ? step : -step;
}, { passive: false }); // passive: false required for preventDefault()
```

### jQuery `.data()` → `dataset`

jQuery `.data('foo-bar')` auto-converts to camelCase. The native `dataset` API does the same:

```javascript
// jQuery
$el.data('crop-data');       // reads data-crop-data attribute
$el.data('crop-data', val);  // sets data-crop-data attribute

// Native
el.dataset.cropData;         // reads data-crop-data (auto camelCase)
el.dataset.cropData = val;   // sets data-crop-data
```

### XSS Prevention

Never use `insertAdjacentHTML` or `innerHTML` with interpolated values. This triggers CodeQL `js/xss-through-dom` alerts:

```javascript
// DANGEROUS
container.insertAdjacentHTML('beforeend', `<span>${userValue}</span>`);

// SAFE
const span = document.createElement('span');
span.textContent = userValue;
container.appendChild(span);
```

## Post-Migration Verification

### Verification Checklist

- [ ] All custom plugins converted and working
- [ ] Toolbar configuration matches requirements
- [ ] Keyboard shortcuts functional
- [ ] Link browser integration working
- [ ] Image handling correct
- [ ] Table editing functional
- [ ] Existing content renders correctly
- [ ] New content saves properly
- [ ] Processing rules sanitize correctly
- [ ] Frontend output valid HTML
- [ ] Accessibility compliance maintained
- [ ] Performance acceptable

---

## CKEditor 5 version timeline in TYPO3

| TYPO3 | CKEditor 5 | Notes |
|---|---|---|
| v12.4 LTS | 41.x–42.x | Initial CKE5 integration |
| v13.4 LTS | 41.x–42.x | Feature parity with v12 |
| **v14.3 LTS** | **47.0.0** | Major jump |

### v14 changes to watch

- **Context-aware theming (dark/light) enabled by default** (Breaking [#106964](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-106964-MakeCkeditorContextAwareByDefault.html)). If you ship a custom RTE preset with hardcoded CSS colors, they may now clash with the backend theme. Prefer CSS custom properties referencing `--typo3-editor-*` tokens.
- **CKEditor 5 v47** brings the Collaboration / Track Changes / Import-from-Word plugin architecture to maturity; none are bundled in TYPO3 core, but if you vendor them, match the 47.x line.
- **PSR-14 `AfterRichtextConfigurationPreparedEvent`** (Feature [#107322](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Feature-107322-IntroduceAfterRichtextConfigurationPreparedEventAfterRteConfigurationIsPrepared.html)) replaces the informal hook previously used to tweak RTE config at runtime.
- **RTE in EXT:form** (Feature [#108966](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.2/Feature-108966-AddCKEditor5SupportForEXTformRichtextElement.html), v14.2+) — CKE5 is now available inside Form Framework `richtext` elements. RTE presets used there must satisfy form-context content rules.

### Jump from v13 (41/42) to v14 (47)

Breaking API changes accumulate across CKE5 41 → 47. Consult the [CKEditor 5 migration docs](https://ckeditor.com/docs/ckeditor5/latest/updating/guides/migration.html) for each major between your source and target. The [TYPO3 Core CKEditor 5 Integration chapter](https://docs.typo3.org/m/typo3/reference-coreapi/main/en-us/ApiOverview/Rte/ConfigurationReference/Index.html) documents the subset used by core plugins and preset YAML conventions.

### Verification steps for a v14 RTE preset

- [ ] RTE renders without console errors in both light and dark backend modes
- [ ] Preset YAML loads without warnings under v14's schema validation
- [ ] Custom plugins declare compatibility with CKEditor 5 v47 API
- [ ] Inline and block widgets respect the new `editor.editing.view.scrollToTheSelection()` behavior
- [ ] `AfterRichtextConfigurationPreparedEvent` (PSR-14) listeners replace any prior use of the older `BeforeRichtextConfigurationPreparedEvent` or custom `getConfiguration` overrides
- [ ] EXT:form integration tested if the preset is used in forms
