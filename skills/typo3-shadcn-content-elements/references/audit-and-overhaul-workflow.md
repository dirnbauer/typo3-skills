# Audit and Overhaul Workflow

The full step-by-step detail behind the condensed workflow in [SKILL.md](../SKILL.md). Load the
section for the step you are on; read the whole file only for a complete catalog overhaul.

## Contents

- [1. Establish the preset source](#1-establish-the-preset-source)
- [2. Audit before editing](#2-audit-before-editing)
- [3. Fix the shared component layer first](#3-fix-the-shared-component-layer-first)
- [4. Keep the local shadcn registry valid](#4-keep-the-local-shadcn-registry-valid)
- [5. Audit each content element against its contract](#5-audit-each-content-element-against-its-contract)
- [6. Add backend previews for the page/layout module](#6-add-backend-previews-for-the-pagelayout-module)
- [7. Create or refresh icons](#7-create-or-refresh-icons)
- [8. Update seed scripts](#8-update-seed-scripts)
- [9. Verify and commit in reviewable slices](#9-verify-and-commit-in-reviewable-slices)

## 1. Establish the preset source

- If a shadcn/create URL or preset id is given, extract the id, for example `b4hb38Fyj`.
- Run `npx shadcn@latest info --json` in the project when `components.json` exists. If a TYPO3/non-TS repo
  fails path resolution, add a small `tsconfig.json` plus scratch aliases so `components`, `ui`, `lib`,
  `utils`, and `hooks` resolve without copying React runtime code into TYPO3.
- Use `shadcn create` or `https://ui.shadcn.com/create?item=preview` as a design-system source. Use an
  Astro scratch app when the user asks for Astro/include-file JavaScript patterns; use a Vite/React scratch
  app only to inspect primitive class contracts.
- Do not install React/Astro components as TYPO3 runtime code. TYPO3 owns rendering; shadcn owns tokens, component contracts, and registry metadata.
- Commit the preset as local CSS variables and Site Settings, for example
  `body[data-shadcn-preset="b4hb38Fyj"]`; do not add a runtime preset downloader or binary switcher.
- Treat `:root` as the light-mode base and `.dark` as the dark-mode override, matching shadcn. Do not write
  content elements that only look correct in one mode.
- Read `references/shadcn-preset-workflow.md` before changing theme tokens or primitive class strings.

## 2. Audit before editing

- Run `php <skill>/scripts/audit-content-elements.php <repo-root>` when working on a repo with `ContentBlocks/ContentElements`.
- For Desiderio, also run the project audit script (`php scripts/audit-content-elements.php`) because it
  contains repo-specific hard checks for inline styles, raw colors, variant branches, undeclared rendered
  fields, and seed gaps.
- If local PHP cannot load Composer because the extension requires a newer PHP, run the audit and PHPUnit
  through DDEV with PHP 8.4 (the project standard). Copy the repo to a temporary path inside the DDEV project first so you do not
  mutate a dirty vendor checkout.
- Use the output to prioritize missing previews, undeclared rendered fields, unused configured fields,
  missing labels, missing icons, and repeatable-field gaps.
- Treat the audit as a starting point, then manually inspect high-risk templates. `fixture_missing_field`
  and `collection_child_seed_gap` can be soft signals when the project seeder auto-fills missing demo
  values, but the rendered seeded pages still need a visual pass.
- Do not stop after icon-like fields. Loop through every Content Block element in the catalog and classify
  each issue as schema, template, CSS/token, JavaScript/include, backend preview, fixture, or seed-fallback
  work.
- Search for structural workaround leftovers before declaring a pass complete: `f:split(`, pipe-delimited
  links such as `Label|https://...`, legacy list fields such as `features_list`, `specs_text`, `row_data`,
  comma-delimited `tier_values`, and monolithic `shadcn2fluid_*` fixture maps.
- Classify leftovers carefully: compatibility converters in a seed script can remain only when they convert
  old input into current structured fields; templates, fixtures, Content Blocks schema, tests, and docs
  should demonstrate the current structured model.
- Apply the Fluid safety checks from `references/content-element-contract.md`, especially for date/time
  formatting, `typolink` attributes, resource paths, and string-only ViewHelpers.

## 3. Fix the shared component layer first

- Update `Resources/Private/Components` atoms/molecules from generated shadcn class contracts before editing hundreds of individual templates.
- Prefer shared Fluid components over bespoke content-element CSS.
- Keep semantic shadcn tokens such as `bg-background`, `text-foreground`, `bg-card`, `border-border`,
  `ring-ring`, `text-muted-foreground`, `bg-primary`, and `text-primary-foreground`.
- Put client-side behavior in shared include files registered through TypoScript, `f:asset.script`, or
  TYPO3's AssetCollector. Templates should emit data attributes and JSON payload attributes; they should
  not contain inline `<script>` renderers.
- For charts and interactive patterns, mirror the shadcn component contract: data attributes, CSS variables
  such as `--chart-1` through `--chart-5`, idempotent initialization, and no hardcoded color fallbacks.
- Read `references/styling-token-contract.md` before adding or changing element CSS, SVG icon colors, chart
  colors, shadows, overlays, or backend preview styling.

## 4. Keep the local shadcn registry valid

- If the project exposes Desiderio/shadcn patterns for reuse, keep a root `registry.json` and build output
  under a public registry endpoint such as `Resources/Public/ShadcnRegistry`.
- Add a `components.json` registry namespace such as `"@desiderio": "Resources/Public/ShadcnRegistry/{name}.json"`.
- Add scripts such as `shadcn:info` and `registry:build`, then run both after changing tokens, runtime assets, or registry item files.
- Use current shadcn CLI commands as the source of truth: `shadcn info --json` for project configuration
  and `shadcn build --output <dir>` for registry output. The upstream registry is framework-agnostic, so a
  TYPO3 registry item may package Fluid, TypoScript, CSS token sources, JavaScript include files, and Site
  Settings when the item type describes that contract.
- Registry items should package theme token sources, Tailwind source files, Site Settings, TypoScript asset
  includes, and shared runtime assets. Do not put generated Tailwind output or one-off page CSS into a
  registry item unless consumers actually need that build artifact.

## 5. Audit each content element against its contract

- Read `references/content-element-contract.md`.
- For every element, compare `config.yaml`, `templates/frontend.fluid.html`, `language/labels.xlf`,
  the element's `<block>/assets/icon.svg`, CSS/JS assets, backend preview, and seed coverage.
- Treat `config.yaml:title` as an editor-facing product name. Prefer names like `Text & Media`, `Image Call
  to Action`, and `Logo Cloud Hero` over raw slugs such as `textmedia`, `CTA With Image`, or `Hero Logo
  Cloud`.
- Use the `typo3-translations` skill for XLIFF format choices, English/German localization, ICU
  MessageFormat strings, `LLL:` references, and localized wizard group labels.
- Generate element descriptions from the element purpose and schema so each description explains what
  editors can build. Do not reuse a single generic sentence across the catalog.
- Every configured editor field should be rendered or intentionally marked backend-only.
- Every rendered field should exist in `config.yaml`.
- Every Collection child field should be rendered or intentionally omitted.
- Treat editor `Style` / `variant` fields as contracts, not decorative metadata. Keep one only when the
  value is passed to an existing shadcn-backed Fluid component feature (for example Button/Badge/Alert
  variants or TabsList `default`/`line`) or when the template has a real layout/behavior branch. Do not
  keep `variant` fields that only append unused BEM modifier classes.
- Prefer removing unsupported style fields over inventing bespoke visual variants. If a style option cannot
  be expressed by the shared shadcn atoms/molecules or existing shadcn class contracts, remove the field
  from `config.yaml`, frontend templates, backend previews, and fixtures.
- If a repo-level test requires every content element to keep `<block>/assets/frontend.css`, use an
  empty/comment-only marker file when the shared component layer handles all styling. Do not re-add
  `f:asset.css` includes or style rules merely to satisfy the file-presence contract.
- Use nested `Collection` fields for second-level repeatables when the installed Content Blocks version
  supports nested Collections; keep seed scripts recursive so child rows are created after their parent
  IRRE rows.
- Give every `Collection` field an explicit `table:` key. Without it, Content Blocks derives the table from
  the `identifier` alone, so unrelated elements that pick the same name (`rows`, `posts`, `column_items`,
  `cells`, `items`, `links`...) silently share one physical table — schema migrations break,
  `foreign_table_parent_uid` drifts to the wrong type, and renames lose data. Names like
  `<contentblock-slug>_<identifier>` are safe, for example `blog_teasers_posts` or `feature_matrix_rows`.
  See `references/content-element-contract.md` "Collection Table Naming".
- Use TYPO3 `Link` fields for editor-managed URLs. Keep visible link text in a separate text field and never encode `Label|https://...` pairs in textareas.
- File fields need alt text and copyright/source strategy in seed data and previews.
- Date and time fields must be formatted to strings before they are passed to visual-editor text rendering or HTML attributes.

## 6. Add backend previews for the page/layout module

- Read `references/backend-preview-pattern.md`.
- Add `templates/backend-preview.fluid.html` using Content Blocks `Preview` layout with `Content` and optionally `Footer`.
- Keep `<f:section name="Header"></f:section>` **empty** — never render a duplicate headline above the
  formatted card. The card itself shows the title inside `d-ce-preview__title`. Removing the section
  instead of emptying it triggers TYPO3's `InvalidSectionException` fallback to the standard renderer,
  which re-adds the duplicate.
- Inside `d-ce-preview__meta`, surface the editor-facing element name, the Content Block identifier, the
  record `uid`, and the page `pid` as small pills. Use `<f:translate
  key="LLL:EXT:desiderio/Resources/Private/Language/labels.xlf:preview.uid"/>` and `:preview.page` — never
  hardcode the labels.
- Show the most important data: title/headline, summary, bullets/repeatables, CTA/link, chart metrics, and thumbnails.
- Never rely on TYPO3’s Core fallback preview for custom Content Blocks.

## 7. Create or refresh icons

- Read `references/icon-pattern.md`.
- Each element gets a semantic `<block>/assets/icon.svg` in the project, not in this skill.
- Use TYPO3-style 16x16 SVGs: transparent background, root color `var(--icon-color-primary,currentColor)`,
  `currentColor` primary paint, `var(--icon-color-accent,currentColor)` accent, readable in light and dark.
- For large catalogs, actively prevent look-alike icons: audit normalized SVG bodies with titles removed,
  inspect same-family groups such as heroes/pricing/nav/footers/features, and add per-element geometry
  instead of relying on one family template.
- If the user asks for GPT Image / Image GPT / `gpt-image-*`, first verify the currently available OpenAI
  image model and API credentials. Use image generation for metaphor boards or visual direction; redraw the
  final asset as clean, editable SVG because TYPO3 backend icons need tiny, token-colored vectors.
- Treat Lucide, Tabler, and TYPO3 backend icons as metaphor references, not as a reason to reuse the same glyph across many content elements.

## 8. Update seed scripts

- Fill all top-level and repeatable fields for every element.
- Fill nested repeatables as structured arrays; never collapse a second-level list into a newline-separated textarea when an IRRE Collection is available.
- Add real dummy images from Unsplash or committed demo assets, with alt text and copyright/source fields where available.
- Seed links as structured data or distinct fields, for example `{"label": "Docs", "link":
  "https://example.com/docs"}` or `link_1_label` plus `link_1`. Do not generate pipe-delimited link
  strings.
- Seed chart/data elements with valid JSON that the frontend template actually parses.
- When the seeder auto-fills omitted optional fields, inspect the generated pages anyway. Empty fixtures
  are acceptable only when the fallback content is specific enough for visual QA and editor demos.
- If a full-catalog audit reports many `fixture_missing_field` or `collection_child_seed_gap` rows but hard
  template/style checks are clean, improve the project seeder first. Fallback copy should read like real
  pattern-library content (`Pattern Library`, realistic product/demo copy, useful CTA labels, valid links,
  valid icon keys, token names such as `primary`) and must not expose generic placeholder phrases such as
  `Complete demo content`.
- Prefer shadcn token `Select` fields over freeform `Color` fields for elements whose appearance should
  track theme changes. If an element needs editor color choice, render it through token-backed data
  attributes or CSS variables and keep raw color values out of fixtures and fallback seed data.
- Validate seeded `Select` values against the current `config.yaml` items before insertion. Stale fixture
  values from removed style variants should fall back to the configured default instead of seeding inert
  editor choices.
- Keep Desiderio fixtures in each `ContentBlocks/ContentElements/<element>/fixture.json` file. Do not
  create or restore monolithic `shadcn2fluid_*` fixture mappings.
- If old fixture keys must be accepted for migration, convert them at seed time into current fields or
  nested Collections and keep those aliases out of new fixtures and examples.

## 9. Verify and commit in reviewable slices

- Run CSS build, PHP unit/static checks, and Content Blocks/TYPO3 cache validation.
- Run `npx shadcn@latest info --json` and `npx shadcn@latest build --output <public-registry-dir>` when `components.json` or `registry.json` changed.
- Scan content elements and shared generated preview code for raw color literals; allowed raw preset values
  should be confined to the shadcn theme token file and generated Tailwind output.
- Scan templates for inline scripts when shared JavaScript was introduced: `rg -n "<script>|JSON\\.parse"
  ContentBlocks/ContentElements/*/templates/frontend.fluid.html`.
- For a full audit, inventory all elements once, repair root-cause batches with affected-element checks,
  then run one complete final verification. Use extra full passes only when the user explicitly requests
  their count/scope; stop on non-progress and report why. Inside an upgrade graph, return one bounded
  job to the parent instead of starting another audit loop. Report coverage and the element count.
- For large overhauls, commit by layer: preset/theme, primitives, generated previews, icons, per-element fixes, seed data.
- Browser-check frontend pages and TYPO3 backend layout module previews.
