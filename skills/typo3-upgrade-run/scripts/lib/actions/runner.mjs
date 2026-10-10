/**
 * Graph runner views: the typed handoff for one node and the measured run report.
 *
 * node-brief exists so that every ready node can be executed by a worker with a fresh,
 * small context: the brief is the whole input. The controller keeps the transcript, the
 * worker keeps nothing but this contract. graph-report turns the journal into per-node
 * wall-clock evidence, so the next admission forecast can use measured minutes instead of
 * guesses. Both commands are read-only.
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { EXIT, HarnessError } from '../cli/exit-codes.mjs';
import { Journal } from '../run/journal.mjs';
import { assertPhaseRuntime, describeRuntimeWindow, resolveRuntime, sealedRuntimeWindow } from '../run/runtime.mjs';
import { blockedClaims, lockOwners, nodeClaims } from '../run/resources.mjs';
import { readClosureArtifact } from './closure.mjs';
import { reviewRequired } from '../run/guards.mjs';
import { deriveGraphStatus, graphContext, recoveryBudgetBlock, refreshReady } from './graph.mjs';

const exec = promisify(execFile);

export const OUTCOME_MEANING = Object.freeze({
  pass: 'the objective is met and the evidence file proves it',
  findings: 'the measurement worked and found a project or site defect',
  invalid: 'inputs drifted or the evidence cannot support a verdict',
  'harness-error': 'the measuring system itself failed; the site is not judged',
  blocked: 'a guard, approval, identity, credential or policy refused the work',
  'not-applicable': 'the condition was inspected and is absent; the evidence says why',
});

const WORKER_RULES = Object.freeze([
  'Work only on this objective. One cause per attempt, normally at most 10 files or 400 changed lines.',
  'Write the evidence file: commands, exit codes, hashes, findings and decisions. "Checked" without an artifact is not evidence.',
  'Return one allowed outcome and the evidence path. Do not start your own retry loop; the graph routes the next step.',
  'Only the controller runs node-open and node-close and writes run state.',
  'Return blocked on any identity, credential, backup, approval or scope doubt. Never mutate to find out.',
]);

export async function nodeBrief({ values, paths, log }) {
  const id = requireNodeId(values.node);
  const { state, definition } = await graphContext(paths);
  refreshReady(state.graph, definition); // in memory only: a brief never writes state
  let forecast = null;
  if (state.runtime?.forecast_ref) {
    forecast = await readClosureArtifact(paths.root, state.runtime.forecast_ref)
      .then((bytes) => JSON.parse(bytes)).catch(() => null);
  }
  const brief = buildNodeBrief(id, definition, state, { forecast, now: Date.now(), window: (await resolveRuntime(paths, state)).window });
  if (!values.json) process.stdout.write(`${renderNodeBrief(brief)}\n`);
  log.debug(`Brief for ${id}: ${brief.status}, ${brief.blockers.length} blocker(s).`);
  return { exitCode: EXIT.PASS, verdict: 'pass', brief,
    message: brief.blockers.length ? `${id}: ${brief.status}, not openable yet` : `${id}: ready to open` };
}

export function buildNodeBrief(id, definition, state, { forecast = null, now = Date.now(), window = null } = {}) {
  const runtimeWindow = window ?? sealedRuntimeWindow(state.runtime);
  const node = definition.nodes[id];
  const nodeState = state.graph?.nodes?.[id];
  if (!node || !nodeState) throw new HarnessError(`Unknown graph node: ${id}`);
  const policy = definition.policy ?? {};
  const edges = definition.edges;
  const traversals = (edge) => state.graph.edges?.[edge.id]?.traversals ?? 0;
  const retriesUsed = edges.filter((e) => e.retry === true).reduce((n, e) => n + traversals(e), 0);
  const claims = nodeClaims(node, definition);
  const mutation = node.mutation ?? 'none';
  const evidence = node.evidence ?? `nodes/${id}/evidence.md`;
  const outcomes = node.outcomes ?? Object.keys(OUTCOME_MEANING);

  const blockers = [];
  if (nodeState.status === 'pending') {
    const unmet = (node.requires ?? []).filter((r) => !['passed', 'skipped'].includes(state.graph.nodes[r]?.status));
    blockers.push(unmet.length ? `waiting for prerequisites: ${unmet.join(', ')}` : 'not activated: no incoming route has fired');
  } else if (nodeState.status === 'running') {
    blockers.push(`already running (attempt ${nodeState.attempts}); close it before opening again`);
  } else if (nodeState.status !== 'ready') {
    blockers.push(`closed as ${nodeState.status}; only a routed edge can reactivate it`);
  }
  for (const { resource } of blockedClaims(claims, state.graph.locks ?? {})) {
    blockers.push(`${resource} held by ${lockOwners(state.graph.locks[resource]).join(', ')}`);
  }
  if (nodeState.attempts >= (policy.max_node_attempts ?? Infinity)) blockers.push('shared node attempt budget exhausted; re-plan or stop');
  const exhausted = recoveryBudgetBlock(state.graph, definition, id);
  if (exhausted) blockers.push(exhausted);
  const phase = Number(String(node.phase ?? '').slice(1));
  if (policy.require_forecast && phase >= 2 && phase <= 10 && !state.runtime?.forecast_ref) {
    blockers.push('graph-forecast must admit the route before baseline or migration work');
  }
  try {
    assertPhaseRuntime(state.runtime, node.phase, now, { contractAClosed: state.contract_a?.status === 'closed', window: runtimeWindow });
  } catch (error) {
    blockers.push(error.message);
  }

  const routes = outcomes.map((outcome) => ({
    outcome,
    meaning: OUTCOME_MEANING[outcome] ?? 'a classifier selected this cause; take its route',
    to: edges.filter((e) => e.from === id && e.outcome === outcome).map((e) => ({
      edge: e.id, targets: asArray(e.to), retry: e.retry === true,
      used: traversals(e), max: e.retry === true ? e.max_traversals : null,
    })),
  }));
  const incomingRetries = edges.filter((e) => e.retry === true && asArray(e.to).includes(id))
    .map((e) => ({ edge: e.id, from: e.from, used: traversals(e), max: e.max_traversals }));

  const openFlags = [];
  if (mutation === 'stateful') openFlags.push('--snapshot <recorded snapshot>');
  if (mutation === 'code') openFlags.push('--rollback-ref git:<sha>');
  if (node.approval === 'required') openFlags.push('--approval <granted APR-NNN>');
  const closeFlags = [`--outcome <${outcomes.join('|')}>`, `--evidence ${evidence}`];
  if (node.evidence_loop === 'required') closeFlags.push('--evidence-loop <green loop id>');
  if (id === 'contract-a-gate') closeFlags.push('--approval <acceptance APR-NNN>');
  const reviewOutcomes = outcomes.filter((outcome) => reviewRequired(definition, node, outcome));
  const reviewPath = `nodes/${id}/review.md`;
  if (reviewOutcomes.length) closeFlags.push(`--review ${reviewPath}`);
  const guarded = policy.guard_change_scope === true && ['code', 'stateful'].includes(mutation);
  const changeBudget = guarded && id.endsWith('-recovery') ? policy.recovery_change_budget ?? null : null;
  const prepare = [];
  if (mutation === 'stateful') prepare.push(`t3u snapshot-create --node ${id}`);

  const scheduled = forecast?.schedule?.find?.((job) => job.id === id);
  const minutesUntil = (iso) => {
    const ms = Date.parse(iso ?? '');
    return Number.isFinite(ms) ? Math.round((ms - now) / 60000) : null;
  };

  return {
    id,
    phase: node.phase ?? null,
    skill: node.skill ?? null,
    owner: node.skill ?? 'controller (join or gate)',
    status: nodeState.status,
    objective: node.objective ?? null,
    done: node.done ?? null,
    evidence: { path: evidence, loop_required: node.evidence_loop === 'required' },
    mutation,
    approval_required: node.approval === 'required',
    review: reviewOutcomes.length ? { required_for: reviewOutcomes, path: reviewPath } : null,
    guard: guarded ? { measurement_node: node.measurement === true, change_budget: changeBudget } : null,
    prerequisites: (node.requires ?? []).map((r) => ({ id: r, status: state.graph.nodes[r]?.status ?? 'unknown' })),
    resources: claims.map((c) => ({ ...c, held_by: lockOwners(state.graph.locks?.[c.resource]) })),
    routes,
    incoming_retries: incomingRetries,
    budget: {
      attempts_used: nodeState.attempts,
      attempts_max: policy.max_node_attempts ?? null,
      graph_retries_used: retriesUsed,
      graph_retries_max: policy.max_total_retries ?? null,
      forecast_minutes: Number.isFinite(scheduled?.minutes) ? scheduled.minutes : null,
      minutes_to_migration_cutoff: minutesUntil(runtimeWindow.cutoffAt),
      minutes_to_deadline: minutesUntil(runtimeWindow.deadlineAt),
      runtime_extension: describeRuntimeWindow(runtimeWindow),
    },
    blockers,
    commands: {
      prepare,
      open: [`t3u node-open --node ${id}`, ...openFlags].join(' '),
      close: [`t3u node-close --node ${id}`, ...closeFlags].join(' '),
    },
    rules: [...WORKER_RULES,
      ...(mutation === 'stateful' ? ['Take the snapshot immediately before the first data change; one snapshot per attempt.'] : []),
      ...(guarded && node.measurement !== true ? ['Never edit measurement inputs (config/, URL manifest, feature plan, self-test lock, baseline seals). node-close refuses them in a site-fix node.'] : []),
      ...(guarded && node.measurement === true ? ['You may recalibrate config/ and the self-test only with an ADR. Baseline seals, URL manifest and feature plan stay untouched.'] : []),
      ...(reviewOutcomes.length ? [`For ${reviewOutcomes.join(' or ')}, a separate verifier reads only this brief and the evidence and writes ${reviewPath} with "verdict: agree|disagree" and "evidence_sha256: sha256:…".`] : [])],
  };
}

export function renderNodeBrief(brief) {
  const lines = [
    `# Node brief: ${brief.id} (${brief.phase ?? '—'})`,
    '',
    `Owner: ${brief.owner}${brief.skill ? ' — load this skill for the procedure' : ''}`,
    `Status: ${brief.status}${brief.blockers.length ? ' — not openable yet' : ' — openable'}`,
    `Objective: ${brief.objective ?? '—'}`,
    `Done when: ${brief.done ?? '—'}`,
    `Evidence: ${brief.evidence.path}${brief.evidence.loop_required ? ' plus a green bounded evidence loop' : ''}`,
    `Mutation: ${brief.mutation}${brief.approval_required ? ' · approval required' : ''}`,
  ];
  if (brief.review) lines.push(`Independent review: required for ${brief.review.required_for.join(', ')} → ${brief.review.path}`);
  if (brief.guard) {
    lines.push(`Change guard: measurement inputs ${brief.guard.measurement_node ? 'recalibration allowed with ADR' : 'frozen'}`
      + (brief.guard.change_budget ? ` · budget ${brief.guard.change_budget.files} files / ${brief.guard.change_budget.lines} lines` : ''));
  }
  if (brief.prerequisites.length) {
    lines.push(`Prerequisites: ${brief.prerequisites.map((p) => `${p.id}=${p.status}`).join(', ')}`);
  }
  lines.push(`Resources: ${brief.resources.map((r) => `${r.resource} (${r.mode}${r.held_by.length ? `, held by ${r.held_by.join('+')}` : ''})`).join(', ') || 'none'}`);
  lines.push('', '## Outcomes → next');
  for (const route of brief.routes) {
    const next = route.to.map((t) => `${t.targets.join(' + ')}${t.retry ? ` (retry ${t.used}/${t.max})` : ''}`).join('; ')
      || 'terminal';
    lines.push(`- ${route.outcome} → ${next} — ${route.meaning}`);
  }
  if (brief.incoming_retries.length) {
    lines.push(`- retry edges into this node: ${brief.incoming_retries.map((r) => `${r.edge} ${r.used}/${r.max}`).join(', ')}`);
  }
  const b = brief.budget;
  lines.push('', '## Budget',
    `- attempts ${b.attempts_used}/${b.attempts_max ?? '∞'} · graph retries ${b.graph_retries_used}/${b.graph_retries_max ?? '∞'}`
      + (b.forecast_minutes !== null ? ` · forecast ${b.forecast_minutes} min` : ''),
    `- migration cutoff in ${b.minutes_to_migration_cutoff ?? '—'} min · deadline in ${b.minutes_to_deadline ?? '—'} min`,
    ...(b.runtime_extension ? [`- runtime ${b.runtime_extension}; sealed cutoff and deadline unchanged`] : []));
  if (brief.blockers.length) {
    lines.push('', '## Blockers', ...brief.blockers.map((x) => `- ${x}`));
  }
  lines.push('', '## Commands', ...brief.commands.prepare.map((c) => `    ${c}`),
    `    ${brief.commands.open}`, `    ${brief.commands.close}`);
  lines.push('', '## Worker rules', ...brief.rules.map((r, i) => `${i + 1}. ${r}`));
  return lines.join('\n');
}

export async function graphReport({ values, paths, log }) {
  const { state, definition } = await graphContext(paths);
  const events = await new Journal(paths.journalPath).read();
  const ledger = await resolveRuntime(paths, state);
  const report = buildGraphReport(definition, state, events, { now: Date.now(), window: ledger.window, extensions: ledger.applied });
  report.audit_trail = await auditTrail(paths);
  const markdown = renderGraphReport(report);
  const reports = [];
  if (values.write) {
    await mkdir(paths.reportDir, { recursive: true });
    await writeFile(path.join(paths.reportDir, 'graph-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await writeFile(path.join(paths.reportDir, 'graph-report.md'), `${markdown}\n`, 'utf8');
    reports.push('report/graph-report.json', 'report/graph-report.md');
  }
  if (!values.json) process.stdout.write(`${markdown}\n`);
  log.debug(`Graph report: ${report.nodes.length} node(s) touched.`);
  return { exitCode: EXIT.PASS, verdict: 'pass', report, reports,
    message: `graph ${report.graph.status}; ${report.nodes.length} node(s) touched; measured minutes are wall-clock, not guarantees` };
}

export function buildGraphReport(definition, state, events, { now = Date.now(), window = null, extensions = [] } = {}) {
  const runtimeWindow = window ?? sealedRuntimeWindow(state.runtime);
  const graph = state.graph;
  const nodeEvents = events.filter((e) => e.event === 'node' && ['open', 'close'].includes(e.action) && e.node_id);
  const open = new Map();
  const runs = new Map();
  for (const event of nodeEvents) {
    if (event.action === 'open') { open.set(event.node_id, event.ts); continue; }
    const started = open.get(event.node_id);
    open.delete(event.node_id);
    const minutes = started ? Math.max(0, (Date.parse(event.ts) - Date.parse(started)) / 60000) : null;
    if (!runs.has(event.node_id)) runs.set(event.node_id, []);
    runs.get(event.node_id).push({ opened_at: started ?? null, closed_at: event.ts, minutes: round(minutes), outcome: event.outcome ?? null });
  }
  const nodes = [];
  for (const [id, node] of Object.entries(definition.nodes)) {
    const nodeState = graph.nodes[id];
    if (!nodeState || (nodeState.attempts === 0 && !runs.has(id))) continue;
    const completed = runs.get(id) ?? [];
    const runningMinutes = nodeState.status === 'running' && nodeState.active_since
      ? round((now - Date.parse(nodeState.active_since)) / 60000) : null;
    nodes.push({
      id, phase: node.phase ?? null, skill: node.skill ?? null, status: nodeState.status,
      attempts: nodeState.attempts, outcomes: completed.map((r) => r.outcome),
      minutes: round(completed.reduce((n, r) => n + (r.minutes ?? 0), 0)), running_minutes: runningMinutes,
      runs: completed,
    });
  }
  const phases = {};
  for (const n of nodes) {
    const key = n.phase ?? '—';
    phases[key] ??= { nodes: 0, minutes: 0 };
    phases[key].nodes += 1;
    phases[key].minutes = round(phases[key].minutes + n.minutes);
  }
  const retryEdges = definition.edges.filter((e) => e.retry === true);
  const retries = retryEdges.map((e) => ({ edge: e.id, from: e.from, to: asArray(e.to),
    used: graph.edges[e.id]?.traversals ?? 0, max: e.max_traversals })).filter((r) => r.used > 0);
  const init = events.find((e) => e.event === 'graph' && e.action === 'init');
  const lastTs = events.length ? events[events.length - 1].ts : null;
  const startedAt = init?.ts ?? null;
  const plan = {};
  for (const n of nodes) {
    const measured = n.runs.filter((r) => Number.isFinite(r.minutes));
    if (!measured.length || !n.skill) continue;
    const mean = measured.reduce((sum, r) => sum + r.minutes, 0) / measured.length;
    plan[n.id] = { minutes: Math.max(1, Math.ceil(mean)), source: `graph-report ${state.run_id}: mean of ${measured.length} measured attempt(s)` };
  }
  return {
    schema: 'typo3-upgrade-run/graph-report@1',
    run_id: state.run_id,
    generated_at: new Date(now).toISOString(),
    graph: {
      definition_hash: graph.definition_hash,
      status: deriveGraphStatus(graph, definition),
      started_at: startedAt,
      last_event_at: lastTs,
      elapsed_minutes: startedAt && lastTs ? round((Date.parse(lastTs) - Date.parse(startedAt)) / 60000) : null,
      node_minutes: round(nodes.reduce((n, x) => n + x.minutes, 0)),
      retries_used: retryEdges.reduce((n, e) => n + (graph.edges[e.id]?.traversals ?? 0), 0),
      retries_max: definition.policy?.max_total_retries ?? null,
      running: nodes.filter((n) => n.status === 'running').map((n) => n.id),
    },
    runtime: {
      profile: state.runtime?.size_profile ?? null,
      deadline_at: state.runtime?.deadline_at ?? null,
      migration_cutoff_at: state.runtime?.migration_cutoff_at ?? null,
      // Owner-approved extensions or waivers; the sealed values above never change.
      effective_deadline_at: runtimeWindow.deadlineAt,
      effective_migration_cutoff_at: runtimeWindow.cutoffAt,
      waived: runtimeWindow.waived,
      extension: describeRuntimeWindow(runtimeWindow),
      extensions: extensions.map((e) => ({ approval_id: e.approval_id, approval_sha256: e.approval_sha256,
        waived: e.waived, new_deadline: e.new_deadline, new_cutoff: e.new_cutoff, reason: e.reason, recorded_at: e.recorded_at })),
    },
    phases,
    nodes,
    retries,
    measured_plan_nodes: plan,
    caveat: 'Wall-clock minutes between node-open and node-close. Waiting between nodes is not attributed; estimates for the next run are hints, not guarantees.',
  };
}

export function renderGraphReport(report) {
  const g = report.graph;
  const lines = [
    `# Graph report: ${report.run_id}`,
    '',
    `Status: ${g.status} · started ${g.started_at ?? '—'} · elapsed ${g.elapsed_minutes ?? '—'} min · node work ${g.node_minutes} min`,
    `Retries: ${g.retries_used}/${g.retries_max ?? '∞'} · running: ${g.running.join(', ') || '—'}`,
    `Runtime: ${report.runtime.profile ?? 'unsealed'} · cutoff ${report.runtime.migration_cutoff_at ?? '—'} · deadline ${report.runtime.deadline_at ?? '—'}`,
  ];
  if (report.runtime.extension) {
    lines.push(`Runtime extension: ${report.runtime.extension}; sealed values unchanged, proof rules unchanged`);
    for (const e of report.runtime.extensions ?? []) {
      lines.push(`- ${e.approval_id} (${e.approval_sha256.slice(0, 19)}…) at ${e.recorded_at}: ${e.waived ? 'waived' : `deadline ${e.new_deadline}, cutoff ${e.new_cutoff}`} — ${e.reason}`);
    }
  }
  if (report.audit_trail) {
    lines.push(`Audit trail in Git: ${report.audit_trail.tracked}${report.audit_trail.detail ? ` (${report.audit_trail.detail})` : ''}`);
  }
  lines.push('', '| Node | Phase | Status | Attempts | Minutes | Outcomes |', '|---|---|---|---:|---:|---|');
  for (const n of report.nodes) {
    lines.push(`| ${n.id} | ${n.phase ?? '—'} | ${n.status}${n.running_minutes !== null ? ` (${n.running_minutes} min)` : ''} | ${n.attempts} | ${n.minutes} | ${n.outcomes.join(', ') || '—'} |`);
  }
  if (report.retries.length) {
    lines.push('', '| Retry edge | From | To | Used |', '|---|---|---|---:|');
    for (const r of report.retries) lines.push(`| ${r.edge} | ${r.from} | ${r.to.join(', ')} | ${r.used}/${r.max} |`);
  }
  const phaseRows = Object.entries(report.phases).sort(([a], [b]) => a.localeCompare(b));
  if (phaseRows.length) {
    lines.push('', '| Phase | Nodes | Minutes |', '|---|---:|---:|', ...phaseRows.map(([p, v]) => `| ${p} | ${v.nodes} | ${v.minutes} |`));
  }
  lines.push('', report.caveat);
  return lines.join('\n');
}

async function auditTrail(paths) {
  const files = ['state.json', 'journal.jsonl'];
  try {
    const { stdout } = await exec('git', ['-C', paths.root, 'ls-files', '--', ...files]);
    const tracked = stdout.split('\n').filter(Boolean);
    return tracked.length === files.length
      ? { tracked: 'yes', detail: null }
      : { tracked: 'no', detail: 'commit the run directory or archive it with checksums before handover' };
  } catch {
    return { tracked: 'unknown', detail: 'not a Git work tree or Git unavailable' };
  }
}

function requireNodeId(value) {
  const id = String(value ?? '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new HarnessError('--node must be a graph node id.');
  return id;
}

function round(value) {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : value;
}

function asArray(value) { return Array.isArray(value) ? value : value ? [value] : []; }
