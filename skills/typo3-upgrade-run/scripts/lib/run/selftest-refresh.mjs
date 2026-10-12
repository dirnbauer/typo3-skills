/**
 * Owner-approved determinism self-test refreshes inside one open guarded node.
 *
 * The self-test lock lives 24 hours and gates every comparison. selftest.lock.json is also a
 * measurement input that a guarded code or stateful node fingerprints at node-open, so a self-test
 * run inside such a node used to leave the node closable only as blocked: a node that outlives the
 * lock could never finish. `t3u selftest-determinism --in-node <id> --approval APR-NNN` lifts that
 * for exactly one node and one owner decision: while that node is the only open guarded node, its
 * project tree is clean and the lock is expired or stale (never to replace a still-valid lock). A
 * green exhaustive self-test then appends one entry to state.selftest_refreshes binding the
 * approval file's bytes and the old and new lock hashes, and journals it. node-close accepts the
 * changed lock if and only if verified entries of that node attempt chain the anchored hash to
 * the current one. Capture, settle, normalisation and comparison logic are untouched.
 */

import { readdir } from 'node:fs/promises';
import { intentApprovalIssues, readIntentApproval } from './runtime.mjs';
import { namesNode } from './attempts.mjs';

/** The measurement input a refresh may change (guards.mjs MEASUREMENT_ONLY). */
export const SELFTEST_LOCK_INPUT = 'selftest.lock.json';

const SHA256_REF = /^sha256:[a-f0-9]{64}$/;
const LOCK_REF = /^(sha256:[a-f0-9]{64}|absent)$/;
const APPROVAL_ID = /^APR-\d{3}$/;

const canonicalTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;

/** True for a node whose close compares the measurement inputs (graph.mjs openGuardedNodes). */
export function isGuardedNode(definition, id) {
  const node = definition?.nodes?.[id];
  return definition?.policy?.guard_change_scope === true && Boolean(node)
    && ['code', 'stateful'].includes(node.mutation) && node.measurement !== true;
}

/** Approval ids the other owner ledgers consumed: one approval authorises one decision. */
export function otherLedgerApprovalIds(state) {
  const ids = new Set();
  const add = (entries) => { for (const entry of Array.isArray(entries) ? entries : []) ids.add(entry?.approval_id); };
  add(state?.runtime?.extensions);
  add(state?.fingerprints?.environment_reseals);
  add(state?.graph?.attempt_extensions);
  ids.delete(undefined);
  return ids;
}

/** Reads the approval behind every recorded refresh. */
export async function readRefreshApprovals(approvalsDir, state) {
  const ids = [...new Set((Array.isArray(state?.selftest_refreshes) ? state.selftest_refreshes : [])
    .map((entry) => entry?.approval_id).filter((id) => APPROVAL_ID.test(String(id ?? ''))))];
  const approvals = new Map();
  if (!ids.length) return approvals;
  const listing = await readdir(approvalsDir).catch(() => []);
  for (const id of ids) approvals.set(id, await readIntentApproval(approvalsDir, id, listing));
  return approvals;
}

/** Why one approval cannot authorise a self-test refresh inside `node` (empty when it can). */
export function refreshApprovalIssues(approval, node, { runId = null, granted = [] } = {}) {
  const issues = intentApprovalIssues(approval, { runId, granted });
  if (approval?.sha256 && !namesNode(approval.meta?.scope, node)) {
    issues.push(`approval ${approval.id} does not name node ${node} in its scope`);
  }
  return issues;
}

function entryIssues(entry, { definition, approvals, runId, granted, usedIds, foreignIds, previousRecordedAt }) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['must be an object'];
  const issues = [];
  const node = String(entry.node ?? '');
  if (!isGuardedNode(definition, node)) issues.push(`node ${node || '<missing>'} is not a guarded code or stateful node of the sealed graph`);
  if (!Number.isInteger(entry.attempt) || entry.attempt < 1) issues.push('attempt must be the node attempt the refresh ran in');
  if (!APPROVAL_ID.test(String(entry.approval_id ?? ''))) issues.push('approval_id must be APR-NNN');
  else if (usedIds.has(entry.approval_id)) issues.push(`approval ${entry.approval_id} already authorised an earlier self-test refresh`);
  else if (foreignIds.has(entry.approval_id)) issues.push(`approval ${entry.approval_id} already authorised another owner decision`);
  if (!SHA256_REF.test(String(entry.approval_sha256 ?? ''))) issues.push('approval_sha256 must be sha256:<64 hex>');
  if (!LOCK_REF.test(String(entry.previous_lock_sha256 ?? ''))) issues.push('previous_lock_sha256 must be sha256:<64 hex> or absent');
  if (!SHA256_REF.test(String(entry.new_lock_sha256 ?? ''))) issues.push('new_lock_sha256 must be sha256:<64 hex>');
  else if (entry.new_lock_sha256 === entry.previous_lock_sha256) issues.push('new_lock_sha256 must differ from previous_lock_sha256');
  const recordedAt = Date.parse(entry.recorded_at ?? '');
  if (!canonicalTime(entry.recorded_at)) issues.push('recorded_at must be an ISO 8601 UTC timestamp');
  else if (recordedAt < previousRecordedAt) issues.push('entries must be ordered by recorded_at');
  if (!approvals) issues.push('cannot be verified without its approval file');
  else if (APPROVAL_ID.test(String(entry.approval_id ?? ''))) {
    const approval = approvals.get(entry.approval_id) ?? { id: entry.approval_id, files: [] };
    issues.push(...refreshApprovalIssues(approval, node, { runId, granted }));
    if (approval.sha256 && approval.sha256 !== entry.approval_sha256) {
      issues.push(`approval ${entry.approval_id} changed after the refresh was recorded (sha256 mismatch)`);
    }
    if (Number.isFinite(recordedAt) && Date.parse(approval.meta?.granted_at ?? '') > recordedAt) {
      issues.push(`approval ${entry.approval_id} was granted after the refresh was recorded`);
    }
  }
  return issues;
}

/**
 * Walks state.selftest_refreshes in order. `applied` holds the entries that verify against the
 * sealed graph and their approval files; `issues` names every refusal for graph-validate and
 * validate-run.
 */
export function selftestRefreshLedger(state, definition, { approvals = null, foreignIds = otherLedgerApprovalIds(state) } = {}) {
  const applied = [], issues = [];
  const entries = state?.selftest_refreshes;
  if (entries === undefined || entries === null) return { applied, issues };
  if (!Array.isArray(entries)) return { applied, issues: ['selftest_refreshes must be an array'] };
  const usedIds = new Set();
  let previousRecordedAt = -Infinity;
  entries.forEach((entry, index) => {
    const own = entryIssues(entry, { definition, approvals, runId: state?.run_id ?? null, granted: state?.approvals ?? [],
      usedIds, foreignIds, previousRecordedAt });
    if (Number.isFinite(Date.parse(entry?.recorded_at ?? ''))) previousRecordedAt = Math.max(previousRecordedAt, Date.parse(entry.recorded_at));
    if (APPROVAL_ID.test(String(entry?.approval_id ?? ''))) usedIds.add(entry.approval_id);
    if (own.length) {
      issues.push(...own.map((issue) => `selftest_refreshes[${index}] ${issue}`));
      return;
    }
    applied.push(entry);
  });
  return { applied, issues };
}

/**
 * True when the verified refreshes of this node attempt chain the lock hash fingerprinted at
 * node-open to `currentLock`, each entry starting where the one before it ended. Anything else
 * (no entry, a gap, a refused entry, a later hand edit) leaves the change forbidden.
 */
export function refreshedLockBound(ledger, id, nodeState, currentLock) {
  const entries = (ledger?.applied ?? []).filter((entry) => entry.node === id && entry.attempt === nodeState?.attempts);
  if (!entries.length) return false;
  let cursor = nodeState?.anchor?.measurement?.[SELFTEST_LOCK_INPUT] ?? 'absent';
  for (const entry of entries) {
    if (entry.previous_lock_sha256 !== cursor) return false;
    cursor = entry.new_lock_sha256;
  }
  return cursor === currentLock;
}
