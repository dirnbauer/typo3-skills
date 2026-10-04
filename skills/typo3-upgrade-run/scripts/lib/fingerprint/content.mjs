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
 *
 * A query that fails is not drift. A `ddev mysql` call that timed out under capture load, or
 * whose output was cut off at the buffer, used to drop its table from the fingerprint, and the
 * comparison then reported that table as changed: every comparison void, and a re-baseline one
 * step away. Each statement now retries once, every failed call is logged with its table, exit
 * code and duration, and a table that still cannot be read is reported `unavailable` with exit 2
 * (harness error). Output beyond the buffer is refused, never hashed.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../run/paths.mjs';
import { EXIT, HarnessError, InvalidRunError } from '../cli/exit-codes.mjs';
import { createLogger } from '../cli/logger.mjs';

const execFileAsync = promisify(execFile);

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

/**
 * Limits of one `ddev mysql` call. The complete ordered tt_content dump of a mid-size site was
 * ~860 KB, 82% of execFile's 1 MiB default buffer; one more page of content and the dump would
 * have been cut off. 256 MiB covers every table this fingerprint reads, and output beyond it
 * fails loudly. One retry absorbs a transient timeout or a container blip; a second failure is
 * reported, not guessed around.
 */
export const FINGERPRINT_QUERY = Object.freeze({
  timeoutMs: 20_000,
  maxBuffer: 256 * 1024 * 1024,
  attempts: 2,
  retryDelayMs: 1_000,
});

export async function collectContent({
  ddevProject = null,
  fileadmin = 'fileadmin',
  tables = null,
  allowMissing = false,
  excludeTables = [],
  runner = ddevSql,
  log = createLogger(),
  retryDelayMs = FINGERPRINT_QUERY.retryDelayMs,
} = {}) {
  const database = await collectDatabase({ ddevProject, tables, excludeTables, runner, log, retryDelayMs });

  if (!database.available && !allowMissing) {
    if (database.unavailable) {
      throw new HarnessError(
        `Content fingerprint unavailable: the database could not be queried (${unavailableSummary(database.unavailable)}). `
        + 'A database the harness cannot read is a harness or input failure, not content drift; nothing was compared. '
        + 'Check that DDEV is running and the machine is not overloaded, then re-run. '
        + 'Pass --allow-missing only to record a degraded fingerprint on purpose; the report records that you did.',
        EXIT.HARNESS_ERROR,
        { reason: database.error, unavailable: database.unavailable },
      );
    }
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
      ? {
          tables: database.tables,
          excludedTables: [...EXCLUDED_TABLES],
          // Project-declared exclusions (run.yml fingerprint.exclude_tables / --exclude-tables):
          // request-driven log tables that mutate under capture load. Declared here so the
          // sealed manifest shows exactly what the fingerprint chose not to see.
          projectExcludedTables: [...excludeTables].sort(),
          collectedVia: database.via,
        }
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

async function collectDatabase({ ddevProject, tables, excludeTables = [], runner, log, retryDelayMs }) {
  const query = (sql, table, statement) => queryWithRetry({ runner, sql, ddevProject, table, statement, log, retryDelayMs });
  let present;
  try {
    present = parseTable(await query('SHOW TABLES', '(all tables)', 'SHOW TABLES'))
      .map((row) => String(Object.values(row)[0] ?? ''))
      .filter(Boolean);
  } catch (error) {
    if (!(error instanceof TableUnavailable)) throw error;
    // Not one statement answered: the database itself is unreachable. --allow-missing may record
    // that as a degraded fingerprint; the hashed error text stays deterministic.
    return { available: false, error: 'no tables could be queried', unavailable: [error.report] };
  }

  const selected = (tables?.length ? tables : trackedTables(present))
    .filter((table) => safeIdentifier(table) && !excluded(table) && !excludeTables.includes(table));
  const rows = [];
  for (const [index, table] of selected.entries()) {
    // A table that no longer exists is not queried: compareContent reports it as drift, which is
    // what a vanished table is. Only a table that exists and cannot be read is unavailable.
    if (!present.includes(table)) {
      log?.warn?.(`content fingerprint: table ${table} does not exist in the database; it is not fingerprinted.`);
      continue;
    }
    try {
      rows.push(await fingerprintTable(table, query));
    } catch (error) {
      if (!(error instanceof TableUnavailable)) throw error;
      throw new HarnessError(
        `Content fingerprint incomplete: table ${table} is unavailable (${unavailableSummary([error.report])}). `
        + 'A table the harness cannot read is a harness or input failure, not content drift; no fingerprint was '
        + 'written or compared. Check DDEV and the machine load, then re-run.',
        EXIT.HARNESS_ERROR,
        { unavailable: [error.report], notQueried: selected.slice(index + 1) },
      );
    }
  }
  if (!rows.length) return { available: false, error: 'no tables could be queried' };
  return { available: true, tables: rows, via: 'ddev mysql' };
}

async function fingerprintTable(table, query) {
  const columns = parseTable(await query(`SHOW COLUMNS FROM \`${table}\``, table, 'SHOW COLUMNS')).map((row) => ({
    name: row.Field,
    type: row.Type,
    key: row.Key,
  })).filter((column) => column.name);
  if (!columns.length) throw unreadable(table, 'SHOW COLUMNS', 'the output listed no columns');

  const names = new Set(columns.map((column) => column.name));
  const maxTstamp = names.has('tstamp') ? 'COALESCE(MAX(`tstamp`),0)' : '0';
  const maxUid = names.has('uid') ? 'COALESCE(MAX(`uid`),0)' : '0';
  const stats = parseTable(await query(
    `SELECT COUNT(*) AS row_count, ${maxTstamp} AS max_tstamp, ${maxUid} AS max_uid FROM \`${table}\``,
    table, 'SELECT COUNT',
  ))[0];
  if (!stats) throw unreadable(table, 'SELECT COUNT', 'the output held no result row');

  const order = columns.filter((column) => column.key === 'PRI').map((column) => column.name);
  if (!order.length) order.push(...columns.map((column) => column.name));
  const select = columns.map((column) => `\`${column.name}\``).join(',');
  const orderBy = order.map((column) => `\`${column}\``).join(',');
  // An empty table prints nothing at all; '' is a valid dump, only a failed call is not.
  const data = await query(`SELECT ${select} FROM \`${table}\` ORDER BY ${orderBy}`, table, 'SELECT rows');
  return {
    table,
    rowCount: Number(stats.row_count ?? 0),
    maxTstamp: Number(stats.max_tstamp ?? 0),
    maxUid: Number(stats.max_uid ?? 0),
    schemaHash: `sha256:${sha256(JSON.stringify(columns))}`,
    rowHash: `sha256:${sha256(String(data))}`,
    method: 'sha256 over complete ordered row serialization',
  };
}

/** A statement that could not be answered after its retry. Internal: callers see exit 2. */
class TableUnavailable extends Error {
  constructor(report) {
    super(`${report.table} (${report.statement}) unavailable`);
    this.report = report;
  }
}

function unreadable(table, statement, reason) {
  return new TableUnavailable({
    table, statement, status: 'unavailable',
    calls: [{ attempt: 1, exitCode: 0, signal: null, timedOut: false, durationMs: null, error: reason }],
  });
}

/**
 * Run one statement, retrying a failed call once. A call fails when the runner throws or returns
 * nothing; an empty string is a valid answer (an empty table prints no header). Truncated output
 * is never retried or hashed: the same dump would be cut off again.
 */
async function queryWithRetry({ runner, sql, ddevProject, table, statement, log, retryDelayMs,
  attempts = FINGERPRINT_QUERY.attempts, now = Date.now }) {
  const calls = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = now();
    let output = null;
    let failure = null;
    try {
      output = await runner(sql, ddevProject);
    } catch (error) {
      if (error?.truncated) throw truncatedOutput(table, statement, error);
      failure = error;
    }
    if (failure === null && output !== null && output !== undefined) return String(output);
    const call = {
      attempt,
      exitCode: Number.isInteger(failure?.exitCode) ? failure.exitCode : null,
      signal: failure?.signal ?? null,
      timedOut: failure?.timedOut === true,
      durationMs: now() - started,
      error: firstLine(failure?.message ?? 'the runner returned no output'),
    };
    calls.push(call);
    const retrying = attempt < attempts;
    log?.warn?.(`content fingerprint: ddev mysql failed for ${table} (${statement}), attempt ${attempt}/${attempts}: `
      + `${describeCall(call)}${retrying ? '; retrying once' : ''}`);
    if (retrying && retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new TableUnavailable({ table, statement, status: 'unavailable', calls });
}

function truncatedOutput(table, statement, error) {
  const limit = error.maxBuffer ?? FINGERPRINT_QUERY.maxBuffer;
  return new HarnessError(
    `Content fingerprint refused: the ddev mysql output for ${table} (${statement}) exceeded the `
    + `${Math.round(limit / (1024 * 1024))} MiB buffer and was cut off. A truncated dump would hash as a changed `
    + 'table, so nothing was fingerprinted. This table is larger than the fingerprint reads in one call; report it as a '
    + 'harness limit instead of excluding it.',
    EXIT.HARNESS_ERROR,
    { table, statement, status: 'truncated', maxBuffer: limit },
  );
}

function describeCall(call) {
  return `exit code ${call.exitCode ?? 'none'}${call.signal ? `, signal ${call.signal}` : ''}`
    + `${call.timedOut ? ', timed out' : ''}${Number.isFinite(call.durationMs) ? `, ${call.durationMs} ms` : ''}: ${call.error}`;
}

function unavailableSummary(reports) {
  return reports.map((report) => `${report.table} ${report.statement}: ${report.calls.map(describeCall).join('; ')}`).join(' | ');
}

function firstLine(text) {
  return String(text ?? '').trim().split('\n').find(Boolean)?.slice(0, 240) ?? '';
}

/**
 * The `ddev mysql` runner. Returns stdout, or throws an error carrying the exit code, signal and
 * whether the call timed out or overran the buffer.
 *
 * Two bugs lived here and both made every content fingerprint report "the database could not be
 * queried": `--no-tablespaces` is a mysqldump flag the mysql client rejects outright, and
 * promisified execFile has no `input` option (that belongs to execFileSync), so the statement
 * was never delivered to stdin. The SQL goes in with -e instead.
 */
export function createDdevSqlRunner({
  exec = execFileAsync,
  timeoutMs = FINGERPRINT_QUERY.timeoutMs,
  maxBuffer = FINGERPRINT_QUERY.maxBuffer,
} = {}) {
  return async function ddevMysql(sql) {
    try {
      const { stdout } = await exec('ddev', ['mysql', '-e', `${sql};`], { timeout: timeoutMs, encoding: 'utf8', maxBuffer });
      return String(stdout);
    } catch (error) {
      throw execFailure(error, { timeoutMs, maxBuffer });
    }
  };
}

const ddevSql = createDdevSqlRunner();

/** Normalise an execFile rejection into the fields the retry log and the refusal report. */
export function execFailure(error, { timeoutMs = FINGERPRINT_QUERY.timeoutMs, maxBuffer = FINGERPRINT_QUERY.maxBuffer } = {}) {
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer length exceeded/i.test(String(error?.message ?? ''))) {
    const failure = new Error(`output exceeded the ${maxBuffer}-byte buffer`);
    failure.truncated = true;
    failure.maxBuffer = maxBuffer;
    return failure;
  }
  // execFile kills a call that outlives `timeout` and reports killed + signal, with no exit code.
  const timedOut = error?.killed === true && Boolean(error?.signal);
  const failure = new Error(timedOut
    ? `timed out after ${timeoutMs} ms`
    : (firstLine(error?.stderr) || firstLine(error?.message ?? error) || 'ddev mysql failed'));
  failure.exitCode = Number.isInteger(error?.code) ? error.code : null;
  failure.signal = error?.signal ?? null;
  failure.timedOut = timedOut;
  return failure;
}

function trackedTables(present) {
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
