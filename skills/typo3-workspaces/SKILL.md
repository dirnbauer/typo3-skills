---
name: "typo3-workspaces"
description: "Lets TYPO3 editors prepare and hold finished content before it goes live, then stage, review and publish it. Use when finished work must wait for a launch, when previewing unpublished work returns the already-published page, when publishing loses file references, when your own code must query records so drafts resolve correctly, or when working with workspace overlays, versioning, staging, permissions, review workflows and workspace-specific bugs."
compatibility: "TYPO3 14.x"
metadata:
  skill_type: preference
  version: "2.1.0"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---
# TYPO3 Workspaces

> Source: https://github.com/dirnbauer/webconsulting-skills

Workspaces let editors prepare, review and publish content without touching the live site. Code
examples target TYPO3 v14; workspace API facts were checked against `typo3/cms-workspaces` 14.3.10.

## Rules

- **Files are not versioned.** An uploaded or overwritten file in `fileadmin/` is live in every
  workspace at once. Upload new files under new, non-guessable names instead of overwriting, and
  never rely on "not published yet" to keep a document confidential. See section 2.
- **Folder-based file collections show the live folder.** Prefer static collections when workspace
  isolation matters. See section 2a.
- **Query so drafts resolve.** Backend code applies `BackendUtility::workspaceOL()`, frontend code
  relies on `WorkspaceRestriction` plus `PageRepository::versionOL()`; load the query migration
  reference before changing a repository or QueryBuilder call.
- **Publish and discard through DataHandler**: the `version` command with `action => 'publish'`
  and `swapWith` set to the workspace version uid, or the v14 `discard` command on the versioned uid.
  Never move workspace rows by SQL.
- **Set `versioningWS` explicitly on every table that editors change in a workspace**, inline child
  tables included (#106821: a missing flag on a child table logs a deprecation now and becomes a
  hard requirement in v15).
- **`versioningWS_alwaysAllowLiveEdit` only works on tables without `versioningWS`.** Since a 14.3 patch
  after 14.3.7 (#106077, present in 14.3.9) the combination is removed during TCA migration with a deprecation entry, and records of
  workspace-aware tables are always versioned.
- **Grant LIVE workspace access explicitly** to the users and groups that need it; it is not
  implied.

## 1. Core Concepts

### What Are Workspaces?

Workspaces allow editors to prepare content changes **without affecting the live website**. Changes go through a configurable review process before publication.

There are two types:

- **LIVE workspace** (ID=0): The default state. Every change is immediately visible. Access is granted explicitly to backend users or groups.
- **Custom workspaces** (ID>0): Safe editing environments. Changes are versioned, previewable, and go through stages before going live.

### How Versioning Works (Database Level)

Offline (workspace) versions live in the **same database table** as live records. They are identified by:

| Field | Purpose |
|-------|---------|
| `t3ver_oid` | Points to the live record's `uid` (0 for live records and workspace-new records) |
| `t3ver_wsid` | Workspace ID this version belongs to (0 for live) |
| `t3ver_state` | Special state flags (see below) |
| `t3ver_stage` | Workflow stage (0=editing, -10=ready to publish) |
| `pid` | Real page ID (same as the live record's pid) |

> **Note:** Before TYPO3 v10.4, offline versions had `pid = -1`. Since v10.4 (Important #89555, "Workspace-related database records contain the proper Page ID"), workspace records store their **real pid**; the separate v11 change (Breaking #92497) removed move placeholders. If you encounter `pid = -1` in legacy code or documentation, it is outdated.

**t3ver_state values (TYPO3 v14):**

| Value | Meaning |
|-------|---------|
| `0` | Default: workspace modification of existing live record |
| `1` | New record created exclusively in workspace (no live counterpart) |
| `2` | Delete placeholder (record marked for deletion upon publish) |
| `4` | Move pointer (record to be moved upon publish, stores new pid/sorting) |

> **Removed in v11:** `t3ver_state = -1` (old "new version" pendant), `t3ver_state = 3` (old "move placeholder"), and the `t3ver_move_id` field. If you see these values in legacy code, they are not used on TYPO3 v14.

### The Overlay Mechanism

TYPO3 **always fetches live records first**, then overlays workspace versions on top. For translations with workspaces, the chain is:

1. Fetch default language, live record (language=0, workspace=0)
2. Overlay workspace version (search for `t3ver_oid=<uid>` AND `t3ver_wsid=<current_ws>`)
3. Overlay language translation (search for `l10n_parent=<uid>` in target language)
4. Overlay workspace version of translation

The `uid` of the live record is **always preserved** during overlay -- this keeps all references and links intact.

### Publishing Workflow

- **Publish**: Draft content replaces live content through the workspace publish process.
- TYPO3 v14 still accepts DataHandler `version` commands with **`action => 'publish'`** (preferred) or **`action => 'swap'`** (alias handled the same as publish in `DataHandlerHook`). The parameter key for the workspace version UID remains **`swapWith`**, not `uid`.
- Do not rely on historic **bidirectional workspace “swap modes”** on `sys_workspace` (removed in v11, #92206) — that is separate from the `swap` **keyword** in cmdmaps.

## 2. File/FAL limitation

> **Files (FAL) are not versioned.** This is the most consequential limitation of TYPO3 Workspaces.
> See also Section 2a below for the additional **file collection** limitation (folder-based collections).

### What This Means

- Files in `fileadmin/` live exclusively in the **LIVE workspace**
- If you **overwrite** a file, the change affects **ALL workspaces immediately**
- `sys_file_reference` records are workspace-versioned; physical files and `sys_file` records are not versioned like content overlays
- Replacing files inside existing references can still have edge cases in workspace previews; test on your exact TYPO3 minor and prefer new filenames over in-place replacement when possible.

### The Predictable Filename Security Problem

**Scenario:** An editor creates a workspace version of a page replacing `geschaeftsbericht2024.pdf` with `geschaeftsbericht2025.pdf`. The workspace is not published yet. However:

1. The new PDF is uploaded to `fileadmin/` immediately (files are live!)
2. An external person guesses the URL by incrementing the year
3. `geschaeftsbericht2025.pdf` is accessible before the content element referencing it is published

This is a **real security/confidentiality risk**.

### Workarounds

**1. Use non-guessable filenames:**

```
# Instead of:
fileadmin/reports/geschaeftsbericht2025.pdf

# Use hashed/random names:
fileadmin/reports/gb-a8f3e2b1c9d4.pdf
```

**2. Store confidential files outside the web root:**

```php
// config/system/settings.php
// Use a private storage that is not publicly accessible
// Deliver files programmatically via a controller
```

**3. Use EXT:secure_downloads (leuchtfeuer/secure-downloads):**

Files are delivered through a PHP script that checks access permissions. No direct file URL access.

**4. Server-level protection for sensitive directories:**

```apache
# Apache (.htaccess in a subdirectory)
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
```

```nginx
# NGINX
location /fileadmin/confidential/ {
    deny all;
    return 403;
}
```

**5. Use separate file references per workspace version:**

Upload the new file with a different name instead of overwriting the existing file. The workspace version of the content element references the new file, the live version keeps the old one. Upon publishing, both files exist but only the new one is referenced.

### Rules for Workspace-Safe File Handling

- Do not overwrite files that content elements use: the change reaches every workspace and live at once.
- Upload new files with unique names when preparing workspace content.
- Do not rely on "the page is not published yet" to protect a file: its URL is reachable on upload.
- Use EXT:secure_downloads (or a non-public storage) for confidential documents.
- Audit `fileadmin/` for files with predictable naming patterns.

## 2a. File Collections and Workspaces

> **File collections (`sys_file_collection`) are workspace-versioned at the record level, but folder-based collections resolve files from the live filesystem at runtime -- there is no database relation to overlay.**

### How File Collections Work

`sys_file_collection` stores three collection types, distinguished by the `type` field:

| `type` value | Resolution mechanism | Database relations involved |
|---|---|---|
| `static` (0) | `sys_file_reference` rows (`tablenames='sys_file_collection'`, `fieldname='files'`) | One `sys_file_reference` row per file |
| `folder` (1) | `folder_identifier` string (e.g. `1:/user_upload/gallery/`) | None -- no join table, no reference rows |
| `category` (2) | `category` uid resolved via `sys_category_record_mm` | MM table (handled via parent record overlay) |

The TCA for `sys_file_collection` has `versioningWS => true`. This means the **collection record itself** gets workspace versions with `t3ver_*` fields. However, the record-level versioning only versions the fields stored in `sys_file_collection` -- it does **not** version the files that the collection resolves.

### Workspace Safety per Collection Type

| Collection Type | Record versioned? | File binding versioned? | Physical files versioned? | Workspace-safe? |
|---|---|---|---|---|
| **Static** | Yes | Yes (`sys_file_reference` has `versioningWS = true`) | No | Partially safe |
| **Folder-based** | Yes (record only) | No -- no DB binding exists | No | **Not safe** |
| **Category-based** | Yes | Partially (category MM handled via parent overlay) | No | Partially safe |

### Why Folder-Based Collections Break Workspace Isolation

For folder-based collections, the "relation" between the collection and its files is **not a database relation**. The collection record stores only a `folder_identifier` string. When `FolderBasedFileCollection::loadContents()` is called, TYPO3 calls `$storage->getFilesInFolder()` to list files directly from the live storage driver. There is no overlay-capable database row between the collection and its files.

**Consequences:**

- Adding a file to the folder makes it visible in **all workspaces** immediately
- Removing a file from the folder removes it from **all workspaces** immediately
- Changing the `folder_identifier` field in a workspace version points to a different folder, but the folder contents themselves are always live
- The "File links" content element (`CType=uploads`) using a folder-based collection will show different files than intended during workspace preview if the folder contents changed after the workspace version was created

### Static Collections Are Safer

Static collections (`type=static`) bind files via `sys_file_reference` rows. Both `sys_file_collection` and `sys_file_reference` have `versioningWS = true`. When you add or remove a file from a static collection inside a workspace, TYPO3 creates workspace versions of the `sys_file_reference` rows. The binding between collection and file is versioned.

The remaining limitation: physical files (`sys_file`) are still not versioned (see Section 2). If you overwrite a file, it changes everywhere.

### Workarounds for Folder-Based Collections

**1. Prefer static collections when workspace isolation matters:**

Use `type=static` instead of `type=folder`. The file-to-collection binding is a `sys_file_reference` row, which is workspace-versioned.

**2. Use separate folders per workspace version:**

For folder-based collections, create a new folder for the workspace change (e.g. `gallery-v2/`) and change the `folder_identifier` in the workspace version of the collection record. The live version still points to the original folder.

**3. Leave shared folder contents unchanged while workspace drafts reference them:**

If a folder-based collection is used in workspace content, avoid adding or removing files from that folder until the workspace is published.

**4. Clean up old folders after publishing:**

Use `AfterRecordPublishedEvent` to remove obsolete folders after the workspace version is published:

```php
<?php

declare(strict_types=1);

namespace MyVendor\MyExtension\EventListener;

use TYPO3\CMS\Core\Attribute\AsEventListener;
use TYPO3\CMS\Core\Resource\StorageRepository;
use TYPO3\CMS\Workspaces\Event\AfterRecordPublishedEvent;

#[AsEventListener]
final class CleanupOldCollectionFolderListener
{
    public function __construct(
        private readonly StorageRepository $storageRepository,
    ) {}

    public function __invoke(AfterRecordPublishedEvent $event): void
    {
        if ($event->getTable() !== 'sys_file_collection') {
            return;
        }

        // After publishing a folder-based collection, remove the old folder
        // if it is no longer referenced by any collection.
        // Implementation depends on your naming convention (e.g. gallery-v1/, gallery-v2/).
    }
}
```

### Rules for Workspace-Safe File Collections

- Prefer static collections (`type=static`) over folder-based ones when workspaces are used.
- Do not add or remove files in a folder that a folder-based collection in an unpublished workspace references; the change is live immediately.
- Use separate folders per workspace version if folder-based collections are required.
- Tell editors that folder-based collections show live folder contents regardless of workspace state.
- Test file collection behavior in workspace preview before relying on it for editorial workflows.

## 3. Installation & Setup Checklist

### Installation

```bash
# Composer (TYPO3 v14)
composer require typo3/cms-workspaces

# Non-Composer: activate in Admin Tools > Extensions
```

### Complete Setup Checklist

Use this checklist to verify your workspace setup is complete:

#### Extension & System

- [ ] `typo3/cms-workspaces` is installed and activated
- [ ] Database schema is up to date (`bin/typo3 extension:setup` or your project's equivalent schema-update wrapper)
- [ ] `typo3/cms-scheduler` is installed (required for auto-publish)
- [ ] Scheduler cron job is configured on server

#### Backend User Groups

- [ ] Workspace-specific backend user group created (e.g., "Workspace Editors")
- [ ] Group has **explicit LIVE workspace access** (Mounts and Workspaces tab > "Live" checkbox)
- [ ] Group has access to the custom workspace (assigned as owner or member in workspace record)
- [ ] DB mounts are set correctly (pages the group can edit)
- [ ] File mounts are set correctly (directories the group can access)
- [ ] Group has `tables_modify` permissions for all relevant tables
- [ ] Group has permissions on page types the workspace will contain

#### Backend Users

- [ ] Users are assigned to the workspace user group
- [ ] Users can see the workspace selector in the **backend sidebar** (v14.2+; earlier v14 builds may still show it in the top bar)
- [ ] Non-admin users have LIVE workspace access only if they need it

#### Workspace Record

- [ ] Workspace record created as System Record on root page (pid=0)
- [ ] Title and description set
- [ ] **Owners** assigned (use groups, not individual users)
- [ ] **Members** assigned (use groups, not individual users)
- [ ] Custom stages created if needed (between "Editing" and "Ready to publish")
- [ ] Notification settings configured per stage
- [ ] Mountpoints set if workspace should be restricted to specific page trees
- [ ] Publish date set if auto-publish is desired
- [ ] "Publish access" configured (restrict publishing to owners if needed)

#### Tables (TCA)

- [ ] All custom extension tables have `'versioningWS' => true` in `$GLOBALS['TCA'][<table>]['ctrl']`
- [ ] Tables that stay unversioned have `'versioningWS' => false`
- [ ] Unversioned tables that editors change while in a workspace have `'versioningWS_alwaysAllowLiveEdit' => true` (ignored on tables with `versioningWS` from 14.3.9 at the latest, #106077)
- [ ] `t3ver_*` database columns exist (auto-created when `versioningWS = true`)

> **Inline / IRRE child tables (Deprecation [#106821](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Deprecation-106821-WorkspaceAwareInlineChildTablesAreEnforced.html)):** If `versioningWS` is missing on a child table, Core **logs a deprecation** and may **auto-add** the flag at TCA build time — it does **not** throw a hard error. Set the flag explicitly in TCA; it will become a **hard requirement in v15**.

#### Scheduler Tasks

- [ ] "Execute console commands" task running `workspace:autopublish` created and enabled (or a cron entry for `vendor/bin/typo3 workspace:autopublish`)
- [ ] "Execute console commands" task running `cleanup:previewlinks` created and enabled
- [ ] Cron frequency is appropriate (e.g., every 15 minutes); `typo3-scheduler-jobs` owns the full Scheduler setup

#### TSconfig

- [ ] `options.workspaces.previewLinkTTLHours` set (default: 48)
- [ ] `options.workspaces.allowed_languages.<wsId>` set if language restrictions needed
- [ ] `workspaces.splitPreviewModes` configured if preview modes should be limited
- [ ] `options.workspaces.previewPageId` set for custom record preview pages


## References

Load only the file the current task needs:

- [Migrating queries to workspace-aware queries](references/06-migrating-queries-without-workspaces-to-with-workspaces.md):
  when your own QueryBuilder, Extbase or legacy query must return drafts correctly.
- [Making extensions workspace-compatible](references/05-making-extensions-workspace-compatible.md):
  when adding workspace support to custom tables, backend modules or plugins.
- [Debugging and troubleshooting](references/08-debugging-and-troubleshooting.md) and the
  [diagnostics and repair playbook](references/09a-workspace-diagnostics-and-repair-playbook.md):
  when a preview shows live content, publishing loses references or workspace rows look broken.
- [DataHandler setup script](references/04-datahandler-setup-script.md): when creating workspaces,
  stages or test data from code.
- [Translations with workspaces](references/07-translations-with-workspaces.md): when localized
  records are drafted, previewed or published.
- [Testing workspace support](references/09-testing-workspace-support.md): when writing functional
  tests for workspace behavior.
- [PSR-14 events reference](references/11-psr-14-events-reference.md): when hooking into publishing,
  previews or the Workspaces module.
- [v14-only changes](references/v14-only-changes.md): when code written for v12 or v13 meets v14
  workspace changes.
- [Best practices](references/10-best-practices.md) and [related skills](references/related-skills.md):
  when planning an editorial workflow or routing to a sibling skill.
- [Credits, attribution and sources](references/credits-and-attribution.md): when citing the 17
  documentation pages, advisories and Forge issues this skill is based on.
