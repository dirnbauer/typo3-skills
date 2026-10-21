# Benutzerverwaltung for non-admin backend users

Owner preference, 2026-10-21: include delegated backend user management in whole-site upgrades,
following the capability used on the reference site. This is **backend** users, not frontend
accounts, and does not mean giving every editor administrator powers.

## Select the implementation without guessing compatibility

1. Inspect installed Core/user-management capabilities first. Prefer the existing compatible
   `my_user_management` integration (`koninklijke-collective/my-user-management`) for this requested
   module; do not build a second account manager. Resolve the latest stable compatible release
   from authoritative metadata and verify its installed APIs and permission enforcement.
2. Do not confuse a project's path-repository version with an upstream release. On 2026-10-21,
   [public Packagist metadata](https://packagist.org/packages/koninklijke-collective/my-user-management.json)
   reported 116,369 total / 827 monthly downloads, but its default development branch required
   Core `^13.4`. The inspected reference copy called itself `10.0.2`, declared `^14.3`, and carried
   local compatibility/security changes. It is **not evidence of a public stable v14 package**.
3. If upstream still cannot satisfy the target, present a reviewed reproducible fork/patch plan,
   exact source revision/hash, licence/provenance, compatibility tests, maintainer and removal
   condition. Preserve upstream LGPL notices and thanks to Koninklijke Collective and contributors.
   No unrecorded `vendor/` edits, fake constraints or copied credentials/customer configuration.
   Publication, if separately authorized, follows the collection's GitLab/dirnbauer-only policy.

## Seal the delegation boundary

Inventory the current roles first. Ask in the existing intake decision round which non-admin
role(s) may manage which groups/accounts and which actions they need. Keep this as an explicit
capability in the approved group model; do not consolidate distinct roles to make delegation easier.
Keep manager-only rights out of the common editor leaf unless every member is explicitly approved.
The bundled group builder does not install the package or configure its authorization adapter.
Review its dry-run against existing delegated rights; do not let regenerating the base editor role
silently remove or broaden a separately maintained manager capability.

- Managers remain `admin = 0`; preserve a different enabled, tested administrator. Never demote
  the working/last administrator as part of module setup.
- Derive the module identifiers and extension-specific action/group options from the installed
  package. Grant only the selected user-management surface; group/file-mount administration,
  impersonation, session termination, resets and deletion need their own approved scope.
- Allow only non-admin accounts wholly within the approved managed-group set. Protect service/CLI
  and administrator accounts, accounts with foreign memberships, and the manager's own continuing
  access. An empty managed-group allowlist means **deny**, never every group.
- Enforce the boundary server-side for native FormEngine, DataHandler data/command maps and any
  module/controller endpoint. Hiding fields/buttons is insufficient. Prevent writes to `admin`,
  arbitrary TSconfig, direct mounts, unapproved groups/options and other privilege-bearing fields.
  Do not grant unrestricted `be_users`/`be_groups` editing to make a menu appear.
- Preserve existing foreign memberships on read/display; do not silently remove them when a form
  opens or saves. On TYPO3 14 verify selectors use named `label`/`value`/`icon` items. A local adapter
  needs tests for permitted, empty, foreign and legacy inputs—not a global fallback to all choices.

## Required proof in the existing backend node

Use approved disposable local accounts, a snapshot and intercepted mail. Verify as the named
non-admin manager: list only authorized targets; create a disabled test account with an allowed
group and inherited mounts; edit and reopen it; perform only the approved lifecycle actions.

Then attempt forbidden direct requests as that same actor. Prove no database change for admin
promotion, an administrator target, foreign groups, direct mounts/TSconfig, group/file-mount edits,
protected service accounts and unauthorized reset/session/impersonation/delete actions. Prove that
self-disable/delete or losing one's own last permitted membership cannot lock the manager out.
Retain failures and teardown verification. Do not send real account invitations or reset emails.

Return actual command/exit codes, actor class, target scope and assertion results under
`backend-editor` / `delegated-user-management`; redact account data. Unit selector tests alone do
not prove authenticated authorization. Missing sign-in or unresolved package compatibility remains
pending/blocked, not silently not-applicable. Use the orchestrator's login protocol and retry budget.

Evidence basis: reference-site `IMPORT.md`, `EditorialUserGuard.php` and
`test/editor-user-management.php`, read on 2026-10-21; source and tests inspected, not executed here.
The reusable contract above is deliberately stronger than copying one project's guard verbatim.
