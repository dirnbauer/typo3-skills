# Backend permissions — what the upgrade broke

**Scope: auditing, not building.** For designing an editor group from scratch — the leaf-group
structure, TSconfig, mounts, MFA, login branding, converting an admin down to an editor — use the
**`typo3-backend-rights`** skill. It owns that, and duplicating it here would only let the two
drift apart.

What belongs here is the narrow question this run has to answer: **did the upgrade quietly change
what editors can do?**

It is the gate nothing else covers. The module sweep proves a module *opens*. The write
round-trip proves an *admin* can save. Neither says anything about the editor who logs in on
Monday, and permission damage is silent by design: TYPO3 ignores a permission entry pointing at
something that no longer exists, and simply does not *offer* a content type an editor is not
allowed to use. No error, nothing logged, frontend perfect.

```bash
node scripts/backend-permissions-audit.mjs --ddev-dir . \
  --report .typo3-update/report.permissions.json     # --fix for additive repairs
```

---

## The three things an upgrade actually breaks

### 1. Content types in use that the editor group does not allow

`explicit_allowdeny` is a whitelist, written when the site was built and rarely revisited — while
the site keeps gaining content types from new extensions, a relaunch, or a Core version that
splits one type into several. The result is content that exists on the site and cannot be edited
by the people who own it.

Measure it; the query is the whole diagnosis:

```bash
ddev mysql -N -e "SELECT CType, COUNT(*) FROM tt_content WHERE deleted=0 GROUP BY CType ORDER BY 2 DESC;"
ddev mysql -N -e "SELECT explicit_allowdeny FROM be_groups WHERE deleted=0;"
```

On a real 12.4 → 14.3 run the editor group allowed 9 types while the site used 5 more —
`textpic` (13 elements), `header` (7), `html` (5), `menu_subpages` (2), `indexedsearch_pi2` (1).
**28 elements the editors could see and not edit**, on a site nobody had reported as broken.

The repair is **additive**: allow what is in use. Never remove an entry to tidy up — you cannot
tell from the data whether a type is unused because it is obsolete or because it was never
permitted.

### 2. `groupMods` entries whose module no longer exists — checked against CODE

The authoritative list is `Configuration/Backend/Modules.php` in every installed package. **Not**
the backend module menu, and **not** the output of the module sweep.

Modules whose `parent` is `user` — User settings, for one — live in the avatar dropdown and never
appear in the module menu. Validating against the menu reports them as removed. That produced a
false positive on a real run, and the "fix" was a `composer require` for an extension that had
never been missing. Menu: 25 modules. Registered code: **56**.

```bash
grep -rhoE "^\s{4}'[a-z0-9_]+' =>" vendor/*/*/Configuration/Backend/Modules.php \
  packages/*/Configuration/Backend/Modules.php 2>/dev/null | tr -d " '=>" | sort -u
```

When an identifier really has gone, establish which cause before touching anything:

- **Renamed.** v14 renamed the module *parents* (`web` → `content`, `file` → `media`,
  `tools` → `admin`/`system`) while leaving identifiers such as `web_layout` alone — so an entry
  that looks obsolete frequently is not.
- **The extension providing it is gone.** Check whether another package now `replaces` it: in v14
  `typo3/cms-backend` replaces `typo3/cms-setup` and `typo3/cms-recordlist`, so requiring them
  separately installs nothing and removing them costs nothing.

### 3. Mountpoints pointing at rows that were deleted

`file_mountpoints` must resolve to live `sys_filemounts` rows and `db_mountpoints` to live pages.
A dead mount yields an empty file browser or an empty page tree, and the editor concludes the
site is gone.

---

## Admin accounts

The audit **reports** who holds admin and **never changes an admin flag** — admin is not a
permission level, it bypasses the permission system entirely, so who keeps it is a decision for
the client **by name**, not an inference from who holds it today. Converting an admin down to an
editor is `typo3-backend-rights` territory.

`_cli_` is TYPO3's own system account: it holds admin, cannot log in, and is left alone.

---

## Then log in as a real editor

The audit proves the configuration is coherent. Only using the account proves an editor can work.
Create a content element of each allowed type, place an image, save. A run that closes green
while nobody can edit has proven the wrong thing.
