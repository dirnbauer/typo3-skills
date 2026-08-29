/**
 * Executable upgrade graph.
 *
 * The graph owns orchestration. A loop is only a bounded evidence/retry unit attached to
 * one node. Branches encode different causes and recovery routes; retry edges are explicit
 * and bounded, so the system cannot silently turn back into "repeat until green".
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { EXIT, HarnessError, InvalidRunError, PreconditionError } from '../cli/exit-codes.mjs';
import { StateStore } from '../run/state.mjs';
import { sha256 } from '../run/paths.mjs';
import { assertPhaseRuntime, runtimeProfileIssues } from '../run/runtime.mjs';

const GRAPH_SCHEMA = 'typo3-upgrade-run/graph@1';
const GRAPH_STATE_SCHEMA = 'typo3-upgrade-run/graph-state@1';
const NODE_OUTCOMES = Object.freeze(['pass', 'findings', 'invalid', 'harness-error', 'blocked', 'not-applicable']);

export async function graphInit({ values, paths, log, journal }) {
  const store = new StateStore(paths);
  const state = await store.read();
  const stateRevision = stateHash(state);
  if (state.graph) {
    throw new PreconditionError('The graph is already initialised and sealed. Start a new run rather than erasing graph history.');
  }
  const definitionPath = resolveDefinitionPath(values.definition, paths);
  const { definition, raw, hash } = await readDefinition(definitionPath);
  const now = new Date().toISOString();
  const start = new Set(asArray(definition.start));
  state.graph = {
    schema: GRAPH_STATE_SCHEMA,
    definition_path: path.relative(paths.root, definitionPath) || path.basename(definitionPath),
    definition_hash: hash,
    status: 'active',
    nodes: Object.fromEntries(Object.keys(definition.nodes).map((id) => [id, {
      status: start.has(id) ? 'ready' : 'pending', attempts: 0,
      active_since: null, completed_at: null, outcome: null, evidence: null, evidence_loop: null, history: [],
    }])),
    edges: Object.fromEntries(definition.edges.map((edge) => [edge.id, { traversals: 0, last_at: null }])),
    locks: {},
    updated_at: now,
  };
  await writeGraphState(store, state, stateRevision);
  await journal?.append('graph', { action: 'init', definition_hash: hash, start: [...start] });
  log.success(`Upgrade graph initialised with ${Object.keys(definition.nodes).length} nodes and ${definition.edges.length} edges.`);
  return { exitCode: EXIT.PASS, verdict: 'pass', definitionHash: hash, ready: [...start], message: 'graph initialised' };
}

export async function graphStatus({ values, paths, log }) {
  const { state, definition } = await graphContext(paths);
  refreshReady(state.graph, definition);
  const summary = summarize(state.graph, definition);
  if (!values.json) process.stdout.write(`${renderGraphStatus(summary)}\n`);
  log.debug(`Graph ${summary.status}: ${summary.counts.ready ?? 0} ready, ${summary.counts.running ?? 0} running.`);
  return { exitCode: EXIT.PASS, verdict: 'pass', ...summary, message: `graph ${summary.status}` };
}

export async function graphNext({ paths, log }) {
  const store = new StateStore(paths);
  const { state, definition } = await graphContext(paths);
  const stateRevision = stateHash(state);
  refreshReady(state.graph, definition);
  state.graph.updated_at = new Date().toISOString();
  await writeGraphState(store, state, stateRevision);
  const ready = Object.entries(state.graph.nodes)
    .filter(([, node]) => node.status === 'ready')
    .map(([id]) => ({ id, skill: definition.nodes[id].skill ?? null, resources: definition.nodes[id].resources ?? [] }));
  const parallelSets = compatibleSets(ready);
  for (const node of ready) log.info(`${node.id}${node.skill ? ` -> ${node.skill}` : ''} [${node.resources.join(', ') || 'no exclusive resource'}]`);
  return { exitCode: EXIT.PASS, verdict: 'pass', ready, parallelSets, message: ready.length ? `${ready.length} node(s) ready` : 'no node ready' };
}

export async function nodeOpen({ values, paths, log, journal }) {
  const id = requireNode(values.node);
  const store = new StateStore(paths);
  const { state, definition } = await graphContext(paths);
  const stateRevision = stateHash(state);
  refreshReady(state.graph, definition);
  const node = definition.nodes[id];
  const nodeState = state.graph.nodes[id];
  if (!node || !nodeState) throw new PreconditionError(`Unknown graph node: ${id}`);
  if (nodeState.status !== 'ready') throw new PreconditionError(`Node ${id} is ${nodeState.status}, not ready.`);
  assertPhaseRuntime(state.runtime, node.phase, Date.now(), {
    contractAClosed: state.contract_a?.status === 'closed',
  });
  if (node.mutation === 'stateful') {
    if (!values.snapshot || !state.snapshots.includes(values.snapshot)) {
      throw new PreconditionError(`Stateful node ${id} requires --snapshot naming a recorded DDEV snapshot.`);
    }
  }
  if (node.mutation === 'code' && !values['rollback-ref']) {
    throw new PreconditionError(`Code-changing node ${id} requires --rollback-ref.`);
  }
  if (node.approval === 'required' && (!values.approval || !state.approvals.includes(values.approval))) {
    throw new PreconditionError(`Node ${id} requires --approval naming a granted approval.`);
  }
  for (const resource of node.resources ?? []) {
    const owner = state.graph.locks[resource];
    if (owner && owner !== id) throw new PreconditionError(`Resource ${resource} is locked by ${owner}.`);
  }
  const now = new Date().toISOString();
  for (const resource of node.resources ?? []) state.graph.locks[resource] = id;
  nodeState.status = 'running';
  nodeState.attempts += 1;
  nodeState.active_since = now;
  nodeState.completed_at = null;
  state.graph.updated_at = now;
  await mkdir(paths.node(id), { recursive: true });
  await writeGraphState(store, state, stateRevision);
  await journal?.append('node', { action: 'open', node_id: id, attempt: nodeState.attempts, resources: node.resources ?? [] });
  for (const resource of node.resources ?? []) await journal?.append('lock', { action: 'acquire', resource, node_id: id });
  log.success(`Node ${id} opened (attempt ${nodeState.attempts}).`);
  return { exitCode: EXIT.PASS, verdict: 'pass', node: id, attempt: nodeState.attempts, skill: node.skill ?? null, message: `${id} running` };
}

export async function nodeClose({ values, paths, log, journal }) {
  const id = requireNode(values.node);
  const outcome = String(values.outcome ?? '');
  const evidence = String(values.evidence ?? '');
  if (!evidence) throw new PreconditionError('--evidence is required and must point to inspectable output.');
  const store = new StateStore(paths);
  const { state, definition } = await graphContext(paths);
  const stateRevision = stateHash(state);
  const node = definition.nodes[id];
  const nodeState = state.graph.nodes[id];
  if (!node || !nodeState) throw new PreconditionError(`Unknown graph node: ${id}`);
  if (nodeState.status !== 'running') throw new PreconditionError(`Node ${id} is ${nodeState.status}, not running.`);
  const allowed = node.outcomes ?? NODE_OUTCOMES;
  if (!allowed.includes(outcome)) throw new PreconditionError(`Outcome ${outcome} is not allowed for ${id}: ${allowed.join(', ')}.`);
  if (outcome === 'pass' && node.evidence_loop === 'required') {
    const loopId = String(values['evidence-loop'] ?? '').slice(0, 3);
    if (!/^\d{3}$/.test(loopId) || state.loops[loopId] !== 'green') {
      throw new PreconditionError(`Node ${id} may pass only with --evidence-loop naming a green bounded loop.`);
    }
  }

  const matching = definition.edges.filter((edge) => edge.from === id && edge.outcome === outcome);
  if (!matching.length && !asArray(definition.terminal).includes(id)) {
    throw new InvalidRunError(`Graph has no ${outcome} route from non-terminal node ${id}.`);
  }
  for (const edge of matching) {
    const edgeState = state.graph.edges[edge.id];
    if (edge.retry === true && edgeState.traversals >= edge.max_traversals) {
      throw new PreconditionError(`Retry edge ${edge.id} exhausted its ${edge.max_traversals} traversal(s). Re-plan; do not repeat.`);
    }
  }
  const now = new Date().toISOString();
  const evidenceLoop = values['evidence-loop'] ? String(values['evidence-loop']).slice(0, 3) : null;
  const previous = { status: nodeState.status, attempt: nodeState.attempts, outcome, evidence, evidence_loop: evidenceLoop, completed_at: now };
  nodeState.history.push(previous);
  nodeState.status = statusForOutcome(outcome);
  nodeState.outcome = outcome;
  nodeState.evidence = evidence;
  nodeState.evidence_loop = evidenceLoop;
  nodeState.completed_at = now;
  nodeState.active_since = null;
  const releasedResources = [];
  for (const [resource, owner] of Object.entries(state.graph.locks)) {
    if (owner === id) {
      delete state.graph.locks[resource];
      releasedResources.push(resource);
    }
  }
  const edgeEvents = [];
  for (const edge of matching) {
    const edgeState = state.graph.edges[edge.id];
    edgeState.traversals += 1;
    edgeState.last_at = now;
    edgeEvents.push({ edge_id: edge.id, from: id, to: asArray(edge.to), outcome, traversal: edgeState.traversals });
  }
  refreshReady(state.graph, definition, { traversed: matching });
  const terminalStates = asArray(definition.terminal).map((terminal) => state.graph.nodes[terminal]?.status);
  if (terminalStates.some((status) => ['passed', 'skipped'].includes(status))) {
    state.graph.status = 'complete';
  } else if (terminalStates.some((status) => status === 'blocked')) {
    state.graph.status = 'blocked';
  } else if (outcome === 'blocked') {
    state.graph.status = 'blocked';
  } else if (outcome === 'invalid' && !matching.length) {
    state.graph.status = 'invalid';
  } else {
    state.graph.status = 'active';
  }
  state.graph.updated_at = now;
  await mkdir(paths.node(id), { recursive: true });
  await writeGraphState(store, state, stateRevision);
  await writeFile(paths.nodeResult(id), `${JSON.stringify({ node: id, ...previous }, null, 2)}\n`, 'utf8');
  for (const resource of releasedResources) await journal?.append('lock', { action: 'release', resource, node_id: id });
  for (const event of edgeEvents) await journal?.append('edge', event);
  await journal?.append('node', { action: 'close', node_id: id, outcome, evidence, routes: matching.map((edge) => edge.id) });
  log.success(`Node ${id} closed as ${outcome}; ${matching.length} route(s) activated.`);
  return { exitCode: exitForOutcome(outcome), verdict: outcome, node: id, routes: matching.map((edge) => edge.id), message: `${id}: ${outcome}` };
}

export async function graphValidate({ paths, log }) {
  const { state, definition, hash } = await graphContext(paths);
  const issues = validateGraphState(state.graph, definition, hash, state);
  if (issues.length) throw new InvalidRunError(`Graph validation failed:\n  - ${issues.join('\n  - ')}`);
  log.success('Graph definition, state, retry bounds, locks, and node references are valid.');
  return { exitCode: EXIT.PASS, verdict: 'pass', nodes: Object.keys(definition.nodes).length, message: 'graph valid' };
}

export function validateGraphDefinition(definition) {
  const issues = [];
  if (definition?.schema !== GRAPH_SCHEMA) issues.push(`schema must be ${GRAPH_SCHEMA}`);
  if (!definition?.nodes || typeof definition.nodes !== 'object' || Array.isArray(definition.nodes)) issues.push('nodes must be an object');
  if (!Array.isArray(definition?.edges)) issues.push('edges must be an array');
  if (issues.length) return issues;
  const nodeIds = new Set(Object.keys(definition.nodes));
  const resources = new Set(asArray(definition.resources));
  for (const id of [...asArray(definition.start), ...asArray(definition.terminal)]) if (!nodeIds.has(id)) issues.push(`unknown start/terminal node ${id}`);
  const edgeIds = new Set();
  for (const edge of definition.edges) {
    if (!edge?.id || edgeIds.has(edge.id)) issues.push(`edge id is missing or duplicated: ${edge?.id ?? '<missing>'}`);
    edgeIds.add(edge?.id);
    if (!nodeIds.has(edge.from)) issues.push(`edge ${edge.id} has unknown from node ${edge.from}`);
    for (const to of asArray(edge.to)) if (!nodeIds.has(to)) issues.push(`edge ${edge.id} has unknown to node ${to}`);
    if (!String(edge.outcome ?? '')) issues.push(`edge ${edge.id} has no outcome`);
    if (edge.retry === true && (!Number.isInteger(edge.max_traversals) || edge.max_traversals < 1 || edge.max_traversals > 5)) {
      issues.push(`retry edge ${edge.id} needs max_traversals between 1 and 5`);
    }
  }
  for (const [id, node] of Object.entries(definition.nodes)) {
    for (const required of node.requires ?? []) if (!nodeIds.has(required)) issues.push(`node ${id} requires unknown node ${required}`);
    for (const resource of node.resources ?? []) if (!resources.has(resource)) issues.push(`node ${id} uses undeclared resource ${resource}`);
    const outgoing = definition.edges.filter((edge) => edge.from === id);
    for (const outcome of node.outcomes ?? []) {
      if (!outgoing.some((edge) => edge.outcome === outcome) && !asArray(definition.terminal).includes(id)) {
        issues.push(`node ${id} outcome ${outcome} has no route`);
      }
    }
  }
  const nonRetryAdj = Object.fromEntries([...nodeIds].map((id) => [id, []]));
  for (const edge of definition.edges.filter((candidate) => candidate.retry !== true)) {
    for (const to of asArray(edge.to)) nonRetryAdj[edge.from]?.push(to);
  }
  if (hasCycle(nonRetryAdj)) issues.push('graph contains an unbounded cycle; every cycle must cross a bounded retry edge');
  return issues;
}

export function validateGraphState(graph, definition, hash, runState = null) {
  const issues = validateGraphDefinition(definition);
  if (graph.definition_hash !== hash) issues.push('definition hash drifted after graph-init');
  if (runState) issues.push(...runtimeProfileIssues(runState.runtime));
  for (const id of Object.keys(definition.nodes)) if (!graph.nodes[id]) issues.push(`state misses node ${id}`);
  for (const id of Object.keys(graph.nodes)) if (!definition.nodes[id]) issues.push(`state contains unknown node ${id}`);
  for (const [id, node] of Object.entries(definition.nodes)) {
    const nodeState = graph.nodes[id];
    if (node.evidence_loop === 'required' && nodeState?.status === 'passed') {
      if (!/^\d{3}$/.test(nodeState.evidence_loop ?? '')) issues.push(`passed proof node ${id} has no evidence loop`);
      else if (runState && runState.loops?.[nodeState.evidence_loop] !== 'green') {
        issues.push(`passed proof node ${id} cites non-green loop ${nodeState.evidence_loop}`);
      }
    }
  }
  for (const [resource, owner] of Object.entries(graph.locks)) {
    if (graph.nodes[owner]?.status !== 'running') issues.push(`lock ${resource} belongs to non-running node ${owner}`);
    if (!(definition.nodes[owner]?.resources ?? []).includes(resource)) issues.push(`lock ${resource} is not declared by ${owner}`);
  }
  for (const edge of definition.edges) {
    const traversals = graph.edges[edge.id]?.traversals;
    if (!Number.isInteger(traversals)) issues.push(`state misses edge ${edge.id}`);
    if (edge.retry === true && traversals > edge.max_traversals) issues.push(`retry edge ${edge.id} exceeded its bound`);
  }
  return issues;
}

async function graphContext(paths) {
  const state = await new StateStore(paths).read();
  if (!state.graph) throw new PreconditionError('No graph state. Run "t3u graph-init" first.');
  const definitionPath = path.resolve(paths.root, state.graph.definition_path);
  const read = await readDefinition(definitionPath);
  if (read.hash !== state.graph.definition_hash) throw new InvalidRunError('Upgrade graph definition changed after initialisation. Reconcile it explicitly; do not continue on a different graph.');
  return { state, ...read };
}

async function readDefinition(definitionPath) {
  let raw;
  try { raw = await readFile(definitionPath, 'utf8'); }
  catch (error) { throw new PreconditionError(`Cannot read graph definition ${definitionPath}: ${error.message}`); }
  let definition;
  try { definition = parseYaml(raw); }
  catch (error) { throw new InvalidRunError(`Graph YAML is invalid: ${error.message}`); }
  const issues = validateGraphDefinition(definition);
  if (issues.length) throw new InvalidRunError(`Graph definition is invalid:\n  - ${issues.join('\n  - ')}`);
  return { definition, raw, hash: `sha256:${sha256(raw)}` };
}

function resolveDefinitionPath(value, paths) {
  if (!value) return paths.graphDefinition;
  const resolved = path.resolve(process.cwd(), String(value));
  if (!resolved.startsWith(paths.root + path.sep) && resolved !== paths.graphDefinition) {
    throw new PreconditionError('The graph definition must live inside the run directory.');
  }
  return resolved;
}

function refreshReady(graph, definition, { traversed = [] } = {}) {
  const traversedTargets = new Set(traversed.flatMap((edge) => asArray(edge.to)));
  const start = new Set(asArray(definition.start));
  for (const [id, nodeState] of Object.entries(graph.nodes)) {
    const incoming = definition.edges.filter((edge) => asArray(edge.to).includes(id));
    const activated = start.has(id) || traversedTargets.has(id) || incoming.some((edge) => (graph.edges[edge.id]?.traversals ?? 0) > 0);
    const required = definition.nodes[id].requires ?? [];
    const requirementsMet = required.every((requiredId) => ['passed', 'skipped'].includes(graph.nodes[requiredId]?.status));
    const wasRetryTarget = traversed.some((edge) => edge.retry === true && asArray(edge.to).includes(id));
    if (activated && requirementsMet && (nodeState.status === 'pending' || (wasRetryTarget && ['failed', 'blocked', 'invalid', 'passed', 'skipped'].includes(nodeState.status)))) {
      nodeState.status = 'ready';
      nodeState.active_since = null;
      nodeState.completed_at = null;
      nodeState.outcome = null;
      nodeState.evidence = null;
      nodeState.evidence_loop = null;
    }
  }
}

function summarize(graph, definition) {
  const counts = {};
  for (const node of Object.values(graph.nodes)) counts[node.status] = (counts[node.status] ?? 0) + 1;
  return {
    status: graph.status,
    definitionHash: graph.definition_hash,
    counts,
    ready: Object.entries(graph.nodes).filter(([, node]) => node.status === 'ready').map(([id]) => id),
    running: Object.entries(graph.nodes).filter(([, node]) => node.status === 'running').map(([id]) => id),
    locks: graph.locks,
    terminal: asArray(definition.terminal),
  };
}

function renderGraphStatus(summary) {
  return [
    `# Upgrade graph: ${summary.status}`,
    '',
    `Definition: \`${summary.definitionHash}\``,
    `Ready: ${summary.ready.join(', ') || '—'}`,
    `Running: ${summary.running.join(', ') || '—'}`,
    `Locks: ${Object.entries(summary.locks).map(([key, value]) => `${key}=${value}`).join(', ') || '—'}`,
    '',
    ...Object.entries(summary.counts).sort().map(([status, count]) => `- ${status}: ${count}`),
  ].join('\n');
}

function compatibleSets(nodes) {
  const sets = [];
  for (const node of nodes) {
    let placed = false;
    for (const set of sets) {
      const used = new Set(set.flatMap((candidate) => candidate.resources));
      if (node.resources.every((resource) => !used.has(resource))) { set.push(node); placed = true; break; }
    }
    if (!placed) sets.push([node]);
  }
  return sets;
}

function hasCycle(adjacency) {
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency[id] ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return Object.keys(adjacency).some(visit);
}

function statusForOutcome(outcome) {
  if (outcome === 'pass') return 'passed';
  if (outcome === 'not-applicable') return 'skipped';
  if (outcome === 'blocked') return 'blocked';
  if (outcome === 'invalid') return 'invalid';
  return 'failed';
}

function exitForOutcome(outcome) {
  if (['pass', 'not-applicable'].includes(outcome)) return EXIT.PASS;
  if (outcome === 'findings') return EXIT.FINDINGS;
  if (outcome === 'invalid') return EXIT.INVALID;
  if (outcome === 'blocked') return EXIT.BLOCKED_BY_POLICY;
  return EXIT.HARNESS_ERROR;
}

function requireNode(value) {
  const id = String(value ?? '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new HarnessError('--node must be a graph node id.');
  return id;
}

async function writeGraphState(store, next, expectedRevision) {
  return store.transaction((current) => {
    if (stateHash(current) !== expectedRevision) {
      throw new PreconditionError('Graph state changed concurrently. Re-read graph-next/status and retry this transition; no work result was lost.');
    }
    return next;
  });
}

function stateHash(state) { return sha256(JSON.stringify(state)); }

function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
