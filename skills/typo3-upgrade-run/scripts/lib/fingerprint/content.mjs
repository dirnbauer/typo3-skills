/**
 * The content fingerprint — proof that the INPUTS did not change during the run.
 *
 * Without it, an editor saving one content element in the local backend mid-run looks
 * exactly like an update regression. That is a common and expensive failure mode: a day
 * spent hunting a change the update never made.
 *
 * Self-changing tables are excluded, or the fingerprint would never match itself.
 * _processed_ is excluded from the INPUT hash on purpose — it is a rendering result, not an
 * input — but its warm/cold state is recorded separately because it changes timing.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../run/paths.mjs';
import { InvalidRunError } from '../cli/exit-codes.mjs';

const exec = promisify(execFile);

export const TRACKED_TABLES = Object.freeze([
  'pages', 'tt_content', 'sys_file', 'sys_file_reference', 'sys_file_metadata',
  'sys_redirect', 'sys_template', 'sys_category', 'sys_category_record_mm',
]);

/** Excluded because they change without anyone editing content. */
export const EXCLUDED_TABLES = Object.freeze([
  'cf_*', 'sys_log', 'be_sessions', 'fe_sessions', 'sys_lockedrecords',
  'tx_scheduler_task', 'sys_history', 'sys_refindex',
]);

export const EXCLUDED_FILE_DIRS = Object.freeze(['_processed_', '_temp_']);

const CONTENT_HASH_MAX_BYTES = 8 * 1024 * 1024;

export async function collectContent({
  ddevProject = null,
  fileadmin = 'fileadmin',
  tables = null,
  allowMissing = false,
  runner = ddevSql,
} = {}) {
  const database = await collectDatabase({ ddevProject, tables, runner });

  if (!database.available && !allowMissing) {
    throw new InvalidRunError(
      'Content fingerprint unavailable: the database could not be queried. '
      + 'Without it a mid-run content change is indistinguishable from a regression. '
      + 'Pass --allow-missing to proceed, and the report will record that you did.',
      { reason: database.error },
    );
  }

  const files = await collectFiles(fileadmin);
  const body = {
    database: database.available
      ? { tables: database.tables, excludedTables: [...EXCLUDED_TABLES], collectedVia: database.via }
      : { available: false, error: database.error },
    files,
  };

  return {
    kind: 'content-fingerprint',
    fingerprintHash: `sha256:${sha256(JSON.stringify(body))}`,
    degraded: !database.available,
    ...body,
    capturedAt: new Date().toISOString(),
  };
}

async function collectDatabase({ ddevProject, tables, runner }) {
  const rows = [];
  try {
    const selected = tables?.length ? tables : await discoverTrackedTables(runner, ddevProject);
    for (const table of selected) {
      if (!safeIdentifier(table) || excluded(table)) continue;
      const columnsRaw = await runner(`SHOW COLUMNS FROM \`${table}\``, ddevProject);
      const columns = parseTable(columnsRaw).map((row) => ({
        name: row.Field,
        type: row.Type,
        key: row.Key,
      })).filter((column) => column.name);
      if (!columns.length) continue;

      const names = new Set(columns.map((column) => column.name));
      const maxTstamp = names.has('tstamp') ? 'COALESCE(MAX(`tstamp`),0)' : '0';
      const maxUid = names.has('uid') ? 'COALESCE(MAX(`uid`),0)' : '0';
      const statsRaw = await runner(
        `SELECT COUNT(*) AS row_count, ${maxTstamp} AS max_tstamp, ${maxUid} AS max_uid FROM \`${table}\``,
        ddevProject,
      );
      const stats = parseTable(statsRaw)[0];
      if (!stats) continue;

      const order = columns.filter((column) => column.key === 'PRI').map((column) => column.name);
      if (!order.length) order.push(...columns.map((column) => column.name));
      const select = columns.map((column) => `\`${column.name}\``).join(',');
      const orderBy = order.map((column) => `\`${column}\``).join(',');
      const data = await runner(`SELECT ${select} FROM \`${table}\` ORDER BY ${orderBy}`, ddevProject);
      if (data === null) continue;
      rows.push({
        table,
        rowCount: Number(stats.row_count ?? 0),
        maxTstamp: Number(stats.max_tstamp ?? 0),
        maxUid: Number(stats.max_uid ?? 0),
        schemaHash: `sha256:${sha256(JSON.stringify(columns))}`,
        rowHash: `sha256:${sha256(String(data))}`,
        method: 'sha256 over complete ordered row serialization',
      });
    }
    if (!rows.length) return { available: false, error: 'no tables could be queried' };
    return { available: true, tables: rows, via: 'ddev mysql' };
  } catch (err) {
    return { available: false, error: String(err.message ?? err) };
  }
}

async function ddevSql(sql, project) {
  // Two bugs lived here and both made every content fingerprint report "the database
  // could not be queried", which surfaces as INVALID for a reason that was never the
  // database: `--no-tablespaces` is a mysqldump flag the mysql client rejects outright,
  // and promisified execFile has no `input` option (that belongs to execFileSync), so
  // the statement was never delivered to stdin. Pass the SQL with -e instead.
  const args = ['mysql'];
  args.push('-e', `${sql};`);
  try {
    const { stdout } = await exec('ddev', args, { timeout: 20000, encoding: 'utf8' });
    return String(stdout);
  } catch {
    return null;
  }
}

async function discoverTrackedTables(runner, project) {
  const raw = await runner('SHOW TABLES', project);
  const rows = parseTable(raw);
  const present = rows.map((row) => Object.values(row)[0]).filter(Boolean);
  const wanted = new Set(TRACKED_TABLES);
  for (const table of present) {
    if (String(table).startsWith('tx_') && !excluded(String(table))) wanted.add(String(table));
  }
  return [...wanted].filter((table) => present.includes(table)).sort();
}

function parseTable(raw) {
  const lines = String(raw ?? '').trim().split('\n').filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t');
  return lines.slice(1).map((line) => Object.fromEntries(
    line.split('\t').map((value, index) => [headers[index], value]),
  ));
}

function safeIdentifier(value) {
  return /^[A-Za-z0-9_]+$/.test(String(value));
}

function excluded(table) {
  return EXCLUDED_TABLES.some((pattern) => (
    pattern.endsWith('*') ? table.startsWith(pattern.slice(0, -1)) : table === pattern
  ));
}

export async function collectFiles(root) {
  const entries = [];
  let totalBytes = 0;
  let processedCount = 0;

  async function walk(dir, rel = '') {
    let items;
    try { items = await readdir(dir, { withFileTypes: true }); }
    catch (err) { if (err.code === 'ENOENT') return; throw err; }

    for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, item.name);
      const relPath = rel ? `${rel}/${item.name}` : item.name;

      if (item.isDirectory()) {
        if (EXCLUDED_FILE_DIRS.includes(item.name)) {
          processedCount += await countFiles(abs);
          continue;
        }
        await walk(abs, relPath);
        continue;
      }
      if (!item.isFile()) continue;

      const s = await stat(abs);
      totalBytes += s.size;
      let contentHash = null;
      if (s.size <= CONTENT_HASH_MAX_BYTES) {
        contentHash = sha256(await readFile(abs));
      }
      entries.push(`${relPath}|${s.size}|${Math.floor(s.mtimeMs / 1000)}|${contentHash ?? 'large'}`);
    }
  }

  await walk(root);
  return {
    root,
    fileCount: entries.length,
    totalBytes,
    treeHash: `sha256:${sha256(entries.join('\n'))}`,
    method: 'sha256 over sorted (relpath,size,mtime@1s,contentSha256 for files<8MiB)',
    excluded: [...EXCLUDED_FILE_DIRS],
    imageProcessingWarm: { processedFileCount: processedCount },
  };
}

async function countFiles(dir) {
  let n = 0;
  try {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.isDirectory()) n += await countFiles(path.join(dir, item.name));
      else n += 1;
    }
  } catch { /* unreadable is zero for counting purposes */ }
  return n;
}

export function compareContent(sealed, current) {
  const drifted = [];
  const bTables = new Map((sealed.database?.tables ?? []).map((t) => [t.table, t]));
  for (const t of current.database?.tables ?? []) {
    const b = bTables.get(t.table);
    if (!b) { drifted.push({ key: `table:${t.table}`, before: null, after: t }); continue; }
    if (b.rowCount !== t.rowCount
      || b.maxTstamp !== t.maxTstamp
      || b.maxUid !== t.maxUid
      || b.rowHash !== t.rowHash
      || b.schemaHash !== t.schemaHash) {
      drifted.push({ key: `table:${t.table}`, before: b, after: t });
    }
  }
  for (const [table, before] of bTables) {
    if (!(current.database?.tables ?? []).some((entry) => entry.table === table)) {
      drifted.push({ key: `table:${table}`, before, after: null });
    }
  }
  if (sealed.files?.treeHash !== current.files?.treeHash) {
    drifted.push({
      key: 'files.treeHash',
      before: sealed.files?.treeHash ?? null,
      after: current.files?.treeHash ?? null,
    });
  }
  return { match: drifted.length === 0, drifted };
}
