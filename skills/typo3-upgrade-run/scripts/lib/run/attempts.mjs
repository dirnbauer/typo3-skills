/**
 * Owner-approved node attempt extensions.
 *
 * `policy.max_node_attempts` in the sealed graph definition is never rewritten. The owner may grant
 * one ready node whose shared attempt budget is exhausted a few extra attempts by a granted intent
 * approval; `t3u node-attempts-extend` appends one entry per decision to
 * `graph.attempt_extensions`. An entry counts only while it verifies, byte for byte, against its
 * approval file, and only for the node it names. Retry edges, their `max_traversals` and the
 * global `max_total_retries` stay as the definition says: an extra attempt moves no other bound.
 */

import { readdir } from 'node:fs/promises';
import { intentApprovalIssues, readIntentApproval } from './runtime.mjs';

const SHA256_REF = /^sha256:[a-f0-9]{64}$/;
const APPROVAL_ID = /^APR-\d{3}$/;

const canonicalTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;

/** The sealed per-node attempt budget of a definition (Infinity when the policy sets none). */
export function sealedAttemptBudget(definition) {
  const max = definition?.policy?.max_node_attempts;
  return Number.isInteger(max) ? max : Infinity;
}

/** Approval ids other owner ledgers already consumed: one approval authorises one decision. */
export function foreignApprovalIds(state) {
  const ids = new Set();
  for (const entry of Array.isArray(state?.runtime?.extensions) ? state.runtime.extensions : []) ids.add(entry?.approval_id);
  for (const entry of Array.isArray(state?.fingerprints?.environment_reseals) ? state.fingerprints.environment_reseals : []) {
    ids.add(entry?.approval_id);
  }
  for (const entry of Array.isArray(state?.selftest_refreshes) ? state.selftest_refreshes : []) ids.add(entry?.approval_id);
  ids.delete(undefined);
  return ids;
}

/** Reads the approval behind every recorded attempt extension. */
export async function readAttemptApprovals(approvalsDir, graph) {
  const ids = [...new Set((Array.isArray(graph?.attempt_extensions) ? graph.attempt_extensions : [])
    .map((entry) => entry?.approval_id).filter((id) => APPROVAL_ID.test(String(id ?? ''))))];
  const approvals = new Map();
  if (!ids.length) return approvals;
  const listing = await readdir(approvalsDir).catch(() => []);
  for (const id of ids) approvals.set(id, await readIntentApproval(approvalsDir, id, listing));
  return approvals;
}

/** True when `scope` names `node` as a whole node id, not as part of a longer one. */
export function namesNode(scope, node) {
  const escaped = String(node).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(node) && new RegExp(`(^|[^a-z0-9-])${escaped}([^a-z0-9-]|$)`).test(String(scope ?? ''));
}

/** Why one approval cannot authorise extra attempts for `node` (empty when it can). */
export function attemptApprovalIssues(approval, node, { runId = null, granted = [] } = {}) {
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
  if (!definition?.nodes?.[node]) issues.push(`node ${node || '<missing>'} is not a node of the sealed graph definition`);
  if (!APPROVAL_ID.test(String(entry.approval_id ?? ''))) issues.push('approval_id must be APR-NNN');
  else if (usedIds.has(entry.approval_id)) issues.push(`approval ${entry.approval_id} already authorised an earlier attempt extension`);
  else if (foreignIds.has(entry.approval_id)) issues.push(`approval ${entry.approval_id} already authorised another owner decision`);
  if (!SHA256_REF.test(String(entry.approval_sha256 ?? ''))) issues.push('approval_sha256 must be sha256:<64 hex>');
  const base = sealedAttemptBudget(definition);
  if (!Number.isFinite(base)) issues.push('the graph policy sets no max_node_attempts to extend');
  else if (!Number.isInteger(entry.extra_attempts) || entry.extra_attempts < 1 || entry.extra_attempts > base) {
    issues.push(`extra_attempts must be an integer between 1 and ${base}`);
  }
  if (typeof entry.reason !== 'string' || !entry.reason.trim()) issues.push('reason must say why the owner granted the attempts');
  const recordedAt = Date.parse(entry.recorded_at ?? '');
  if (!canonicalTime(entry.recorded_at)) issues.push('recorded_at must be an ISO 8601 UTC timestamp');
  else if (recordedAt < previousRecordedAt) issues.push('entries must be ordered by recorded_at');
  if (!approvals) issues.push('cannot be verified without its approval file');
  else if (APPROVAL_ID.test(String(entry.approval_id ?? ''))) {
    const approval = approvals.get(entry.approval_id) ?? { id: entry.approval_id, files: [] };
    issues.push(...attemptApprovalIssues(approval, node, { runId, granted }));
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
 * Walks graph.attempt_extensions in order. `extra` holds, per node, the attempts of the entries
 * that verify; a refused entry adds nothing. `issues` names every refusal for graph-validate and
 * validate-run.
 */
export function attemptExtensionLedger(graph, definition, {
  approvals = null, runId = null, granted = [], foreignIds = new Set(),
} = {}) {
  const extra = {}, applied = [], issues = [];
  const entries = graph?.attempt_extensions;
  if (entries === undefined || entries === null) return { extra, issues, applied };
  if (!Array.isArray(entries)) return { extra, issues: ['graph.attempt_extensions must be an array'], applied };
  const usedIds = new Set();
  let previousRecordedAt = -Infinity;
  entries.forEach((entry, index) => {
    const own = entryIssues(entry, { definition, approvals, runId, granted, usedIds, foreignIds, previousRecordedAt });
    if (Number.isFinite(Date.parse(entry?.recorded_at ?? ''))) previousRecordedAt = Math.max(previousRecordedAt, Date.parse(entry.recorded_at));
    if (APPROVAL_ID.test(String(entry?.approval_id ?? ''))) usedIds.add(entry.approval_id);
    if (own.length) {
      issues.push(...own.map((issue) => `graph.attempt_extensions[${index}] ${issue}`));
      return;
    }
    extra[entry.node] = (extra[entry.node] ?? 0) + entry.extra_attempts;
    applied.push(entry);
  });
  return { extra, issues, applied };
}

/** The effective attempt budget of one node: the sealed budget plus its verified extensions. */
export function nodeAttemptBudget(definition, id, ledger = null) {
  return sealedAttemptBudget(definition) + (ledger?.extra?.[id] ?? 0);
}

/** A budget lookup for deriveGraphStatus and friends; without a ledger only the sealed budget counts. */
export function attemptBudgetOf(definition, ledger = null) {
  return (id) => nodeAttemptBudget(definition, id, ledger);
}

/** The verified ledger for a run: reads the approvals from the run directory. */
export async function resolveAttemptBudgets(paths, state, definition) {
  const approvals = await readAttemptApprovals(paths.approvalsDir, state?.graph);
  return attemptExtensionLedger(state?.graph, definition, {
    approvals, runId: state?.run_id ?? null, granted: state?.approvals ?? [], foreignIds: foreignApprovalIds(state),
  });
}
