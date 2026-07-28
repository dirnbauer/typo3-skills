# Backend users, groups and permissions

**The gate nothing else covers.** The module sweep proves a module *opens*. The write round-trip
proves an *admin* can save. Neither says anything about the editor who logs in on Monday.

Permission damage is silent by design. TYPO3 ignores a permission entry pointing at something
that no longer exists, and it simply does not *offer* a content type an editor is not allowed to
use. There is no error, nothing in any log, and the frontend is perfect. The editor just cannot
do their job, and you hear about it from the client.

```bash
node scripts/backend-permissions-audit.mjs --ddev-dir . \
  --report .typo3-update/report.permissions.json     # add --fix for the additive repairs
```

---

## 1. Who keeps admin — ask, never assume

**Admin is not a permission level. It bypasses the permission system entirely.** An admin
account is unbounded: every module, every table, every field, every page, every file mount,
regardless of what any group says.

The policy is: **`admin` itself, plus the named individuals the client explicitly confirms, and
nobody else.** Everyone else gets a group.

**Ask for the list by name.** Do not infer it from who currently holds the flag — the current
set is exactly the thing being questioned, and demoting the wrong person locks out whoever
actually runs the site. The audit reports admins and **never changes an admin flag**; that
decision needs a human.

`_cli_` is TYPO3's own system account. It holds admin, cannot log in, and must be left alone.

Also check for the opposite failure — a non-admin belonging to **no group at all**. It can log
in and do precisely nothing, which reads to the user as "the upgrade broke my account".

## 2. The editor group — what it actually has to contain

A group is not one setting; it is seven, and any one of them silently disables editing.

| Field | What it decides | How it fails |
|---|---|---|
| `groupMods` | which backend modules appear | an identifier that no longer exists is ignored — the module vanishes |
| `tables_modify` | which tables can be edited | without `pages`, `tt_content`, `sys_file_reference` there is no editing at all |
| `tables_select` | which tables can be read | records exist but cannot be opened |
| `explicit_allowdeny` | **which content types may be used** | the common one — see below |
| `non_exclude_fields` | which "exclude" fields are visible | the field exists on the element and the editor cannot see it |
| `pagetypes_select` | which page doktypes may be created | new pages of the right type become impossible |
| `file_permissions`, `file_mountpoints`, `db_mountpoints` | file and page access | uploads fail, or the page tree is empty |

### `explicit_allowdeny` is where it goes wrong

This lists the content types an editor may use, one entry per type
(`tt_content:CType:textmedia`). It is a **whitelist**, and it is written once when the site is
built and then never revisited — while the site keeps gaining content types from new extensions,
from a relaunch, or from a Core version that split one type into several.

The result is content that exists on the site and cannot be edited by the people who own it.

**Measure it — the query is the whole diagnosis.** Compare what the group allows against what the
content actually uses:

```bash
ddev mysql -N -e "SELECT CType, COUNT(*) FROM tt_content WHERE deleted=0 GROUP BY CType ORDER BY 2 DESC;"
ddev mysql -N -e "SELECT explicit_allowdeny FROM be_groups WHERE deleted=0;"
```

On a real 12.4 → 14.3 run the editor group allowed 9 types while the site used 5 more —
`textpic` (13 elements), `header` (7), `html` (5), `menu_subpages` (2), `indexedsearch_pi2` (1).
**28 elements the editors could see and not edit**, on a site nobody had reported as broken.

The repair is additive: allow what is in use. Never remove an entry to "tidy up" — you cannot
tell from the data whether a type is unused because it is obsolete or because it was never
permitted in the first place.

## 3. Enumerate modules from CODE, not from the module menu

When checking `groupMods`, the authoritative list is
`Configuration/Backend/Modules.php` in every installed package — **not** what the backend menu
shows and **not** the output of the module sweep.

Modules whose `parent` is `user` — User settings, for one — live in the avatar dropdown and never
appear in the module menu at all. Validating against the menu reports them as removed.

This is not hypothetical: it produced a false positive on a real run, and the "fix" was a
`composer require` for an extension that had never been missing. The module menu showed 25
modules; the registered code contained **56**.

```bash
grep -rhoE "^\s{4}'[a-z0-9_]+' =>" vendor/*/*/Configuration/Backend/Modules.php \
  packages/*/Configuration/Backend/Modules.php 2>/dev/null | tr -d " '=>" | sort -u
```

Include `packages/` and `extensions/`. An in-house backend module is exactly the kind that gets
missed, because nobody upstream documents it.

### When an identifier really has gone

Two different causes, two different fixes — establish which before touching anything:

- **Renamed.** Map the old identifier to the new one. v14 renamed the module *parents*
  (`web` → `content`, `file` → `media`, `tools` → `admin`/`system`) while leaving module
  identifiers such as `web_layout` alone, so a `groupMods` entry that looks obsolete frequently
  is not.
- **The extension providing it is gone.** Either reinstall it or accept the loss deliberately.
  Check `composer why-not` and whether another package now `replaces` it — in v14
  `typo3/cms-backend` replaces `typo3/cms-setup` and `typo3/cms-recordlist`, so requiring them
  separately installs nothing and removing them costs nothing.

## 4. Files must actually work

A group that can edit content but not place an image is not usable. Check all three:

- `file_permissions` — needs at minimum `readFolder`, `writeFolder`, `addFile`, `readFile`,
  `writeFile`, `deleteFile`. Missing `replaceFile` is the subtle one: editors can upload a new
  file but not update an existing one, so the media library fills with `image-final-2-neu.jpg`.
- `file_mountpoints` — must resolve to live `sys_filemounts` rows. A mount pointing at a deleted
  row silently yields an empty file browser.
- `db_mountpoints` — must resolve to live pages, or the page tree is empty and the editor
  concludes the site is gone.

## 5. What to check after every upgrade

The recurring failures, in the order they cost time:

1. Content types in use that the editor group does not allow.
2. `groupMods` entries whose module no longer exists — verified against **code**.
3. Admin accounts that accumulated over the years and were never reviewed.
4. Mountpoints pointing at deleted rows.
5. `non_exclude_fields` not extended when new fields arrived with a new extension version.

Then **log in as a real editor and try**. Create a content element of each allowed type, place an
image, save. The audit proves the configuration is coherent; only using the account proves an
editor can work. A run that closes green while nobody can edit has proven the wrong thing.
