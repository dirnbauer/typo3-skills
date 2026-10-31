---
name: "typo3-content-blocks"
description: "Defines what a TYPO3 block is: its field definitions in config.yaml, and how fields nest into collections or repeatable children. Covers Content Blocks for elements, records, page types and file types as the single source of truth. Use when creating a new block, writing or debugging config.yaml and make:content-block output, migrating Mask or legacy fluid_styled_content while preserving existing records, fixing a block preview that renders blank in the backend, or working with IRRE, labels and friendsoftypo3/content-blocks behaviour. For visual design of blocks: typo3-shadcn-content-elements."
compatibility: "TYPO3 v14.3+ — `friendsoftypo3/content-blocks` 2.x (verify on [Packagist](https://packagist.org/packages/friendsoftypo3/content-blocks))"
metadata:
  skill_type: preference
  version: "1.5.0"
  related_skills: "typo3-content-blocks-migration, shadcn-ui, typo3-vite"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---
# TYPO3 Content Blocks Development

> Source: https://github.com/dirnbauer/webconsulting-skills

Target **TYPO3 v14.3+** with **Content Blocks 2.x**; the 1.x line is v13-only and does not resolve
in a v14 project. Checked on Packagist 2026-10-31: the newest release, 2.4.10 (2026-09-22),
requires `typo3/cms-core ^14.3.7` and PHP `^8.2`; 2.4.8 requires `^14.3.5`. Read the constraint of
the release Composer actually selects. Verify every Content Blocks and Core API against the
installed `vendor/` source, not memory or the online docs (this skill was spot-checked against
Content Blocks 2.4.10 on TYPO3 14.3.9).

## Rules

- **One `config.yaml` per block is the source of truth.** Content Blocks generates TCA, SQL,
  TypoScript rendering, backend forms and label wiring from it. Do not hand-write TCA or SQL for a
  block's own fields; change the YAML and run the schema update.
- **Preserve existing records during migration.** Keep field identifiers, prefix settings,
  `typeName`/CType values and Collection tables stable; a renamed identifier leaves records that
  look empty. Read [Common Pitfalls & Hard-Won Lessons](references/common-pitfalls-and-hard-won-lessons.md)
  before migrating Mask, fluid_styled_content or a classic extension.
- **Give every nested or shared-name Collection an explicit `table:`.** A bare identifier such as
  `items` or `pages` becomes the table name and can collide (pitfalls 1 and 5 in the reference above).
- **Reusing `bodytext` alone does not enable rich text** for a new CType. For migration or preset
  changes, read the [rich-text round-trip contract](references/rich-text-roundtrip.md).
- **Link fields are objects, not strings.** For converted link columns, nested links or plugin type
  restrictions, read [typed links and no-change saves](references/typed-link-migration.md).
- **Backend previews:** on 14.3 a migrated preview that renders collections with the
  `PageLayout/Grid` partial makes child rows use the parent's preview and throws `#1775553111`; read
  [backend previews](references/19-backend-previews.md#child-rows-rendered-through-the-parents-preview).
- **After creating or changing a block**, run `ddev typo3 cache:flush -g system` and
  `ddev typo3 extension:setup --extension=<ext_key>`, then check the backend form, preview and
  frontend output with real records.
- **Visual design** (shadcn/ui tokens, shared Fluid atoms, icons, seed data) belongs to
  `typo3-shadcn-content-elements`; this skill owns the content model.

## Where to read next

| Task | Read |
|---|---|
| Record types, page types, file types | [full guide](references/full-guide.md) sections 6–8 |
| Field type options, prefixing, templating features | [full guide](references/full-guide.md) sections 9–11 |
| Converting a classic TCA/SQL extension to Content Blocks, or back | [SKILL-MIGRATION.md](SKILL-MIGRATION.md) |
| Troubleshooting a block that does not appear or save | [troubleshooting](references/16-troubleshooting.md) |
| v14-only TCA features (country, itemsProcessors, per-colPos restrictions) | [v14-only changes](references/v14-only-changes.md) |

## 1. Installation

```bash
ddev composer require friendsoftypo3/content-blocks
ddev typo3 cache:flush
```

### Security Configuration (Classic Mode)

For non-composer installations, deny web access to ContentBlocks folder:

```apache
# .htaccess addition
RewriteRule (?:typo3conf/ext|typo3/sysext|typo3/ext)/[^/]+/(?:Configuration|ContentBlocks|Resources/Private|Tests?|Documentation|docs?)/ - [F]
```

## 2. Content Types Overview

Content Blocks supports four content types:

| Type | Folder | Table | Use Case |
|------|--------|-------|----------|
| `ContentElements` | `ContentBlocks/ContentElements/` | `tt_content` | Frontend content (hero, accordion, CTA) |
| `RecordTypes` | `ContentBlocks/RecordTypes/` | Custom/existing | Structured records (news, products, team) |
| `PageTypes` | `ContentBlocks/PageTypes/` | `pages` | Custom page types (blog, landing page) |
| `FileTypes` | `ContentBlocks/FileTypes/` | `sys_file_reference` | Extended file references (photographer, copyright) |

## 3. Folder Structure

```
EXT:my_sitepackage/
└── ContentBlocks/
    ├── ContentElements/
    │   └── my-hero/
    │       ├── assets/
    │       │   └── icon.svg
    │       ├── language/
    │       │   └── labels.xlf
    │       ├── templates/
    │       │   ├── backend-preview.fluid.html
    │       │   ├── frontend.fluid.html
    │       │   └── partials/
    │       └── config.yaml
    ├── RecordTypes/
    │   └── my-record/
    │       ├── assets/
    │       │   └── icon.svg
    │       ├── language/
    │       │   └── labels.xlf
    │       └── config.yaml
    ├── PageTypes/
    │   └── blog-article/
    │       ├── assets/
    │       │   ├── icon.svg
    │       │   ├── icon-hide-in-menu.svg
    │       │   └── icon-root.svg
    │       ├── language/
    │       │   └── labels.xlf
    │       ├── templates/
    │       │   └── backend-preview.fluid.html
    │       └── config.yaml
    └── FileTypes/
        └── image-extended/
            ├── language/
            │   └── labels.xlf
            └── config.yaml
```

## 4. Creating Content Elements

### Kickstart Command (Recommended)

```bash
# Interactive mode
ddev typo3 make:content-block

# One-liner
ddev typo3 make:content-block \
  --content-type="content-element" \
  --vendor="myvendor" \
  --name="hero-banner" \
  --title="Hero Banner" \
  --extension="my_sitepackage"

# After creation, update database
ddev typo3 cache:flush -g system
ddev typo3 extension:setup --extension=my_sitepackage
```

### Predefined Basics (content elements)

List under `basics:` to pull in Core field groups: **`TYPO3/Header`**, **`TYPO3/Appearance`**, **`TYPO3/Links`**, **`TYPO3/Categories`**. See the [Content Blocks basics reference](https://docs.typo3.org/p/friendsoftypo3/content-blocks/main/en-us/API/Basics/Index.html).

### Minimal Content Element

```yaml
# EXT:my_sitepackage/ContentBlocks/ContentElements/hero-banner/config.yaml
name: myvendor/hero-banner
fields:
  - identifier: header
    useExistingField: true
  - identifier: bodytext
    useExistingField: true
    type: Textarea
    enableRichtext: true
```

Reusing `bodytext` alone does not enable rich text for a new CType. For migration or preset changes,
read the [rich-text round-trip contract](references/rich-text-roundtrip.md): verify effective
type-specific TCA, stored markup, actual preset and both editor and frontend behavior.

For converted link columns, nested links or plugin type restrictions, read
[typed links and no-change saves](references/typed-link-migration.md). Test actual transformed
objects in both template contexts; a string fixture or unchanged public page can miss editor damage.

### Full Content Element Example

```yaml
# EXT:my_sitepackage/ContentBlocks/ContentElements/hero-banner/config.yaml
name: myvendor/hero-banner
group: default
description: "A full-width hero banner with image and CTA"
prefixFields: true
prefixType: full
basics:
  - TYPO3/Appearance
  - TYPO3/Links
fields:
  - identifier: header
    useExistingField: true
  - identifier: subheadline
    type: Text
    label: Subheadline
  - identifier: hero_image
    type: File
    minitems: 1
    maxitems: 1
    allowed: common-image-types
  - identifier: cta_link
    type: Link
    label: Call to Action Link
  - identifier: cta_text
    type: Text
    label: Button Text
```

### Frontend Template

```html
<!-- templates/frontend.fluid.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      xmlns:cb="http://typo3.org/ns/TYPO3/CMS/ContentBlocks/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:asset.css identifier="hero-banner-css" href="{cb:assetPath()}/frontend.css"/>

<section class="hero-banner">
    <f:if condition="{data.hero_image}">
        <f:for each="{data.hero_image}" as="image">
            <f:image image="{image}" alt="{data.header}" class="hero-image"/>
        </f:for>
    </f:if>
    
    <div class="hero-content">
        <h1>{data.header}</h1>
        <f:if condition="{data.subheadline}">
            <p class="subheadline">{data.subheadline}</p>
        </f:if>
        
        <f:if condition="{data.cta_link.url}">
            <f:link.typolink parameter="{data.cta_link}" class="btn btn-primary">
                {data.cta_text -> f:or(default: 'Learn more')}
            </f:link.typolink>
        </f:if>
    </div>
</section>
</html>
```

### Styled frontends

When a block should follow shadcn/ui styling, keep `config.yaml` as the content model and map
`{data}` fields to shared Fluid components instead of per-block CSS. Preserve existing field
identifiers, `fixture.json`, labels and editor workflows unless the content model itself changes.
Tokens, atoms, icons, previews and seed data are covered by `typo3-shadcn-content-elements`.

### Backend Preview Template

```html
<!-- templates/backend-preview.fluid.html -->
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      xmlns:be="http://typo3.org/ns/TYPO3/CMS/Backend/ViewHelpers"
      data-namespace-typo3-fluid="true">

<div class="content-block-preview">
    <strong>{data.header}</strong>
    <f:if condition="{data.subheadline}">
        <br/><em>{data.subheadline}</em>
    </f:if>
    <f:if condition="{data.hero_image}">
        <f:for each="{data.hero_image}" as="image">
            <be:thumbnail image="{image}" width="100" height="100"/>
        </f:for>
    </f:if>
</div>
</html>
```

Migrated previews (Mask importer, `make:content-block`) dump raw fields; collections drawn with the
`PageLayout/Grid` partial show empty cards for non-`tt_content` children. For one shared preview design,
item lists with side-panel editing, link-field values and inline record labels, read
[backend previews](references/19-backend-previews.md).


## Detailed Reference

Read [the full guide](references/full-guide.md) when the task needs detailed examples, long templates, troubleshooting matrices, appendices, or sections not included above. Keep this file unloaded for narrow tasks so the skill follows progressive disclosure.

For migrations and silent data-contract failures, also read
[Common Pitfalls & Hard-Won Lessons](references/common-pitfalls-and-hard-won-lessons.md).
