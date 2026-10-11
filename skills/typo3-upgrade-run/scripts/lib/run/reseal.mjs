/**
 * Approval-bound re-seal of the environment fingerprint after a harness hotfix.
 *
 * `harness.sourceHash` is part of the sealed environment fingerprint, so a fix to the measuring
 * harness makes env-fingerprint, loop-open, every comparison, gate and closure-start refuse the
 * run as drifted. The owner may re-seal for exactly that change and nothing else: only
 * harness.version, harness.sourceHash and harness.bookkeepingHash may differ, every other field
 * must equal its sealed value. Each re-seal appends one entry to state.fingerprints.environment_reseals
 * that binds the granted intent approval byte for byte, and marks the self-test stale: the next
 * capture or comparison needs a fresh selftest-determinism under the new harness.
 */

import { compareEnvironment, hashComponents, HASH_RELEVANT } from '../fingerprint/environment.mjs';
import { intentApprovalIssues, readIntentApproval } from './runtime.mjs';
import { readdir } from 'node:fs/promises';

/** The only fields a re-seal may change. harness.bookkeepingHash is recorded, never hashed. */
export const RESEALABLE_KEYS = Object.freeze(['harness.version', 'harness.sourceHash', 'harness.bookkeepingHash']);
const HARNESS_FIELDS = Object.freeze(['version', 'sourceHash', 'bookkeepingHash']);
const SHA256_REF = /^sha256:[a-f0-9]{64}$/;
const APPROVAL_ID = /^APR-\d{3}$/;

const harnessOf = (record) => Object.fromEntries(HARNESS_FIELDS.map((key) => [key, record?.components?.harness?.[key] ?? null]));

/**
 * What a re-seal from `sealed` to `current` would change. `forbidden` names every hashed field
 * outside the harness identity that differs; any entry there refuses the re-seal.
 */
export function resealDrift(sealed, current) {
  const { drifted } = compareEnvironment(sealed, current);
  const forbidden = drifted.filter((entry) => !RESEALABLE_KEYS.includes(entry.key));
  const before = harnessOf(sealed), after = harnessOf(current);
  const changed = HARNESS_FIELDS.filter((key) => before[key] !== after[key]);
  return { forbidden, changed, before, after };
}

/**
 * The re-sealed record: the sealed components with only the harness identity taken from the
 * current collection. Recorded-only provenance (PHP, TYPO3, host) stays as it was sealed.
 */
export function resealedEnvironment(sealed, current, reseal) {
  const components = {
    ...sealed.components,
    harness: { ...sealed.components?.harness, ...Object.fromEntries(HARNESS_FIELDS.map((key) => [key, current.components?.harness?.[key] ?? null])) },
  };
  return {
    ...sealed,
    fingerprintHash: hashComponents(components),
    hashRelevantKeys: [...HASH_RELEVANT],
    components,
    reseal,
  };
}

/** True when the sealed record was hashed under today's key set, so its hash can be recomputed. */
export function sealedHashVerifiable(sealed) {
  const keys = sealed?.hashRelevantKeys;
  return Array.isArray(keys) && keys.length === HASH_RELEVANT.length && keys.every((key, i) => key === HASH_RELEVANT[i]);
}

/** Reads the approval behind every recorded re-seal. */
export async function readResealApprovals(approvalsDir, state) {
  const ids = [...new Set((Array.isArray(state?.fingerprints?.environment_reseals) ? state.fingerprints.environment_reseals : [])
    .map((entry) => entry?.approval_id).filter((id) => APPROVAL_ID.test(String(id ?? ''))))];
  const approvals = new Map();
  if (!ids.length) return approvals;
  const listing = await readdir(approvalsDir).catch(() => []);
  for (const id of ids) approvals.set(id, await readIntentApproval(approvalsDir, id, listing));
  return approvals;
}

/**
 * Why the recorded re-seals do not verify (empty when they do): each entry must chain onto the
 * one before it and bind an intact, granted intent approval of this run, used once.
 */
export function environmentResealIssues(state, approvals) {
  const entries = state?.fingerprints?.environment_reseals;
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries)) return ['fingerprints.environment_reseals must be an array'];
  const issues = [], used = new Set();
  let previous = null, previousAt = -Infinity;
  entries.forEach((entry, index) => {
    const at = `fingerprints.environment_reseals[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { issues.push(`${at} must be an object`); return; }
    if (!APPROVAL_ID.test(String(entry.approval_id ?? ''))) issues.push(`${at} approval_id must be APR-NNN`);
    else if (used.has(entry.approval_id)) issues.push(`${at} approval ${entry.approval_id} already authorised an earlier re-seal`);
    used.add(entry.approval_id);
    if (!SHA256_REF.test(String(entry.approval_sha256 ?? ''))) issues.push(`${at} approval_sha256 must be sha256:<64 hex>`);
    for (const key of ['previous_fingerprint', 'new_fingerprint']) {
      if (!SHA256_REF.test(String(entry[key] ?? ''))) issues.push(`${at} ${key} must be sha256:<64 hex>`);
    }
    if (previous && entry.previous_fingerprint !== previous) issues.push(`${at} previous_fingerprint must equal the re-seal before it (${previous})`);
    previous = entry.new_fingerprint;
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) issues.push(`${at} reason must say why the owner re-sealed`);
    const recordedAt = Date.parse(entry.recorded_at ?? '');
    if (!Number.isFinite(recordedAt)) issues.push(`${at} recorded_at must be an ISO 8601 timestamp`);
    else if (recordedAt < previousAt) issues.push(`${at} entries must be ordered by recorded_at`);
    else previousAt = recordedAt;
    if (!approvals) { issues.push(`${at} cannot be verified without its approval file`); return; }
    if (!APPROVAL_ID.test(String(entry.approval_id ?? ''))) return;
    const approval = approvals.get(entry.approval_id) ?? { id: entry.approval_id, files: [] };
    issues.push(...intentApprovalIssues(approval, { runId: state.run_id ?? null, granted: state.approvals ?? [] })
      .map((issue) => `${at} ${issue}`));
    if (approval.sha256 && approval.sha256 !== entry.approval_sha256) {
      issues.push(`${at} approval ${entry.approval_id} changed after the re-seal was recorded (sha256 mismatch)`);
    }
    if (Number.isFinite(recordedAt) && Date.parse(approval.meta?.granted_at ?? '') > recordedAt) {
      issues.push(`${at} approval ${entry.approval_id} was granted after the re-seal was recorded`);
    }
  });
  return issues;
}
