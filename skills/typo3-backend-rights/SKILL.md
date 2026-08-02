---
name: typo3-backend-rights
description: "Build and audit one main non-admin TYPO3 backend user group: explicit CType permissions, domain-record fields, modules, web and file mounts, User TSconfig, Visual Editor, Admin Panel, and safe privilege conversion for editors. Use when a module can open but existing record types are missing during editing, be_groups.explicit_allowdeny is blank, Visual Editor fields are read-only, news records cannot be changed, mount trees are incomplete, or legacy groups must be consolidated. Always preserve a separate working administrator."
---

# TYPO3 backend rights

> Source: https://github.com/dirnbauer/typo3-skills

Build one complete editor group from the live project. Treat permissions as a verified model,
not a copied backend record.

## Contract

1. Identify the TYPO3 installation selected by the user before writing. If several projects could
   be meant, ask which one to use. Apply the approved group, User TSconfig, and user setting to that
   installation; a permission plan without the requested live/local integration is incomplete.
2. Create or maintain exactly **one main editor group**. Keep `subgroup` empty. Do not split
   required rights across inherited groups.
3. Derive rights from installed TCA, existing records, backend modules, site roots, file mounts,
   and file storages. Never clone a legacy group without auditing every field.
4. Allow every content type currently used for editorial content. Record every exception with
   its CType and reason.
5. Keep infrastructure content elements such as list/detail renderers, login endpoints, or
   system integration plugins admin-only when editors manage their underlying records instead.
   Decide from the actual record, FlexForm, page purpose, and workflow—not from the CType name
   alone.
6. Grant all exclude fields needed to edit every allowed record type. Plugin placement rights and
   domain-record rights are separate: editors may edit news records while news list/detail content
   elements remain admin-only.
7. Include every required web mount, every active file mount, and every referenced online file
   storage. Do not replace real mounts with hard-coded example paths.
8. Preserve a different enabled, login-capable administrator. Never demote the administrator used
   for the current work or the last remaining administrator.

Report the selected installation's DDEV/project name, root, TYPO3 version, and affected group/user
UIDs. Never apply one installation's audited permissions to another installation.

## Audit first

Run the bundled read-only audit inside the project container:

```bash
ddev exec php /dev/stdin --pretty \
  < /absolute/path/to/typo3-backend-rights/scripts/audit-backend-rights.php
```

Add `--group-title='Editorial Main'` to check a target group and `--strict` to return non-zero for
blocking findings. Add `--exceptions-plan=/container/path/to/permission-plan.json` to load the
documented exception map used by the group. Read [permission-model.md](references/permission-model.md)
before changing a group or user.

Treat this result as a blocking defect:

```text
tt_content.CType authMode = explicitAllow
be_groups.explicit_allowdeny has no tt_content:CType:* entries
```

An empty list does **not** mean “allow every CType.” It prevents non-admin users from using the
explicitly protected types. Require each used editorial CType to appear as
`tt_content:CType:<value>`.

## Build the permission plan

1. Inventory enabled backend users, their groups, and enabled administrators. Identify the
   current working administrator and the separate administrator that will remain.
2. Inventory distinct non-deleted `tt_content.CType` values, including hidden records. Compare
   them with registered TCA types and the target group's explicit allow-list.
3. Classify each used CType:
   - **editorial**: add it to `explicit_allowdeny`;
   - **infrastructure**: omit it and record the specific reason and owner.
4. Inventory editable tables. Make `tables_select` a superset of `tables_modify`. Include content,
   FAL relations/metadata, categories, and the project's editorial domain tables.
5. Add every TCA column marked `exclude` that the editor needs for those tables to
   `non_exclude_fields`. For editorial domain records such as news, expose the complete editing
   form unless a field has a documented security or workflow reason to remain admin-only.
6. Use the actual page roots and storage folders as `db_mountpoints`. Use every active
   `sys_filemounts.uid` as `file_mountpoints`, validate each identifier's storage UID against
   `sys_file_storage`, and grant the file operations required by the workflow.
7. Allow only installed backend module identifiers required for editing, preview, records, files,
   redirects, and project-specific editorial modules. Do not grant administration or system
   configuration modules.
8. Include every page type already used below the editor's web mounts. Add unused types only when
   the workflow explicitly needs editors to create them.

## Configure TSconfig

Keep User TSconfig in the sitepackage and import it from the main group. Copy one bundled profile:

- [basic.tsconfig](assets/tsconfig/basic.tsconfig): page-cache clearing and safe preview access.
- [optimized.tsconfig](assets/tsconfig/optimized.tsconfig): the basic rights plus useful Admin
  Panel sections, file-list actions, resource view, and live-search destinations.

Use the optimized profile by default for trusted content editors. Keep `debug`, `tsdebug`, and
`publish` disabled. Verify the frontend TypoScript has `config.admPanel = 1`; User TSconfig alone
cannot display the Admin Panel.

When `friendsoftypo3/visual-editor` is installed, include its registered `web_edit` module and set:

```typoscript
options.pageTree.showPageIdWithTitle = 1
```

The Visual Editor consumes this option when building its editing context. In multi-site projects,
also enable `options.pageTree.showDomainNameWithTitle = 1` to make destinations unambiguous.
These options improve the editor context but do not grant write access. Visual editing additionally
requires the page mount, language, `tables_modify`, `non_exclude_fields`, and explicit CType rights
for each rendered record. `admPanel.enable.edit` controls the Admin Panel and is not a substitute
for the `web_edit` backend module.

Prefer a group import over duplicated inline TSconfig:

```typoscript
@import 'EXT:sitepackage/Configuration/TsConfig/User/BackendEditor/optimized.tsconfig'
```

## Create the group

Create or update one top-level group through the TYPO3 backend or a project command using TYPO3's
loaded TCA. Set a descriptive title such as `Editorial Main`, keep `subgroup` empty, and document:

- the allowed editorial CTypes;
- every excluded infrastructure CType with its reason;
- editable/selectable tables and non-exclude fields;
- backend modules and page types;
- database/file mounts and file operations;
- the selected TSconfig profile.

Create the group before changing any user. Do not delete or repurpose old groups until the new
group has passed verification.

For a repeatable local/DDEV setup, prepare a reviewed JSON plan following
[permission-plan.example.json](assets/permission-plan.example.json), then apply only the group:

```bash
ddev exec php /dev/stdin --dry-run \
  --plan=/var/www/html/var/transient/backend-rights-plan.json \
  < /absolute/path/to/typo3-backend-rights/scripts/apply-backend-rights.php

ddev exec php /dev/stdin --plan=/var/www/html/var/transient/backend-rights-plan.json \
  < /absolute/path/to/typo3-backend-rights/scripts/apply-backend-rights.php
```

The command validates live CTypes, exception reasons, tables, mounts, and admin presence before a
transactional insert/update. It never changes users or deletes old groups.

## Change user membership safely

Ask the user this explicit question before replacing memberships:

> Should `<main group>` be this backend user's only group?

- If yes, replace that user's group list with the main group.
- If no, append the main group and preserve existing memberships.
- If the target user is an administrator, set `admin = 0` only after proving a different enabled,
  login-capable administrator remains.
- Never demote the current working administrator. Use a second account for the editor test.

Changing one user's memberships does not authorize bulk changes to other users.

## Verify as a non-admin

Use a real non-admin session and verify all of these:

1. The page tree covers every required web mount.
2. Every used editorial CType can be opened, changed, saved, hidden/unhidden, copied, and created.
3. Each documented infrastructure CType is unavailable for creation and cannot be reconfigured.
4. Editorial records such as news open with every required field and can be saved.
5. All active file mounts appear in Media and in file selectors; upload, replace, metadata edit,
   move/copy, and delete behave according to the plan.
6. If installed, the Visual Editor module opens and every allowed rendered field can be changed
   and saved; page IDs are present in its editing context and multi-site destinations are clear.
7. Preview and the Admin Panel work; page cache clearing is available, while debugging and
   publishing controls remain unavailable.
8. The separate administrator can still log in.

Re-run the audit with `--group-title` and `--strict`. Report the group UID, target user, remaining
administrator, allowed/missing CTypes, exceptions, tables, fields, mounts, TSconfig profile, and
the non-admin verification evidence.

## Resources

- [permission-model.md](references/permission-model.md): database field mapping, classification
  rules, and verification queries.
- `scripts/audit-backend-rights.php`: read-only runtime TCA/database audit.
- `scripts/apply-backend-rights.php`: validate and transactionally create/update the one group
  from a reviewed plan; never changes users.
- `assets/tsconfig/`: basic and optimized User TSconfig templates.
