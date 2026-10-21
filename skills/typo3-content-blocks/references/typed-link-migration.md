# Typed links and no-change saves after migration

Use for migrated link fields, nested collections and plugin CTypes. Keep this inside the caller's
existing migration/backend check; it is not a second migration programme.

## Link fields are not strings

Inventory the stored values and the effective TCA/Content Blocks field type before changing it.
Use native `Link` for an actual editorial link, retaining the existing field/column identity.
Do not convert arbitrary text or apply a guessed page UID to an ambiguous target.

The installed transformer can return `TypolinkParameter`, including an object with an empty URL.
Inspect its installed class and the [Content Blocks Link contract](https://docs.typo3.org/p/friendsoftypo3/content-blocks/main/en-us/YamlReference/FieldTypes/Link/Index.html).
Check the URL, pass the complete object to the link renderer, and use a real text label:

```html
<f:if condition="{data.destination.url}">
    <f:link.typolink parameter="{data.destination}">{data.link_label}</f:link.typolink>
</f:if>
```

When a preview deliberately displays the stored target, print its `url` property as escaped text.
That property is a typolink target, not necessarily a resolved public URL: do not concatenate it
into `href`. Keep target, class, title and additional parameters by passing the whole parameter.
Test empty and `nullable` values as well as populated objects; a string-only fixture misses this bug.

## Persisted-value changes need their own plan

1. Inventory actual formats: legacy numeric page/anchor targets, file identifiers, `t3://` values,
   external URLs, telephone/email and extra typolink attributes. Include nested, hidden, translated
   and workspace records. Record unresolved or excluded records rather than silently skipping them.
2. Prefer an installed Core/extension migration that handles the observed formats. For a real gap,
   use the installed `TypoLinkCodecService` to decode/encode; preserve all other parts. Do not split
   on spaces or blindly add `https://`, `_blank` or `c` to values from another site's convention.
3. Produce a read-only table/UID/field/before/after plan with a hash. Require reviewed mappings for
   ambiguous targets and the same hash immediately before apply. Reject concurrent changes.
4. Snapshot the exact local dataset; route writes through `typo3-datahandler`. Verify compatible
   field registration first, then read back values and unchanged parent/CType/language/workspace
   identity. A successful API return alone is insufficient. Retain rollback and error evidence.
5. Repeat the same discovery/planning command on the resulting dataset: zero remaining changes.
   Do not force an old before-state hash onto already migrated rows; reject a stale apply plan.
   A YAML-only correction accepting existing data does not need a new content rewrite.

## Render and save the real contract

- Render the project's frontend **and** backend templates through the installed Fluid runtime with
  transformed records, not handcrafted string arrays. Check resulting links, attributes and nested
  children. Include one bounded synthetic fixture for each affected definition without records;
  absence from the sitemap does not prove that a future editor-created block will work.
- For list_type→CType and TSconfig restrictions, compare stored CType/FlexForm/relations before
  and after an authorized **no-change save**, then reopen under the intended non-admin role.
  `removeItems`/allowlists must not hide an existing permitted value and silently select another.
  Keep infrastructure creation restrictions; fix the affected existing type's selection contract,
  not every editor's rights. Route genuine permission changes to `typo3-backend-rights`.
- Use [rich-text round trips](rich-text-roundtrip.md) for HTML fields. Preserve preview fallbacks
  and test nested children as described in [backend previews](19-backend-previews.md).
- Restore disposable fixtures through supported APIs. Bind frontend and backend results separately
  to the current proof epoch. Missing login remains pending; a renderer test is not an editor save.

Evidence: the [October fleet review](../../typo3-upgrade-run/references/run-retrospective-2026-10-21.md)
records the actual failing templates, Core-codec migration and no-change CType repair. Customer
UIDs, commands and data mappings are intentionally not reusable defaults.
