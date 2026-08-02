# Backend permission model

Read this reference before creating or changing a TYPO3 backend group or user.

## Contents

- [Invariants](#invariants)
- [`be_groups` field mapping](#be_groups-field-mapping)
- [Flat group composition](#flat-group-composition)
- [The empty CType allow-list defect](#the-empty-ctype-allow-list-defect)
- [Classify content elements](#classify-content-elements)
- [Separate plugin placement from record editing](#separate-plugin-placement-from-record-editing)
- [Exclude fields](#exclude-fields)
- [Mount coverage](#mount-coverage)
- [Page group permissions](#page-group-permissions)
- [Module baseline](#module-baseline)
- [Workspaces baseline](#workspaces-baseline)
- [Languages and MFA](#languages-and-mfa)
- [User TSconfig profiles](#user-tsconfig-profiles)
- [Verification queries](#verification-queries)

## Invariants

- Identify the user-selected TYPO3 installation first and apply the approved group, User TSconfig,
  and user setting only there; do not stop at a generic permission plan.
- Use one user-facing main editor group with four flat leaf groups: Base, Content, Site, Extensions.
- Keep permission fields empty on the main group and `subgroup` empty on every leaf.
- Assign users only to the main group; preserve later site/extension leaf packs attached to it.
- Keep at least one separate enabled administrator that can log in.
- Keep the account used to perform the work as an administrator.
- Ask before replacing a user's existing group list.
- Assign and verify at least one enabled non-admin user in the main group before changing page
  group ownership.
- Build CType, table, field, module, and mount rights from the live project.
- Mount every configured Site root and every non-deleted page with `is_siteroot = 1`.
- Use all languages, both built-in MFA providers, and the complete page baseline `31/27/1` for
  the resolved default owner user, main editor group, and everybody.
- When Workspaces is installed, give editors Live access and membership in the intended custom
  Workspace, but keep ownership and publishing separate.
- Keep page deletion, admin-only fields/tables, system-managed fields, and infrastructure plugins
  outside the editor role.

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
| `allowed_languages` | Keep empty in TYPO3 v14 to allow all current and future site languages |
| `mfa_providers` | Exact provider identifiers `totp,recovery-codes` |
| `explicit_allowdeny` | Comma-separated auth-mode values, especially `tt_content:CType:<value>` |
| `non_exclude_fields` | Comma-separated `<table>:<field>` values for TCA fields marked `exclude` |
| `TSconfig` | Prefer one sitepackage import for the selected User TSconfig profile |
| `workspace_perms` | Extensions leaf: `1` only when Workspaces is installed; otherwise `0` |
| `subgroup` | Main: four required leaf UIDs plus preserved capability leaves; leaf groups: empty |

## Flat group composition

Keep the main group free of direct permission values. Split the initial permission set once:

- **Base**: Core modules, page types, all-language mode, `totp,recovery-codes`, file operations,
  and User TSconfig.
- **Content**: explicit editorial CTypes and the Core content, category, and FAL tables/fields.
- **Site**: current database and file mount UIDs.
- **Extensions**: installed extension modules and non-Core domain tables/fields, including News,
  Core Form, Powermail form definitions, and conditional Workspaces access.

All four are direct leaves of the main group. The user belongs only to the main group, and pages
use the main group as group owner. Put routine extension changes into Extensions. For a later Site
root, add a direct `<main> · Site: Name` leaf containing its mounts. Add a separate extension leaf
only when the capability needs an independent lifecycle; otherwise update Extensions. Never add a
second inheritance level. Set both group-mount inheritance bits on assigned users
(`be_users.options |= 3`) without clearing other option bits. Audit effective inherited permissions,
not only the raw main row.

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
the actual TCA and grant the installed editorial tables in both table lists, commonly:

```text
tx_news_domain_model_news
tx_news_domain_model_link
tx_news_domain_model_tag
sys_category
sys_file_reference
```

For Powermail, grant complete read/write form-building access to:

```text
tx_powermail_domain_model_form
tx_powermail_domain_model_page
tx_powermail_domain_model_field
```

Do not grant `tx_powermail_domain_model_mail`, `tx_powermail_domain_model_answer`, Powermail
marketing/statistics/reporting modules, or the `powermail_pi1` frontend plugin. Form authors can
build definitions without receiving access to personal submissions, campaign data, or plugin
placement.

For Core Form, grant `form_definition` in both `tables_select` and `tables_modify` plus the Form
manager/editor modules. TYPO3 v14.3's Form persistence layer checks both table lists even though
the TCA representation is read-only and the module performs guarded writes.

Include project inline/collection tables referenced by allowed content elements, such as Content
Blocks, Bootstrap Package collections, or legacy Mask child tables. A content element is not
editable end-to-end if its child records are inaccessible.

## Exclude fields

After choosing tables, inspect loaded runtime TCA. Add each needed field with `exclude = true` to
`non_exclude_fields`. Include enable fields, scheduling, language, SEO, FAL metadata/reference
fields, relations, and all editorial domain fields required to complete a record.

Do not rely on a historical list. Extensions and Content Blocks add fields at runtime. The bundled
audit reports runtime exclude fields so the permission plan can be compared with installed TCA.

Never grant these categories to a non-admin editor:

- a table's `ctrl.editlock` field, such as `editlock`;
- a field whose runtime `displayCond` contains `HIDE_FOR_NON_ADMINS`;
- fields with TCA types `passthrough`, `none`, or runtime `readOnly = true` when they are generated
  or maintained by TYPO3/an extension;
- fields of tables with `ctrl.adminOnly = true`;
- structural integrator controls such as `pages.is_siteroot`, page `TSconfig`,
  `tsconfig_includes`, backend module assignment, and page access ownership/permission fields.

Do not force such fields editable by overriding TCA. Report unexpected read-only/system-managed
fields separately. The success criterion is that every legitimate editor field is editable, not
that every database column is exposed.

## Mount coverage

Use the union of configured Site roots and non-deleted `pages.is_siteroot = 1` records as
`db_mountpoints`. A database mount does not itself grant page access; audit `perms_groupid` and
`perms_group` throughout every mounted tree. For files:

1. Select every active, non-deleted `sys_filemounts` record required by the user.
2. Parse its identifier as `<storage uid>:<folder>/`.
3. Verify the referenced `sys_file_storage` exists, is online and browsable, and is writable when
   editors need write operations.
4. Verify the folder exists through TYPO3 FAL or the backend Media module.
5. Test the mounts both in Media and in FormEngine file selectors.
6. Ensure every online, browsable storage is covered by at least one active file mount; backend
   groups cannot receive useful storage access without a mount.

Do not use backend list-module URLs or session tokens as configuration input.

## Page group permissions

Use this complete baseline on every page in every configured or flagged Site tree:

```text
owner user: 31 = show (1) + edit page (2) + delete page (4) + create page (8) + edit content (16)
owner group: 27 = show (1) + edit page (2) + create page (8) + edit content (16)
everybody:    1 = show (1)
```

Resolve the default owner user from the selected installation and report the account/UID. Never
embed a reusable fixed UID in the skill or script, and never retain deleted or missing page owners
as a supposed default. The main editor group is the group owner. Everybody remains view-only.

Use group permission bits `27` for trusted full-content editors:

```text
show (1) + edit page (2) + create page (8) + edit content (16) = 27
```

Keep group delete-page bit (`4`) disabled unless separately approved. Assign the approved default
user and main group throughout the deduplicated union of every configured Site tree and every tree
whose root is marked `is_siteroot`; do not stop at the first homepage and do not compensate with
broad `perms_everybody`. Configure new pages through Page/User TSconfig to inherit both owners and
the `31/27/1` matrix.

Apply this as a cutover, not as part of initial group creation:

1. Inventory every intended editor's current `usergroup` list and option bits.
2. Ask append-versus-replace for each target or explicitly named cohort. Never interpret
   “consolidate” as permission to remove unrelated memberships.
3. Assign only the main group, preserve required unrelated memberships according to that answer,
   and set `be_users.options |= 3` without clearing other option bits.
4. Verify a real non-admin login can see and edit the intended mounted tree.
5. Only then change `pages.perms_userid` to the approved default user, `pages.perms_groupid` to the
   main group, and the user/group/everybody bits to `31/27/1` through DataHandler or the Permissions
   module. Re-audit before removing the legacy owner group.

If the page tree still belongs to a legacy group while no enabled non-admin user has the new main
group, report both states and stop. Changing page ownership first can lock every editor out even
though the new group passes a static permission audit.

## Module baseline

Resolve module identifiers from the runtime registry. Include Layout, Records, Preview, Status,
Recycler, Media, and User Settings when installed. Add Visual Editor and Core Form only when
installed. For Solr, expose the `searchbackend` parent and read-only `searchbackend_info`, not core
optimization, index queue, or index administration. Do not expose any Powermail backend module;
editors build form-definition records through the normal record workflow.

## Workspaces baseline

Apply this only when `typo3/cms-workspaces` and `workspaces_publish` are registered:

- Extensions leaf: `groupMods += workspaces_publish` and `workspace_perms = 1` for Live access.
- User TSconfig: `options.workspaces.previewLinkTTLHours = 48`.
- Keep the default Editing and Ready to publish stages.
- Add the main editor group as a custom Workspace **member**, never as an owner by default.
- Use `publish_access = 2`; publishing remains an approved owner responsibility.
- Use groups rather than individual users for Workspace membership and ownership.
- Ask for the owner/publisher before creating a missing custom Workspace, then write it through
  DataHandler. Do not grant editor access to the administrator-only `sys_workspace` table.

If Workspaces is absent, leave `workspace_perms = 0`, omit its module, and create no Workspace
record. If it is present, a group permission without custom Workspace membership is incomplete.
Physical FAL files are not versioned even though `sys_file_reference` overlays are: upload a new
unique filename for a Workspace replacement and never overwrite a shared file in place.

## Languages and MFA

In TYPO3 v14, blank `allowed_languages` means all languages and automatically covers later Site
Configuration additions. Do not freeze the group to today's numeric language IDs.

Use exact `mfa_providers` values `totp,recovery-codes`. Recovery codes are a fallback and require
a primary provider. Provider availability is distinct from enforcing MFA: recommend TOTP in User
TSconfig, but require MFA only after explicit policy approval.

## User TSconfig profiles

Use the basic template for narrowly scoped editors. Use optimized for trusted editors who manage
the whole content tree. Both profiles recommend TOTP, inherit the parent owner user/group, and set
the new-page baseline to owner user `31`, owner group `27`, and everybody view-only `1`. Group page
deletion remains off. Both set the basic Workspaces preview-link lifetime to 48 hours; this is inert
when Workspaces is absent. The optimized profile intentionally enables Admin Panel `preview`,
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
       allowed_languages, mfa_providers, explicit_allowdeny, non_exclude_fields, TSconfig
FROM be_groups
WHERE deleted = 0
ORDER BY uid;

SELECT uid, pid, title, is_siteroot, perms_userid, perms_user,
       perms_groupid, perms_group, perms_everybody
FROM pages
WHERE deleted = 0
ORDER BY pid, sorting, uid;

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
