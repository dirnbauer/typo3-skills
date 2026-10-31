# Migrating Mask elements to Content Blocks

`EXT:mask` builds custom content elements through the backend. **Content Blocks**
(`friendsoftypo3/content-blocks`) is the file-based successor, and it is where the ecosystem has
moved. A v14 upgrade on a Mask site is the natural moment to make the switch — the elements have
to be re-tested anyway.

There is an importer, and it does most of the work. **The trap is when you run it.**

---

## Contents

- [The sequencing trap — read this before planning the upgrade](#the-sequencing-trap--read-this-before-planning-the-upgrade)
- [Before you start](#before-you-start)
- [Running it](#running-it)
- [What the importer does not do](#what-the-importer-does-not-do)
- [Preserve the content API, not only the rendered HTML](#preserve-the-content-api-not-only-the-rendered-html)
- [Six fixes the generated blocks needed](#six-fixes-the-generated-blocks-needed)
- [Backend previews that crash on 14.3](#backend-previews-that-crash-on-143)
- [Proving it worked](#proving-it-worked)
- [If you are already on v14](#if-you-are-already-on-v14)

## The sequencing trap — read this before planning the upgrade

The importer runs on **v13**, not v14:

| Package | TYPO3 | Content Blocks | Mask |
|---|---|---|---|
| `nhovratov/mask-to-content-blocks` 1.0.4 | **^13.4** | ^1.3 | ^9 |
| `schmidtwebmedia/mask-export-to-content-blocks` 0.9.1 | ^12.4 | ^0.7 | — |
| `friendsoftypo3/content-blocks` 2.4.8 (current) | ^14.3.5 | — | — |

So the migration belongs **on the 13.4 rung, before the v14 rung** — while Mask still runs and
while an importer that supports the platform still exists. Reach 14.3 first and there is no
supported path back: Mask has to be migrated by hand, element by element, against a Content
Blocks major the importer never targeted.

Plan it as part of the ladder:

```
12.4  →  13.4  →  [ migrate Mask to Content Blocks here ]  →  14.3
```

`nhovratov` is a Content Blocks maintainer, which makes that the tool to reach for first. Verify
the constraints yourself before committing to a plan — these versions move, and the whole point
of this page is that the *ordering* depends on them:

```bash
ddev composer why-not nhovratov/mask-to-content-blocks "*"
curl -s https://repo.packagist.org/p2/nhovratov/mask-to-content-blocks.json \
  | python3 -c "import json,sys; d=json.load(sys.stdin)['packages']; k=list(d)[0]; \
      print([(v['version'], v.get('require',{}).get('typo3/cms-core')) for v in d[k][:3]])"
```

## Before you start

- **Snapshot.** `ddev snapshot --name pre-mask-migration`. This rewrites content element
  definitions; a bad run is not something you want to unpick by hand.
- **Count what you actually have.** An element defined in Mask and used nowhere gets deleted, not
  migrated — the cheapest possible outcome, and worth the query:

  ```bash
  ddev mysql -N -e "SELECT CType, COUNT(*) FROM tt_content
    WHERE deleted=0 AND CType LIKE 'mask_%' GROUP BY CType ORDER BY 2 DESC;"
  ```

- Note which extension the Mask elements are loaded from. The importer writes the generated
  Content Blocks **into that same extension**.

## Running it

```bash
ddev composer require nhovratov/mask-to-content-blocks
ddev typo3 mask-to-content-blocks:migrate
ddev composer remove mask/mask nhovratov/mask-to-content-blocks
```

Remove both afterwards. The migration extension is a one-shot tool, and leaving Mask installed
alongside generated Content Blocks invites two definitions of the same element. Do **not** remove
`friendsoftypo3/fontawesome-provider` with Mask: the migrated elements keep using their Font Awesome
icon identifiers through it. Keep it and upgrade it to its latest stable v14-compatible release — see
[Font Awesome icons](extension-strategy.md#font-awesome-icons-keep-friendsoftypo3fontawesome-provider).

## What the importer does not do

Its own README is blunt about this — *"no guarantee that everything will work perfectly"* — and
the gaps are predictable:

- **TypoScript overrides are not migrated.** Anything addressing `lib.maskElement` has to be moved
  to `lib.contentBlock` by hand. Grep for it, including in the **database** (`sys_template`), where
  a file-based tool will never look:

  ```bash
  grep -rn 'maskElement' packages/ config/ fileadmin/
  ddev mysql -N -e "SELECT uid, title FROM sys_template
    WHERE deleted=0 AND (config LIKE '%maskElement%' OR constants LIKE '%maskElement%');"
  ```

- **Frontend templates and backend previews need adjusting.** They are generated, not translated.
- **Field-level behaviour** — defaults, evaluations, display conditions — deserves a look per
  element rather than a spot check.

## Preserve the content API, not only the rendered HTML

Treat the Mask definition as a data contract. Before removing it, compare every generated
`EditorInterface.yaml` with the source definition and preserve:

- the original `typeName`, so existing `tt_content.CType` values keep resolving;
- field identifiers, so persisted values and templates still address the same properties; and
- `prefixFields: false` where the old fields were unprefixed. Accepting the generator default can
  create perfectly valid but empty-looking records because the runtime reads different columns.

Audit generated field types rather than trusting the importer's closest match. Media fields are a
common miss: if the existing element accepts video, ensure the generated file restrictions include
the actual types in use (for example MP4), then prove one record of each media variant in FormEngine
and the frontend.

Content Blocks 2 has a stricter schema than the v1 output produced on the 13.4 rung. On the 14.3
rung, migrate the generated definitions deliberately:

- scalar options such as `minitems` and `maxitems` are integers, not quoted strings;
- `DateTime` fields do not accept legacy TCA-shaped options such as `eval` or `renderType`; and
- the schema rejects unknown keys, so run `ddev typo3 content-blocks:lint` and fix every definition.

Treat the importer as an **in-place model migration**. The safest result keeps the existing CTypes,
custom columns, child tables and `sys_file_reference.fieldname` values; renaming them for cosmetic
consistency creates a second migration and can orphan data. Inspect the generated YAML values by
type, not appearance: converters have emitted quoted strings for integer and boolean options. Check
stored `NULL` values before accepting a generated non-nullable field.

The data sequence is part of the migration. If legacy Extbase plugins still persist `list_type`, run
and prove that transaction before CType-only registration makes those records unreadable. Then test
Fluid with the actual values returned by Content Blocks: Link fields are link objects rather than
plain strings, and local Frame layouts or `_all` argument forwarding may need explicit migration for
Fluid 5.

Preserve the package's layout and partial paths when moving templates, and remove Mask TypoScript
or static includes only after the equivalent Content Blocks rendering paths are active. Finish by
updating the reference index: migrated FAL fields and renamed/prefixed fields can otherwise leave
records that render locally but fail after cleanup or deployment.

## Six fixes the generated blocks needed

Proven on one fleet site (13.4.35, Mask 9.0.12, importer 1.0.4, Content Blocks 1.6.5). The importer kept
the `mask_*` CTypes, `prefixFields: false`, the existing columns and child tables, and copied the Mask
templates verbatim. Six fixes were still needed; 5 and 6 surfaced only at full scope, on pages no
intermediate sample drew ([intermediate loops](measurement-recipes.md#intermediate-loops-on-stateful-rungs)).

| # | Symptom | Fix |
|---|---|---|
| 1 | editors lose the RTE on Mask "richtext" fields | the importer emits a plain `Textarea`: add `enableRichtext: true` |
| 2 | link fallbacks never render | Link fields are `TypolinkParameter` objects (Mask passed strings), and an empty object is truthy: use `{x.url}` in `f:if` conditions and in `f:link.page pageUid` / `f:link.email email` |
| 3 | template values come out empty | the template reads a column its element does not define (Mask exposed the whole row): `{data.rawRecord.<column>}`, which also works on the v14 Record API |
| 4 | the schema update fails in strict mode | Mask `tinytext NULL` becomes `VARCHAR(255)`/`TEXT NOT NULL`: first a ledgered `UPDATE … SET <col> = '' WHERE <col> IS NULL` (check no value exceeds 255 characters); staging replays it before its schema update |
| 5 | "Oops, an error occurred!" on a page | `f:link.external uri` takes a strict `string`: pass `{x.url}` |
| 6 | exception on a page | a Mask field named `rowDescription` collides with a reserved Content Blocks property: drop it (Mask never rendered it) |

Before the first capture, list every `{data.<name>}` reference a block's templates make that its
`config.yaml` does not define. Each hit is a record property (`uid`, `pid`, `rawRecord`, …) or a column
only Mask exposed (fix 3):

```bash
for b in packages/*/ContentBlocks/ContentElements/*/; do
  comm -23 <(grep -rhoE '\{data\.[A-Za-z0-9_]+' "${b}templates" | cut -d. -f2 | sort -u) \
           <(grep -hoE 'identifier: *[A-Za-z0-9_]+' "${b}config.yaml" | awk '{print $2}' | sort -u) \
    | sed "s|^|${b}: |"
done
```

## Backend previews that crash on 14.3

On one fleet run the frontend proof was green while the 14.3 page module threw
`#1775553111 Record property "X" is not available` from `typo3/cms-fluid` `Render/TextViewHelper`:
721 child rows across 11 child tables failed, and other child rows rendered silently with nonsense.

**Cause.** The importer's generated `templates/backend-preview.html` renders every collection with
the Content Blocks partial `PageLayout/Grid`. That partial is meant for blocks with their own record
table. For a child table defined inside a block (`tx_mask_*`), Content Blocks picks the **parent**
block's `backend-preview.html` for the child row. Each child row was therefore rendered through its
parent's preview, and `{data -> f:render.text(field: 'header')}` threw because the child row has no
`header`. Child rows whose fields happened to exist rendered the parent's layout with wrong values.

**Not the cause:** `ctrl.hideTable`. Mask on 12.4 set `hideTable: true` for its child tables, and
Content Blocks sets the same.

**Detect.** A frontend proof never reaches these templates. Run a page-module probe that renders
every page carrying Content Block elements, child rows included, and require 0 exceptions (that run:
328 pages, 522 elements). Find the generated previews that use the grid first:

```bash
grep -rl 'PageLayout/Grid' packages/*/ContentBlocks/ContentElements/*/templates/backend-preview*.html
```

**Run the probe only on a clone** (a copied DDEV project or a scratch database plus a copied
`fileadmin`), never on the project whose fingerprint is sealed. Rendering previews with `f:image`
writes derivatives: in that run `plan2net/webp` created `.webp` sidecars in the main `fileadmin` and
broke a sealed content fingerprint.

**Fix**, per element, decided by what 12.4 had:

1. **12.4 had a Mask backend template** (the Mask `backend` template folder): restore it as the
   `Content` section of `backend-preview.html`. Render the children in a plain `f:for` loop over the
   collection, never through `PageLayout/Grid`.
2. **12.4 had none:** delete the generated `backend-preview.html`. Content Blocks then falls back to
   the TYPO3 standard preview, which matches what editors saw on 12.4.
3. In TYPO3 14 backend templates, use `f:sanitize.html` instead of `f:format.html`, which throws
   `#1686813703` in the page module.

Then rerun the clone probe until it reports 0 exceptions, and compare one page per element type with
the 12.4 page module ([backend previews](../../typo3-content-blocks/references/19-backend-previews.md#verify)).

## Proving it worked

This is a content-element migration, so the invariance gate is exactly the right instrument and
it is already in this skill. Do not eyeball it:

1. Capture a baseline **before** migrating, on 13.4.
2. Migrate.
3. Compare — every page carrying a migrated element must render identically.

```bash
node scripts/t3u.mjs capture  --run-dir .typo3-update --label before-mask --out before-mask --all-urls
# … migrate …
node scripts/t3u.mjs capture  --run-dir .typo3-update --label after-mask --out after-mask --all-urls
node scripts/t3u.mjs compare-visual \
  --before-dir .typo3-update/captures/before-mask/shots \
  --after-dir  .typo3-update/captures/after-mask/shots \
  --diff-dir   .typo3-update/loops/mask-diff --loop 210
```

Then check the backend as well: a Content Block that renders correctly in the frontend can still
be uneditable, and its page-module preview can still throw
([previews that crash on 14.3](#backend-previews-that-crash-on-143)). Open one of each migrated type in FormEngine, save it, and confirm every field
survived — `scripts/backend-write-roundtrip.mjs` covers the mechanics, and
`references/backend-permissions.md` covers the part everyone forgets: **new content types are not
automatically permitted to editors.** A migrated element that editors cannot select has not been
migrated as far as they are concerned.

The final proof is four-sided: identical frontend output, editable backend records, a clean
`content-blocks:lint`, and a clean reference index. Record any intentional difference as a declared
change rather than weakening the visual comparison.

## If you are already on v14

The importer will not install. The options, in order of cost:

1. **Go back.** If the run is still local and the snapshot exists, restore to 13.4, migrate, then
   redo the v14 rung. Usually cheapest.
2. **Migrate by hand** against the Content Blocks documentation, one element at a time, using the
   Mask definitions as the specification. Budget it as its own workstream.
3. **Keep Mask** if it has a v14 release, and treat the migration as separate work later. Check
   before assuming this is available.

The manual guide is in the Content Blocks documentation under
`friendsoftypo3-content-blocks:migrations-mask`.
