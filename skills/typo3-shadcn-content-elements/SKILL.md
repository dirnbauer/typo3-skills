---
name: "typo3-shadcn-content-elements"
description: "Produces, audits, and overhauls TYPO3 Content Blocks content elements styled with shadcn/ui presets, semantic tokens, Fluid atoms, backend previews, icons, and seed data. Use when the user asks to create, restyle, review, seed, iconize, or preview TYPO3 Content Blocks with shadcn/ui, Tailwind v4 tokens, no-hardcoded-style rules, or local registry presets."
compatibility: "TYPO3 14.3+"
metadata:
  skill_type: capability
  version: "1.7.0"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---

# TYPO3 shadcn Content Elements

> Source: https://github.com/dirnbauer/typo3-skills

Builds TYPO3 Content Blocks content elements that behave like one coherent shadcn/ui system:
preset-driven tokens, shared Fluid atoms/molecules, complete field coverage, useful backend
previews, semantic icons, local shadcn registry items and seed data that makes the styleguide
credible. Content Blocks own the schema (see `typo3-content-blocks`), TYPO3 owns rendering, and
shadcn/ui is the source for theme tokens, class contracts, data attributes, states, spacing,
borders, radius and typography.

## Rules

- **Never install React, Radix or Astro components as TYPO3 runtime code.** Port tokens and class
  contracts into Fluid; interactive behavior uses small vanilla or shared include-file controllers
  with ARIA and `data-state` attributes.
- **No raw colour values in content elements.** `oklch()`, `hsl()`, `rgb()`, hex colours and fixed
  light/dark assumptions belong only in the committed shadcn theme token file and the generated
  Tailwind output. Templates, element CSS, backend preview CSS, icons and chart scripts consume
  semantic tokens or Tailwind/shadcn utilities. Reason: preset switches and dark mode reach an
  element only through tokens. `:root` is the light base, `.dark` the override.
- **Every `type: Collection` field declares `table:`** named
  `<contentblock-slug-as-snake_case>_<collection-identifier>` (for example `blog_teasers_posts`,
  nested: `pricing_plan_features`). Without it the bare identifier becomes the table name: reserved
  SQL words such as `rows` break dumps and schema tools, unrelated elements that pick `items` or
  `posts` silently share one table, and legacy `foreign_table_parent_uid` columns fail the
  integer migration with `Truncated incorrect INTEGER value: ''`. Never rename a `table:` after
  editor data exists without a parent-aware data migration. Full reasoning and the migration
  playbook: [Collection Table Naming](references/content-element-contract.md#collection-table-naming).
- **No inline `<script>` in content element templates.** Put idempotent behavior in shared include
  files registered through TypoScript, `f:asset.script` or the AssetCollector; templates emit data
  attributes and JSON payload attributes. Make reduced-motion behavior explicit.
- **Editor-facing strings come from XLIFF through `LLL:` references**; use `typo3-translations`
  for XLIFF format, English/German labels and ICU MessageFormat.
- **Links are TYPO3 `Link` fields** with visible text in a separate field. Never encode
  `Label|https://...` pairs in textareas.
- **Backend previews keep `<f:section name="Header"></f:section>` present and empty.** Removing
  the section makes Content Blocks fall back to the Core header renderer (`PreviewRenderer`
  catches both `InvalidSectionException` and `InvalidTemplateResourceException`, verified in
  Content Blocks 2.4.10 on 2026-10-31), which re-adds a duplicate headline above the card.
- **`Style`/`variant` fields are contracts.** Keep one only when it drives an existing
  shadcn-backed component variant or a real layout/behavior branch; otherwise remove it from
  `config.yaml`, templates, previews and fixtures.
- **Bound the audit loop.** Inventory all elements once, repair root-cause batches with
  affected-element checks, then run one complete final verification. Stop on non-progress and
  report the unresolved cause. Inside an upgrade graph, return one bounded job to the parent
  instead of starting another audit loop.

## Workflow

Each step has full detail in [the audit and overhaul workflow](references/audit-and-overhaul-workflow.md);
load the section for the step you are on.

1. **Establish the preset source.** Extract the preset id from a shadcn/create URL, run
   `npx shadcn@latest info --json` where `components.json` exists, and commit the preset as local
   CSS variables plus Site Settings (for example `body[data-shadcn-preset="b4hb38Fyj"]`), not a
   runtime downloader. Read [shadcn-preset-workflow.md](references/shadcn-preset-workflow.md)
   before changing theme tokens or primitive class strings.
2. **Audit before editing.** Run `php <skill>/scripts/audit-content-elements.php <repo-root>`
   (and the project's own audit script if it has one). Classify every finding as schema,
   template, CSS/token, JavaScript/include, backend preview, fixture or seed-fallback work, and
   search for workaround leftovers (`f:split(`, `Label|URL` strings, `features_list`,
   `specs_text`, `row_data`, monolithic fixture maps).
3. **Fix the shared component layer first.** Update `Resources/Private/Components`
   atoms/molecules from shadcn class contracts before touching individual templates. Read
   [styling-token-contract.md](references/styling-token-contract.md) before adding element CSS,
   SVG or chart colours, shadows, overlays or preview styling.
4. **Keep the local shadcn registry valid** when the project exposes one: `registry.json`, a
   `components.json` namespace, and `shadcn build --output <dir>` after token or registry changes
   ([local registry](references/shadcn-preset-workflow.md#local-registry)).
5. **Audit each element against its contract.** Compare `config.yaml`, frontend template,
   labels, icon, assets, backend preview and seed coverage. Every configured field is rendered or
   deliberately backend-only; every rendered field exists in `config.yaml`. Read
   [content-element-contract.md](references/content-element-contract.md).
6. **Add backend previews** for the page module. Read
   [backend-preview-pattern.md](references/backend-preview-pattern.md).
7. **Create or refresh icons**: one semantic 16x16 `<block>/assets/icon.svg` per element,
   `currentColor` primary, `var(--icon-color-accent,currentColor)` accent, no look-alikes across
   the catalog. Read [icon-pattern.md](references/icon-pattern.md); for v14 icon rules beyond
   content elements use `typo3-icon14`.
8. **Update seed data** so every top-level, repeatable and nested field has credible content,
   valid links, images with alt/source data and `Select` values that exist in the current
   `config.yaml` ([seed data](references/content-element-contract.md#seed-data)).
9. **Verify and commit in reviewable slices**: CSS build, PHP unit/static checks, cache and schema
   validation, the raw-colour and inline-script scans, a registry build when registry files
   changed, and a browser check of frontend pages and backend previews in light and dark mode.
   Commit by layer: preset/theme, primitives, previews, icons, per-element fixes, seed data.

### Collection audit

Run before declaring a Collection sweep complete; each command should print nothing:

```bash
# Collection fields without an explicit table: key.
rg -nP '^\s*type: Collection\s*$' --no-heading -A1 ContentBlocks/ContentElements \
  | rg -B1 -v 'table:'

# Bare table names that are MySQL/MariaDB reserved words: run the reserved-word scan from
# references/content-element-contract.md (section "Collection audit"); that list is the canonical one.

# Bare unprefixed names; review every remaining match by hand.
rg -nP '^\s+table:\s+[a-z][a-z0-9_]*\s*$' ContentBlocks/ContentElements \
  | rg -v '_[a-z]'
```

## Done when

- Preset changes visibly change the design through committed tokens and shared component classes.
- Elements look like shadcn/ui, not generic Bootstrap or one-off CSS, and work in light and dark mode.
- Backend previews let editors recognize content without opening the form.
- Icons form a coherent family, and every element stays distinguishable in the new content
  element wizard at 16px.
- Every `type: Collection` has a prefixed `table:`; the Collection audit prints nothing.
- Active content elements do not depend on `shadcn2fluid`; mentions remain only in package
  conflicts, migration notes and tests that prevent its return.
- Generated or bulk changes have deterministic scripts and tests where possible, and the report
  states coverage and the element count.

## Project contracts

- **Desiderio** (EXT:desiderio, `d:` Fluid components, `desiderio.*` Site Settings): read
  [desiderio-project-contract.md](references/desiderio-project-contract.md) before creating or
  overhauling its elements. It fixes the template file names, Astro include runtime, Form
  Framework mail routing, CAPTCHA policy, fixture location and the project audit command.

## References

Load each file at the step named above:

- [audit-and-overhaul-workflow.md](references/audit-and-overhaul-workflow.md): full detail for workflow steps 1–9.
- [shadcn-preset-workflow.md](references/shadcn-preset-workflow.md): scratch-app preset workflow, token expectations, local registry.
- [styling-token-contract.md](references/styling-token-contract.md): no-hardcoded-style rules, light/dark behavior, verification scans.
- [content-element-contract.md](references/content-element-contract.md): field/template/label/seed audit contract and Collection table naming.
- [backend-preview-pattern.md](references/backend-preview-pattern.md): Content Blocks backend preview pattern.
- [icon-pattern.md](references/icon-pattern.md): content element icon rules.
- [desiderio-project-contract.md](references/desiderio-project-contract.md): Desiderio project rules.

## Scripts

- Run `scripts/audit-content-elements.php <repo-root>` for a JSON audit of `ContentBlocks/ContentElements`.
- Run `node scripts/extract-shadcn-preset.mjs --scratch <dir> --preset <id> --out <css> --meta <json>` to turn a
  generated shadcn scratch app into the scoped token CSS a preset needs (workflow step 1; details in
  [shadcn-preset-workflow.md](references/shadcn-preset-workflow.md#switching-presets)).
