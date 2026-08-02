# Backend permission model

Read this reference before creating or changing a TYPO3 backend group or user.

## Invariants

- Identify the user-selected TYPO3 installation first and apply the approved group, User TSconfig,
  and user setting only there; do not stop at a generic permission plan.
- Use one top-level main editor group; keep `be_groups.subgroup` empty.
- Keep at least one separate enabled administrator that can log in.
- Keep the account used to perform the work as an administrator.
- Ask before replacing a user's existing group list.
- Build CType, table, field, module, and mount rights from the live project.

## `be_groups` field mapping

| Field | Required interpretation |
|---|---|
| `groupMods` | Installed backend module identifiers needed by editors |
| `tables_select` | Every table editors must read; always include every `tables_modify` entry |
| `tables_modify` | Tables editors may create, edit, hide, move, or delete |
| `pagetypes_select` | Page `doktype` values editors may use |
| `db_mountpoints` | Root page UIDs that contain the complete editable tree |
| `file_mountpoints` | UIDs of active `sys_filemounts` records, not storage UIDs or example paths |
| `file_permissions` | Explicit folder/file operations allowed by the workflow |
| `explicit_allowdeny` | Comma-separated auth-mode values, especially `tt_content:CType:<value>` |
| `non_exclude_fields` | Comma-separated `<table>:<field>` values for TCA fields marked `exclude` |
| `TSconfig` | Prefer one sitepackage import for the selected User TSconfig profile |
| `subgroup` | Keep empty; required rights belong to the one main group |

## The empty CType allow-list defect

TYPO3 v14 configures `tt_content.CType` with `authMode = explicitAllow`. Therefore this group is
broken for non-admin content editing:

```text
title = Redakteur
explicit_allowdeny =
```

Do not interpret the empty value as unrestricted. For a used CType `text`, the group needs:

```text
tt_content:CType:text
```

Audit all non-deleted `tt_content` records, including hidden records. Let `U` be the set of used
CTypes, `E` the documented infrastructure exceptions, and `A` the group's explicitly allowed
CTypes. The required gate is:

```text
U - E - A = empty
E intersect A = empty
```

Also flag allowed values that are no longer registered in runtime TCA.

## Classify content elements

Default every used CType to editorial. Move it to the exception set only after inspecting the
record, page, FlexForm, and workflow and recording a concrete reason.

Typical infrastructure candidates:

- news list, category list, and detail renderers whose records are edited separately;
- list/detail/search plugins that define routing, storage PIDs, or templates;
- login/logout endpoints;
- form-rendering plugins containing receiver or integration configuration;
- site-wide logo, shop, or account renderers maintained by integrators.

Do not classify by a name pattern alone. A project-specific plugin can be normal editorial
content. Raw HTML is also not automatically an exception; decide from the trusted-editor model
and document the security consequence.

## Separate plugin placement from record editing

An admin-only news list/detail CType must not remove access to news records. For EXT:news, consider
the actual TCA and grant the installed editorial tables, commonly:

```text
tx_news_domain_model_news
tx_news_domain_model_link
tx_news_domain_model_tag
sys_category
sys_file_reference
```

For Powermail, distinguish form-definition records (`form`, `page`, `field`) from submitted mail
and answer records. Grant modification of submissions only when the editorial workflow requires
it; read-only reporting is usually sufficient.

Include project inline/collection tables referenced by allowed content elements, such as Content
Blocks, Bootstrap Package collections, or legacy Mask child tables. A content element is not
editable end-to-end if its child records are inaccessible.

## Exclude fields

After choosing tables, inspect loaded runtime TCA. Add each needed field with `exclude = true` to
`non_exclude_fields`. Include enable fields, scheduling, language, SEO, FAL metadata/reference
fields, relations, and all editorial domain fields required to complete a record.

Do not rely on a historical list. Extensions and Content Blocks add fields at runtime. The bundled
audit reports runtime exclude fields so the permission plan can be compared with installed TCA.

## Mount coverage

Use all required site roots as `db_mountpoints`. For files:

1. Select every active, non-deleted `sys_filemounts` record required by the user.
2. Parse its identifier as `<storage uid>:<folder>/`.
3. Verify the referenced `sys_file_storage` exists, is online and browsable, and is writable when
   editors need write operations.
4. Verify the folder exists through TYPO3 FAL or the backend Media module.
5. Test the mounts both in Media and in FormEngine file selectors.

Do not use backend list-module URLs or session tokens as configuration input.

## User TSconfig profiles

Use the basic template for narrowly scoped editors. Use optimized for trusted editors who manage
the whole content tree. The optimized profile intentionally enables Admin Panel `preview`,
`cache`, `edit`, and `info`, while disabling `debug`, `tsdebug`, and `publish`.

The frontend must separately enable:

```typoscript
config.admPanel = 1
```

For `friendsoftypo3/visual-editor`, grant the installed `web_edit` backend module and include this
User TSconfig in both profiles:

```typoscript
options.pageTree.showPageIdWithTitle = 1
```

The extension reads this value directly for its editing context. The optimized profile may also
set `options.pageTree.showDomainNameWithTitle = 1` for multi-site clarity. These are presentation
settings, not permission bypasses: the Visual Editor separately checks language access, the web
mount, `tables_modify`, `tt_content:CType:*`, and `non_exclude_fields` before exposing a field.
Do not mistake `admPanel.enable.edit = 1` for Visual Editor access; they are separate interfaces.

Keep the group TSconfig as a version-controlled import. Confirm the effective User TSconfig in
System > Configuration as an administrator.

## Verification queries

Adapt table/column availability to the installed TYPO3 version.

```sql
SELECT uid, username, admin, disable, usergroup
FROM be_users
WHERE deleted = 0
ORDER BY admin DESC, uid;

SELECT uid, title, subgroup, db_mountpoints, file_mountpoints,
       explicit_allowdeny, non_exclude_fields, TSconfig
FROM be_groups
WHERE deleted = 0
ORDER BY uid;

SELECT CType, COUNT(*) AS records
FROM tt_content
WHERE deleted = 0
GROUP BY CType
ORDER BY CType;

SELECT uid, title, identifier, hidden, read_only
FROM sys_filemounts
WHERE deleted = 0
ORDER BY uid;

SELECT uid, name, is_browsable, is_writable, is_online
FROM sys_file_storage
WHERE deleted = 0
ORDER BY uid;
```

Database evidence does not replace the final non-admin browser test. FormEngine, module access,
FAL selectors, and Admin Panel behavior must be exercised in a real non-admin session.
