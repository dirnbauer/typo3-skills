/** Evidence-derived runtime sizing for whole-project upgrades. */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { PreconditionError } from '../cli/exit-codes.mjs';
import { sha256 } from './paths.mjs';

export const RUNTIME_SIZE_SCHEMA = 'typo3-upgrade-run/runtime-size@1';
export const RUNTIME_BUDGET_POLICY = 'site-size-v2';

export const RUNTIME_PROFILES = Object.freeze({
  small: Object.freeze({ maxHours: 8, closureReserveHours: 2 }),
  large: Object.freeze({ maxHours: 24, closureReserveHours: 6 }),
  huge: Object.freeze({ maxHours: 48, closureReserveHours: 12 }),
});

// An absent policy marker belongs to the original seal, never to today's defaults.
const RUNTIME_POLICIES = Object.freeze({
  [RUNTIME_BUDGET_POLICY]: RUNTIME_PROFILES,
  'overnight-v1': Object.freeze({
    small: Object.freeze({ maxHours: 8, closureReserveHours: 2 }),
    large: Object.freeze({ maxHours: 12, closureReserveHours: 3 }),
    huge: Object.freeze({ maxHours: 14, closureReserveHours: 4 }),
  }),
});

export const SIZE_METRICS = Object.freeze([
  'public_routes',
  'content_records',
  'fileadmin_files',
  'sites',
  'languages',
  'active_non_core_extensions',
  'local_packages',
  'stateful_migrations',
  'compatibility_blockers',
]);

/** The smallest profile whose every upper bound contains the evidence wins. */
export const SIZE_LIMITS = Object.freeze({
  small: Object.freeze({
    public_routes: 250,
    content_records: 10_000,
    fileadmin_files: 25_000,
    sites: 1,
    languages: 2,
    active_non_core_extensions: 12,
    local_packages: 2,
    stateful_migrations: 1,
    compatibility_blockers: 0,
  }),
  large: Object.freeze({
    public_routes: 2_500,
    content_records: 100_000,
    fileadmin_files: 250_000,
    sites: 3,
    languages: 6,
    active_non_core_extensions: 35,
    local_packages: 8,
    stateful_migrations: 4,
    compatibility_blockers: 2,
  }),
});

/**
 * How a package that blocks `composer why-not typo3/cms-core ^14.3` is resolved.
 * Only work on a package the project uses counts toward the size profile: a fork, a local
 * migration of templates/config/code, a migration of stored data, or removing a used package
 * (its usages have to be migrated first).
 */
export const BLOCKER_RESOLUTIONS = Object.freeze([
  'fork',
  'local-migration',
  'data-migration',
  'drop-in-replacement',
  'supported-release',
  'removal',
]);

function blockerInventoryIssues(inventory) {
  if (!Array.isArray(inventory)) return ['compatibility_blocker_inventory must be an array'];
  const issues = [];
  const seen = new Set();
  inventory.forEach((entry, index) => {
    const at = `compatibility_blocker_inventory[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push(`${at} must be an object`);
      return;
    }
    if (typeof entry.package !== 'string' || !entry.package.trim()) issues.push(`${at}.package must name the package`);
    else if (seen.has(entry.package)) issues.push(`${at}.package ${entry.package} is listed twice`);
    else seen.add(entry.package);
    if (typeof entry.dev_only !== 'boolean') issues.push(`${at}.dev_only must be true or false`);
    if (!Number.isInteger(entry.usage) || entry.usage < 0) {
      issues.push(`${at}.usage must be a non-negative integer (content rows, config and code references)`);
    }
    if (!BLOCKER_RESOLUTIONS.includes(entry.resolution)) {
      issues.push(`${at}.resolution must be one of ${BLOCKER_RESOLUTIONS.join(', ')}`);
    }
    if (typeof entry.source !== 'string' || !entry.source.trim()) issues.push(`${at}.source must name inspectable evidence`);
  });
  return issues;
}

/**
 * Splits the blocker inventory into blockers that count toward the size profile and
 * packages that are only recorded: dev-only packages, packages without any usage, and
 * drop-in replacements or plain upgrades. A used package that is removed counts, because
 * its content, configuration or code has to be migrated first.
 */
export function classifyCompatibilityBlockers(inventory) {
  const counted = [];
  const recorded = [];
  for (const entry of inventory) {
    let reason = null;
    if (entry.dev_only) reason = 'dev-only';
    else if (entry.usage === 0) reason = 'unused';
    else if (entry.resolution === 'drop-in-replacement' || entry.resolution === 'supported-release') {
      reason = entry.resolution;
    }
    if (reason) recorded.push({ package: entry.package, reason });
    else {
      counted.push({ package: entry.package, resolution: entry.resolution });
    }
  }
  return { counted, recorded };
}

/** The metrics the profile is classified from: blockers derived from the inventory when present. */
export function sizingMetrics(evidence) {
  const metrics = { ...evidence.metrics };
  if (Array.isArray(evidence.compatibility_blocker_inventory)) {
    metrics.compatibility_blockers = classifyCompatibilityBlockers(evidence.compatibility_blocker_inventory).counted.length;
  }
  return metrics;
}

export function sizingEvidenceIssues(evidence) {
  const issues = [];
  if (evidence?.schema !== RUNTIME_SIZE_SCHEMA) issues.push(`schema must be ${RUNTIME_SIZE_SCHEMA}`);
  if (!evidence?.metrics || typeof evidence.metrics !== 'object' || Array.isArray(evidence.metrics)) {
    issues.push('metrics must be an object');
  }
  if (!evidence?.sources || typeof evidence.sources !== 'object' || Array.isArray(evidence.sources)) {
    issues.push('sources must be an object');
  }
  const inventory = evidence?.compatibility_blocker_inventory;
  const hasInventory = inventory !== undefined;
  const inventoryIssues = hasInventory ? blockerInventoryIssues(inventory) : [];
  issues.push(...inventoryIssues);
  for (const key of SIZE_METRICS) {
    const value = evidence?.metrics?.[key];
    const derived = key === 'compatibility_blockers' && hasInventory;
    if (!(derived && value === undefined) && (!Number.isInteger(value) || value < 0)) {
      issues.push(`metrics.${key} must be a non-negative integer`);
    }
    if (typeof evidence?.sources?.[key] !== 'string' || !evidence.sources[key].trim()) {
      issues.push(`sources.${key} must name inspectable evidence`);
    }
  }
  const stated = evidence?.metrics?.compatibility_blockers;
  if (!hasInventory && Number.isInteger(stated) && stated > 0) {
    issues.push('compatibility_blocker_inventory must itemize every blocker when metrics.compatibility_blockers is above 0');
  }
  if (hasInventory && !inventoryIssues.length && stated !== undefined) {
    const counted = classifyCompatibilityBlockers(inventory).counted.length;
    if (stated !== counted) {
      issues.push(`metrics.compatibility_blockers is ${stated} but the inventory counts ${counted}; omit the metric or state the counted value`);
    }
  }
  return issues;
}

export function classifySiteSize(metrics) {
  for (const size of ['small', 'large']) {
    if (SIZE_METRICS.every((key) => metrics[key] <= SIZE_LIMITS[size][key])) return size;
  }
  return 'huge';
}

export function runtimeWindow(startedAt, size, budgetPolicy = RUNTIME_BUDGET_POLICY) {
  const profiles = RUNTIME_POLICIES[budgetPolicy];
  if (!profiles) throw new TypeError(`Unknown runtime budget policy: ${budgetPolicy}`);
  const profile = profiles[size];
  if (!profile) throw new TypeError(`Unknown runtime size profile: ${size}`);
  const startedMs = Date.parse(startedAt);
  if (!Number.isFinite(startedMs)) throw new TypeError(`Invalid runtime start timestamp: ${startedAt}`);
  const deadlineMs = startedMs + profile.maxHours * 60 * 60 * 1000;
  const cutoffMs = deadlineMs - profile.closureReserveHours * 60 * 60 * 1000;
  return {
    sizeProfile: size,
    maxHours: profile.maxHours,
    closureReserveHours: profile.closureReserveHours,
    migrationCutoffAt: new Date(cutoffMs).toISOString(),
    deadlineAt: new Date(deadlineMs).toISOString(),
  };
}

export function phaseUsesMigrationWindow(phase) {
  const number = Number(String(phase ?? '').match(/^P(\d{2})$/)?.[1]);
  return Number.isInteger(number) && number >= 5 && number <= 10;
}

export function assertPhaseRuntime(runtime, phase, timestamp = Date.now(), { contractAClosed = false, window = null } = {}) {
  const phaseNumber = Number(String(phase ?? '').match(/^P(\d{2})$/)?.[1]);
  const requiresSealedRuntime = Number.isInteger(phaseNumber) && phaseNumber >= 2 && phaseNumber <= 13;
  if (requiresSealedRuntime && !runtime?.deadline_at) {
    throw new PreconditionError(
      'Runtime sizing is not sealed. Complete read-only intake evidence and run t3u runtime-seal first.',
    );
  }
  // Without a verified ledger only the sealed window counts: an unverified extension never widens it.
  const effective = window ?? sealedRuntimeWindow(runtime);
  const by = effective.extension ? `, extended by ${effective.extension.approval_id},` : '';
  if (phaseUsesMigrationWindow(phase)) {
    if (Number.isFinite(effective.cutoffMs) && timestamp >= effective.cutoffMs) {
      throw new PreconditionError(
        `The ${runtime.size_profile} migration cutoff (${effective.cutoffAt})${by} has passed. `
        + 'Start no new P05-P10 cause; use the reserved window for P11-P13 closure or report incomplete.',
      );
    }
  }
  if (!contractAClosed && Number.isFinite(effective.deadlineMs) && timestamp >= effective.deadlineMs) {
    throw new PreconditionError(
      `The ${runtime.size_profile ?? 'legacy'} ${runtime.max_hours}h deadline (${effective.deadlineAt})${by} has passed. `
      + 'Contract A remains incomplete; do not report a pass.',
    );
  }
  return true;
}

/**
 * Validates the sealed values against their profile, then every recorded extension. `context`
 * carries the approvals read by readRuntimeApprovals; without it an extension cannot verify.
 */
export function runtimeProfileIssues(runtime, context = {}) {
  if (!runtime?.size_profile) {
    return runtime?.extensions?.length ? ['runtime.extensions require a sealed runtime profile'] : [];
  }
  let expected;
  try {
    expected = runtimeWindow(runtime.started_at, runtime.size_profile, runtime.budget_policy ?? 'overnight-v1');
  }
  catch (error) { return [error.message]; }
  const checks = [
    ['max_hours', expected.maxHours],
    ['closure_reserve_hours', expected.closureReserveHours],
    ['migration_cutoff_at', expected.migrationCutoffAt],
    ['deadline_at', expected.deadlineAt],
  ];
  return [
    ...checks
      .filter(([key, value]) => runtime[key] !== value)
      .map(([key, value]) => `runtime.${key} must equal sealed ${runtime.size_profile} profile value ${value}`),
    ...runtimeExtensionLedger(runtime, context).issues,
  ];
}

/*
 * Runtime extensions. The sealed window (started_at, migration_cutoff_at, deadline_at,
 * size_profile) is never rewritten. The owner may extend or waive it by a granted intent
 * approval; `t3u runtime-extend` appends one entry per decision to runtime.extensions. The
 * effective window is the latest entry that verifies against the window before it and against
 * its approval file, byte for byte. An extension moves only time limits, never a proof rule.
 */

const SHA256_REF = /^sha256:[a-f0-9]{64}$/;
const APPROVAL_ID = /^APR-\d{3}$/;
const HOUR_MS = 60 * 60 * 1000;

function windowOf(cutoffAt, deadlineAt, waived = false, extension = null) {
  return {
    cutoffAt: waived ? null : cutoffAt ?? null,
    deadlineAt: waived ? null : deadlineAt ?? null,
    cutoffMs: waived ? Infinity : Date.parse(cutoffAt ?? ''),
    deadlineMs: waived ? Infinity : Date.parse(deadlineAt ?? ''),
    waived,
    extension,
  };
}

/** The window the seal fixed: no extension counts. */
export function sealedRuntimeWindow(runtime) {
  return windowOf(runtime?.migration_cutoff_at, runtime?.deadline_at);
}

const canonicalTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;

/** One intent approval file APR-NNN-intent-*.md: its exact bytes hash and its front matter. */
export async function readIntentApproval(approvalsDir, id, listing = null) {
  const files = (listing ?? await readdir(approvalsDir).catch(() => []))
    .filter((name) => name.startsWith(`${id}-intent-`) && name.endsWith('.md'));
  const record = { id, files, file: files.length === 1 ? files[0] : null, sha256: null, meta: null };
  if (!record.file) return record;
  const bytes = await readFile(path.join(approvalsDir, record.file)).catch(() => null);
  if (!bytes) return record;
  record.sha256 = `sha256:${sha256(bytes)}`;
  try { record.meta = parseYaml(bytes.toString('utf8').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '') ?? null; }
  catch { record.meta = null; }
  return record;
}

/** Why an approval record cannot authorise a runtime extension (empty when it can). */
export function intentApprovalIssues(approval, { runId = null, granted = [] } = {}) {
  if (!approval?.files?.length) return [`approval ${approval?.id ?? '?'} has no intent approval file`];
  if (approval.files.length > 1) return [`approval ${approval.id} has ${approval.files.length} intent approval files`];
  if (!approval.sha256) return [`approval ${approval.id} cannot be read`];
  const meta = approval.meta ?? {};
  const issues = [];
  if (meta.id !== approval.id) issues.push(`approval ${approval.id} names id ${meta.id ?? 'none'}`);
  if (meta.stage !== 'intent') issues.push(`approval ${approval.id} is not an intent approval`);
  if (meta.granted_by !== 'user' || !Number.isFinite(Date.parse(meta.granted_at ?? ''))) {
    issues.push(`approval ${approval.id} is not granted by the user`);
  }
  if (meta.run_id !== runId) issues.push(`approval ${approval.id} belongs to another run`);
  if (!granted.includes(approval.id)) issues.push(`approval ${approval.id} is not recorded as granted in state.approvals`);
  return issues;
}

/** Reads the approval behind every recorded extension. */
export async function readRuntimeApprovals(approvalsDir, runtime) {
  const ids = [...new Set((Array.isArray(runtime?.extensions) ? runtime.extensions : [])
    .map((entry) => entry?.approval_id).filter((id) => APPROVAL_ID.test(String(id ?? ''))))];
  const approvals = new Map();
  if (!ids.length) return approvals;
  const listing = await readdir(approvalsDir).catch(() => []);
  for (const id of ids) approvals.set(id, await readIntentApproval(approvalsDir, id, listing));
  return approvals;
}

function extensionIssues(entry, current, { runtime, approvals, runId, granted, previousRecordedAt, usedIds }) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['must be an object'];
  const issues = [];
  if (!APPROVAL_ID.test(String(entry.approval_id ?? ''))) issues.push('approval_id must be APR-NNN');
  else if (usedIds.has(entry.approval_id)) issues.push(`approval ${entry.approval_id} already authorised an earlier extension`);
  if (!SHA256_REF.test(String(entry.approval_sha256 ?? ''))) issues.push('approval_sha256 must be sha256:<64 hex>');
  if (entry.previous_cutoff !== current.cutoffAt || entry.previous_deadline !== current.deadlineAt) {
    issues.push(`previous_cutoff/previous_deadline must equal the window before it (${current.cutoffAt ?? 'waived'} / ${current.deadlineAt ?? 'waived'})`);
  }
  if (typeof entry.waived !== 'boolean') issues.push('waived must be true or false');
  else if (entry.waived) {
    if (entry.new_cutoff !== null || entry.new_deadline !== null) issues.push('a waiver sets new_cutoff and new_deadline to null');
    if (current.waived) issues.push('the window is already waived');
  } else if (!canonicalTime(entry.new_cutoff) || !canonicalTime(entry.new_deadline)) {
    issues.push('new_cutoff and new_deadline must be ISO 8601 UTC timestamps');
  } else {
    const deadline = Date.parse(entry.new_deadline);
    const reserve = Number(runtime?.closure_reserve_hours) * HOUR_MS;
    if (!current.waived && deadline <= current.deadlineMs) issues.push('new_deadline must be later than the window before it; an extension never shortens it');
    if (!Number.isFinite(reserve) || Date.parse(entry.new_cutoff) !== deadline - reserve) {
      issues.push(`new_cutoff must keep the sealed ${runtime?.closure_reserve_hours}h closure reserve before new_deadline`);
    }
  }
  if (typeof entry.reason !== 'string' || !entry.reason.trim()) issues.push('reason must say why the owner extended the run');
  const recordedAt = Date.parse(entry.recorded_at ?? '');
  if (!canonicalTime(entry.recorded_at)) issues.push('recorded_at must be an ISO 8601 UTC timestamp');
  else if (recordedAt < previousRecordedAt) issues.push('entries must be ordered by recorded_at');
  else if (Number.isFinite(Date.parse(runtime?.sealed_at ?? '')) && recordedAt < Date.parse(runtime.sealed_at)) {
    issues.push('recorded_at precedes the runtime seal');
  }
  if (!approvals) issues.push('cannot be verified without its approval file');
  else if (APPROVAL_ID.test(String(entry.approval_id ?? ''))) {
    const approval = approvals.get(entry.approval_id) ?? { id: entry.approval_id, files: [] };
    issues.push(...intentApprovalIssues(approval, { runId, granted }));
    if (approval.sha256 && approval.sha256 !== entry.approval_sha256) {
      issues.push(`approval ${entry.approval_id} changed after the extension was recorded (sha256 mismatch)`);
    }
    if (Number.isFinite(recordedAt) && Date.parse(approval.meta?.granted_at ?? '') > recordedAt) {
      issues.push(`approval ${entry.approval_id} was granted after the extension was recorded`);
    }
  }
  return issues;
}

/**
 * Walks runtime.extensions in order. An entry counts only when it has no issue against the
 * window before it; a refused entry leaves that window in force (and so does every later entry
 * that chained onto it). `issues` names every refusal for graph-validate and validate-run.
 */
export function runtimeExtensionLedger(runtime, { approvals = null, runId = null, granted = [] } = {}) {
  let window = sealedRuntimeWindow(runtime);
  const entries = runtime?.extensions;
  if (entries === undefined || entries === null) return { window, issues: [], applied: [] };
  if (!Array.isArray(entries)) return { window, issues: ['runtime.extensions must be an array'], applied: [] };
  const issues = [], applied = [], usedIds = new Set();
  if (entries.length && !runtime?.deadline_at) issues.push('runtime.extensions require a sealed runtime');
  let previousRecordedAt = -Infinity;
  entries.forEach((entry, index) => {
    const own = extensionIssues(entry, window, { runtime, approvals, runId, granted, previousRecordedAt, usedIds });
    if (Number.isFinite(Date.parse(entry?.recorded_at ?? ''))) previousRecordedAt = Math.max(previousRecordedAt, Date.parse(entry.recorded_at));
    if (APPROVAL_ID.test(String(entry?.approval_id ?? ''))) usedIds.add(entry.approval_id);
    if (own.length || !runtime?.deadline_at) {
      issues.push(...own.map((issue) => `runtime.extensions[${index}] ${issue}`));
      return;
    }
    window = windowOf(entry.new_cutoff, entry.new_deadline, entry.waived, entry);
    applied.push(entry);
  });
  return { window, issues, applied };
}

/** The verified ledger for a run: reads the approvals from the run directory. */
export async function resolveRuntime(paths, state) {
  const approvals = await readRuntimeApprovals(paths.approvalsDir, state?.runtime);
  return runtimeExtensionLedger(state?.runtime, { approvals, runId: state?.run_id ?? null, granted: state?.approvals ?? [] });
}

/** "cutoff waived by APR-NNN" or "extended to … by APR-NNN"; null for the sealed window. */
export function describeRuntimeWindow(window) {
  const extension = window?.extension;
  if (!extension) return null;
  return window.waived
    ? `cutoff waived by ${extension.approval_id} (no cutoff and no deadline)`
    : `extended to ${window.deadlineAt} (migration cutoff ${window.cutoffAt}) by ${extension.approval_id}`;
}
