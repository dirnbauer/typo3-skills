#!/usr/bin/env node
/**
 * Database health check with lolli/dbdoctor for the db-health-intake and db-health-target nodes.
 *
 * dbdoctor's check mode changes no rows, but it prints only a count per table, and on a dirty
 * database it aborts with exit 255 at the first "a previous check should have fixed this"
 * exception, so every later check never runs. The uid-level change set exists only as the SQL
 * file of an execute run. This script therefore offers:
 *
 *   check      run `dbdoctor:health --mode=check` in DDEV under a timeout and normalise the
 *              output into deterministic, hashed JSON (per check: ok, affected, aborted, not-run)
 *   probe      snapshot -> execute -f passN.sql until check exits 0 (at most 5 passes) -> copy
 *              the SQL -> snapshot restore -> prove the database fingerprint equals the pre-probe
 *              one. Yields the full record inventory (check, table, uid, action)
 *   parse-check / parse-sql   the same parsers on saved files
 *   compare    intake inventory vs target inventory: new, unchanged, vanished, target-only
 *   apply      replay an owner-approved, curated SQL file in one transaction, then
 *              referenceindex:update, cache:flush and a re-check (db-health-recovery only)
 *
 * Exit codes follow the harness: 0 pass/clean, 1 findings, 2 harness error, 3 invalid (the probe
 * could not prove the restore), 4 precondition (dbdoctor exit 4, missing snapshot, bad input),
 * 5 refused by policy (apply without approval, or SQL that is not dbdoctor-shaped).
 *
 * Never run dbdoctor in execute or interactive mode on a database you want to keep: execute has
 * no transaction and no DataHandler; interactive mode loops forever without a TTY.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { sha256 } from './lib/run/paths.mjs';
import { collectContent, compareContent } from './lib/fingerprint/content.mjs';
import { isMain } from './lib/cli/is-main.mjs';

export const EXIT = Object.freeze({ PASS: 0, FINDINGS: 1, HARNESS_ERROR: 2, INVALID: 3, PRECONDITION: 4, POLICY: 5 });
export const CHECK_SCHEMA = 'typo3-upgrade-run/db-health-check@1';
export const RECORDS_SCHEMA = 'typo3-upgrade-run/db-health-records@1';
export const COMPARE_SCHEMA = 'typo3-upgrade-run/db-health-compare@1';
export const MAX_PROBE_PASSES = 5;
export const CONTAINER_SQL_DIR = '/var/www/html/.dbdoctor';

const COMMON = [
  'WorkspacesNotLoadedRecordsDangling', 'WorkspacesRecordsOfDeletedWorkspaces', 'TcaTablesDeleteFlagZeroOrOne',
  'WorkspacesSoftDeletedRecords', 'WorkspacesPidNegative', 'WorkspacesT3verStateNotZeroInLive',
  'WorkspacesT3verStateMinusOne', 'WorkspacesT3verStateThree', 'SysRedirectInvalidPid',
  'TcaTablesLanguageLessThanOneHasZeroLanguageParent', 'TcaTablesLanguageLessThanOneHasZeroLanguageSource',
  'PagesBrokenTree', 'PagesTranslatedLanguageParentSelf', 'PagesTranslatedLanguageParentMissing',
  'PagesTranslatedLanguageParentDeleted', 'PagesTranslatedLanguageParentDifferentPid',
];
const TT_CONTENT = [
  'TtContentPidMissing', 'TtContentPidDeleted', 'TtContentDeletedLocalizedParentExists', 'TtContentLocalizedParentExists',
  'TtContentLocalizedParentSoftDeleted', 'TtContentDeletedLocalizedParentDifferentPid', 'TtContentLocalizedParentDifferentPid',
  'TtContentLocalizedDuplicates', 'TtContentLocalizationSourceExists', 'TtContentLocalizationSourceSetWithParent',
  'TtContentLocalizationSourceLogicWithParent', 'SysFileReferenceDangling', 'SysFileReferenceDeletedLocalizedParentExists',
  'SysFileReferenceLocalizedParentExists', 'SysFileReferenceLocalizedParentDeleted', 'SysFileReferenceLocalizedFieldSync',
  'SysFileReferenceInvalidPid', 'TcaTablesPidMissing', 'TcaTablesPidDeleted',
];
const INLINE = [
  'InlineForeignFieldChildrenParentMissing', 'InlineForeignFieldNoForeignTableFieldChildrenParentMissing',
  'InlineForeignFieldChildrenParentDeleted', 'InlineForeignFieldNoForeignTableFieldChildrenParentDeleted',
  'InlineForeignFieldChildrenParentLanguageDifferent', 'InlineForeignFieldNoForeignTableFieldChildrenParentLanguageDifferent',
];

/**
 * Execution order of the pinned releases, taken from each tag's Tests/Cli/InvalidArgumentTest.phpt.
 * 1.0.6 runs SysFileReferenceDangling a second time; 2.2.0 dropped that pass (#185).
 */
export const CHECK_ORDER = Object.freeze({
  '1.0.6': Object.freeze([...COMMON, 'TcaTablesTranslatedParentSelf', 'TcaTablesTranslatedParentInvalidPointer', ...TT_CONTENT,
    'TcaTablesTranslatedLanguageParentMissing', 'SysFileReferenceDangling', 'TcaTablesTranslatedLanguageParentDeleted',
    'TcaTablesTranslatedLanguageParentDifferentPid', ...INLINE]),
  '2.2': Object.freeze([...COMMON, 'PagesTranslatedLanguageParentDuplicates', 'TcaTablesTranslatedParentSelf',
    'TcaTablesTranslatedParentInvalidPointer', ...TT_CONTENT, 'TcaTablesPidTranslatedPage',
    'TcaTablesTranslatedLanguageParentMissing', 'TcaTablesTranslatedLanguageParentDeleted',
    'TcaTablesTranslatedLanguageParentDifferentPid', ...INLINE, 'TcaTablesTranslatedLanguageParentDuplicates']),
});

/**
 * Frontend risk for Contract A parity. none: never rendered before or after. low: backend or editor
 * consistency only. medium: can change rendering in some configurations. high: usually changes it.
 */
export const CHECK_RISK = Object.freeze({
  WorkspacesNotLoadedRecordsDangling: 'high', WorkspacesRecordsOfDeletedWorkspaces: 'none', TcaTablesDeleteFlagZeroOrOne: 'none',
  WorkspacesSoftDeletedRecords: 'none', WorkspacesPidNegative: 'none', WorkspacesT3verStateNotZeroInLive: 'low',
  WorkspacesT3verStateMinusOne: 'none', WorkspacesT3verStateThree: 'none', SysRedirectInvalidPid: 'medium',
  TcaTablesLanguageLessThanOneHasZeroLanguageParent: 'medium', TcaTablesLanguageLessThanOneHasZeroLanguageSource: 'low',
  PagesLanguageNegative: 'medium', PagesBrokenTree: 'none', PagesPidDeleted: 'medium', PagesTranslatedLanguageParentSelf: 'low',
  PagesTranslatedLanguageParentMissing: 'none', PagesTranslatedLanguageParentDeleted: 'none',
  PagesTranslatedLanguageParentDifferentPid: 'medium', PagesTranslatedLanguageParentDuplicates: 'high',
  TcaTablesTranslatedParentSelf: 'high', TcaTablesTranslatedParentInvalidPointer: 'medium', TtContentPidMissing: 'medium',
  TtContentPidDeleted: 'medium', TtContentDeletedLocalizedParentExists: 'none', TtContentLocalizedParentExists: 'medium',
  TtContentLocalizedParentSoftDeleted: 'low', TtContentDeletedLocalizedParentDifferentPid: 'none',
  TtContentLocalizedParentDifferentPid: 'low', TtContentLocalizedDuplicates: 'high', TtContentLocalizedPageTranslationMissing: 'medium',
  TtContentLocalizationSourceExists: 'none', TtContentLocalizationSourceSetWithParent: 'none',
  TtContentLocalizationSourceLogicWithParent: 'none', SysFileReferenceDangling: 'medium',
  SysFileReferenceDeletedLocalizedParentExists: 'none', SysFileReferenceLocalizedParentExists: 'high',
  SysFileReferenceLocalizedParentDeleted: 'high', SysFileReferenceLocalizedFieldSync: 'high', SysFileReferenceInvalidPid: 'none',
  TcaTablesPidMissing: 'medium', TcaTablesPidDeleted: 'medium', TcaTablesPidTranslatedPage: 'high',
  TcaTablesTranslatedLanguageParentMissing: 'low', TcaTablesTranslatedLanguageParentDeleted: 'low',
  TcaTablesTranslatedLanguageParentDifferentPid: 'medium', TcaTablesTranslatedLanguageNotInSiteConfiguration: 'high',
  InlineForeignFieldChildrenParentMissing: 'medium', InlineForeignFieldNoForeignTableFieldChildrenParentMissing: 'medium',
  InlineForeignFieldChildrenParentDeleted: 'none', InlineForeignFieldNoForeignTableFieldChildrenParentDeleted: 'none',
  InlineForeignFieldChildrenParentLanguageDifferent: 'high', InlineForeignFieldNoForeignTableFieldChildrenParentLanguageDifferent: 'high',
  TcaTablesTranslatedLanguageParentDuplicates: 'high', TcaTablesTranslatedWithAllowLanguageSynchronization: 'none',
});

/** 1.0.6 deletes visible language -1 inline children under translated parents (fixed in 2.2.0, #192). */
const NEVER_WITH_1X = new Set(['InlineForeignFieldChildrenParentLanguageDifferent',
  'InlineForeignFieldNoForeignTableFieldChildrenParentLanguageDifferent']);

/* ----------------------------------------------------------------------------- helpers */

export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

/** Hash over canonical JSON without the sha256 field itself. */
export function withHash(body) {
  const { sha256: _ignored, ...rest } = body;
  return { ...rest, sha256: `sha256:${sha256(JSON.stringify(canonical(rest)))}` };
}

/** '2.2.0' -> '2.2'; '1.0.6' -> '1.0.6'; anything else has no known order. */
export function orderKey(version) {
  const v = String(version ?? '').replace(/^v/, '');
  if (/^1\.0\.\d+$/.test(v)) return '1.0.6';
  if (/^2\.2\.\d+$/.test(v)) return '2.2';
  return null;
}

export function recordKey({ check, table, uid }) { return `${check}|${table}|${uid}`; }

const stripAnsi = (text) => String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');

/* ----------------------------------------------------------------------------- check output */

/**
 * Parse `dbdoctor:health --mode=check --no-ansi` output.
 * The verdict decides the exit code: clean 0, findings / partial-findings 1, precondition 4,
 * timeout / crashed / unparseable 2.
 */
export function parseCheckOutput({ stdout = '', stderr = '', exitCode, version = null }) {
  const checks = [];
  const seen = new Map();
  let current = null;
  let errorLines = null;
  for (const raw of stripAnsi(stdout).split('\n')) {
    const line = raw.trim();
    const cls = line.match(/^Class:\s*([A-Za-z0-9_]+)\s*$/);
    if (cls) {
      const occurrence = (seen.get(cls[1]) ?? 0) + 1;
      seen.set(cls[1], occurrence);
      current = { class: cls[1], occurrence, status: null, actions: [], tables: {} };
      checks.push(current);
      continue;
    }
    if (errorLines && line && !/^\[/.test(line)) { errorLines.push(line); continue; }
    if (/^\[ERROR\]/.test(line)) { errorLines = [line.replace(/^\[ERROR\]\s*/, '')]; continue; }
    if (!current) continue;
    const actions = line.match(/^Actions:\s*(.+)$/);
    if (actions) { current.actions = actions[1].split(',').map((a) => a.trim()).filter(Boolean).sort(); continue; }
    if (/^\[OK\]\s*No affected records found/.test(line)) { current.status = 'ok'; continue; }
    if (/Found affected records in \d+ tables?/.test(line)) { current.status = 'affected'; continue; }
    const table = line.match(/^(?:\[WARNING\]\s*)?"([A-Za-z0-9_]+)":\s*(\d+)\s+records?\b/);
    if (table && current.status === 'affected') current.tables[table[1]] = Number(table[2]);
  }
  for (const check of checks) check.tables = canonical(check.tables);

  const err = stripAnsi(stderr);
  const location = err.match(/In ([A-Za-z0-9_]+)\.php line (\d+):/);
  const codeMatch = err.match(/\[[A-Za-z0-9_\\]+\s*\((\d+)\)\]/);
  const message = err.split('\n').map((l) => l.trim())
    .filter((l) => l && !/^In [A-Za-z0-9_]+\.php line/.test(l) && !/^\[[A-Za-z0-9_\\]+/.test(l) && !/^dbdoctor:health/.test(l))
    .join(' ').replace(/\s+/g, ' ').slice(0, 500);
  // Symfony wraps the exception text over several indented lines; match it on collapsed whitespace.
  const chained = /previous check should have (found and )?fixed|should have been caught by previous/i.test(`${err} ${stripAnsi(stdout)}`.replace(/\s+/g, ' '));

  let aborted = null;
  const unfinished = checks.filter((c) => c.status === null);
  if (exitCode === 255 || exitCode === 124) {
    const last = unfinished.at(-1) ?? null;
    if (last) last.status = exitCode === 124 ? 'timed-out' : 'aborted';
    aborted = { class: last?.class ?? location?.[1] ?? null, file: location ? `${location[1]}.php` : null,
      line: location ? Number(location[2]) : null, exception_code: codeMatch ? Number(codeMatch[1]) : null,
      chained, message: message || null };
  }
  for (const check of checks) if (check.status === null) check.status = 'unknown';

  const key = orderKey(version);
  const notRun = [];
  if (key) {
    const ran = new Map();
    for (const check of checks) ran.set(check.class, (ran.get(check.class) ?? 0) + 1);
    const expected = new Map();
    for (const name of CHECK_ORDER[key]) {
      const occurrence = (expected.get(name) ?? 0) + 1;
      expected.set(name, occurrence);
      if ((ran.get(name) ?? 0) < occurrence) notRun.push({ class: name, occurrence, status: 'not-run', actions: [], tables: {} });
    }
  }

  const affected = checks.filter((c) => c.status === 'affected');
  let verdict;
  if (exitCode === 0) verdict = affected.length ? 'unparseable' : 'clean';
  else if (exitCode === 1) verdict = affected.length ? 'findings' : 'unparseable';
  else if (exitCode === 4) verdict = 'precondition';
  else if (exitCode === 124) verdict = 'timeout';
  else if (exitCode === 255) verdict = chained ? 'partial-findings' : 'crashed';
  else verdict = 'unparseable';
  if (exitCode === 0 && checks.length === 0) verdict = 'unparseable';

  const precondition = exitCode === 4
    ? { kind: /not in sync with TCA/i.test((errorLines ?? []).join(' ')) ? 'schema' : 'options',
      message: (errorLines ?? []).join(' ').replace(/\s+/g, ' ').slice(0, 500) || null }
    : null;
  const totals = { checks_run: checks.length, ok: checks.filter((c) => c.status === 'ok').length,
    affected: affected.length, not_run: key ? notRun.length : null,
    affected_rows: affected.reduce((sum, c) => sum + Object.values(c.tables).reduce((a, b) => a + b, 0), 0) };

  return withHash({
    schema: CHECK_SCHEMA,
    tool: { package: 'lolli/dbdoctor', version: version ?? null, order_known: Boolean(key) },
    dbdoctor_exit: exitCode,
    verdict,
    complete: ['clean', 'findings'].includes(verdict),
    checks: [...checks, ...notRun],
    aborted,
    precondition,
    totals,
  });
}

export function exitForCheck(parsed) {
  switch (parsed.verdict) {
    case 'clean': return EXIT.PASS;
    case 'findings': case 'partial-findings': return EXIT.FINDINGS;
    case 'precondition': return EXIT.PRECONDITION;
    default: return EXIT.HARNESS_ERROR;
  }
}

/* ----------------------------------------------------------------------------- SQL log */

const IDENT = '[`"]?([A-Za-z0-9_]+)[`"]?';
const DELETE_RE = new RegExp(`^DELETE FROM ${IDENT} WHERE ${IDENT} = (\\d+);$`, 'i');
const UPDATE_RE = new RegExp(`^UPDATE ${IDENT} SET (.+) WHERE ${IDENT} = (\\d+);$`, 'i');
const ASSIGN_RE = new RegExp(`^${IDENT} = ('(?:[^'\\\\]|'')*'|-?\\d+)$`);

/** Split a SET clause into field assignments; null when a value cannot be read unambiguously. */
export function parseAssignments(clause) {
  const parts = [];
  let buffer = '', quoted = false;
  for (const char of clause) {
    if (char === "'") quoted = !quoted;
    if (char === ',' && !quoted) { parts.push(buffer.trim()); buffer = ''; continue; }
    buffer += char;
  }
  if (quoted) return null;
  parts.push(buffer.trim());
  const fields = {};
  for (const part of parts) {
    const match = part.match(ASSIGN_RE);
    if (!match) return null;
    const value = match[2];
    fields[match[1]] = value.startsWith("'") ? value.slice(1, -1).replace(/''/g, "'") : Number(value);
  }
  return fields;
}

/**
 * Parse one dbdoctor `-f` file: `# Triggered by <Class>` headers, then one statement per line.
 * Unrecognised lines are returned, never guessed: a curated replay refuses them.
 */
export function parseSqlLog(text, { file = null } = {}) {
  const statements = [];
  const unparsed = [];
  let check = null;
  for (const [index, raw] of String(text ?? '').split('\n').entries()) {
    const line = raw.trim();
    if (!line) continue;
    const header = line.match(/^#\s*Triggered by\s+([A-Za-z0-9_\\]+)/);
    if (header) { check = header[1].split('\\').at(-1); continue; }
    if (line.startsWith('#') || line.startsWith('--')) continue;
    const del = line.match(DELETE_RE);
    if (del && del[2] === 'uid') {
      statements.push({ check, table: del[1], uid: Number(del[3]), action: 'delete', fields: {}, file, line: index + 1, sql: line });
      continue;
    }
    const upd = line.match(UPDATE_RE);
    const fields = upd && upd[3] === 'uid' ? parseAssignments(upd[2]) : null;
    if (upd && fields) {
      const names = Object.keys(fields);
      const action = names.length === 1 && names[0] === 'deleted' && fields.deleted === 1 ? 'soft-delete' : 'update';
      statements.push({ check, table: upd[1], uid: Number(upd[4]), action, fields, file, line: index + 1, sql: line });
      continue;
    }
    unparsed.push({ file, line: index + 1, sql: line.slice(0, 300) });
  }
  return { statements, unparsed };
}

/** Collapse statements of every pass into one record per (check, table, uid), sorted. */
export function buildRecords(statements) {
  const map = new Map();
  for (const s of statements) {
    const key = recordKey({ check: s.check ?? 'unknown', table: s.table, uid: s.uid });
    const entry = map.get(key) ?? { check: s.check ?? 'unknown', table: s.table, uid: s.uid, actions: [], fields: {} };
    if (!entry.actions.includes(s.action)) entry.actions.push(s.action);
    Object.assign(entry.fields, s.fields);
    map.set(key, entry);
  }
  return [...map.values()]
    .map((r) => ({ ...r, actions: r.actions.sort(), fields: canonical(r.fields) }))
    .sort((a, b) => a.check.localeCompare(b.check) || a.table.localeCompare(b.table) || a.uid - b.uid);
}

/**
 * One group per (check, table) with the default proposal. The proposal is a starting point for the
 * owner question, never a decision: fix-candidate (no or backend-only effect), owner-decision
 * (rendering may change; show rendered URLs before and after), do-not-fix-with-1.0.6.
 */
export function classifyGroups(records, { version = null } = {}) {
  const groups = new Map();
  for (const r of records) {
    const key = `${r.check}|${r.table}`;
    const group = groups.get(key) ?? { check: r.check, table: r.table, count: 0, actions: [] };
    group.count += 1;
    for (const action of r.actions) if (!group.actions.includes(action)) group.actions.push(action);
    groups.set(key, group);
  }
  const legacy = orderKey(version) === '1.0.6';
  return [...groups.values()].map((g) => {
    const risk = CHECK_RISK[g.check] ?? 'unknown';
    let proposal = ['none', 'low'].includes(risk) ? 'fix-candidate' : 'owner-decision';
    if (legacy && NEVER_WITH_1X.has(g.check)) proposal = 'do-not-fix-with-1.0.6';
    return { ...g, actions: g.actions.sort(), risk, proposal };
  }).sort((a, b) => a.check.localeCompare(b.check) || a.table.localeCompare(b.table));
}

export function recordsDocument({ passes, statements, unparsed, version, converged, passesRun }) {
  const records = buildRecords(statements);
  return withHash({
    schema: RECORDS_SCHEMA,
    tool: { package: 'lolli/dbdoctor', version: version ?? null },
    converged: converged ?? null,
    passes_run: passesRun ?? passes.length,
    passes,
    records,
    groups: classifyGroups(records, { version }),
    unparsed,
    totals: { records: records.length, statements: statements.length, unparsed: unparsed.length },
  });
}

/* ----------------------------------------------------------------------------- compare */

/**
 * Compare intake and target record inventories on (check, table, uid).
 * new: a migration-introduced inconsistency (route to content-recovery).
 * unchanged: pre-existing, a residual for the handover.
 * vanished: fixed by a wizard, migration or approved change; it must be in the transition ledger.
 * target-only: found by a check the intake version does not have; pre-existing only when a
 * Baseline A lookup proves it (--pre-existing), otherwise it counts like new.
 */
export function compareInventories(intake, target, { ledgerKeys = [], preExisting = [] } = {}) {
  const intakeOrder = orderKey(intake?.tool?.version);
  const targetOrder = orderKey(target?.tool?.version);
  // Without a known intake order every target check counts as covered at intake (classified new).
  const intakeChecks = intake && intakeOrder ? new Set(CHECK_ORDER[intakeOrder]) : null;
  const targetOnlyChecks = targetOrder && (intakeChecks || !intake)
    ? [...new Set(CHECK_ORDER[targetOrder])].filter((c) => !intakeChecks?.has(c)).sort()
    : [];
  const before = new Map((intake?.records ?? []).map((r) => [recordKey(r), r]));
  const after = new Map((target?.records ?? []).map((r) => [recordKey(r), r]));
  const ledger = new Set(ledgerKeys), proven = new Set(preExisting);
  const out = { new: [], unchanged: [], vanished: [], target_only: [] };
  for (const [key, record] of after) {
    const entry = { key, check: record.check, table: record.table, uid: record.uid, actions: record.actions };
    if (before.has(key)) out.unchanged.push(entry);
    else if (!intake || (intakeChecks && !intakeChecks.has(record.check))) out.target_only.push({ ...entry, pre_existing: proven.has(key) });
    else out.new.push(entry);
  }
  for (const [key, record] of before) {
    if (!after.has(key)) out.vanished.push({ key, check: record.check, table: record.table, uid: record.uid, ledgered: ledger.has(key) });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.key.localeCompare(b.key));
  const unresolvedTargetOnly = out.target_only.filter((r) => !r.pre_existing).length;
  return withHash({
    schema: COMPARE_SCHEMA,
    intake: intake ? { version: intake.tool?.version ?? null, sha256: intake.sha256 ?? null } : null,
    target: { version: target?.tool?.version ?? null, sha256: target?.sha256 ?? null },
    target_only_checks: targetOnlyChecks,
    ...out,
    counts: { new: out.new.length, unchanged: out.unchanged.length, vanished: out.vanished.length,
      vanished_unledgered: out.vanished.filter((r) => !r.ledgered).length,
      target_only: out.target_only.length, target_only_unresolved: unresolvedTargetOnly },
  });
}

export function exitForCompare(result, { requireLedgered = false } = {}) {
  const c = result.counts;
  if (c.new > 0 || c.target_only_unresolved > 0) return EXIT.FINDINGS;
  if (requireLedgered && c.vanished_unledgered > 0) return EXIT.FINDINGS;
  return EXIT.PASS;
}

/** Keys a content-transition ledger declares as resolved: declared_transitions[].db_health_resolved. */
export function ledgerKeysFrom(ledger) {
  return (ledger?.declared_transitions ?? []).flatMap((t) => Array.isArray(t?.db_health_resolved) ? t.db_health_resolved : [])
    .map(String);
}

/* ----------------------------------------------------------------------------- curated replay */

/**
 * Build the transaction for an owner-approved curated SQL file. Refuses (policy) anything that is
 * not a single-row dbdoctor statement by uid, so a typo or a pasted statement cannot widen it.
 */
export function buildCuratedTransaction(text) {
  const { statements, unparsed } = parseSqlLog(text);
  if (unparsed.length) return { refused: unparsed, sql: null, statements };
  if (!statements.length) return { refused: [{ line: 0, sql: '(no statements)' }], sql: null, statements };
  const missingCheck = statements.filter((s) => !s.check);
  if (missingCheck.length) {
    return { refused: missingCheck.map((s) => ({ line: s.line, sql: `${s.sql} (no # Triggered by header)` })), sql: null, statements };
  }
  const sql = ['START TRANSACTION;', ...statements.map((s) => s.sql), 'COMMIT;', ''].join('\n');
  return { refused: [], sql, statements };
}

export function statementCounts(statements) {
  const counts = {};
  for (const s of statements) counts[s.check] = (counts[s.check] ?? 0) + 1;
  return canonical(counts);
}

/* ----------------------------------------------------------------------------- DDEV side */

/**
 * Run a command; resolve { code, stdout, stderr } and never throw on a non-zero exit.
 * Output is collected as Buffers and decoded once: decoding chunk by chunk corrupts a multibyte
 * UTF-8 character split across two chunks, which made the probe's restore fingerprint differ on
 * every call for large tables (exit 3 on an untouched database).
 */
export function defaultRunner(cmd, args, { cwd, input, timeoutMs, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    const child = spawnFn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [], err = [];
    let timer = null;
    const text = (chunks) => Buffer.concat(chunks).toString('utf8');
    child.stdout.on('data', (d) => { out.push(Buffer.from(d)); });
    child.stderr.on('data', (d) => { err.push(Buffer.from(d)); });
    if (timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (error) => { clearTimeout(timer); resolve({ code: 127, stdout: text(out), stderr: `${text(err)}${error.message}` }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code: signal ? 124 : code, stdout: text(out), stderr: text(err) }); });
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
  });
}

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

function dbdoctorCommand({ mode, timeoutSeconds, typo3Bin, file = null }) {
  return `COLUMNS=200 timeout ${Number(timeoutSeconds)} ${typo3Bin} dbdoctor:health --mode=${mode} --no-ansi --no-interaction`
    + (file ? ` --file=${shellQuote(file)}` : '');
}

export async function detectVersion({ run, cwd }) {
  const result = await run('ddev', ['composer', 'show', 'lolli/dbdoctor', '--format=json'], { cwd, timeoutMs: 120_000 });
  if (result.code !== 0) return null;
  try { return JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))).versions?.[0]?.replace(/^v/, '') ?? null; }
  catch { return null; }
}

export async function runCheck({ run = defaultRunner, cwd, timeoutSeconds = 3600, typo3Bin = 'vendor/bin/typo3', version }) {
  const result = await run('ddev', ['exec', 'bash', '-c', dbdoctorCommand({ mode: 'check', timeoutSeconds, typo3Bin })],
    { cwd, timeoutMs: (timeoutSeconds + 120) * 1000 });
  return { raw: result, parsed: parseCheckOutput({ stdout: result.stdout, stderr: result.stderr, exitCode: result.code, version }) };
}

/**
 * The probe. Runs only against a snapshot it took itself and always restores it, then proves the
 * restore with a database fingerprint taken before the probe. Exit 3 means the database could not be
 * proven restored: stop and restore the node snapshot by hand.
 */
export async function runProbe({ run = defaultRunner, cwd, out, version, timeoutSeconds = 3600, typo3Bin = 'vendor/bin/typo3',
  snapshotName, maxPasses = MAX_PROBE_PASSES, fingerprint, log = () => {} }) {
  if (!snapshotName || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(snapshotName)) throw usage('--snapshot-name must be a safe DDEV snapshot name');
  await mkdir(out, { recursive: true });
  const before = await fingerprint();
  const snap = await run('ddev', ['snapshot', '--name', snapshotName], { cwd, timeoutMs: 30 * 60_000 });
  if (snap.code !== 0 || /failed to snapshot/i.test(`${snap.stdout}\n${snap.stderr}`)) {
    return { exitCode: EXIT.HARNESS_ERROR, reason: `ddev snapshot ${snapshotName} failed; nothing was executed`, detail: stripAnsi(snap.stderr).slice(0, 500) };
  }
  const passes = [], statements = [], unparsed = [];
  let converged = false, executeError = null, restore = null, after = null;
  try {
    for (let pass = 1; pass <= maxPasses; pass += 1) {
      const file = `${CONTAINER_SQL_DIR}/${snapshotName}-pass${pass}.sql`;
      const exec = await run('ddev', ['exec', 'bash', '-c',
        `mkdir -p ${CONTAINER_SQL_DIR} && ${dbdoctorCommand({ mode: 'execute', timeoutSeconds, typo3Bin, file })}`],
      { cwd, timeoutMs: (timeoutSeconds + 120) * 1000 });
      await writeFile(path.join(out, `pass${pass}.execute.stdout.txt`), stripAnsi(exec.stdout));
      await writeFile(path.join(out, `pass${pass}.execute.stderr.txt`), stripAnsi(exec.stderr));
      const cat = await run('ddev', ['exec', 'cat', file], { cwd, timeoutMs: 120_000 });
      const sqlText = cat.code === 0 ? cat.stdout : '';
      await writeFile(path.join(out, `pass${pass}.sql`), sqlText);
      const parsed = parseSqlLog(sqlText, { file: `pass${pass}.sql` });
      statements.push(...parsed.statements);
      unparsed.push(...parsed.unparsed);
      passes.push({ pass, file: `pass${pass}.sql`, sha256: `sha256:${sha256(sqlText)}`, statements: parsed.statements.length,
        execute_exit: exec.code });
      if (![0, 1].includes(exec.code)) { executeError = `execute pass ${pass} exited ${exec.code}`; break; }
      const check = await runCheck({ run, cwd, timeoutSeconds, typo3Bin, version });
      await writeFile(path.join(out, `pass${pass}.check.json`), `${JSON.stringify(check.parsed, null, 2)}\n`);
      if (check.parsed.verdict === 'clean') { converged = true; break; }
    }
  } finally {
    await run('ddev', ['exec', 'rm', '-f', ...passes.map((p) => `${CONTAINER_SQL_DIR}/${snapshotName}-pass${p.pass}.sql`)], { cwd, timeoutMs: 60_000 });
    restore = await run('ddev', ['snapshot', 'restore', snapshotName], { cwd, timeoutMs: 30 * 60_000 });
    after = await fingerprint().catch((error) => ({ error: error.message }));
  }
  const restored = restore.code === 0 && !after.error ? compareContent(before, after) : { match: false, drifted: [{ key: after?.error ?? 'restore failed' }] };
  const document = recordsDocument({ passes, statements, unparsed, version, converged, passesRun: passes.length });
  const probe = withHash({ schema: 'typo3-upgrade-run/db-health-probe@1', snapshot: snapshotName, converged, execute_error: executeError,
    restore_exit: restore.code, restored: restored.match, drifted: restored.drifted.map((d) => d.key), records_sha256: document.sha256,
    fingerprint_before: before.fingerprintHash ?? null, fingerprint_after: after?.fingerprintHash ?? null });
  await writeFile(path.join(out, 'records.json'), `${JSON.stringify(document, null, 2)}\n`);
  await writeFile(path.join(out, 'probe.json'), `${JSON.stringify(probe, null, 2)}\n`);
  if (!restored.match) {
    log(`DATABASE NOT PROVEN RESTORED after the probe (${probe.drifted.join(', ')}). Stop and restore the node snapshot.`);
    return { exitCode: EXIT.INVALID, probe, document };
  }
  if (executeError) return { exitCode: EXIT.HARNESS_ERROR, probe, document };
  return { exitCode: document.records.length || !converged ? EXIT.FINDINGS : EXIT.PASS, probe, document };
}

export async function runApply({ run = defaultRunner, cwd, sqlText, approval, snapshot, out, version, timeoutSeconds = 3600,
  typo3Bin = 'vendor/bin/typo3', fingerprint }) {
  if (!approval || !/^APR-\d{3}$/.test(approval)) return { exitCode: EXIT.POLICY, reason: 'apply needs --approval APR-NNN naming the owner decision' };
  const built = buildCuratedTransaction(sqlText);
  if (built.refused.length) return { exitCode: EXIT.POLICY, reason: 'curated SQL contains statements that are not dbdoctor-shaped', refused: built.refused };
  const list = await run('ddev', ['snapshot', '--list'], { cwd, timeoutMs: 120_000 });
  if (!snapshot || list.code !== 0 || !list.stdout.split(/\s+/).includes(snapshot)) {
    return { exitCode: EXIT.PRECONDITION, reason: `snapshot ${snapshot ?? '(none)'} is not listed by ddev snapshot --list; take it first` };
  }
  await mkdir(out, { recursive: true });
  const before = await fingerprint();
  await writeFile(path.join(out, 'apply.sql'), built.sql);
  const applied = await run('ddev', ['mysql'], { cwd, input: built.sql, timeoutMs: (timeoutSeconds + 120) * 1000 });
  if (applied.code !== 0) {
    return { exitCode: EXIT.HARNESS_ERROR, reason: `ddev mysql exited ${applied.code}; the transaction was not committed`, detail: stripAnsi(applied.stderr).slice(0, 500) };
  }
  const refindex = await run('ddev', ['exec', typo3Bin, 'referenceindex:update'], { cwd, timeoutMs: (timeoutSeconds + 120) * 1000 });
  const flush = await run('ddev', ['exec', typo3Bin, 'cache:flush'], { cwd, timeoutMs: 600_000 });
  const check = await runCheck({ run, cwd, timeoutSeconds, typo3Bin, version });
  const after = await fingerprint();
  const record = withHash({ schema: 'typo3-upgrade-run/db-health-apply@1', approval, snapshot, tool: { package: 'lolli/dbdoctor', version: version ?? null },
    sql_sha256: `sha256:${sha256(built.sql)}`, statements: built.statements.length, statements_per_check: statementCounts(built.statements),
    referenceindex_exit: refindex.code, cache_flush_exit: flush.code, recheck: { verdict: check.parsed.verdict, sha256: check.parsed.sha256 },
    fingerprint_before: before.fingerprintHash ?? null, fingerprint_after: after.fingerprintHash ?? null });
  await writeFile(path.join(out, 'recheck.json'), `${JSON.stringify(check.parsed, null, 2)}\n`);
  await writeFile(path.join(out, 'apply.json'), `${JSON.stringify(record, null, 2)}\n`);
  if (refindex.code !== 0 || flush.code !== 0) return { exitCode: EXIT.HARNESS_ERROR, record };
  return { exitCode: check.parsed.verdict === 'clean' ? EXIT.PASS : exitForCheck(check.parsed), record };
}

/** Fingerprint every non-cache table of the DDEV database; files are out of scope for dbdoctor. */
export function ddevDatabaseFingerprint({ run = defaultRunner, cwd, extraExcludes = [] }) {
  return async () => {
    const shown = await run('ddev', ['mysql', '-N', '-e', 'SHOW TABLES'], { cwd, timeoutMs: 120_000 });
    if (shown.code !== 0) throw new Error(`SHOW TABLES failed (${shown.code})`);
    const tables = shown.stdout.split('\n').map((t) => t.trim()).filter(Boolean)
      .filter((t) => !t.startsWith('cache_') && !extraExcludes.includes(t));
    // collectContent's own runner has no working directory; this one runs ddev in the project.
    const runner = async (sql) => {
      const result = await run('ddev', ['mysql', '-e', `${sql};`], { cwd, timeoutMs: 120_000 });
      if (result.code !== 0) {
        const error = new Error(stripAnsi(result.stderr).trim().split('\n')[0] || `ddev mysql exited ${result.code}`);
        error.exitCode = result.code;
        throw error;
      }
      return result.stdout;
    };
    return collectContent({ tables, runner, fileadmin: path.join(cwd ?? '.', '.db-health-no-files'),
      log: { warn() {}, info() {}, debug() {}, error() {} } });
  };
}

/* ----------------------------------------------------------------------------- CLI */

function usage(message) { const error = new Error(message); error.exitCode = EXIT.PRECONDITION; return error; }

async function readJson(file) { return JSON.parse(await readFile(file, 'utf8')); }

async function writeJson(file, data) {
  if (!file) { process.stdout.write(`${JSON.stringify(data, null, 2)}\n`); return; }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

const HELP = `Usage: node db-health.mjs <command> [options]
  check        --project <dir> --out <dir> [--version x.y.z] [--timeout 3600] [--typo3-bin vendor/bin/typo3]
  parse-check  --stdout <file> --exit <n> [--stderr <file>] [--version x.y.z] [--json <file>]
  probe        --project <dir> --out <dir> --snapshot-name <name> [--version] [--timeout] [--max-passes 5]
  parse-sql    --sql <file> [--sql <file> ...] [--version x.y.z] [--json <file>]
  compare      --target <records.json> [--intake <records.json>|none] [--ledger <content-transition.json>]
               [--pre-existing <keys.json>] [--require-ledgered] [--json <file>]
  apply        --project <dir> --sql <curated.sql> --approval APR-NNN --snapshot <name> --out <dir> [--version]
Exit: 0 pass, 1 findings, 2 harness error, 3 restore not proven, 4 precondition, 5 refused by policy.`;

export async function main(argv, { run = defaultRunner, stderr = (m) => process.stderr.write(`${m}\n`) } = {}) {
  const [command, ...rest] = argv;
  const { values } = parseArgs({ args: rest, allowPositionals: false, options: {
    project: { type: 'string' }, out: { type: 'string' }, version: { type: 'string' }, timeout: { type: 'string', default: '3600' },
    'typo3-bin': { type: 'string', default: 'vendor/bin/typo3' }, stdout: { type: 'string' }, stderr: { type: 'string' },
    exit: { type: 'string' }, json: { type: 'string' }, 'snapshot-name': { type: 'string' }, 'max-passes': { type: 'string', default: String(MAX_PROBE_PASSES) },
    sql: { type: 'string', multiple: true }, intake: { type: 'string' }, target: { type: 'string' }, ledger: { type: 'string' },
    'pre-existing': { type: 'string' }, 'require-ledgered': { type: 'boolean', default: false }, approval: { type: 'string' },
    snapshot: { type: 'string' }, help: { type: 'boolean', default: false },
  } });
  if (!command || values.help || command === 'help') { process.stdout.write(`${HELP}\n`); return EXIT.PASS; }
  const timeoutSeconds = Number(values.timeout);
  const cwd = values.project ? path.resolve(values.project) : undefined;
  const typo3Bin = values['typo3-bin'];
  if (!/^[A-Za-z0-9._/-]+$/.test(typo3Bin)) throw usage('--typo3-bin may contain letters, digits, dot, dash, underscore and slash');

  if (command === 'parse-check') {
    if (!values.stdout || values.exit === undefined) throw usage('parse-check needs --stdout and --exit');
    const parsed = parseCheckOutput({ stdout: await readFile(values.stdout, 'utf8'),
      stderr: values.stderr ? await readFile(values.stderr, 'utf8') : '', exitCode: Number(values.exit), version: values.version ?? null });
    await writeJson(values.json, parsed);
    return exitForCheck(parsed);
  }
  if (command === 'parse-sql') {
    if (!values.sql?.length) throw usage('parse-sql needs --sql');
    const passes = [], statements = [], unparsed = [];
    for (const file of values.sql) {
      const text = await readFile(file, 'utf8');
      const parsed = parseSqlLog(text, { file: path.basename(file) });
      passes.push({ file: path.basename(file), sha256: `sha256:${sha256(text)}`, statements: parsed.statements.length });
      statements.push(...parsed.statements); unparsed.push(...parsed.unparsed);
    }
    const document = recordsDocument({ passes, statements, unparsed, version: values.version ?? null });
    await writeJson(values.json, document);
    return unparsed.length ? EXIT.HARNESS_ERROR : document.records.length ? EXIT.FINDINGS : EXIT.PASS;
  }
  if (command === 'compare') {
    if (!values.target) throw usage('compare needs --target');
    const intake = !values.intake || values.intake === 'none' ? null : await readJson(values.intake);
    const target = await readJson(values.target);
    const ledgerKeys = values.ledger ? ledgerKeysFrom(await readJson(values.ledger)) : [];
    const preExisting = values['pre-existing'] ? (await readJson(values['pre-existing'])).map(String) : [];
    const result = compareInventories(intake, target, { ledgerKeys, preExisting });
    await writeJson(values.json, result);
    return exitForCompare(result, { requireLedgered: values['require-ledgered'] });
  }
  if (!cwd) throw usage(`${command} needs --project`);
  if (!values.out) throw usage(`${command} needs --out`);
  const out = path.resolve(values.out);
  const version = values.version ?? await detectVersion({ run, cwd });
  if (!version) throw usage('lolli/dbdoctor is not installed (ddev composer show lolli/dbdoctor failed); install the pinned version first');
  if (!orderKey(version)) stderr(`warning: lolli/dbdoctor ${version} is not a pinned release (1.0.6 or 2.2.x); not-run checks cannot be listed`);

  if (command === 'check') {
    await mkdir(out, { recursive: true });
    const { raw, parsed } = await runCheck({ run, cwd, timeoutSeconds, typo3Bin, version });
    await writeFile(path.join(out, 'dbdoctor-check.stdout.txt'), stripAnsi(raw.stdout));
    await writeFile(path.join(out, 'dbdoctor-check.stderr.txt'), stripAnsi(raw.stderr));
    await writeFile(path.join(out, 'dbdoctor-check.exit'), `${raw.code}\n`);
    await writeJson(path.join(out, 'check.json'), parsed);
    stderr(`dbdoctor ${version}: ${parsed.verdict} (${parsed.totals.affected} affected checks, ${parsed.totals.affected_rows} rows)`
      + (parsed.verdict === 'partial-findings' ? `; aborted at ${parsed.aborted?.class}: run the probe for the full inventory` : ''));
    return exitForCheck(parsed);
  }
  if (command === 'probe') {
    const result = await runProbe({ run, cwd, out, version, timeoutSeconds, typo3Bin, snapshotName: values['snapshot-name'],
      maxPasses: Math.min(MAX_PROBE_PASSES, Math.max(1, Number(values['max-passes']))), fingerprint: ddevDatabaseFingerprint({ run, cwd }), log: stderr });
    if (result.reason) stderr(result.reason);
    else stderr(`probe: ${result.document.records.length} records in ${result.document.groups.length} groups, converged=${result.probe.converged}, restored=${result.probe.restored}`);
    return result.exitCode;
  }
  if (command === 'apply') {
    if (!values.sql?.length) throw usage('apply needs --sql <curated.sql>');
    const result = await runApply({ run, cwd, sqlText: await readFile(values.sql[0], 'utf8'), approval: values.approval, snapshot: values.snapshot,
      out, version, timeoutSeconds, typo3Bin, fingerprint: ddevDatabaseFingerprint({ run, cwd }) });
    if (result.reason) stderr(result.reason);
    for (const refused of result.refused ?? []) stderr(`  refused line ${refused.line}: ${refused.sql}`);
    return result.exitCode;
  }
  throw usage(`unknown command ${command}\n${HELP}`);
}

if (isMain(import.meta.url)) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`db-health: ${error.message}\n`);
    process.exitCode = error.exitCode ?? EXIT.HARNESS_ERROR;
  }
}
