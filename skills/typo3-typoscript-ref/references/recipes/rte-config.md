# Recipe: Rich Text Editor Configuration (CKEditor)

> Version: v12+

## What this builds
Page TSconfig configuration for CKEditor presets, controlling allowed HTML tags, heading levels, format options, and custom styles in the TYPO3 Rich Text Editor.

## TSconfig — Custom RTE Preset Registration

File: `EXT:site_package/Configuration/RTE/SitePackage.yaml`
```yaml
imports:
  - { resource: "EXT:rte_ckeditor/Configuration/RTE/Default.yaml" }

editor:
  config:
    # Toolbar configuration
    toolbar:
      items:
        - bold
        - italic
        - '|'
        - bulletedList
        - numberedList
        - '|'
        - indent
        - outdent
        - '|'
        - blockQuote
        - link
        - '|'
        - insertTable
        - '|'
        - heading
        - style
        - '|'
        - sourceEditing
        - removeFormat
        - '|'
        - undo
        - redo

    # Heading levels
    heading:
      options:
        - { model: 'paragraph', title: 'Paragraph' }
        - { model: 'heading2', view: 'h2', title: 'Heading 2' }
        - { model: 'heading3', view: 'h3', title: 'Heading 3' }
        - { model: 'heading4', view: 'h4', title: 'Heading 4' }

    # Custom styles dropdown
    style:
      definitions:
        - { name: 'Lead text', element: 'p', classes: ['text-lead'] }
        - { name: 'Small text', element: 'p', classes: ['text-small'] }
        - { name: 'Highlight', element: 'span', classes: ['text-highlight'] }
        - { name: 'Button primary', element: 'a', classes: ['btn', 'btn-primary'] }
        - { name: 'Button secondary', element: 'a', classes: ['btn', 'btn-secondary'] }

    # Link configuration
    link:
      decorators:
        openInNewTab:
          mode: 'manual'
          label: 'Open in new tab'
          defaultValue: false
          attributes:
            target: '_blank'
            rel: 'noopener noreferrer'

    # Table configuration
    table:
      contentToolbar:
        - tableColumn
        - tableRow
        - mergeTableCells
        - tableProperties
        - tableCellProperties

    # Word count (optional)
    wordCount:
      displayCharacters: true
      displayWords: true

  # External plugins (if needed)
  externalPlugins: {}

processing:
  # Allowed HTML tags
  allowTags:
    - a
    - abbr
    - b
    - blockquote
    - br
    - caption
    - cite
    - code
    - em
    - figcaption
    - figure
    - h2
    - h3
    - h4
    - hr
    - i
    - img
    - li
    - ol
    - p
    - pre
    - span
    - strong
    - sub
    - sup
    - table
    - tbody
    - td
    - th
    - thead
    - tr
    - ul

  # Allowed tag attributes
  allowAttributes:
    - class
    - href
    - target
    - rel
    - id
    - colspan
    - rowspan
    - src
    - alt
    - title

  # Deny specific tags
  denyTags:
    - font
    - center
    - div
    - h1
    - h5
    - h6
```

## TSconfig — Assign RTE Preset

File: `EXT:site_package/Configuration/page.tsconfig` or via Page TSconfig field:
```tsconfig
# Assign the custom preset globally
RTE.default.preset = SitePackage

# Override preset for specific fields
RTE.config.tt_content.bodytext.preset = SitePackage

# Minimal preset for header fields (if using RTE in headers)
RTE.config.tt_content.subheader.preset = minimal

# Disable RTE for specific content types
RTE.config.tt_content.bodytext.types.header.disabled = 1
```

## TSconfig — Restrict RTE Features per Content Type

```tsconfig
# Simplified RTE for news teaser text
RTE.config.tx_news_domain_model_news.bodytext.preset = minimal

# Override for specific page trees (use conditions or set on page)
[page["uid"] in [42,43,44]]
    RTE.default.preset = minimal
[end]
```

## Register the Preset in ext_localconf.php

```php
$GLOBALS['TYPO3_CONF_VARS']['RTE']['Presets']['SitePackage'] =
    'EXT:site_package/Configuration/RTE/SitePackage.yaml';
```

## v13+ — Register via Configuration/Sets (Site Sets)

File: `EXT:site_package/Configuration/Sets/SitePackage/config.yaml`
```yaml
name: vendor/site-package
label: Site Package
```

File: `EXT:site_package/Configuration/Sets/SitePackage/page.tsconfig`
```tsconfig
RTE.default.preset = SitePackage
```

## Minimal Preset Example

File: `EXT:site_package/Configuration/RTE/Minimal.yaml`
```yaml
imports:
  - { resource: "EXT:rte_ckeditor/Configuration/RTE/Default.yaml" }

editor:
  config:
    toolbar:
      items:
        - bold
        - italic
        - '|'
        - link
        - '|'
        - bulletedList
        - numberedList

    heading:
      options:
        - { model: 'paragraph', title: 'Paragraph' }

    removePlugins:
      - table
      - blockQuote
      - indent

processing:
  allowTags:
    - a
    - b
    - br
    - em
    - li
    - ol
    - p
    - span
    - strong
    - ul
```

## Custom CSS for RTE Editor Content

File: `EXT:site_package/Configuration/RTE/SitePackage.yaml` (add to editor section):
```yaml
editor:
  config:
    # Load custom CSS into the editor iframe
    contentsCss:
      - "EXT:site_package/Resources/Public/Css/rte-editor.css"
```

File: `EXT:site_package/Resources/Public/Css/rte-editor.css`
```css
.text-lead {
    font-size: 1.25em;
    font-weight: 300;
    line-height: 1.6;
}

.text-small {
    font-size: 0.875em;
}

.text-highlight {
    background-color: #fff3cd;
    padding: 0.125em 0.25em;
    border-radius: 0.125rem;
}

.btn {
    display: inline-block;
    padding: 0.5em 1em;
    text-decoration: none;
    border-radius: 0.25rem;
    cursor: pointer;
}

.btn-primary {
    background-color: #0d6efd;
    color: #ffffff;
}

.btn-secondary {
    background-color: #6c757d;
    color: #ffffff;
}
```

## Notes
- TYPO3 v12+ uses CKEditor 5. The configuration format changed significantly from CKEditor 4 (v11 and earlier).
- The preset YAML file must be registered in `ext_localconf.php` via `$GLOBALS['TYPO3_CONF_VARS']['RTE']['Presets']`.
- `processing.allowTags` controls which HTML tags are stored in the database. Tags not listed are stripped on save.
- Custom styles need matching CSS both in the RTE editor (`contentsCss`) and on the frontend.
- Deny `h1` in the RTE — `h1` should come from the page title, not from content elements.
- In v13+, preset assignment can be done via Site Sets `page.tsconfig` instead of manual `ext_localconf.php` registration.
- The `sourceEditing` toolbar item allows editors to see raw HTML. Only enable for trusted users.
- `removePlugins` in the minimal preset disables CKEditor plugins entirely, not just toolbar buttons.
