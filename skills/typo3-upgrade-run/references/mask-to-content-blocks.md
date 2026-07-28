# Migrating Mask elements to Content Blocks

`EXT:mask` builds custom content elements through the backend. **Content Blocks**
(`friendsoftypo3/content-blocks`) is the file-based successor, and it is where the ecosystem has
moved. A v14 upgrade on a Mask site is the natural moment to make the switch — the elements have
to be re-tested anyway.

There is an importer, and it does most of the work. **The trap is when you run it.**

---

## The sequencing trap — read this before planning the upgrade

The importer runs on **v13**, not v14:

| Package | TYPO3 | Content Blocks | Mask |
|---|---|---|---|
| `nhovratov/mask-to-content-blocks` 1.0.3 | **^13.4** | ^1.3 | ^9 |
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
alongside generated Content Blocks invites two definitions of the same element.

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
be uneditable. Open one of each migrated type in FormEngine, save it, and confirm every field
survived — `scripts/backend-write-roundtrip.mjs` covers the mechanics, and
`references/backend-permissions.md` covers the part everyone forgets: **new content types are not
automatically permitted to editors.** A migrated element that editors cannot select has not been
migrated as far as they are concerned.

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
