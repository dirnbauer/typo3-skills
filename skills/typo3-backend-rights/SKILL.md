---
name: typo3-backend-rights
metadata:
  skill_type: preference
description: "Builds and audits TYPO3 backend editor rights after an explicit choice between one user-facing main group with simple internal leaves or preserving distinct existing roles. Covers CTypes, fields, page ACLs, languages, modules, mounts, MFA, Forms/Powermail, Workspaces, User TSconfig, Visual Editor, Redirects, safe membership cutover, and customer login/backend branding with the Application Context. Use when permissions are missing/read-only, be_groups is incomplete, or legacy roles may be consolidated. Always preserve a separate working administrator."
---

# TYPO3 backend rights

> Source: https://github.com/dirnbauer/typo3-skills

Build complete editor rights from the live project. Treat permissions as a verified model, not a
copied backend record.

## Rules that always hold

- **Keep a separate, enabled, login-capable administrator.** Never demote the administrator used
  for the current work or the last remaining administrator; demote any other admin only after the
  separate one is proven. A lockout costs more than any permission gain.
- **Ask the group-model question before consolidating anything** (below). A yes authorizes the
  single-main-group topology only; it never authorizes deleting groups or changing memberships.
- **Topology, each user's membership, and page ownership are three separate approvals.** For every
  target user, show current memberships and ask append versus replace. Never infer a bulk cutover.
- **Never change page ownership before an enabled non-admin member of the new owner group passes
  a login and editing test.** Changing owners first locks every editor out.
- **One installation at a time.** Identify the TYPO3 installation the user selected; if several
  could be meant, ask. Apply the plan there and report its DDEV name, root, TYPO3 version and the
  affected group/user UIDs. Never reuse one installation's audited rights on another. A permission
  plan without the requested integration is incomplete.
- **An empty CType allow-list is a defect, not "allow everything".** `tt_content.CType` uses
  `authMode = explicitAllow`; each used editorial CType needs `tt_content:CType:<value>`.
- **Never grant** `HIDE_FOR_NON_ADMINS` fields, `ctrl.editlock`, read-only/passthrough/generated
  fields, admin-only tables, page deletion for the group, administration modules, or identifiers
  of modules that are not installed. Do not present a read-only form as successful editing.
- **Write through the bundled scripts or DataHandler**, dry run first. Hand-written SQL for pages,
  users or Workspaces is forbidden: it skips validation, history and the reference index. The
  bundled group script writes `be_groups` through the Connection API by design (the CLI has no
  DataHandler backend-user context), so the workflow runs `referenceindex:update` afterwards.

## Decide the group model first

Inventory active `be_groups`, direct memberships in `be_users.usergroup`, inheritance in
`be_groups.subgroup`, and material differences in mounts, languages, modules, tables, fields,
Workspaces, and site scope. Show which groups are duplicates, which encode a real authorization
boundary, and which enabled users depend on each group.

Then ask exactly this project-level question and record the answer as evidence:

> Can this project live with one user-facing, non-admin editor group for all normal editors? This
> means one directly assigned main role, with inherited internal Base, Content, Site, and Extensions
> leaves. It is simpler to maintain, but all included editors share the same authorization boundary.

- Recommend **yes** only when normal editors genuinely share site, language, module, table, field,
  Workspace, and file scope.
- Recommend **no** when the installation has meaningful role separation: limited-site editors,
  translators, publishers, form-only users, agency/customer boundaries, or other least-privilege
  differences. Preserve those roles and repair their rights independently.
- Without an answer, stop before group creation, consolidation, membership replacement, or
  page-owner changes. Convenience is not implied authorization.

TYPO3 stores all groups, including the internal leaves, in `be_groups`; direct assignments live in
`be_users.usergroup`. There is no `be_user_group` table. "One group" means one user-facing main
membership, not one database row.

### Approved single-main-group model

Use one flat inheritance level:

| Group | Owns |
|---|---|
| `<main> · Base` | Core editor modules, page types, all languages, MFA, file operations, User TSconfig |
| `<main> · Content` | Editorial CTypes, Core content/FAL/category tables, and their editor fields |
| `<main> · Site` | Database mounts and file mounts |
| `<main> · Extensions` | Installed extension modules, domain tables, editor fields, and conditional Workspace access |

The main group holds only the subgroup references and is the page group owner. A later website gets
one new leaf such as `<main> · Site: Example`; a separately maintained extension capability gets
`<main> · Extension: Example`. Do not nest leaves. Preserve extra leaves when regenerating the
four required ones: four is a baseline, not a limit.

### Preserved-role model

When the answer is no, keep the existing user-facing groups, membership intent, and meaningful
inheritance. Apply every rule of this skill per intended role, evaluating CTypes, fields, tables,
modules, mounts, languages, Workspaces, file operations, page ACLs, and Redirects separately. Do
not broaden a narrow group because a broader group has the capability. Run the audit once per role
title and produce a role matrix of effective and missing permissions. `apply-backend-rights.php`
implements only the single-main-group model; make preserved-role changes through reviewed
DataHandler operations, keep UIDs and inheritance unless a change is approved, and verify each
materially different role with its own non-admin user. "Main group" below means the selected role
in this mode. Page ownership still needs one explicit owner group per Site tree, never every role.

## Derive the rights from the installation

1. Run the read-only audit inside the project container and read
   [permission-model.md](references/permission-model.md) before changing a group or user:

   ```bash
   ddev exec php /dev/stdin --pretty \
     < /absolute/path/to/typo3-backend-rights/scripts/audit-backend-rights.php
   ```

   `--group-title='Editorial Main'` checks a target group, `--owner-username='default-owner'` the
   resolved page owner, `--exceptions-plan=/container/path/permission-plan.json` loads the
   documented exceptions (or `--exceptions-json='{"<CType>": "<reason>"}'` inline; the two are
   mutually exclusive and the script exits 64 if both are given), and `--strict` returns non-zero
   for blocking findings.
2. Inventory enabled backend users, their groups and administrators; name the working
   administrator and the separate one that remains.
3. Inventory distinct non-deleted `tt_content.CType` values, hidden records included. Classify each
   as **editorial** (add to `explicit_allowdeny`) or **infrastructure** (omit, record CType, reason
   and owner). Decide from the record, FlexForm, page purpose and workflow, not the CType name:
   list/detail renderers, login endpoints and integration plugins usually stay admin-only while
   editors manage their underlying records.
4. Tables: `tables_select` is a superset of `tables_modify`. Require `pages`, `tt_content`,
   `sys_category`, `sys_file`, `sys_file_collection`, `sys_file_metadata`, `sys_file_reference`, the
   project's editorial domain tables and their inline child tables; with EXT:news its news, link
   and tag tables. Core Form needs `form_definition` in both lists (the 14.3 Form persistence check
   requires it). Powermail: form, page and field tables only; `powermail_pi1` stays a documented
   infrastructure exception and mail/answer tables stay out.
5. Fields: grant every runtime editor-editable exclude field of each `tables_modify` table in
   `non_exclude_fields`; report unexpected read-only fields instead of overriding TCA.
6. Mounts: every configured Site root plus every non-deleted page with `is_siteroot = 1` as
   `db_mountpoints`; every active `sys_filemounts` UID as `file_mountpoints`, and every online
   browsable storage covered by an active mount. No hard-coded example paths.
7. Languages and MFA: `allowed_languages` empty (all current and future languages in v14),
   `mfa_providers = totp,recovery-codes`. Requiring MFA is a separate, explicit security decision.
8. Modules: the installed editor modules from the
   [module baseline](references/permission-model.md#module-baseline), including Forms, Visual
   Editor, Redirects (named trusted groups only, installation-wide) and the read-only Solr view.
9. Page types: those already used below the mounts; add others only when the workflow needs them.
10. Page ACLs: DB mounts alone do not grant access. Resolve one explicit default owner user and the
    owner group, then apply owner user `31`, owner group `27`, everybody view-only `1` to the
    deduplicated union of all Site trees, and make new pages inherit it. Never give everybody write
    rights. Details: [page group permissions](references/permission-model.md#page-group-permissions).

## Apply, cut over, verify

Read [apply-and-verify.md](references/apply-and-verify.md) before running a writing script. In
order: create the complete group structure (`apply-backend-rights.php`, dry run first; it never
touches users), ask append versus replace per user, set `be_users.options |= 3` without clearing
other bits, test a real non-admin login, only then cut over page ownership
(`apply-page-permissions.php`, dry run first), and finish with the non-admin checklist and a
`--strict` re-audit. Keep the legacy owner group recoverable until the cutover is accepted. Do not
create a temporary editor or guess membership to make the audit green.

## Conditional integrations

- **Workspaces:** only when `typo3/cms-workspaces` and `workspaces_publish` are registered; otherwise
  `workspace_perms = 0`, no module, no Workspace record. Read [typo3-workspaces](../typo3-workspaces/SKILL.md)
  and the [Workspaces baseline](references/permission-model.md#workspaces-baseline): Live bit and
  module in the Extensions leaf, main group as member not owner, `publish_access` bit 2 set (owners only), default
  stages, `options.workspaces.previewLinkTTLHours = 48`, no `sys_workspace` table access. Ask who
  owns and publishes before creating a missing Workspace. Physical FAL files are not versioned:
  replacements need new unique filenames.
- **User TSconfig:** import one bundled profile from the sitepackage in the Base leaf; use the
  optimized profile by default for trusted content editors
  ([profiles](references/permission-model.md#user-tsconfig-profiles)). Keep `debug`, `tsdebug` and
  `publish` off; the Admin Panel also needs `config.admPanel = 1` in frontend TypoScript.
- **Visual Editor:** grant `web_edit` and set `options.pageTree.showPageIdWithTitle = 1` (plus
  `showDomainNameWithTitle = 1` on multi-site). These are presentation options; each rendered field
  still needs mount, language, `tables_modify`, `non_exclude_fields` and CType rights.
  `admPanel.enable.edit` is not Visual Editor access.
- **Delegated Benutzerverwaltung** (whole-site upgrades or on request): follow
  [delegated-user-management.md](references/delegated-user-management.md). Managers stay non-admin,
  manage only approved accounts within permitted groups, and pass server-side privilege-denial
  tests; verify a compatible package or fork. Never grant blanket admin rights.

## Brand the login and backend

Read [backend-branding.md](references/backend-branding.md). Keep three fixed environment colour
families (green Live, orange Staging, blue DDEV); derive motifs and logos from the current
customer's site. Configure Core logo/alt/highlight, three calm login backgrounds, backend logo and
favicon, and the footnote `<customer> · <label> · Website von webconsulting.at`, through supported
Core configuration and a small sitepackage stylesheet in `$GLOBALS['TYPO3_CONF_VARS']['BE']['stylesheets']`.

Map the real `Environment::getContext()` once: any context whose top level is `Development` →
`Entwicklung (DDEV)` (Core knows only the roots `Development`, `Testing` and `Production`; the
sub-context such as `Development/Docker` is the project's own value from `.ddev/config.yaml`),
`Production/Staging` → `Staging`, `Production` or `Production/Live` → `Live`, anything else → a
readable context name. Show the label in the footnote and sitename; never print the raw context
string. Fail closed: a release on the staging deploy path is labelled Staging even when its context
claims production. Do not infer the context from the hostname or set `TYPO3_CONTEXT` in
`additional.php` (it is read earlier in bootstrap). Do not override TYPO3's status colours, focus
indicators or layout. Verify the login page in light and dark scheme and every simulated context.

## Gotchas

- An empty `explicit_allowdeny` looked unrestricted and blocked every protected CType (2026-08-02).
- During a live migration, page owners were switched to a new group no editor belonged to yet.
- A group insert committed, then the UID lookup crashed; a blind retry would duplicate the group.
  Look the uniquely titled group up first; the apply script resolves UIDs with a `SELECT`.

## Resources

- [permission-model.md](references/permission-model.md): field mapping, CType classification,
  exclude fields, mounts, page ACLs, modules, Workspaces, TSconfig profiles, verification SQL.
  Load before planning or changing a group.
- [apply-and-verify.md](references/apply-and-verify.md): group creation, membership questions,
  page cutover commands, the non-admin checklist and the report. Load before any write.
- [backend-branding.md](references/backend-branding.md): login/backend branding and the context
  mapping. Load for branding work.
- [delegated-user-management.md](references/delegated-user-management.md): non-admin user managers.
  Load when Benutzerverwaltung is in scope.
- `scripts/audit-backend-rights.php` (run, read-only), `scripts/apply-backend-rights.php` (run,
  group only), `scripts/apply-page-permissions.php` (run, membership and page cutover),
  `assets/tsconfig/` and `assets/permission-plan.example.json` (copy and adapt).
