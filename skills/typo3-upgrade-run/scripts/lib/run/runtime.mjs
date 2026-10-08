/** Evidence-derived runtime sizing for whole-project upgrades. */

import { PreconditionError } from '../cli/exit-codes.mjs';

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

export function assertPhaseRuntime(runtime, phase, timestamp = Date.now(), { contractAClosed = false } = {}) {
  const phaseNumber = Number(String(phase ?? '').match(/^P(\d{2})$/)?.[1]);
  const requiresSealedRuntime = Number.isInteger(phaseNumber) && phaseNumber >= 2 && phaseNumber <= 13;
  if (requiresSealedRuntime && !runtime?.deadline_at) {
    throw new PreconditionError(
      'Runtime sizing is not sealed. Complete read-only intake evidence and run t3u runtime-seal first.',
    );
  }
  if (phaseUsesMigrationWindow(phase)) {
    const cutoff = Date.parse(runtime?.migration_cutoff_at ?? '');
    if (Number.isFinite(cutoff) && timestamp >= cutoff) {
      throw new PreconditionError(
        `The ${runtime.size_profile} migration cutoff (${runtime.migration_cutoff_at}) has passed. `
        + 'Start no new P05-P10 cause; use the reserved window for P11-P13 closure or report incomplete.',
      );
    }
  }
  const deadline = Date.parse(runtime?.deadline_at ?? '');
  if (!contractAClosed && Number.isFinite(deadline) && timestamp >= deadline) {
    throw new PreconditionError(
      `The ${runtime.size_profile ?? 'legacy'} ${runtime.max_hours}h deadline (${runtime.deadline_at}) has passed. `
      + 'Contract A remains incomplete; do not report a pass.',
    );
  }
  return true;
}

export function runtimeProfileIssues(runtime) {
  if (!runtime?.size_profile) return [];
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
  return checks
    .filter(([key, value]) => runtime[key] !== value)
    .map(([key, value]) => `runtime.${key} must equal sealed ${runtime.size_profile} profile value ${value}`);
}
