---
name: typo3-backend-rights
description: "Build and audit TYPO3 backend editor rights after an explicit choice between one user-facing main group with simple internal leaves or preserving distinct existing roles. Covers CTypes, fields, page ACLs, languages, modules, mounts, MFA, Forms/Powermail, Workspaces, User TSconfig, Visual Editor, Redirects, safe membership cutover, and customer login/backend branding with the Application Context. Use when permissions are missing/read-only, be_groups is incomplete, or legacy roles may be consolidated. Always preserve a separate working administrator."
---

# TYPO3 backend rights

> Source: https://github.com/dirnbauer/typo3-skills

Build one complete editor group from the live project. Treat permissions as a verified model,
not a copied backend record.

## Contract

1. Identify the TYPO3 installation selected by the user before writing. If several projects could
   be meant, ask which one to use. Apply the approved group model, User TSconfig, and user settings
   to that installation; a permission plan without the requested live/local integration is incomplete.
2. Inventory the current group topology and obtain the explicit group-model decision below before
   consolidating anything. If approved, create or maintain exactly **one user-facing main editor
   group** with four required leaf subgroups: **Base**, **Content**, **Site access**, and
   **Extensions**. If declined, preserve the existing user-facing role separation and audit each
   intended group independently. Never interpret “one group” as permission to delete group rows or
   replace user memberships.
3. Derive rights from installed TCA, existing records, backend modules, configured sites, pages
   marked `is_siteroot`, file mounts, and file storages. Never clone a legacy group without
   auditing every field.
4. Add every configured site root and every non-deleted page marked **Use as Root Page**
   (`pages.is_siteroot = 1`) as a database mount. Use all site languages; in TYPO3 v14 an empty
   `allowed_languages` value means unrestricted access to all current and future site languages.
5. Allow every content type currently used for editorial content. Record every exception with
   its CType and reason.
6. Keep infrastructure content elements such as list/detail renderers, login endpoints, or
   system integration plugins admin-only when editors manage their underlying records instead.
   Decide from the actual record, FlexForm, page purpose, and workflow—not from the CType name
   alone.
7. For every table in `tables_modify`, grant every runtime editor-accessible exclude field. Never
   grant fields hidden with `HIDE_FOR_NON_ADMINS`, a table's `ctrl.editlock` field, or read-only,
   passthrough, generated, or otherwise system-managed fields. Do not present a read-only form as
   successful editing. Plugin placement and domain-record rights remain separate.
8. Make `tables_select` a superset of `tables_modify`. A table used in an editing workflow belongs
   in both lists; select-only access is reserved for a documented lookup or reporting use case.
9. Include every required web mount and every active file mount. Ensure every online, browsable
   file storage is covered by an active file mount and works in Media and record selectors. Do not
   replace real mounts with hard-coded example paths.
10. Allow exactly the installed editor modules defined below, including Forms, Visual Editor, and
    Solr only when present. Allow the MFA providers `totp` and `recovery-codes`.
11. Verify page ownership and permission bits throughout every mounted site tree; DB mounts alone
    do not grant access. Resolve one explicit default owner user and the intended page-owner group.
    In the single-main-group model, use the main group. In the preserved-role model, retain or
    explicitly select the appropriate existing owner group per Site tree without broadening other
    roles. Apply the complete baseline `31/27/1`: owner user `31`, owner group `27`, and everybody
    view-only `1`. Never switch ownership before an enabled non-admin member of that owner group
    passes a login test.
12. Preserve a different enabled, login-capable administrator. Never demote the administrator used
    for the current work or the last remaining administrator. Ask whether each target user's
    existing groups should be appended to or replaced; do not infer a bulk membership cutover.
13. Apply customer branding and the actual TYPO3 application context before and after login using
    supported Core configuration and a small sitepackage stylesheet. Keep it version-controlled.
14. When `typo3/cms-workspaces` is installed, add the safe basic Workspace setup below. Do not
    write stale Workspace permissions or module identifiers when it is absent.

## Decide the group model first

Before proposing a topology, inventory active `be_groups`, direct memberships in
`be_users.usergroup`, inheritance in `be_groups.subgroup`, and material differences in mounts,
languages, modules, tables, fields, Workspaces, and site scope. Show which groups are duplicates,
which encode a real authorization boundary, and which enabled users depend on each group.

Then ask exactly this project-level question and record the answer as evidence:

> Can this project live with one user-facing, non-admin editor group for all normal editors? This
> means one directly assigned main role, with inherited internal Base, Content, Site, and Extensions
> leaves. It is simpler to maintain, but all included editors share the same authorization boundary.

- Recommend **yes** only when normal editors genuinely have the same site, language, module, table,
  field, Workspace, and file scope. A yes answer authorizes building the single-main-group topology;
  it does not authorize deleting legacy groups or changing any user's membership.
- Recommend **no** when the installation has meaningful role separation, limited-site editors,
  translators, publishers, form-only users, agency/customer boundaries, or other least-privilege
  differences. Preserve those roles and repair their rights independently.
- If the user has not answered, stop before group creation, consolidation, membership replacement,
  or page-owner changes. Do not turn convenience into implied authorization.

TYPO3 stores all groups—including the internal leaves—in `be_groups`. Direct group assignments are
stored in `be_users.usergroup`; there is no `be_user_group` table. Therefore “one group” in this
decision means one user-facing main membership, not literally one database row.

The topology decision and the later per-user cutover are separate approvals. Even after a yes,
show every target user's current memberships and ask append-versus-replace for that user.

## Approved single-main-group model

Use this model only after the user answered yes to the project-level question above. Use one flat
inheritance level:

| Group | Owns |
|---|---|
| `<main> · Base` | Core editor modules, page types, all languages, MFA, file operations, User TSconfig |
| `<main> · Content` | Editorial CTypes, Core content/FAL/category tables, and their editor fields |
| `<main> · Site` | Database mounts and file mounts |
| `<main> · Extensions` | Installed extension modules, domain tables, editor fields, and conditional Workspace access |

The main group contains only those subgroup references and remains the page group owner. To add a
website later, attach one new leaf such as `<main> · Site: Example`; to add a separately maintained
extension capability, attach `<main> · Extension: Example`. Do not nest leaves. Preserve additional
leaf groups when regenerating the four required groups. This is a baseline of four, not a permanent
limit of four.

Report the selected installation's DDEV/project name, root, TYPO3 version, and affected group/user
UIDs. Never apply one installation's audited permissions to another installation.

## Preserved-role model

When the answer is no, keep the existing user-facing groups, direct membership intent, and
meaningful inheritance boundaries. Apply the same least-privilege rules in this skill to every
intended role, but evaluate CTypes, fields, tables, modules, mounts, languages, Workspaces, file
operations, page ACLs, and Redirects separately for each group. Do not broaden a narrow group just
because a broader group already has the capability.

Run the read-only audit once per target title and produce a role matrix showing effective and
missing permissions. Do not use `apply-backend-rights.php` to pretend it supports a multi-role
consolidation: that script implements only the approved single-main-group model. Make preserved-role
changes through reviewed TYPO3/DataHandler operations, retain existing UIDs and inheritance unless
an exact change is approved, and verify each materially different role with its own non-admin user.

Every later instruction that says “main group” describes the single-main-group mode. In the
preserved-role mode, apply it only to the selected role when the capability belongs there. Page
ownership still needs one explicit owner group per Site tree; it is never granted to every role.

## Separate permission creation from the live cutover

Treat group configuration, user membership, and page ownership as three distinct operations:

1. Create/update the main group and leaves, then audit their effective permissions.
2. For every named target user, show the current membership and ask whether the main group should
   be **appended** or should **replace** the existing non-admin groups. Preserve unrelated groups
   until the user answers. Set the group-mount inheritance option bits without clearing other bits.
3. Resolve and report the default owner user. Log in as an enabled non-admin target and verify
   modules, page tree, content editing, Media/FAL, language, and selectors. Only then assign that
   user and the main group as owners with the `31/27/1` baseline.
4. Re-audit page ownership and repeat the non-admin test. Keep the prior owner group recoverable
   until the cutover is accepted.

If no enabled non-admin user belongs to the main group, page ownership remediation is blocked even
when the permission model itself is valid. Do not create a temporary editor or guess membership to
make the audit green.

## Audit first

Run the bundled read-only audit inside the project container:

```bash
ddev exec php /dev/stdin --pretty \
  < /absolute/path/to/typo3-backend-rights/scripts/audit-backend-rights.php
```

Add `--group-title='Editorial Main'` to check a target group,
`--owner-username='default-owner'` to verify the resolved page owner, and `--strict` to return
non-zero for blocking findings. Add `--exceptions-plan=/container/path/to/permission-plan.json` to
load the documented exception map used by the group. Read
[permission-model.md](references/permission-model.md) before changing a group or user.

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
   FAL relations/metadata, categories, and the project's editorial domain tables. Require the
   registered Core set `pages`, `tt_content`, `sys_category`, `sys_file`, `sys_file_collection`,
   `sys_file_metadata`, and `sys_file_reference`. When EXT:news is installed, also require its
   registered news, link, and tag tables in both lists.
5. Add every runtime TCA column marked `exclude` that is genuinely editor-editable to
   `non_exclude_fields`. Exclude Core-enforced admin-only and system-managed fields. Report
   unexpected read-only fields instead of overriding them. For editorial records such as news,
   expose the complete editing form apart from those verified exceptions.
6. Use every configured Site root and every page with `is_siteroot = 1` as `db_mountpoints`.
   Include extra storage folders only when the workflow requires them. Use every active
   `sys_filemounts.uid` as `file_mountpoints`, validate each identifier's storage UID against
   `sys_file_storage`, ensure every online browsable storage has an active mount, and grant the
   file operations required by the workflow.
7. Set `allowed_languages` to an empty value for all languages and set `mfa_providers` to
   `totp,recovery-codes`. Recommend TOTP in User TSconfig; requiring MFA is a separate security
   policy and needs an explicit decision.
8. Add the installed minimum modules listed below. Do not grant administration, system
   configuration, Powermail reporting/marketing, Solr index mutation, or infrastructure modules.
9. Include every page type already used below the editor's web mounts. Add unused types only when
   the workflow explicitly needs editors to create them.
10. Audit every page in the deduplicated union of all configured Site trees and every tree marked
    `is_siteroot`. Ensure the approved default user owns it with bits `31`, the main group owns it
    with bits `27`, and everybody has view-only bit `1`. Remediate through the Permissions module
    or DataHandler **after the membership/login cutover gate above passes**. Configure new pages to
    inherit both owners and the same `31/27/1` baseline. Never grant everybody write rights.

## Minimum installed modules

Resolve identifiers from the runtime `ModuleRegistry`; never write identifiers for absent modules.

- Always when installed: `web_layout`, `records`, `page_preview`, `content_status`,
  `web_info_overview`, `web_info_translations`, `recycler`, `media_management`, and `user_setup`.
- Visual Editor: `web_edit`.
- Core Form: `web_FormFormbuilder`, `form_manager`, and `form_editor`.
- Core Redirects: `redirects`. Grant only to named trusted editor groups; it manages redirects across the
  entire installation. Do not grant `qrcodes` or `short_urls` unless separately requested.
- Solr: `searchbackend` and the read-only `searchbackend_info` entry. Keep
  `searchbackend_coreoptimization`, `searchbackend_indexqueue`, and
  `searchbackend_indexadministration` admin-only.
- Workspaces: `workspaces_publish` and Live access bit `workspace_perms = 1` in the **Extensions**
  subgroup.

When `typo3/cms-form` is installed, grant read/write access to `form_definition`; TYPO3 v14.3's
Form persistence permission checker requires both lists even though its TCA display fields are
read-only and the Form modules perform the controlled writes.

When `typo3/cms-redirects` is installed, grant the intended trusted editor group or groups
read/write access to `sys_redirect` and its runtime editor-editable exclude fields. Keep read-only
and system-managed fields excluded. Users inherit this through groups; never write direct per-user
rights.

When Powermail is installed, grant read/write access and every editor-accessible field for
`tx_powermail_domain_model_form`, `tx_powermail_domain_model_page`, and
`tx_powermail_domain_model_field`. Do not grant Powermail mail/answer/marketing tables or any
`web_powermail` / `powermail_*` reporting module by default. Keep the `powermail_pi1` CType as a
documented infrastructure exception so normal editors build forms but do not place or reconfigure
the frontend plugin.

## Use basic Workspaces settings when installed

First confirm that `typo3/cms-workspaces` and its runtime module `workspaces_publish` are installed.
If they are absent, keep `workspace_perms = 0`, do not add the module, and do not create Workspace
records. If present, read [the Workspaces skill](../typo3-workspaces/SKILL.md) and use this baseline:

- Put `workspaces_publish` and Live access bit `workspace_perms = 1` in the **Extensions** leaf.
- Keep the Core default stages. Do not invent review stages, notifications, or scheduled publishing
  for a basic editor role.
- Add the main editor group—not individual users—as a member of the intended custom Workspace.
  Do not make it an owner. Ask who should own and publish before creating a missing Workspace.
- Set `publish_access = 2` so only approved Workspace owners can publish. Do not expose publishing
  controls to normal editors.
- Use the group's audited database and file mounts for the Workspace. Do not grant `sys_workspace`
  table access; its TCA is administrator-only.
- Set `options.workspaces.previewLinkTTLHours = 48` in User TSconfig.

Create or update a custom Workspace through DataHandler, not raw SQL. Adding the group permission
alone does not make the group a custom-Workspace member. Physical FAL files are not versioned:
editors must upload replacements under new unique filenames instead of overwriting a shared file,
and unpublished page content must never be treated as protection for a directly accessible file.

## Configure TSconfig

Keep User TSconfig in the sitepackage and import it from the **Base** subgroup. Copy one bundled profile:

- [basic.tsconfig](assets/tsconfig/basic.tsconfig): page-cache clearing and safe preview access.
- [optimized.tsconfig](assets/tsconfig/optimized.tsconfig): the basic rights plus useful Admin
  Panel sections, file-list actions, resource view, and live-search destinations.

Use the optimized profile by default for trusted content editors. Keep `debug`, `tsdebug`, and
`publish` disabled. Verify the frontend TypoScript has `config.admPanel = 1`; User TSconfig alone
cannot display the Admin Panel.

Both profiles recommend TOTP and make new pages inherit their parent owner user and owner group.
They set owner user `show,edit,delete,new,editcontent` (`31`), owner group
`show,edit,new,editcontent` (`27`), and everybody `show` (`1`). Group page deletion remains off;
the profiles do not force MFA.

Both profiles set `options.workspaces.previewLinkTTLHours = 48`. TYPO3 ignores the option when
Workspaces is absent; it does not grant Workspace access by itself.

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

## Brand the login and backend

Read [backend-branding.md](references/backend-branding.md), derive an accessible action color from
the customer's design tokens/CSS/logo, and configure the Core login logo, logo alt text, highlight,
background, footnote, backend logo, and favicon. Use the plain-text Core footnote for
`Website by webconsulting.at`; TYPO3 already places it at the lower right on wide screens.

Show the exact value of `Environment::getContext()` before login and in the logged-in backend by
adding it to the instance sitename and login footnote. Do not infer the context from the hostname
and do not try to set `TYPO3_CONTEXT` from `additional.php`; it is read earlier during bootstrap.
Use `$GLOBALS['TYPO3_CONF_VARS']['BE']['stylesheets']` for a small sitepackage stylesheet. Do not
override TYPO3's danger/success colors, focus indicators, or structural layout.

## Create the group structure

This section applies only to the approved single-main-group model. Create or update the four
required leaf groups first, then create or update the main group with
their UIDs in `subgroup`. Keep the main group's permission fields empty and each leaf's `subgroup`
empty. Set a descriptive main title such as `Editorial Main` and document:

- the allowed editorial CTypes;
- every excluded infrastructure CType with its reason;
- editable/selectable tables and non-exclude fields;
- backend modules and page types;
- database/file mounts and file operations;
- all-languages mode and both MFA providers;
- page group ownership and permission bits;
- the selected TSconfig profile.

Create the complete structure before changing any user. Do not delete or repurpose old groups until
the main group and all inherited rights have passed verification.

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
transactional insert/update of the main group and four required leaves. It preserves additional
leaf references and never changes users or deletes old groups.

## Change user membership safely

This is a per-user decision, separate from approval of the project-level group model. Ask the user
this explicit question before replacing memberships:

> Should `<main group>` be this backend user's only group?

- If yes, replace that user's group list with the main group.
- If no, append the main group and preserve existing memberships.
- Never assign a user directly to Base, Content, Site, Extensions, or later capability leaves.
- Enable both **Inherit page mounts from groups** and **Inherit file mounts from groups** while
  preserving other user options (`be_users.options |= 3`). Otherwise the Site leaf has no effect.
- If the target user is an administrator, set `admin = 0` only after proving a different enabled,
  login-capable administrator remains.
- Never demote the current working administrator. Use a second account for the editor test.

Changing one user's memberships does not authorize bulk changes to other users.

After the approved membership/login gate, use the bundled DataHandler cutover script to apply the
same default owner and `31/27/1` matrix to every configured or flagged Site tree. Start with a dry
run and name the default owner explicitly; the script never guesses it:

```bash
ddev exec php /dev/stdin --dry-run \
  --group-title='Editorial Main' --owner-username='default-owner' \
  --usernames='editor-one,editor-two' --membership-mode=replace \
  --replace-group-title='Legacy Editors' --apply-pages \
  < /absolute/path/to/scripts/apply-page-permissions.php
```

Run without `--dry-run` only after review. Use `membership-mode=append` for the pre-cutover login
test, then `replace` only when the user approved replacement. The script preserves unrelated group
memberships, sets the two group-mount inheritance bits, deduplicates nested Site roots, and writes
users/pages through DataHandler.

## Verify as a non-admin

Use a real non-admin session and verify all of these:

1. The page tree covers every required web mount.
2. Every used editorial CType can be opened, changed, saved, hidden/unhidden, copied, and created.
3. Each documented infrastructure CType is unavailable for creation and cannot be reconfigured.
4. Editorial records such as news open with every required field and can be saved.
5. Every Site tree is mounted and has the same default owner plus `31/27/1` page baseline, every
   configured site language can be edited, and newly created pages inherit both owners and those
   permissions.
6. Core Forms can be created, edited, duplicated, and saved when installed. Powermail forms, pages,
   and fields can be created and changed when installed, while marketing/reporting modules and the
   frontend plugin remain unavailable.
7. All active file mounts appear in Media and in file selectors; upload, replace, metadata edit,
   move/copy, and delete behave according to the plan.
8. If installed, the Visual Editor module opens and every allowed rendered field can be changed
   and saved; page IDs are present in its editing context and multi-site destinations are clear.
9. If installed, Redirects opens for the named trusted non-admin, who can list, create, follow,
   edit, disable and delete a DDEV-only redirect; cleanup and `redirects:checkintegrity` pass.
10. Preview, Status, Recycler, Media, and the Admin Panel work; page cache clearing is available,
   while debugging, page deletion, Solr index mutation, and
   publishing controls remain unavailable.
11. When Workspaces is installed, the main group can enter the intended custom Workspace, edit and
    preview versioned content, and create a 48-hour preview link, but cannot publish. Confirm the
    group is a member rather than an owner and test file replacement with a new unique filename.
12. TOTP and recovery codes can be configured in User Settings; MFA enforcement matches the
    separately approved policy.
13. Login, password reset, MFA, and the logged-in top bar show the customer identity and exact
    application context with accessible contrast.
14. The separate administrator can still log in.

Re-run the audit with `--group-title` and `--strict`. Report the main and leaf group UIDs, target
user, remaining administrator, allowed/missing CTypes, exceptions, tables, fields, mounts,
TSconfig profile, and the non-admin verification evidence.

## Resources

- [permission-model.md](references/permission-model.md): database field mapping, classification
  rules, and verification queries.
- [backend-branding.md](references/backend-branding.md): supported login/backend branding,
  accessible color selection, application-context display, and verification.
- [typo3-workspaces](../typo3-workspaces/SKILL.md): Workspace versioning, DataHandler setup,
  preview, publishing, and the physical-file limitation.
- `scripts/audit-backend-rights.php`: read-only runtime TCA/database audit.
- `scripts/apply-backend-rights.php`: validate and transactionally create/update the main group
  and four required leaves from a reviewed plan; never changes users.
- `scripts/apply-page-permissions.php`: dry-run/apply the approved membership cutover and complete
  default-owner/main-group/everybody `31/27/1` baseline across all configured Site trees via
  DataHandler.
- `assets/tsconfig/`: basic and optimized User TSconfig templates.
