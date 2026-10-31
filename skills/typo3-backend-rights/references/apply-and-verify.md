# Apply the group, cut over users and pages, verify as a non-admin

Read this reference when the permission plan is reviewed and the group model is approved: before
running `apply-backend-rights.php`, before changing any user's memberships or page ownership, and
before the final non-admin verification.

## Contents

- [Create the group structure](#create-the-group-structure)
- [Change user membership safely](#change-user-membership-safely)
- [Cut over page ownership](#cut-over-page-ownership)
- [Verify as a non-admin](#verify-as-a-non-admin)
- [Report](#report)

## Create the group structure

This section applies only to the approved single-main-group model. Create or update the four
required leaf groups first, then create or update the main group with their UIDs in `subgroup`.
Keep the main group's permission fields empty and each leaf's `subgroup` empty. Set a descriptive
main title such as `Editorial Main` and document:

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
[permission-plan.example.json](../assets/permission-plan.example.json), then apply only the group:

```bash
ddev exec php /dev/stdin --dry-run \
  --plan=/var/www/html/var/transient/backend-rights-plan.json \
  < /absolute/path/to/typo3-backend-rights/scripts/apply-backend-rights.php

ddev exec php /dev/stdin --plan=/var/www/html/var/transient/backend-rights-plan.json \
  < /absolute/path/to/typo3-backend-rights/scripts/apply-backend-rights.php
```

The command validates live CTypes, exception reasons, tables, mounts, and admin presence before a
transactional insert/update of the main group and four required leaves. It preserves additional
leaf references and never changes users or deletes old groups. It resolves group UIDs with a
`SELECT` by unique title after the transaction instead of trusting the driver's last insert ID; if a
run aborts after commit, look the uniquely titled group up before retrying so no duplicate appears.

In the preserved-role model, do not use this script: it implements only the single-main-group
topology. Make the reviewed per-role changes through DataHandler and keep existing UIDs.

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

## Cut over page ownership

Treat group configuration, user membership, and page ownership as three distinct operations:

1. Create/update the main group and leaves, then audit their effective permissions.
2. For every named target user, show the current membership and ask append versus replace.
   Preserve unrelated groups until the user answers.
3. Resolve and report the default owner user. Log in as an enabled non-admin target and verify
   modules, page tree, content editing, Media/FAL, language, and selectors. Only then assign that
   user and the main group as owners with the `31/27/1` baseline.
4. Re-audit page ownership and repeat the non-admin test. Keep the prior owner group recoverable
   until the cutover is accepted.

If no enabled non-admin user belongs to the main group, page ownership remediation is blocked even
when the permission model itself is valid. Do not create a temporary editor or guess membership to
make the audit green.

After the membership/login gate, use the bundled DataHandler cutover script to apply the same
default owner and `31/27/1` matrix to every configured or flagged Site tree. Start with a dry run
and name the default owner explicitly; the script never guesses it:

```bash
ddev exec php /dev/stdin --dry-run \
  --group-title='Editorial Main' --owner-username='default-owner' \
  --usernames='editor-one,editor-two' --membership-mode=replace \
  --replace-group-title='Legacy Editors' --apply-pages \
  < /absolute/path/to/typo3-backend-rights/scripts/apply-page-permissions.php
```

Run without `--dry-run` only after review. Use `--membership-mode=append` for the pre-cutover login
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
    while debugging, page deletion, Solr index mutation, and publishing controls remain unavailable.
11. When Workspaces is installed, the main group can enter the intended custom Workspace, edit and
    preview versioned content, and create a 48-hour preview link, but cannot publish. Confirm the
    group is a member rather than an owner and test file replacement with a new unique filename.
12. TOTP and recovery codes can be configured in User Settings; MFA enforcement matches the
    separately approved policy.
13. Login, password reset, MFA, and the logged-in top bar show the customer identity and the
    environment label mapped from the real application context, with accessible contrast in the
    light and dark scheme; the mapping was evaluated for every context.
14. The separate administrator can still log in.
15. When delegated user management is in scope, the named non-admin manager can complete the
    approved account lifecycle and every forbidden privilege/target/action remains denied in UI
    and direct server-side requests. Follow the
    [delegation proof](delegated-user-management.md#required-proof-in-the-existing-backend-node).

Database evidence does not replace this browser test.

## Report

Re-run the audit with `--group-title` and `--strict`. Report the selected installation (DDEV name,
root, TYPO3 version), the main and leaf group UIDs, target users, the remaining administrator,
allowed/missing CTypes, exceptions, tables, fields, mounts, TSconfig profile, and the non-admin
verification evidence.
