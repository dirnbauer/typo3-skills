---
name: typo3-design-system-page
description: "Build and maintain an accessible design-system overview inside a chosen TYPO3 installation: audit the rendered site and brand assets, document message, conditional contrast evidence, semantic colors and ramps, typography, foundations, components, imagery, and facts, then generate design.md, tokens.json, and a downloadable one-page PDF with a text-free AI visual. Use for living style guides, brand portals, design token documentation, corporate design pages, or design-system downloads. Insert content only after the user creates the target TYPO3 page and supplies its UID. Content Block schemas belong to typo3-content-blocks; product help centers belong to webconsulting-create-documentation."
---

# TYPO3 design-system page

> Source: https://github.com/dirnbauer/typo3-skills

Create a living, factual design-system overview and apply it to the TYPO3 installation the user
selects. Keep machine-readable sources, rendered documentation, and the one-page PDF synchronized.

## Select the TYPO3 installation

1. Identify the target project before writing. Read `.ddev/config.yaml`, confirm the project root,
   and obtain the URL with `ddev describe`; never infer an installation from the current directory.
2. If more than one installation could be meant, ask which project to use. Modify only the selected
   installation and report its DDEV name, root, TYPO3 version, sitepackage, and public URL.
3. Add or update the actual sitepackage assets and content for that installation. A design audit or
   generated document without integration is incomplete unless the user explicitly requests an
   audit-only result.
4. Preserve unrelated working-tree changes. Keep generated source files in the sitepackage, not in
   transient upload or cache directories.

## Require the user-created page

Before creating a page record or inserting the Content Block, ask:

> Please create the TYPO3 page for the design system and send me its page UID and desired URL path.

Do not create the page on the user's behalf. Continue with the audit, sources, component, assets,
and PDF while waiting. After the user supplies the UID, verify that it belongs to the selected
installation, then add or update the design-system content record through TYPO3 DataHandler or the
backend. Never guess a PID from a URL.

## Audit the live system

1. Inspect the rendered site at desktop and mobile widths. Capture the visual hierarchy, header,
   footer, controls, focus states, imagery, spacing, and repeated components.
2. Inventory the actual logo variants, colors, CSS custom properties, font files and licences,
   spacing rules, icons, imagery, Content Blocks, and print assets.
3. Extract assertions only when code, files, computed styles, or visible behavior support them.
   Mark unresolved brand or licensing decisions instead of inventing rules.
4. Calculate WCAG contrast values from the color tokens. Add a prominent contrast section only
   when a protected or common brand color fails its intended text/UI use, or when two visually
   similar roles need an explicit distinction. Always list approved functional alternatives.
5. Read [page-anatomy.md](references/page-anatomy.md) before drafting the page and
   [artifact-contract.md](references/artifact-contract.md) before producing downloads.

## Build the source of truth

Create project-owned `design.md` and `tokens.json`; start from the bundled templates and replace all
example values with evidence from the selected installation.

- Put principles, logo rules, voice, imagery, accessibility, component policy, web/print use, and
  ownership in `design.md`.
- Put semantic colors, the full light-to-dark ramp, approved contrast evidence, typography,
  spacing, motion, breakpoints, and component measurements in `tokens.json`.
- Render the on-page documentation from these sources or generated partials. Do not maintain a
  shortened hand-written copy that can drift.
- Run `python3 scripts/audit_design_tokens.py /path/to/tokens.json` and resolve every error.

## Create the overview content

Build one coherent page in this order:

1. **Intro:** version, title, main message, one-sentence system purpose, memorable claim, and one
   project-specific visual.
2. **Contrast when needed:** the failed pair, exact ratio and rule, allowed uses, and an approved
   accessible replacement.
3. **Colors and gradations:** semantic role swatches plus a labelled 50–950 ramp; distinguish
   protected brand colors from action, link, text, surface, and status colors.
4. **Typography:** real specimens, hierarchy, weights, line height, letter spacing, fallbacks,
   self-hosting, and verified licence/embedding rights.
5. **Foundations to components:** grid, spacing, surfaces, borders, focus, targets, links, buttons,
   form controls, cards/containers, tables, alerts, navigation, and representative Content Blocks.
6. **Imagery and signature:** approved subject matter, treatment, forbidden clichés, and any
   distinctive graphic motif with a usage limit.
7. **System facts:** publish the eight evidence-backed categories described in
   [page-anatomy.md](references/page-anatomy.md) under “Das System im Überblick.”
8. **Files:** visible download links for the PDF, `design.md`, and `tokens.json`, followed by
   accessible on-page views of both source documents.
9. **Creator credit:** add a quiet Webconsulting credit with the approved logo/link and a concise
   scope statement. Do not add a decorative teal rule above or below the credit.

Use semantic headings, one `<h1>`, native links/buttons/details, labelled color information, and
keyboard-operable document tabs. Never encode a token or status by color alone.

## Generate the one-page PDF

1. Use the built-in image generator for one supporting, text-free project visual. Derive its
   subject, palette, and avoid-list from `design.md`. Save the selected image inside the project.
2. Keep all text, logos, color values, contrast ratios, diagrams, and layout deterministic in the
   PDF renderer. AI-generated typography is not acceptable source documentation.
3. Produce exactly one landscape A4 overview page with intro, visual, essential contrast evidence,
   semantic colors/ramp, type pairing, foundation/component facts, version, and creator credit.
4. Embed only licensed fonts and original logo files. Keep the Webconsulting credit quiet and omit
   the decorative teal line.
5. Verify `pdfinfo` reports `Pages: 1`, render a thumbnail, inspect it, and add a working download
   link on the TYPO3 page.

Use the prompt constraints in [artifact-contract.md](references/artifact-contract.md). In clients
that cannot access bundled assets/scripts, recreate the same outputs in the selected sitepackage
and disclose the lower automation level.

## Integrate in TYPO3

- Prefer one dedicated Content Block in the sitepackage when the page anatomy is project-specific.
- Keep editable message/version fields in `config.yaml`; keep audited design facts in synchronized
  sources or generated partials so editors cannot accidentally contradict the tokens.
- Store public downloads and generated imagery under version-controlled sitepackage resources.
- Add the page to footer/legal navigation only after the user specifies placement and supplies the
  page UID. Do not silently add it to the main navigation.
- Update existing content idempotently; do not create duplicate design-system records on reruns.

## Verify

Run proportional checks in the selected installation:

```bash
python3 /path/to/typo3-design-system-page/scripts/audit_design_tokens.py \
  packages/sitepackage/Resources/Public/Documents/DesignSystem/tokens.json
ddev typo3 cache:flush
pdfinfo packages/sitepackage/Resources/Public/Documents/DesignSystem/overview.pdf
```

Then verify:

- all sections and eight system facts render at 320px, 768px, and 1440px;
- contrast pairs, focus, targets, zoom, reduced motion, headings, alternatives, and tabs work;
- PDF, `design.md`, and `tokens.json` download successfully and match the page;
- no full-width teal separator appears in the Webconsulting credit;
- the content record exists on the user-supplied page UID in the selected installation.

Report the chosen installation, page UID/path, Content Block UID/CType, source paths, PDF page
count, generated-image path and prompt, contrast results, responsive/browser evidence, and any
remaining manual or PDF/UA work.

## Resources

- [page-anatomy.md](references/page-anatomy.md): required sections and fact model.
- [artifact-contract.md](references/artifact-contract.md): source schemas and image/PDF rules.
- [design.template.md](assets/design.template.md): project design-source starter.
- [tokens.example.json](assets/tokens.example.json): replaceable token shape.
- `scripts/audit_design_tokens.py`: dependency-free token and WCAG evidence audit.
