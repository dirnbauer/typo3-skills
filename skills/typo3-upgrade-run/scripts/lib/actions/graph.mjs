/**
 * Executable upgrade graph.
 *
 * The graph owns orchestration. A loop is only a bounded evidence/retry unit attached to
 * one node. Branches encode different causes and recovery routes; retry edges are explicit
 * and bounded, so the system cannot silently turn back into "repeat until green".
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { EXIT, HarnessError, InvalidRunError, PreconditionError } from '../cli/exit-codes.mjs';
import { StateStore } from '../run/state.mjs';
import { sha256 } from '../run/paths.mjs';
import { assertPhaseRuntime, runtimeProfileIssues } from '../run/runtime.mjs';
import { forecastGraph } from '../run/forecast.mjs';
import { closureCheck, readClosureArtifact, validClosureAcceptance, verifyRecordedClosureAcceptance } from './closure.mjs';
export { validClosureAcceptance } from './closure.mjs';

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
  state.graph.status = deriveGraphStatus(state.graph, definition);
  state.graph.updated_at = new Date().toISOString();
  await writeGraphState(store, state, stateRevision);
  const candidates = Object.entries(state.graph.nodes)
    .filter(([, node]) => node.status === 'ready')
    .map(([id]) => ({ id, skill: definition.nodes[id].skill ?? null, resources: nodeResources(definition.nodes[id], definition) }));
  const ready = [], waiting = [];
  for (const node of candidates) {
    const held = node.resources.filter(resource => state.graph.locks[resource]);
    if (held.length) waiting.push({ ...node, reason: held.map(r => `${r} held by ${state.graph.locks[r]}`).join(', ') });
    else if (state.graph.nodes[node.id].attempts >= (definition.policy?.max_node_attempts ?? Infinity)) {
      waiting.push({ ...node, reason: 'Shared node attempt budget exhausted; re-plan or stop.' });
    } else {
      const exhausted = recoveryBudgetBlock(state.graph, definition, node.id);
      if (exhausted) waiting.push({ ...node, reason: exhausted });
      else ready.push(node);
    }
  }
  const parallelSets = compatibleSets(ready);
  for (const node of ready) log.info(`${node.id}${node.skill ? ` -> ${node.skill}` : ''} [${node.resources.join(', ') || 'no exclusive resource'}]`);
  return { exitCode: EXIT.PASS, verdict: 'pass', ready, waiting, parallelSets, message: ready.length ? `${ready.length} node(s) ready` : 'no node ready' };
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
  if (nodeState.attempts >= (definition.policy?.max_node_attempts ?? Infinity)) {
    throw new PreconditionError(`Node ${id} exhausted its shared attempt budget. Changing recovery cause does not reset it.`);
  }
  const exhausted = recoveryBudgetBlock(state.graph, definition, id);
  if (exhausted) throw new PreconditionError(exhausted);
  const phaseNumber = Number(node.phase?.slice(1));
  if (definition.policy?.require_forecast && phaseNumber >= 2 && phaseNumber <= 10) {
    if (!state.runtime.forecast_ref || !state.runtime.forecast_hash) {
      throw new PreconditionError('Run graph-forecast with measured pilot estimates before baseline/migration work.');
    }
    const bytes = await readClosureArtifact(paths.root, state.runtime.forecast_ref);
    const forecast = JSON.parse(bytes);
    if (`sha256:${sha256(bytes)}` !== state.runtime.forecast_hash || !forecast.feasible
      || forecast.graph_hash !== state.graph.definition_hash || forecast.run_id !== state.run_id) {
      throw new PreconditionError('A current feasible graph-forecast is required before baseline/migration work.');
    }
    for (const [ref, hash] of [[forecast.plan_ref, forecast.plan_hash], ...Object.entries(forecast.source_hashes ?? {})]) {
      if (`sha256:${sha256(await readClosureArtifact(paths.root, ref))}` !== hash) {
        throw new PreconditionError('Runtime forecast plan/source changed. Reforecast against the remaining sealed window.');
      }
    }
  }
  const applicabilityOnly = values['applicability-only'] === true;
  if (applicabilityOnly && !(node.outcomes ?? []).includes('not-applicable')) {
    throw new PreconditionError(`Node ${id} has no not-applicable outcome; its checks cannot be skipped.`);
  }
  const acceptingRecordedProof = id === 'contract-a-gate' && Boolean(state.contract_a?.verification);
  if (acceptingRecordedProof) {
    await closureCheck({ values: { evidence: state.contract_a.verification.evidence_ref }, paths, log });
  }
  assertPhaseRuntime(state.runtime, node.phase, Date.now(), {
    contractAClosed: state.contract_a?.status === 'closed' || acceptingRecordedProof,
  });
  if (!applicabilityOnly && node.mutation === 'stateful') {
    if (!values.snapshot || !state.snapshots.includes(values.snapshot)) {
      throw new PreconditionError(`Stateful node ${id} requires --snapshot naming a recorded DDEV snapshot.`);
    }
  }
  if (!applicabilityOnly && node.mutation === 'code' && !values['rollback-ref']) {
    throw new PreconditionError(`Code-changing node ${id} requires --rollback-ref.`);
  }
  if (!applicabilityOnly && node.approval === 'required' && (!values.approval || !state.approvals.includes(values.approval))) {
    throw new PreconditionError(`Node ${id} requires --approval naming a granted approval.`);
  }
  const resources = nodeResources(node, definition);
  for (const resource of resources) {
    const owner = state.graph.locks[resource];
    if (owner && owner !== id) throw new PreconditionError(`Resource ${resource} is locked by ${owner}.`);
  }
  const now = new Date().toISOString();
  for (const resource of resources) state.graph.locks[resource] = id;
  nodeState.status = 'running';
  nodeState.applicability_only = applicabilityOnly;
  nodeState.attempts += 1;
  nodeState.active_since = now;
  nodeState.completed_at = null;
  state.graph.updated_at = now;
  await mkdir(paths.node(id), { recursive: true });
  await writeGraphState(store, state, stateRevision);
  await journal?.append('node', { action: 'open', node_id: id, attempt: nodeState.attempts, resources, applicability_only: applicabilityOnly });
  for (const resource of resources) await journal?.append('lock', { action: 'acquire', resource, node_id: id });
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
  if (nodeState.applicability_only && !['not-applicable', 'blocked'].includes(outcome)) {
    throw new PreconditionError('A read-only applicability check may only close not-applicable or blocked; it cannot authorize implementation or pass a proof node.');
  }
  const evidenceHash = definition.policy?.require_artifacts
    ? `sha256:${sha256(await readClosureArtifact(paths.root, evidence))}` : null;
  if (outcome === 'pass' && node.evidence_loop === 'required') {
    const loopId = String(values['evidence-loop'] ?? '').slice(0, 3);
    if (!/^\d{3}$/.test(loopId) || state.loops[loopId] !== 'green') {
      throw new PreconditionError(`Node ${id} may pass only with --evidence-loop naming a green bounded loop.`);
    }
  }
  if (outcome === 'pass' && ['contract-a-gate', 'handover'].includes(id)) {
    const checkedClosure = await closureCheck({ values, paths, log });
    if (id === 'handover') await verifyRecordedClosureAcceptance(paths, state);
    if (id === 'contract-a-gate') {
      const approvalId = values.approval;
      const files = await readdir(paths.approvalsDir).catch(() => []);
      const candidates = files.filter(f => approvalId && f.startsWith(`${approvalId}-acceptance-`));
      if (!state.approvals.includes(approvalId) || candidates.length !== 1) {
        throw new PreconditionError('Contract A requires --approval naming one recorded human acceptance of this closure evidence.');
      }
      const approvalBody = await readFile(path.join(paths.approvalsDir, candidates[0]), 'utf8');
      const acceptance = parseYaml(approvalBody.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '');
      if (!validClosureAcceptance(acceptance, { ...checkedClosure, runId: state.run_id, approvalId, evidence })) {
        throw new PreconditionError('Acceptance must belong to this run and reference the closure path#sha256:hash.');
      }
    }
  }

  const matching = definition.edges.filter((edge) => edge.from === id && edge.outcome === outcome);
  const retriesUsed = definition.edges.filter(e => e.retry === true)
    .reduce((n, e) => n + state.graph.edges[e.id].traversals, 0);
  if (retriesUsed + matching.filter(e => e.retry === true).length > (definition.policy?.max_total_retries ?? Infinity)) {
    throw new PreconditionError('The shared graph recovery budget is exhausted. Stop rather than nesting another retry loop.');
  }
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
  if (id === 'contract-a-gate' && outcome === 'pass') {
    state.contract_a = { ...state.contract_a, phase: 'P13', status: 'closed', closed_at: now, closure_ref: evidence };
    state.contract_b.unlocked = true;
    state.contract_b.unlocked_at = now;
  }
  const evidenceLoop = values['evidence-loop'] ? String(values['evidence-loop']).slice(0, 3) : null;
  const previous = { status: nodeState.status, attempt: nodeState.attempts, outcome, evidence, evidence_sha256: evidenceHash, evidence_loop: evidenceLoop, completed_at: now, applicability_only: nodeState.applicability_only ?? false };
  nodeState.history.push(previous);
  nodeState.status = statusForOutcome(outcome);
  nodeState.outcome = outcome;
  nodeState.evidence = evidence;
  nodeState.evidence_sha256 = evidenceHash;
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
  state.graph.status = deriveGraphStatus(state.graph, definition);
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
  if (definition.policy?.require_artifacts) {
    for (const [id, node] of Object.entries(state.graph.nodes)) {
      if (!['passed', 'skipped'].includes(node.status)) continue;
      if (`sha256:${sha256(await readClosureArtifact(paths.root, node.evidence))}` !== node.evidence_sha256) {
        throw new InvalidRunError(`Node ${id} evidence changed after its result was recorded.`);
      }
    }
  }
  log.success('Graph integrity is valid; this is not a completion or Contract A verdict.');
  return { exitCode: EXIT.PASS, verdict: 'pass', nodes: Object.keys(definition.nodes).length, message: 'graph integrity valid; closure is a separate gate' };
}

export async function graphForecast({ values, paths, log, journal }) {
  const { state, definition } = await graphContext(paths);
  const revision = stateHash(state);
  const planBytes = await readClosureArtifact(paths.root, values.evidence);
  const plan = JSON.parse(planBytes);
  const forecast = forecastGraph(definition, state, plan);
  forecast.plan_ref = values.evidence;
  forecast.plan_hash = `sha256:${sha256(planBytes)}`;
  forecast.source_hashes = {};
  for (const source of forecast.sources) {
    forecast.source_hashes[source] = `sha256:${sha256(await readClosureArtifact(paths.root, source))}`;
  }
  const bytes = JSON.stringify(forecast, null, 2) + '\n';
  const hash = `sha256:${sha256(bytes)}`;
  const ref = `report/runtime-forecast-${hash.slice(7, 23)}.json`;
  await mkdir(paths.reportDir, { recursive: true });
  await writeFile(path.join(paths.root, ref), bytes, { flag: 'wx' });
  state.runtime.forecast_ref = ref;
  state.runtime.forecast_hash = hash;
  await writeGraphState(new StateStore(paths), state, revision);
  await journal?.append('graph', { action: 'forecast', evidence: ref, hash, feasible: forecast.feasible });
  log.info(`${forecast.profile}: estimated ${forecast.estimated_minutes}m, reserved ${forecast.reserved_minutes}m; ${forecast.feasible ? 'fits' : 'does not fit'} the sealed window.`);
  return { exitCode: forecast.feasible ? EXIT.PASS : EXIT.PRECONDITION,
    verdict: forecast.feasible ? 'pass' : 'incomplete', evidence: ref, ...forecast,
    message: forecast.feasible ? 'forecast admitted; estimates are not guarantees' : 'split prerequisite work before starting the admitted migration' };
}

export function validateGraphDefinition(definition) {
  const issues = [];
  if (definition?.schema !== GRAPH_SCHEMA) issues.push(`schema must be ${GRAPH_SCHEMA}`);
  if (!definition?.nodes || typeof definition.nodes !== 'object' || Array.isArray(definition.nodes)) issues.push('nodes must be an object');
  if (!Array.isArray(definition?.edges)) issues.push('edges must be an array');
  if (issues.length) return issues;
  const nodeIds = new Set(Object.keys(definition.nodes));
  const resources = new Set(asArray(definition.resources));
  if (definition.policy?.serialize_mutations && !resources.has('project-write')) issues.push('serialized mutations require the project-write resource');
  for (const key of ['max_node_attempts', 'max_total_retries']) {
    const value = definition.policy?.[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 100)) issues.push(`policy.${key} must be an integer between 1 and 100`);
  }
  for (const id of [...asArray(definition.start), ...asArray(definition.terminal)]) if (!nodeIds.has(id)) issues.push(`unknown start/terminal node ${id}`);
  const edgeIds = new Set();
  for (const edge of definition.edges) {
    if (!edge?.id || edgeIds.has(edge.id)) issues.push(`edge id is missing or duplicated: ${edge?.id ?? '<missing>'}`);
    edgeIds.add(edge?.id);
    if (!nodeIds.has(edge.from)) issues.push(`edge ${edge.id} has unknown from node ${edge.from}`);
    for (const to of asArray(edge.to)) if (!nodeIds.has(to)) issues.push(`edge ${edge.id} has unknown to node ${to}`);
    if (!String(edge.outcome ?? '')) issues.push(`edge ${edge.id} has no outcome`);
    if (definition.nodes[edge.from]?.outcomes && !definition.nodes[edge.from].outcomes.includes(edge.outcome)) {
      issues.push(`edge ${edge.id} uses undeclared outcome ${edge.outcome}`);
    }
    if (edge.retry === true && (!Number.isInteger(edge.max_traversals) || edge.max_traversals < 1 || edge.max_traversals > 5)) {
      issues.push(`retry edge ${edge.id} needs max_traversals between 1 and 5`);
    }
  }
  for (const [id, node] of Object.entries(definition.nodes)) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) issues.push(`unsafe node id ${id}`);
    if (!node || typeof node !== 'object' || Array.isArray(node)) { issues.push(`node ${id} must be an object`); continue; }
    for (const required of node.requires ?? []) if (!nodeIds.has(required)) issues.push(`node ${id} requires unknown node ${required}`);
    for (const resource of nodeResources(node, definition)) if (!resources.has(resource)) issues.push(`node ${id} uses undeclared resource ${resource}`);
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
  const requiredAdj = Object.fromEntries([...nodeIds].map(id => [id, definition.nodes[id]?.requires ?? []]));
  if (hasCycle(requiredAdj)) issues.push('graph contains a prerequisite cycle and cannot become ready');
  return issues;
}

export function validateGraphState(graph, definition, hash, runState = null) {
  const issues = validateGraphDefinition(definition);
  if (graph.definition_hash !== hash) issues.push('definition hash drifted after graph-init');
  if (runState) issues.push(...runtimeProfileIssues(runState.runtime));
  if (graph.status === 'complete' && deriveGraphStatus(graph, definition) !== 'complete') {
    issues.push('graph is labelled complete with blocked or unfinished activated work; reconcile derived status with graph-next');
  }
  for (const id of Object.keys(definition.nodes)) if (!graph.nodes[id]) issues.push(`state misses node ${id}`);
  for (const id of Object.keys(graph.nodes)) if (!definition.nodes[id]) issues.push(`state contains unknown node ${id}`);
  for (const [id, node] of Object.entries(definition.nodes)) {
    const nodeState = graph.nodes[id];
    if (nodeState?.attempts > (definition.policy?.max_node_attempts ?? Infinity)) issues.push(`node ${id} exceeded its shared attempt budget`);
    if (nodeState?.status === 'running') {
      for (const resource of nodeResources(node, definition)) {
        if (graph.locks[resource] !== id) issues.push(`running node ${id} does not own lock ${resource}`);
      }
    }
    if (definition.policy?.require_artifacts && ['passed', 'skipped'].includes(nodeState?.status)
      && !/^sha256:[a-f0-9]{64}$/.test(nodeState.evidence_sha256 ?? '')) issues.push(`node ${id} has no evidence hash`);
    if (node.evidence_loop === 'required' && nodeState?.status === 'passed') {
      if (!/^\d{3}$/.test(nodeState.evidence_loop ?? '')) issues.push(`passed proof node ${id} has no evidence loop`);
      else if (runState && runState.loops?.[nodeState.evidence_loop] !== 'green') {
        issues.push(`passed proof node ${id} cites non-green loop ${nodeState.evidence_loop}`);
      }
    }
  }
  for (const [resource, owner] of Object.entries(graph.locks)) {
    if (graph.nodes[owner]?.status !== 'running') issues.push(`lock ${resource} belongs to non-running node ${owner}`);
    if (!nodeResources(definition.nodes[owner] ?? {}, definition).includes(resource)) issues.push(`lock ${resource} is not declared by ${owner}`);
  }
  for (const edge of definition.edges) {
    const traversals = graph.edges[edge.id]?.traversals;
    if (!Number.isInteger(traversals)) issues.push(`state misses edge ${edge.id}`);
    if (edge.retry === true && traversals > edge.max_traversals) issues.push(`retry edge ${edge.id} exceeded its bound`);
  }
  if (definition.edges.filter(e => e.retry).reduce((n, e) => n + (graph.edges[e.id]?.traversals ?? 0), 0)
    > (definition.policy?.max_total_retries ?? Infinity)) issues.push('graph exceeded its shared recovery budget');
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
    // An explicit arrival is a new work item, including a second visit to a repair
    // node. Historical edge counts alone must never reactivate completed work.
    if (nodeState.status === 'ready' && !requirementsMet) nodeState.status = 'pending';
    if (activated && requirementsMet && (nodeState.status === 'pending' || (traversedTargets.has(id) && ['failed', 'blocked', 'invalid', 'passed', 'skipped'].includes(nodeState.status)))) {
      nodeState.status = 'ready';
      nodeState.active_since = null;
      nodeState.completed_at = null;
      nodeState.outcome = null;
      nodeState.evidence = null;
      nodeState.evidence_sha256 = null;
      nodeState.evidence_loop = null;
    }
  }
}

function recoveryBudgetBlock(graph, definition, id) {
  // Admit no expensive repair whose every successful continuation is already exhausted.
  // Keep node-close's checks too: another worker may spend shared retries after node-open.
  const outgoing = definition.edges.filter(e => e.from === id);
  const outcomes = [...new Set(definition.nodes[id]?.outcomes ?? outgoing.map(e => e.outcome))]
    .filter(o => !['blocked', 'invalid', 'findings', 'harness-error'].includes(o));
  if (!outcomes.length) return null;
  const used = definition.edges.filter(e => e.retry)
    .reduce((sum, e) => sum + (graph.edges[e.id]?.traversals ?? 0), 0);
  const exhausted = outcomes.every(outcome => {
    const retries = outgoing.filter(e => e.outcome === outcome && e.retry);
    return used + retries.length > (definition.policy?.max_total_retries ?? Infinity)
      || retries.some(e => (graph.edges[e.id]?.traversals ?? 0) >= e.max_traversals);
  });
  return exhausted ? `Node ${id} cannot finish a successful route within the remaining recovery budget; stop before starting another repair.` : null;
}

function deriveGraphStatus(graph, definition) {
  const entries = Object.entries(graph.nodes);
  const terminals = asArray(definition.terminal);
  if (entries.some(([, n]) => n.status === 'blocked')
    || terminals.some(id => graph.nodes[id]?.status === 'failed')) return 'blocked';
  if (entries.some(([id, n]) => n.status === 'invalid'
    && !definition.edges.some(e => e.from === id && e.outcome === n.outcome))) return 'invalid';
  const start = new Set(asArray(definition.start));
  const unfinished = entries.some(([id, n]) => {
    const activated = start.has(id) || n.attempts > 0
      || definition.edges.some(e => asArray(e.to).includes(id) && graph.edges[e.id]?.traversals > 0);
    return activated && ['pending', 'ready', 'running'].includes(n.status);
  });
  if (!unfinished && terminals.some(id => ['passed', 'skipped'].includes(graph.nodes[id]?.status))) return 'complete';
  const ready = entries.filter(([, n]) => n.status === 'ready');
  if (!entries.some(([, n]) => n.status === 'running') && ready.length
    && ready.every(([id, n]) => n.attempts >= (definition.policy?.max_node_attempts ?? Infinity)
      || recoveryBudgetBlock(graph, definition, id))) return 'blocked';
  return 'active';
}

function summarize(graph, definition) {
  const counts = {};
  for (const node of Object.values(graph.nodes)) counts[node.status] = (counts[node.status] ?? 0) + 1;
  return {
    status: deriveGraphStatus(graph, definition),
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

function nodeResources(node, definition) {
  return [...new Set([...(node.resources ?? []),
    ...(definition.policy?.serialize_mutations && (['code', 'stateful'].includes(node.mutation) || node.freeze) ? ['project-write'] : [])])];
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
