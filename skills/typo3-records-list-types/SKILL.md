---
name: "typo3-records-list-types"
description: "Changes how records are presented in the TYPO3 v14 Records module: cards with thumbnails instead of a plain table of rows, a timeline, a board with columns, or grid, compact and teaser views - configured per record type through TSconfig with Fluid templates, icons and accessibility. Use when editors want to see something other than a table, when one record type needs its own layout in the backend, or when building custom Records module views."
metadata:
  skill_type: preference
  version: "1.0.0"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---
# TYPO3 Records List Types

> Source: https://github.com/dirnbauer/typo3-skills

Extension key `records_list_types`, Composer package `webconsulting/records-list-types`, source
https://github.com/dirnbauer/typo3-records-list-types. The skill's `metadata.version` versions this
document, not the extension.

## Rules

- **Read the selected release's own `composer.json`.** The [reviewed source](https://github.com/dirnbauer/typo3-records-list-types/blob/9a07a5ceca3b5c8ab3166debb762d96d1d03adcf/composer.json)
  (v2.0.1, 2026-09-26) requires TYPO3 `^14.3.7` and PHP `^8.4`; the newest tag on 2026-10-31,
  v2.0.2, declares the same. Never claim v14.0 or PHP 8.3 compatibility.
- **Install from the VCS source.** The package returned 404 on Packagist on 2026-10-31, so a plain
  `composer require` fails until a root `repositories` entry exists (see [Installation](#2-installation)).
- **Configure, do not patch.** Views, fields and templates are set through Page TSconfig plus Fluid
  and CSS in the sitepackage; never edit the extension's vendor files.
- **Accessibility is evidenced, not assumed.** Keyboard and ARIA patterns are not a WCAG
  conformance certificate; test the installed release with automated and manual checks, including
  drag-and-drop with the keyboard.
- **Workspace support is experimental.** Indicators work; test drag-and-drop in a workspace before
  promising it to editors.
- Verify every TYPO3 API you add against the installed v14 source, not memory.

## 1. Overview

Transforms the TYPO3 backend **Records** module with multiple view modes:

| View | Description | Best for |
|------|-------------|----------|
| **List** | Standard TYPO3 table (unchanged) | Data-heavy tables, system records |
| **Grid** | Card layout with thumbnails, drag-and-drop | News, products, team members, media |
| **Compact** | Dense single-line rows, fixed columns | Address books, logs, settings, bulk data |
| **Teaser** | Minimal cards with title, date, excerpt | Blog posts, events, press releases |
| **Custom** | Your own views via TSconfig + Fluid | Timeline, kanban, catalog, gallery |

Check pagination, sorting, search, record actions, workspace indicators and dark mode in every
enabled view.

## 2. Installation

Merge a scoped VCS entry into the root `composer.json`, then require a stable tag:

```json
{
  "repositories": [
    {
      "type": "vcs",
      "url": "https://github.com/dirnbauer/typo3-records-list-types.git",
      "only": ["webconsulting/records-list-types"]
    }
  ]
}
```

```bash
composer require webconsulting/records-list-types:^2.0
./vendor/bin/typo3 extension:setup -e records_list_types
```

After activation, view mode toggle buttons appear in the Records module header.

## 3. View Mode Configuration

### Set Default and Allowed Views

```tsconfig
mod.web_list.viewMode {
    default = grid                          # Default for new users
    allowed = list,grid,compact,teaser      # Available in toggle
}
```

### Grid Column Count

```tsconfig
mod.web_list.gridView.cols = 4    # 2-6 columns (default: 4)
```

### View Mode Resolution Order

1. **URL parameter** (`?displayMode=grid`) -- highest priority
2. **User preference** (stored via AJAX, persisted per session)
3. **TSconfig default** (`mod.web_list.viewMode.default`)
4. **Fallback**: `list`

## 4. Per-Table Field Configuration

Configure which fields appear on cards for each table:

```tsconfig
mod.web_list.gridView.table.<tableName> {
    titleField = title              # Card title (default: TCA ctrl.label)
    descriptionField = teaser       # Card body text
    imageField = fal_media          # FAL field for thumbnail
    preview = 1                     # Enable thumbnails (1/0)
}
```

### Common Tables

```tsconfig
# News
mod.web_list.gridView.table.tx_news_domain_model_news {
    titleField = title
    descriptionField = teaser
    imageField = fal_media
    preview = 1
}

# Pages
mod.web_list.gridView.table.pages {
    titleField = title
    descriptionField = abstract
    imageField = media
    preview = 1
}

# Content Elements
mod.web_list.gridView.table.tt_content {
    titleField = header
    descriptionField = bodytext
    imageField = image
    preview = 1
}

# Frontend Users
mod.web_list.gridView.table.fe_users {
    titleField = name
    descriptionField = email
    imageField = image
    preview = 1
}
```

## 5. View Modes Detail

### Grid View

- **Card structure**: Header (icon, title, drag handle, actions), optional thumbnail image (16:9), field values body, footer (UID, PID, language flag)
- **Thumbnails**: Automatically resolved from FAL image fields (configurable per table)
- **Field display**: Type-aware formatting -- booleans as badges, dates in monospace, relations with count indicators, links as clickable, text truncated with ellipsis
- **Two-column field layout**: Small fields display side-by-side; text/richtext fields span full width
- **Drag-and-drop**: Both mouse and keyboard (Space to grab, arrows to move, Space to drop, Escape to cancel)
- **Record actions**: Inline visibility toggle, edit, delete, plus dropdown for info, history, copy, cut
- **State indicators**: Hidden records get amber headers; workspace records show blue/purple/cyan/red headers
- **Language flags**: Each card shows the record's language flag icon in the bottom-right corner
- **Responsive grid**: Auto-fills columns from 320px minimum, scales from 1 column on mobile to multiple on wide screens

### Compact View

- **Fixed columns**: Icon, UID, and title pinned on the left; status toggle, edit, delete pinned on the right
- **Scrollable middle**: Additional fields scroll horizontally between fixed columns
- **Scroll shadows**: Visual indicators when content extends beyond the visible area
- **Sortable headers**: Click column headers to sort ascending/descending via TYPO3's native dropdown API
- **Zebra striping**: Alternating row colors for readability
- **Hidden record styling**: Muted background and dimmed title for hidden records

### Teaser View

- **Clean design**: Title, date with calendar icon, description excerpt (2-line clamp)
- **Status badges**: UID pill and hidden/visible indicator
- **Compact actions**: Visibility toggle, edit, delete buttons
- **Hidden state**: Accent bar on hidden records
- **CSS `light-dark()`**: Native theme switching support

## 6. Pagination

Matches TYPO3 Core List View behavior:

- **Multi-table mode**: Limited records per table with "Expand table" button
- **Single-table mode**: Full pagination (record range, page input, first/prev/next/last)

```tsconfig
# Global default items per page
mod.web_list.viewMode.itemsPerPage = 100

# Per-type override
mod.web_list.viewMode.types.grid.itemsPerPage = 100
mod.web_list.viewMode.types.compact.itemsPerPage = 300
mod.web_list.viewMode.types.teaser.itemsPerPage = 100

# Disable pagination
mod.web_list.viewMode.types.grid.itemsPerPage = 0
```

## 7. Sorting

Tables with TCA `sortby` support two modes:

- **Manual**: Drag-and-drop reordering (default)
- **Field**: Sort by column with ascending/descending toggle

A segmented toggle switches between modes. Drag-and-drop supports both mouse and keyboard (Space to grab, arrows to move, Space to drop, Escape to cancel).

## 8. Custom View Types (Quick Start)

Add a view in **3 steps** -- zero PHP required.

### Step 1: Register via TSconfig

```tsconfig
mod.web_list.viewMode {
    allowed = list,grid,compact,teaser,timeline

    types.timeline {
        label = Timeline
        icon = actions-calendar
        template = TimelineView
        templateRootPath = EXT:my_sitepackage/Resources/Private/Backend/Templates/
        css = EXT:my_sitepackage/Resources/Public/Css/timeline.css
        displayColumns = label,datetime,teaser
        columnsFromTCA = 0
    }
}
```

### Step 2: Create Fluid Template

Copy `GenericView.html` from the extension as a starting point. Key variables: `tableData`, `tableData.records`, `record.title`, `record.displayValues`.

### Step 3: Add CSS (optional)

Use TYPO3 CSS variables for automatic dark mode:

```css
.timeline-item {
    /* TYPO3 Core fallbacks; `--gv-*` tokens are defined by this extension, not by TYPO3 Core */
    background: var(--typo3-component-bg, #fff);
    border: 1px solid var(--typo3-component-border-color, #d4d4d8);
}
```

Read [SKILL-CUSTOM-VIEWS.md](SKILL-CUSTOM-VIEWS.md) for the rest: the full view-type option
table, template variables, reusing the built-in `CompactView`/`TeaserView` templates with fixed
columns, page-scoped views, column resolution (`columnsFromTCA` vs `displayColumns`, resolved by
`RecordDisplayColumnResolver`), asset loading, worked examples and PSR-14 registration.

## 9. Workspace Support

Records display color-coded indicators in workspaces:

| State | Color | Visual |
|-------|-------|--------|
| New | Blue | Blue header + left border |
| Modified | Purple | Purple header + left border |
| Moved | Cyan | Cyan header + left border |
| Deleted | Red | Red header + strikethrough title |

Workspace overlays applied via `BackendUtility::workspaceOL()`.

> **Note:** Workspace support is experimental. Visual indicators work, but drag-and-drop within workspaces has limited testing.


## Detailed Reference

Read [the full guide](references/full-guide.md) index when the task needs one of sections 12–20: PSR-14 events and shipped Core listeners (12), extending with custom partials, assets and the page-tree refresh event (13), architecture and service classes (14), common TSconfig recipes (15), file structure of the v2.0.2 checkout (16), accessibility of the shipped listbox pattern (17), dark mode (18), security (19) and known limitations (20). Keep this file unloaded for narrow tasks so the skill follows progressive disclosure.
