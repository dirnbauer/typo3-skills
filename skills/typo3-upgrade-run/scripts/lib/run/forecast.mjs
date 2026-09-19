/** Pure, conservative admission scheduling. Estimates are not measured completion claims. */
import { PreconditionError } from '../cli/exit-codes.mjs';
import { nodeClaims, claimsConflict } from './resources.mjs';

const terminal = status => ['passed', 'skipped'].includes(status);
const array = value => Array.isArray(value) ? value : value ? [value] : [];

export function forecastGraph(definition, state, plan, now = Date.now()) {
  const refuse = message => { throw new PreconditionError(`Runtime forecast: ${message}`); };
  if (plan?.schema !== 'typo3-upgrade-run/runtime-plan@1' || plan.run_id !== state.run_id
    || plan.graph_hash !== state.graph?.definition_hash) refuse('plan must name this run and sealed graph.');
  if (!Number.isFinite(Date.parse(state.runtime?.deadline_at))) refuse('seal site sizing first.');
  if (Object.values(state.graph.nodes).some(n => n.status === 'running')) refuse('checkpoint running work before forecasting.');
  if (plan.final_passes !== 2 || !Number.isInteger(plan.lighthouse_runs_per_url) || plan.lighthouse_runs_per_url < 3) refuse('include both final passes and at least three Lighthouse runs per URL.');
  const workers = plan.max_workers ?? 1;
  if (!Number.isInteger(workers) || workers < 1 || workers > 4) refuse('max_workers must be 1..4.');
  if (workers > 1 && !state.approvals.includes(plan.parallel_approval)) refuse('parallel estimates need a recorded authorization; otherwise use one worker.');
  if (!Number.isFinite(plan.buffer_minutes) || plan.buffer_minutes < 30) refuse('reserve at least 30 minutes of uncertainty/rollback buffer.');
  if (!plan.nodes || typeof plan.nodes !== 'object' || Array.isArray(plan.nodes)) refuse('nodes must contain per-node estimates and source references.');
  const selected = new Set(), parents = new Map();
  const visit = id => {
    if (selected.has(id)) return;
    if (!definition.nodes[id]) refuse(`unknown node ${id}.`);
    selected.add(id);
    if (id === 'closure-join') return; // Human acceptance and optional B are not overnight execution.
    const nodeState = state.graph.nodes[id];
    const outcome = terminal(nodeState.status) ? nodeState.outcome : (plan.nodes[id]?.outcome ?? 'pass');
    if (!['pass', 'not-applicable'].includes(outcome)) refuse(`resolve the ${id} branch before admission.`);
    const edges = definition.edges.filter(e => e.from === id && e.outcome === outcome && !e.retry);
    if (!edges.length) refuse(`no success route for ${id}:${outcome}.`);
    for (const edge of edges) for (const target of array(edge.to)) {
      if (target === 'stopped') refuse(`${id} routes to stopped.`);
      if (!parents.has(target)) parents.set(target, new Set());
      parents.get(target).add(id); visit(target);
    }
  };
  array(definition.start).forEach(visit);
  if (!selected.has('closure-join')) refuse('selected route cannot reach final verification.');
  const jobs = new Map(), sources = new Set();
  for (const id of selected) {
    const node = definition.nodes[id];
    for (const required of node.requires ?? []) {
      if (!selected.has(required)) refuse(`${id} depends on inactive branch ${required}.`);
      if (!parents.has(id)) parents.set(id, new Set());
      parents.get(id).add(required);
    }
    const estimate = plan.nodes[id];
    const done = terminal(state.graph.nodes[id].status);
    // Pure joins do not need invented timing documents. All real work does.
    const minutes = done ? 0 : (node.skill ? estimate?.minutes : (estimate?.minutes ?? 0));
    if (!Number.isFinite(minutes) || minutes < 0 || (!done && node.skill && minutes === 0)) refuse(`missing positive estimate for ${id}.`);
    if (!done && node.skill) {
      if (typeof estimate?.source !== 'string' || !estimate.source.trim()) refuse(`${id} has no measured pilot/estimate source.`);
      sources.add(estimate.source);
    }
    const claims = nodeClaims(node, definition);
    jobs.set(id, { id, minutes, resources: claims.map(c => c.resource), claims,
      parents: [...(parents.get(id) ?? [])], phase: Number(node.phase?.slice(1)) });
  }
  const finish = new Map(), running = [], schedule = [];
  let time = 0;
  while (finish.size < jobs.size) {
    for (let i = running.length - 1; i >= 0; i--) if (running[i].end <= time) {
      finish.set(running[i].id, running[i].end); running.splice(i, 1);
    }
    let started = false;
    for (const job of jobs.values()) {
      if (finish.has(job.id) || running.some(r => r.id === job.id) || !job.parents.every(p => finish.has(p))) continue;
      const occupied = running.flatMap(r => r.claims);
      if (job.minutes && (running.length >= workers || claimsConflict(job.claims, occupied))) continue;
      const task = { ...job, start: time, end: time + job.minutes };
      schedule.push(task); started = true;
      if (job.minutes === 0) finish.set(job.id, time); else running.push(task);
    }
    if (finish.size === jobs.size) break;
    if (!started) {
      if (!running.length) refuse('dependency deadlock in the selected route.');
      time = Math.min(...running.map(r => r.end));
    }
  }
  const minutes = Math.max(0, ...finish.values());
  const migrations = schedule.filter(j => j.minutes > 0 && j.phase >= 5 && j.phase <= 10);
  const mutationEnd = Math.max(0, ...migrations.map(j => j.end));
  // A resumed closure uses the reserve already protected before migration. Do not
  // charge that entire reserve again or require a cutoff for work already finished.
  const protectedMinutes = Math.max(minutes + plan.buffer_minutes,
    migrations.length ? mutationEnd + state.runtime.closure_reserve_hours * 60 : 0);
  const deadline = Date.parse(state.runtime.deadline_at), cutoff = Date.parse(state.runtime.migration_cutoff_at);
  const feasible = now + protectedMinutes * 60000 <= deadline
    && (!migrations.length || now + (mutationEnd + plan.buffer_minutes) * 60000 <= cutoff);
  return { schema: 'typo3-upgrade-run/runtime-forecast@1', run_id: state.run_id, graph_hash: plan.graph_hash,
    created_at: new Date(now).toISOString(), profile: state.runtime.size_profile, max_workers: workers,
    estimated_minutes: minutes, serial_minutes: [...jobs.values()].reduce((n, j) => n + j.minutes, 0),
    reserved_minutes: protectedMinutes, feasible, sources: [...sources], schedule,
    estimated_finish_at: new Date(now + minutes * 60000).toISOString(),
    reserved_finish_at: new Date(now + protectedMinutes * 60000).toISOString(),
    migration_finish_at: migrations.length ? new Date(now + mutationEnd * 60000).toISOString() : null,
    caveat: 'Pilot-based estimate including declared final reruns; locks serialize shared resources. Human acceptance is separate. Not a runtime or speedup guarantee.' };
}
