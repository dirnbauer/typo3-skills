# Rollback

The loop protocol says "restore the snapshot, fix the cause, rerun". That instruction is only safe
if the restore actually returns the whole system to a bootable state — and a database snapshot on
its own does not.

## Why a snapshot is not a rollback

`ddev snapshot` restores **the database only**. An upgrade rung changes three things that move
together:

| What changes | Restored by `ddev snapshot`? |
|---|---|
| Database schema and rows | yes |
| `vendor/`, `composer.lock`, extension code, configuration | **no** |
| `fileadmin` and other file storages | **no** |

Restoring `loop-140-pre` after a failed 14.3 wizard therefore puts a v12/v13 database underneath a
v14 `vendor/` tree. The install does not boot, and the run has no documented way back.

## The three anchors, taken together

Before the first change (P01) and before every schema change, wizard run or data migration:

```bash
# 1. database
ddev snapshot --name <loop>-pre
ddev export-db > ../<project>-<loop>-pre.sql.gz     # outside the container

# 2. code — a commit or tag is the anchor; note the SHA in snapshots.json
git rev-parse HEAD

# 3. files — only when the step can touch FAL
tar czf ../<project>-<loop>-pre-fileadmin.tar.gz fileadmin/
```

Record all three identifiers in `manifests/snapshots.json` as one entry. An anchor whose three parts
are recorded separately invites restoring two of them.

## Restoring

Restore in the same order, all three or none:

```bash
git checkout <sha>            # or: git checkout <branch> && composer install
ddev composer install         # rebuild vendor/ to match the lockfile at that SHA
ddev snapshot restore <name>
tar xzf ../<project>-<loop>-pre-fileadmin.tar.gz   # only if files were archived
ddev typo3 cache:flush
```

Then re-verify the baseline (`t3u verify-baseline`) before drawing any conclusion from a comparison.

## Files are the irreversible part

Wizards and extension migrations that move, rename or reprocess FAL files cannot be undone by a
database restore, and mutating files after `seal-baseline` changes the content fingerprint — which
makes every later loop `INVALID` with no way back to a valid measurement. So:

- Archive file storages **before** any step that can touch them, not after.
- Never "tidy" `fileadmin` mid-run. If files must change, that is a declared change with an
  approval, and the baseline consequences are decided before the change, not discovered after it.
- Storages on remote drivers cannot be archived this way. Decide at P00 whether they are in scope;
  if they are not, they belong in the coverage declaration as untested.

## When rollback is not the answer

Rolling back repeatedly is a signal, not a strategy. If the same rung fails twice for different
reasons, stop and escalate rather than restoring a third time — the loop protocol's abort matrix
exists for exactly this, and an honest "this rung cannot complete, here is what blocks it" is worth
more than a fourth attempt.
