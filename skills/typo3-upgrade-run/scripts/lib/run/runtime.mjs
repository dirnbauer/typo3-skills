/** Evidence-derived runtime sizing for whole-project upgrades. */

import { PreconditionError } from '../cli/exit-codes.mjs';

export const RUNTIME_SIZE_SCHEMA = 'typo3-upgrade-run/runtime-size@1';

export const RUNTIME_PROFILES = Object.freeze({
  small: Object.freeze({ maxHours: 8, closureReserveHours: 2 }),
  large: Object.freeze({ maxHours: 12, closureReserveHours: 3 }),
  huge: Object.freeze({ maxHours: 14, closureReserveHours: 4 }),
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

export function sizingEvidenceIssues(evidence) {
  const issues = [];
  if (evidence?.schema !== RUNTIME_SIZE_SCHEMA) issues.push(`schema must be ${RUNTIME_SIZE_SCHEMA}`);
  if (!evidence?.metrics || typeof evidence.metrics !== 'object' || Array.isArray(evidence.metrics)) {
    issues.push('metrics must be an object');
  }
  if (!evidence?.sources || typeof evidence.sources !== 'object' || Array.isArray(evidence.sources)) {
    issues.push('sources must be an object');
  }
  for (const key of SIZE_METRICS) {
    const value = evidence?.metrics?.[key];
    if (!Number.isInteger(value) || value < 0) issues.push(`metrics.${key} must be a non-negative integer`);
    if (typeof evidence?.sources?.[key] !== 'string' || !evidence.sources[key].trim()) {
      issues.push(`sources.${key} must name inspectable evidence`);
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

export function runtimeWindow(startedAt, size) {
  const profile = RUNTIME_PROFILES[size];
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
  try { expected = runtimeWindow(runtime.started_at, runtime.size_profile); }
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
