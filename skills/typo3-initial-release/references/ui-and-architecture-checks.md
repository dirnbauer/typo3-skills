# UI and architecture checks for a first release

Load this when the release diff touches backend modules, frontend output, Fluid templates, styles,
JavaScript, Content Blocks relations or repository queries.

## UI rules

Apply these before any release implementation or review work that touches backend or frontend output:

- Use the TYPO3 Styleguide only for styling decisions. Backend UI colors, spacing, icons, tables, cards,
  buttons, form controls, module chrome, CSS variables, dark mode, and accessibility states should follow
  TYPO3's established styleguide patterns.
- Use TYPO3 APIs first. Prefer PHP and TYPO3 Core APIs for routing, configuration, data preparation, actions,
  permissions, persistence, and rendering setup whenever they can express the behavior.
- Prefer TYPO3 Fluid templates for output. Compose UI with layouts, templates, Partials, and ViewHelpers before introducing custom rendering code.
- Use JavaScript only when the interaction genuinely requires client-side behavior. If JavaScript is needed,
  use modern TYPO3-compatible Lit/Web Component or ES module patterns. Do not add DOM hacks, global event
  stunts, framework islands, hidden state machines, or clever JavaScript when PHP, Fluid, or a TYPO3 backend
  API is enough.
- Check every style change before release. List each required CSS/SCSS/Fluid markup change, explain why it is
  necessary, and remove or revise any styling that duplicates or contradicts TYPO3 Styleguide behavior.
- Use XLIFF 2.0 and ICU messages for all extension labels. Do not hardcode user-facing text in Fluid
  templates, PHP, JavaScript, or configuration when it should be translated. Provide English and German
  labels, then check whether both languages are easy to understand for editors and administrators.

## Architecture checks

Use these checks when preparing or reviewing release changes:

- Extension boundaries: split extensions by bounded context, not convenience. A `1.0.0` release should not hide unrelated product areas inside one package.
- UI composition: compose frontend and backend output from existing Fluid Partials and established building
  blocks. Avoid duplicated markup for identical UI structures.
- View shaping: keep simple links, labels, download outputs, and display transformations close to Fluid templates. Keep business logic in services.
- Content Blocks relations: let Content Blocks own TCA and schema for `Select` or `Collection` relation
  fields. Use `ObjectStorage<T>` in Extbase models and iterate object relations directly. Do not add raw SQL
  relation sync methods in models.
- Repository queries: use Extbase `createQuery()` for normal filtering, sorting, and object-based access. Use
  Doctrine QueryBuilder only for requirements Extbase cannot express, such as `GROUP BY`/`HAVING`, aggregate
  functions, spatial queries, or bulk updates without object loading. Explain every QueryBuilder exception.
- Backend validation: reuse a known backend admin session or saved Playwright state for backend smoke tests
  when available, then verify the relevant module or user journey.
