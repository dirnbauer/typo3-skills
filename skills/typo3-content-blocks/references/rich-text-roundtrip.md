# Rich-text migration: preserve editing as well as rendering

Read when converting Mask/legacy fields, enabling RTE on stored HTML, or changing effective RTE
presets. Field modeling belongs to `typo3-content-blocks`; preset/plugin repairs use `typo3-ckeditor5`;
authenticated journeys use `typo3-playwright`. Return evidence to the existing upgrade node.

## Inventory the effective field, not only its YAML

- Compare legacy Mask/TCA/importer definitions with current Content Blocks, nested child tables,
  page fields and relevant FlexForms. Keep CType, column, table, relation and localization identity.
- Deduplicate by table/type/field, but retain distinct page/role/preset contexts. Inspect compiled
  TCA including `types.*.columnsOverrides` and the actual FormEngine configuration. A missing global
  `enableRichtext` does not prove that a type-specific field lacks RTE.
- Count nonempty and HTML-bearing values using read-only queries on the approved local dataset.
  Include hidden/translated/workspace records where present. Preserve hashes and sanitized examples;
  do not put full editorial content or credentials in public skill/report files.
- Resolve the effective preset from field/type-specific Page TSconfig, field TCA, general Page
  TSconfig and registered fallback. On inspected TYPO3 14.3.7, `Richtext::getConfiguration()` prefers
  a field-specific preset, then TCA `richtextConfiguration`, then the general preset, then `default`.
  Inspect the installed source and effective output; a global `RTE.default.preset` alone proves
  neither which preset the editor uses nor the final merged options.

## Correct the smallest contract

For an existing HTML prose column that should be editable, keep `useExistingField: true` and the
stored name; explicitly enable rich text on that content type. For example:

```yaml
- identifier: bodytext
  useExistingField: true
  type: Textarea
  enableRichtext: true
```

Resolve `richtextConfiguration` to an existing, tested project preset when needed. `Textarea` maps
to TCA `text`; this is not permission to change an existing incompatible DB/TCA type. If the change
only enables the editor/preset on an existing text column, no importer replay, schema migration or
content rewrite is needed. Verify unchanged content hashes and schema rather than running setup
commands by habit. [Content Blocks documents these field options](https://docs.typo3.org/p/friendsoftypo3/content-blocks/main/en-us/YamlReference/FieldTypes/Textarea/Index.html).

Leave titles, captions, labels, alt text, identifiers and intentionally plain teaser fields plain
unless actual content and the requested editor contract require otherwise. Keep deliberate raw-HTML
elements separate. A JSON property edited by a custom widget is not a TCA rich-text column; adding
`enableRichtext` elsewhere cannot turn that widget into CKEditor. Inspect frontend rendering too:
field-aware helpers can change escaping/markup when the field type changes.

## Test the full save/load path with representative fixtures

1. Group affected fields by effective preset, transformation and renderer. Reuse one fixture per
   distinct combination, plus an affected nested-field example when present; do not test every
   record in a browser. Include observed headings, inline code, lists, wrappers/classes, language
   attributes and TYPO3 page/record/file links, not arbitrary markup nobody stores.
2. Exercise the installed CKEditor build/plugins and TYPO3 RTE save/load processing. Compare
   semantic structure, link targets/attributes and visible output. Record harmless normalization
   separately (for example equivalent emphasis tags); don't hide dropped headings or wrappers.
   Client-side HTML support, server-side processing and frontend rendering are separate checks.
3. Preserve the sanitizer and CSP. Add only necessary, reviewed HTML support; never permit every
   tag/attribute or scripts to preserve old embeds. See [TYPO3's RTE configuration examples](https://docs.typo3.org/c/typo3/cms-rte-ckeditor/14.3/en-us/Configuration/Examples.html).
   Unsupported iframe/image/disclosure markup needs a scoped content-review/migration decision,
   not bulk resaving or silent removal. Keep a separate inventory and do not claim it is repaired.
4. In an authenticated local backend with the intended editor role, open an affected field and
   real link dialog, save/reopen an authorized disposable fixture, then inspect actual frontend
   HTML and appearance. Snapshot before the database write and restore the fixture through supported
   APIs. In-memory parser tests alone need no DB snapshot; don't mutate production/editor records.
5. Record configuration/parser proof, authenticated backend proof and frontend proof separately.
   A logged-out browser, standalone editor fixture or green lint cannot satisfy the real backend
   check. Missing access is pending/blocked evidence, never a completed editor gate.

Within `typo3-upgrade-run`, map named assertions to the existing `backend-editor` check and affected
frontend checks in the sealed feature plan. Run affected fixtures after a change and final required
proof at closure. No extra graph phase, global visual state, independent loop or expanded deadline.

## Evidence basis

Watchlist's September 16 audit found HTML already stored in a migrated plain editor, field-level
preset overrides, and formatting loss on save. Its local report records successful configuration,
parser and frontend checks but **pending authenticated backend verification**. These are repair
lessons, not a completed site certificate. See the [September 17 delta review](../../typo3-upgrade-run/references/run-retrospective-2026-09-17.md).
Recheck APIs against the installed source; internal audit helpers are not stable extension APIs.
