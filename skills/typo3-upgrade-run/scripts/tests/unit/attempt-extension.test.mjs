import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  deriveGraphStatus, graphContext, graphInit, graphNext, graphValidate, nodeAttemptsExtend, nodeClose, nodeOpen, recoveryRoutes,
} from '../../lib/actions/graph.mjs';
import { validateRun, approvalRecord } from '../../lib/actions/lifecycle.mjs';
import { buildGraphReport, buildNodeBrief, renderGraphReport, renderNodeBrief } from '../../lib/actions/runner.mjs';
import {
  attemptBudgetOf, attemptExtensionLedger, namesNode, nodeAttemptBudget, readAttemptApprovals, resolveAttemptBudgets,
} from '../../lib/run/attempts.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';
import { stateSchemaErrors } from '../../lib/run/schema.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { Journal } from '../../lib/run/journal.mjs';
import { parse } from '../../lib/cli/args.mjs';
import { isMeasurementSource } from '../../lib/fingerprint/environment.mjs';

const RUN_ID = '2026-09-05-attempts';
const quiet = { success() {}, info() {}, warn() {}, debug() {}, error() {}, step() {}, finding() {}, json() {} };

/**
 * Three proof nodes route `invalid` to one recovery node; each recovery attempt repairs a
 * different instrument and retries that proof. After three repairs the recovery node is ready
 * again with its shared budget of three attempts spent, while its reproof route is untouched.
 */
function definition(policy = {}) {
  const proofs = ['http', 'component', 'backend'];
  return {
    schema: 'typo3-upgrade-run/graph@1', resources: [],
    policy: { max_node_attempts: 3, max_total_retries: 12, ...policy },
    start: proofs, terminal: ['done', 'stopped'],
    nodes: {
      ...Object.fromEntries(proofs.map((id) => [id, { outcomes: ['pass', 'invalid'] }])),
      'harness-recovery': { outcomes: [...proofs, 'reproof', 'blocked'] },
      epoch: { outcomes: ['pass'] },
      done: { outcomes: ['pass'] },
      stopped: { outcomes: ['pass'] },
    },
    edges: [
      ...proofs.map((id) => ({ id: `${id}-invalid`, from: id, outcome: 'invalid', to: 'harness-recovery' })),
      ...proofs.map((id) => ({ id: `${id}-pass`, from: id, outcome: 'pass', to: 'done' })),
      ...proofs.map((id) => ({ id: `recovery-${id}`, from: 'harness-recovery', outcome: id, to: id, retry: true, max_traversals: 2 })),
      { id: 'recovery-reproof', from: 'harness-recovery', outcome: 'reproof', to: 'epoch', retry: true, max_traversals: 2 },
      { id: 'recovery-blocked', from: 'harness-recovery', outcome: 'blocked', to: 'stopped' },
      { id: 'epoch-pass', from: 'epoch', outcome: 'pass', to: 'done' },
    ],
  };
}

async function exhaustedRun(policy = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 't3u-attempts-'));
  await writeFile(path.join(root, 'composer.json'), '{}\n');
  const paths = new RunPaths('.typo3-update', root);
  await mkdir(paths.configDir, { recursive: true });
  await mkdir(paths.approvalsDir, { recursive: true });
  await writeFile(paths.graphDefinition, JSON.stringify(definition(policy)));
  await writeFile(path.join(paths.root, 'proof.txt'), 'command output\nexit=0\n');
  const state = emptyState({ runId: RUN_ID, now: new Date().toISOString() });
  state.project.name = 'attempts-fixture';
  state.project.trusted_origin = 'https://attempts.ddev.site';
  await new StateStore(paths).write(state);
  const journal = new Journal(paths.journalPath);
  await graphInit({ values: {}, paths, log: quiet, journal });
  const run = { root, paths, journal };
  for (const proof of ['http', 'component', 'backend']) {
    await open(run, proof); await close(run, proof, 'invalid');
    await open(run, 'harness-recovery'); await close(run, 'harness-recovery', proof);
  }
  await open(run, 'http'); await close(run, 'http', 'invalid');
  return run;
}

const open = (run, node) => nodeOpen({ values: { node }, paths: run.paths, log: quiet, journal: run.journal });
const close = (run, node, outcome) => nodeClose({ values: { node, outcome, evidence: 'proof.txt' }, paths: run.paths, log: quiet, journal: run.journal });
const extend = (run, values) => nodeAttemptsExtend({ values: { node: 'harness-recovery', reason: 'stale epoch needs a reproof', ...values },
  paths: run.paths, log: quiet, journal: run.journal });
const readState = (run) => new StateStore(run.paths).read();
const approvalFile = async (run, id) => path.join(run.paths.approvalsDir,
  (await readdir(run.paths.approvalsDir)).find((name) => name.startsWith(`${id}-`)));

async function grant(run, id, { scope = 'One extra attempt for graph node harness-recovery to route reproof', granted = true, stage = 'intent' } = {}) {
  await approvalRecord({
    values: { id, stage, granted, scope, question: 'The recovery node spent its attempts; may it run once more?',
      answer: granted ? 'Yes' : 'No', ...(stage === 'acceptance' ? { evidence: 'report/closure-evidence.json#sha256:x' } : {}) },
    paths: run.paths, log: quiet, journal: run.journal,
  });
}

describe('t3u node-attempts-extend', () => {
  test('the command is parsed with its approval, attempts and reason options', () => {
    const parsed = parse(['node-attempts-extend', '--node', 'harness-recovery', '--approval', 'APR-001', '--reason', 'owner decision']);
    assert.equal(parsed.command, 'node-attempts-extend');
    assert.equal(parsed.values.node, 'harness-recovery');
    assert.equal(parsed.values.attempts, '1');
    assert.equal(parse(['node-attempts-extend', '--node', 'x', '--approval', 'APR-001', '--attempts', '2', '--reason', 'r']).values.attempts, '2');
  });

  test('one verified approval gives the spent node one more attempt and nothing else', async () => {
    const run = await exhaustedRun();
    try {
      let state = await readState(run);
      assert.equal(state.graph.nodes['harness-recovery'].status, 'ready');
      assert.equal(state.graph.nodes['harness-recovery'].attempts, 3);
      await assert.rejects(open(run, 'harness-recovery'), /exhausted its shared attempt budget.*node-attempts-extend/s);
      assert.match((await graphNext({ paths: run.paths, log: quiet })).waiting.find((n) => n.id === 'harness-recovery').reason, /budget exhausted/);
      const definitionBefore = await readFile(run.paths.graphDefinition, 'utf8');
      const edgesBefore = structuredClone(state.graph.edges);

      await grant(run, 'APR-001');
      const result = await extend(run, { approval: 'APR-001' });
      assert.equal(result.exitCode, 0);
      assert.equal(result.attempts_max, 4);
      assert.deepEqual(result.routes_within_budget, ['http', 'component', 'backend', 'reproof']);
      state = await readState(run);
      assert.deepEqual(stateSchemaErrors(state), []);
      const [entry] = state.graph.attempt_extensions;
      assert.deepEqual(Object.keys(entry), ['node', 'approval_id', 'approval_sha256', 'extra_attempts', 'reason', 'recorded_at']);
      assert.equal(entry.node, 'harness-recovery');
      assert.equal(entry.extra_attempts, 1);
      assert.match(entry.approval_sha256, /^sha256:[a-f0-9]{64}$/);
      // The sealed definition, its retry edges and the edge counters are untouched.
      assert.equal(await readFile(run.paths.graphDefinition, 'utf8'), definitionBefore);
      assert.deepEqual(state.graph.edges, edgesBefore);
      const events = (await readFile(run.paths.journalPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      assert.ok(events.some((e) => e.event === 'attempt-extension' && e.approval_id === 'APR-001' && e.node === 'harness-recovery'));

      const { definition: def } = await graphContext(run.paths);
      const ledger = await resolveAttemptBudgets(run.paths, state, def);
      const brief = buildNodeBrief('harness-recovery', def, state, { attempts: ledger });
      assert.deepEqual(brief.blockers, []);
      assert.equal(brief.budget.attempts_max, 4);
      assert.match(renderNodeBrief(brief), /attempts 3\/4 .*\n.*\n- attempts extended by APR-001 \(\+1\); retry edges and the global retry cap unchanged/);
      const report = renderGraphReport(buildGraphReport(def, state, [], { attempts: ledger }));
      assert.match(report, /Attempt extension: harness-recovery \+1 by APR-001 .*stale epoch needs a reproof/);

      assert.equal((await graphValidate({ paths: run.paths, log: quiet })).exitCode, 0);
      assert.equal((await validateRun({ paths: run.paths, log: quiet })).exitCode, 0);
      assert.equal((await open(run, 'harness-recovery')).attempt, 4);
      await close(run, 'harness-recovery', 'reproof');
      state = await readState(run);
      assert.equal(state.graph.nodes.epoch.status, 'ready');
      assert.equal(state.graph.edges['recovery-reproof'].traversals, 1);
      assert.equal((await graphValidate({ paths: run.paths, log: quiet })).exitCode, 0);
      // The approval is spent: it cannot authorise a second extension.
      await assert.rejects(extend(run, { approval: 'APR-001' }), /not ready|already authorised/);
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });

  test('refuses a missing, declined, acceptance-stage, wrong-node or reused approval and an unspent budget', async () => {
    const run = await exhaustedRun();
    try {
      await assert.rejects(extend(run, { approval: 'APR-009' }), /APR-009 has no intent approval file/);
      await grant(run, 'APR-001', { granted: false });
      await assert.rejects(extend(run, { approval: 'APR-001' }), /not recorded as granted/);
      await grant(run, 'APR-002', { stage: 'acceptance' });
      await assert.rejects(extend(run, { approval: 'APR-002' }), /no intent approval file/);
      await grant(run, 'APR-003', { scope: 'One extra attempt for graph node http' });
      await assert.rejects(extend(run, { approval: 'APR-003' }), /does not name node harness-recovery/);
      await grant(run, 'APR-004');
      await assert.rejects(extend(run, { approval: 'APR-004', attempts: '0' }), /--attempts must be an integer between 1 and 3/);
      await assert.rejects(extend(run, { approval: 'APR-004', reason: ' ' }), /--reason is required/);
      await assert.rejects(extend(run, { approval: 'APR-004', node: 'epoch' }), /epoch is pending, not ready/);
      await assert.rejects(extend(run, { approval: 'APR-004', 'dry-run': true }), /no --dry-run/);
      assert.equal((await readState(run)).graph.attempt_extensions, undefined);
      await extend(run, { approval: 'APR-004' });
      await grant(run, 'APR-005');
      await assert.rejects(extend(run, { approval: 'APR-005' }), /has used 3 of 4 attempts; it needs no extension/);
      // An approval spent on another owner decision cannot authorise attempts as well.
      const state = await readState(run);
      state.runtime.extensions = [{ approval_id: 'APR-005' }];
      const { definition: def } = await graphContext(run.paths);
      state.graph.attempt_extensions.push({ ...state.graph.attempt_extensions[0], approval_id: 'APR-005',
        recorded_at: new Date().toISOString() });
      const ledger = attemptExtensionLedger(state.graph, def, { approvals: await readAttemptApprovals(run.paths.approvalsDir, state.graph),
        runId: RUN_ID, granted: state.approvals, foreignIds: new Set(['APR-005']) });
      assert.ok(ledger.issues.some((issue) => /APR-005 already authorised another owner decision/.test(issue)));
      assert.equal(nodeAttemptBudget(def, 'harness-recovery', ledger), 4);
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });

  test('refuses when the extra attempt would also need a retry-edge or global-retry overrun, and says which', async () => {
    const run = await exhaustedRun({ max_total_retries: 3 });
    try {
      await grant(run, 'APR-001');
      const { state, definition: def } = await graphContext(run.paths);
      const routes = recoveryRoutes(state.graph, def, 'harness-recovery');
      assert.ok(routes.every((r) => r.overruns.some((o) => /global retry cap max_total_retries used 3\/3, needs 1 more/.test(o))));
      await assert.rejects(extend(run, { approval: 'APR-001' }),
        /would also need a retry-edge or global-retry overrun.*reproof: global retry cap max_total_retries used 3\/3/s);
      assert.equal((await readState(run)).graph.attempt_extensions, undefined);
      // A spent retry edge is named too.
      state.graph.edges['recovery-reproof'].traversals = 2;
      const reproof = recoveryRoutes(state.graph, def, 'harness-recovery').find((r) => r.outcome === 'reproof');
      assert.ok(reproof.overruns.includes('retry edge recovery-reproof used 2/2'));
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });

  test('a tampered or deleted approval stops counting: node-open, graph-validate and validate-run refuse', async () => {
    const run = await exhaustedRun();
    try {
      await grant(run, 'APR-001');
      await extend(run, { approval: 'APR-001' });
      const file = await approvalFile(run, 'APR-001');
      const original = await readFile(file, 'utf8');
      await writeFile(file, original.replace('One extra attempt', 'Ten extra attempts'));
      const state = await readState(run);
      const { definition: def } = await graphContext(run.paths);
      const ledger = await resolveAttemptBudgets(run.paths, state, def);
      assert.equal(nodeAttemptBudget(def, 'harness-recovery', ledger), 3);
      assert.ok(ledger.issues.some((issue) => /sha256 mismatch/.test(issue)));
      await assert.rejects(open(run, 'harness-recovery'), /exhausted its shared attempt budget/);
      await assert.rejects(graphValidate({ paths: run.paths, log: quiet }), /sha256 mismatch/);
      await assert.rejects(validateRun({ paths: run.paths, log: quiet }), /sha256 mismatch/);
      await grant(run, 'APR-002');
      await assert.rejects(extend(run, { approval: 'APR-002' }), /do not verify/);
      await rm(file);
      const gone = await resolveAttemptBudgets(run.paths, state, def);
      assert.equal(nodeAttemptBudget(def, 'harness-recovery', gone), 3);
      assert.ok(gone.issues.some((issue) => /APR-001 has no intent approval file/.test(issue)));
      await assert.rejects(graphValidate({ paths: run.paths, log: quiet }), /APR-001 has no intent approval file/);
      // Restored byte for byte, it verifies again.
      await writeFile(file, original);
      assert.equal((await graphValidate({ paths: run.paths, log: quiet })).exitCode, 0);
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });

  test('an extension recorded for another node does not apply to this one', async () => {
    const run = await exhaustedRun();
    try {
      await grant(run, 'APR-001', { scope: 'One extra attempt for graph node http' });
      const approval = (await readAttemptApprovals(run.paths.approvalsDir, { attempt_extensions: [{ approval_id: 'APR-001' }] })).get('APR-001');
      const store = new StateStore(run.paths);
      await store.update((s) => {
        s.graph.attempt_extensions = [{ node: 'http', approval_id: 'APR-001', approval_sha256: approval.sha256,
          extra_attempts: 1, reason: 'http instrument', recorded_at: new Date().toISOString() }];
      });
      const state = await readState(run);
      const { definition: def } = await graphContext(run.paths);
      const ledger = await resolveAttemptBudgets(run.paths, state, def);
      assert.deepEqual(ledger.issues, []);
      assert.equal(nodeAttemptBudget(def, 'http', ledger), 4);
      assert.equal(nodeAttemptBudget(def, 'harness-recovery', ledger), 3);
      await assert.rejects(open(run, 'harness-recovery'), /exhausted its shared attempt budget/);
      assert.equal((await graphValidate({ paths: run.paths, log: quiet })).exitCode, 0);
      // Relabelled onto this node by hand, the entry no longer matches its approval's scope.
      await store.update((s) => { s.graph.attempt_extensions[0].node = 'harness-recovery'; });
      const relabelled = await resolveAttemptBudgets(run.paths, await readState(run), def);
      assert.equal(nodeAttemptBudget(def, 'harness-recovery', relabelled), 3);
      assert.ok(relabelled.issues.some((issue) => /does not name node harness-recovery/.test(issue)));
      await assert.rejects(graphValidate({ paths: run.paths, log: quiet }), /does not name node harness-recovery/);
    } finally { await rm(run.root, { recursive: true, force: true }); }
  });
});

describe('attempt extension ledger', () => {
  test('a scope names a node only as a whole id', () => {
    assert.ok(namesNode('One extra attempt for graph node closure-harness-recovery (budget 3)', 'closure-harness-recovery'));
    assert.ok(!namesNode('closure-harness-recovery', 'harness-recovery'));
    assert.ok(!namesNode('route closure-harness-reproof', 'reproof'));
  });

  test('a graph whose only ready node is spent is blocked until a verified extension counts', () => {
    const def = definition();
    const node = (status, attempts = 0, outcome = status === 'invalid' ? 'invalid' : null) => ({ status, attempts, outcome });
    const graph = {
      nodes: { http: node('invalid', 2), component: node('passed', 1), backend: node('passed', 1),
        'harness-recovery': node('ready', 3), epoch: node('pending'), done: node('pending'), stopped: node('pending') },
      edges: Object.fromEntries(def.edges.map((e) => [e.id, { traversals: 0, last_at: null }])),
    };
    graph.edges['http-invalid'].traversals = 1;
    assert.equal(deriveGraphStatus(graph, def), 'blocked');
    const ledger = { extra: { 'harness-recovery': 1 }, issues: [], applied: [] };
    assert.equal(deriveGraphStatus(graph, def, attemptBudgetOf(def, ledger)), 'active');
    assert.equal(deriveGraphStatus(graph, def, attemptBudgetOf(def, { extra: { http: 1 } })), 'blocked');
  });

  test('without approvals an entry cannot verify and adds nothing', () => {
    const def = definition();
    const graph = { attempt_extensions: [{ node: 'harness-recovery', approval_id: 'APR-001', approval_sha256: `sha256:${'a'.repeat(64)}`,
      extra_attempts: 1, reason: 'r', recorded_at: '2026-10-11T20:00:00.000Z' }] };
    const ledger = attemptExtensionLedger(graph, def);
    assert.equal(nodeAttemptBudget(def, 'harness-recovery', ledger), 3);
    assert.ok(ledger.issues.some((issue) => /cannot be verified without its approval file/.test(issue)));
    assert.deepEqual(attemptExtensionLedger({}, def).issues, []);
  });

  test('the feature changes bookkeeping only: no attempt-extension file is measurement source', () => {
    for (const file of ['lib/run/attempts.mjs', 'lib/actions/graph.mjs', 'lib/actions/runner.mjs', 'lib/actions/core.mjs',
      'lib/cli/args.mjs', 'lib/run/journal.mjs', 't3u.mjs']) {
      assert.equal(isMeasurementSource(file), false, file);
    }
  });
});
