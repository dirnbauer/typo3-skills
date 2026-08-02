# Database integrity during a TYPO3 major upgrade

Schema convergence is not data integrity. A database analyzer can become green while values are
truncated, relations point nowhere, workspace overlays are lost or obsolete columns containing
live data are dropped. Use this playbook around P09 and every destructive cleanup.

## Pre-migration data checks

Inspect source-version assumptions before running schema migrations. Old databases often contain
values that the target type rejects; for example, a nullable legacy `fe_users.image` column may
need an explicit reviewed conversion before it becomes an integer relation counter:

```bash
ddev mysql -N -e "SELECT COUNT(*) FROM fe_users WHERE image IS NULL;"
```

Never turn an observed count into a blind update. Take a snapshot, inspect representative records,
confirm the target semantics and record the exact conversion. Repeat this for every field called
out by the analyzer or migration error.

## Move data before removing its source model

A code registration and its persisted discriminator are one migration. For legacy Extbase plugins,
migrate every live, translated and workspace `tt_content.list_type` value to the target `CType`
**before** enabling CType-only registration or removing the legacy field. A generated wizard is not
proof until its pre-count, affected rows, second idempotent run and post-count are recorded. Registering
the target first can make existing records unrenderable before the wizard gets a chance to fix them.

Likewise, do not trust a wizard's “done” flag as a row audit. Before a source column disappears,
query every non-empty value and compare it with the target representation. Real projects contain
older or manually edited records a previously completed wizard did not cover; `pages.url` on hidden
or link pages is one example. Migrate those exact rows explicitly, rerun the audit at zero, then let
the schema remove the source column.

Content Block schema declarations must match stored nullability. Before changing a generated field
to non-nullable, count existing `NULL` rows and decide whether `NULL`, an empty value or a real default
has the correct semantics. Restore the pre-loop snapshot after a failed schema attempt; do not keep
retrying against a partially migrated database.

## Review all eight schema operation types

Where the project already installs `helhum/typo3-console`, its `database:updateschema` command
classifies changes as:

- `field.add`, `field.change`, `field.prefix`, `field.drop`
- `table.add`, `table.change`, `table.prefix`, `table.drop`

Confirm the available syntax with `ddev typo3 help database:updateschema`; this command is not
TYPO3 Core. Review all eight types in the dry-run output. Applying only add/change can be a safe
intermediate step, but it is not evidence that the final schema is clean.

For every change or removal candidate, record:

```sql
SELECT COUNT(*) AS rows_total FROM table_name;
SELECT COUNT(*) AS populated FROM table_name WHERE column_name IS NOT NULL;
SELECT uid, column_name FROM table_name
 WHERE column_name IS NOT NULL ORDER BY uid LIMIT 20;
```

Adapt the predicate to the field type so empty strings, zero and serialized values are interpreted
correctly. For versioned tables, also count `t3ver_oid`, `t3ver_wsid` and `t3_origuid`; a live-only
sample does not prove workspace safety.

## Stage destructive changes reversibly

Prefix candidates (for example `zzz_deleted_...`) before dropping them where the analyzer or a
reviewed migration supports that workflow. A prefixed field/table is a reversible quarantine:

1. snapshot database and files;
2. record row/population counts and representative values;
3. prefix the candidate and run frontend, backend-write and workspace checks;
4. update the reference index and repeat the checks;
5. request destructive approval for the exact prefixed objects; then
6. drop only those approved objects and prove the analyzer is clean.

Never rename or drop through an ad-hoc wildcard. The snapshot name, object list, evidence and
approval id belong in the loop journal.

## Relations and generated files

After the schema and wizards settle:

```bash
ddev typo3 referenceindex:update
ddev typo3 cleanup:missingrelations --dry-run
ddev typo3 redirects:checkintegrity
```

Read each command's `--help` on the installed version before adding flags. Missing-relation cleanup
can remove managed references and depends on a current reference index; soft references and custom
serialized relations still need manual inspection. Review storage FlexForms after driver changes,
and use the installed cleanup command for obsolete local processed files only after original files,
references and frontend variants have been proved.

## Generated-artifact guard

Commands such as `language:update`, reference-index work and cache warm-up can create or modify
tracked-looking language/runtime files. Immediately run:

```bash
git status --short
git diff --stat
```

Classify each file as a deliberate source/translation update or a disposable runtime artifact.
Do not let a successful database operation smuggle hundreds of generated files into the commit.

## Exit evidence

Close the database work only with a clean analyzer, all eight operation classes reviewed, wizards
resolved, reference index updated, missing relations assessed, workspaces checked where relevant,
and every destructive action tied to a snapshot plus explicit approval.
