# Desiderio Creation Contract

Load this file when the repository is EXT:desiderio, the user names Desiderio, or the project uses
the `d:` Fluid component namespace and the `desiderio.*` Site Settings. These rules take precedence
over general preferences in [SKILL.md](../SKILL.md) for that project; other projects use them only
as an example of a complete project contract.

## Contents

- [Rules](#rules)
- [Verification](#verification)

## Rules

When creating or overhauling Desiderio shadcn/ui content elements, respect these project-specific rules before general preferences:

- Use TYPO3 14.3 (`^14.3`), Content Blocks 2.x, and Fluid 5.3 templates (14.3.9 ships `typo3fluid/fluid` 5.3.2). Frontend entrypoints stay in
  `templates/frontend.fluid.html` (the Content Blocks 2.x default since 2.0.4; plain `frontend.html` is the
  legacy 1.x name); backend previews stay in `templates/backend-preview.fluid.html`.
- TYPO3 owns rendering. Do not copy React, Radix, or Astro framework components into the runtime. shadcn/ui is
  the source for tokens, class contracts, states, radius, spacing, focus rings, and component anatomy.
- Use Desiderio Fluid atoms/molecules/components where they exist, especially `d:layout.section`,
  `d:layout.container`, `d:atom.typography`, `d:atom.icon`, buttons, badges, cards, form controls, tabs,
  accordions, tables, alerts, dialogs, and chart wrappers.
- Respect responsive design in every element: mobile-first grids, stable dimensions for fixed-format UI, no
  text overflow, no incoherent overlap, and layouts that still read well at narrow and wide widths.
- Keep designs genuinely polished. Prefer clear editorial/product systems with strong hierarchy, deliberate
  spacing, real media or useful demo content, and restrained shadcn surfaces. Avoid decorative-only gradients,
  orphan cards, nested cards, and generic placeholder copy.
- Use only semantic tokens and shadcn/Tailwind classes in templates and CSS. Raw color values are allowed only
  in theme token files and generated Tailwind output.
- Use XLIFF 2.0 labels with modern stable ids such as `copy_code`, `preview.uid`, or `field.headline`. Provide
  English base labels and German labels for editor-facing strings. Use ICU MessageFormat for variable or
  pluralized labels instead of concatenating strings.
- Use `LLL:` references for labels in Content Blocks YAML, backend previews, and templates. Do not hardcode
  editor-facing labels in Fluid when they belong in XLIFF.
- For behavior that pure HTML, CSS, and shadcn classes cannot cover, use the shared Desiderio Astro runtime in
  `Resources/Public/Js/astro.js`. Templates should emit data attributes such as `data-astro-counter`,
  `data-astro-reveal`, `data-astro-highlight`, `data-astro-copy`, `data-astro-tilt`, or `data-astro-marquee`.
- Do not add inline `<script>` blocks to content element templates. Add idempotent behavior to shared JS
  include files, register them through TypoScript or AssetCollector, and make reduced-motion behavior
  explicit.
- Code examples should use the editorial code-block element with `data-astro-highlight` and the copy control.
  Keep source text escaped in Fluid and let the runtime decorate tokens after load.
- For forms, use TYPO3 Form Framework definitions under `Resources/Private/Forms`, TypoScript renderers in the
  Site Set, and `typo3/cms-form` as a Composer runtime dependency. Do not hand-roll mail forms in Fluid
  templates.
- Configure form mail routing through TYPO3 form finishers and Site Settings (`desiderio.forms.*`). Use a
  PSR-14 listener, such as `BeforeEmailFinisherInitializedEvent`, only to map site-specific sender/receiver
  options. Do not invent a `setup.php` mail mapping layer.
- CAPTCHA is opt-in and must be TYPO3 Form-compatible. Prefer honeypot, validation, throttling, and
  server-side spam checks first. If a real CAPTCHA provider is required, keep provider keys in Site Settings
  or environment configuration, never in templates, fixtures, or registry items.
- Seed data is part of the design. Every element needs credible English/German demo copy, valid links,
  meaningful icons, realistic metrics, useful code snippets, structured repeatables, image alt/source data,
  and select values that match the current `config.yaml`.

## Verification

- Verify visually in the browser after changes. For Desiderio styleguide work, check the local DDEV site and
  the relevant page URL, including the full styleguide/catalog pages, not just the element that was edited.
- Finish with project checks: `php scripts/audit-content-elements.php`, PHPUnit/static checks, Tailwind sync,
  registry build when registry files changed, JS syntax checks when shared JS changed, and a browser pass.
