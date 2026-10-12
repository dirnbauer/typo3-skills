import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { graphInit, graphValidate, nodeClose, nodeOpen } from '../../lib/actions/graph.mjs';
import { selftestDeterminism } from '../../lib/actions/compare.mjs';
import { approvalRecord, validateRun } from '../../lib/actions/lifecycle.mjs';
import { selftestRefreshLedger, refreshedLockBound } from '../../lib/run/selftest-refresh.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';
import { stateSchemaErrors } from '../../lib/run/schema.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { Journal } from '../../lib/run/journal.mjs';
import { parse } from '../../lib/cli/args.mjs';
import { EXIT } from '../../lib/cli/exit-codes.mjs';
import { isMeasurementSource } from '../../lib/fingerprint/environment.mjs';

const exec = promisify(execFile);
const RUN_ID = '2026-10-12-refresh';
const NODE = 'webmcp-readiness';
const quiet = { success() {}, info() {}, warn() {}, debug() {}, error() {}, step() {}, finding() {}, json() {} };
const hex = (text) => createHash('sha256').update(text).digest('hex');
const ref = (char) => `sha256:${char.repeat(64)}`;
const INPUTS = { env: ref('b'), content: ref('c'), manifest: ref('a') };
const LOCK_HASH = hex([INPUTS.env, INPUTS.content, INPUTS.manifest].join('|'));

/** Two guarded code nodes and a measurement node; any of them may be open. */
const DEFINITION = {
  schema: 'typo3-upgrade-run/graph@1', resources: [],
  policy: { max_node_attempts: 3, max_total_retries: 4, guard_change_scope: true },
  start: [NODE, 'other-site-node', 'harness-recovery'], terminal: ['done'],
  nodes: {
    [NODE]: { mutation: 'code', outcomes: ['pass', 'blocked'] },
    'other-site-node': { mutation: 'code', outcomes: ['pass', 'blocked'] },
    'harness-recovery': { mutation: 'code', measurement: true, outcomes: ['pass'] },
    done: { outcomes: ['pass'] },
  },
  edges: [
    { id: 'node-pass', from: NODE, outcome: 'pass', to: 'done' },
    { id: 'node-blocked', from: NODE, outcome: 'blocked', to: 'done' },
    { id: 'other-pass', from: 'other-site-node', outcome: 'pass', to: 'done' },
    { id: 'other-blocked', from: 'other-site-node', outcome: 'blocked', to: 'done' },
    { id: 'recovery-pass', from: 'harness-recovery', outcome: 'pass', to: 'done' },
  ],
};

const lockBody = (passedAt) => `${JSON.stringify({
  schema: 'typo3-upgrade-run/selftest-lock@1', verdict: 'pass', passedAt, selftestHash: LOCK_HASH,
  coverage: 'all', repeats: 2, captures: 0, visualWorkers: 1, visualWorkersSource: 'flag',
  maxAgeMs: 24 * 60 * 60 * 1000, harnessVersion: '2.1.0',
}, null, 2)}\n`;

const git = (root, ...args) => exec('git', ['-C', root, ...args]);

/** A clean Git project whose run has a sealed graph, sealed inputs and an expired (or valid) lock. */
async function run({ lockAgeHours = 48 } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 't3u-refresh-'));
  await writeFile(path.join(root, 'composer.json'), '{}\n');
  await writeFile(path.join(root, '.gitignore'), '.typo3-update/\n');
  await git(root, 'init', '-q');
  await git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '.');
  await git(root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'site');
  const head = (await git(root, 'rev-parse', 'HEAD')).stdout.trim();
  const paths = new RunPaths('.typo3-update', root);
  await mkdir(paths.configDir, { recursive: true });
  await mkdir(paths.manifestsDir, { recursive: true });
  await mkdir(paths.approvalsDir, { recursive: true });
  await writeFile(paths.graphDefinition, JSON.stringify(DEFINITION));
  await writeFile(path.join(paths.root, 'proof.txt'), 'webmcp tools listed\nexit=0\n');
  const state = emptyState({ runId: RUN_ID, now: new Date().toISOString() });
  state.project.trusted_origin = 'https://refresh.ddev.site';
  state.fingerprints.environment = INPUTS.env;
  state.fingerprints.content = INPUTS.content;
  state.manifest.hash = INPUTS.manifest;
  state.selftest = { status: 'green', at: null, lock_hash: LOCK_HASH, coverage: 'all', quarantined_captures: [] };
  await new StateStore(paths).write(state);
  await writeFile(paths.envFingerprint, JSON.stringify({ fingerprintHash: INPUTS.env, components: {} }));
  await writeFile(paths.contentFingerprint, JSON.stringify({ fingerprintHash: INPUTS.content, database: { tables: [] } }));
  await writeFile(paths.urlManifest, JSON.stringify({
    manifestHash: INPUTS.manifest, allowedOrigins: ['http://127.0.0.1:9'], seed: 's', allUrls: [], captures: [],
  }));
  await writeFile(paths.selftestLock, lockBody(new Date(Date.now() - lockAgeHours * 3_600_000).toISOString()));
  const journal = new Journal(paths.journalPath);
  await graphInit({ values: {}, paths, log: quiet, journal });
  return { root, paths, journal, head };
}

const open = (r, node = NODE) => nodeOpen({ values: { node, 'rollback-ref': `git:${r.head}` }, paths: r.paths, log: quiet, journal: r.journal });
const close = (r, outcome = 'pass', node = NODE) => nodeClose({ values: { node, outcome, evidence: 'proof.txt' }, paths: r.paths, log: quiet, journal: r.journal });
const readState = (r) => new StateStore(r.paths).read();
const refresh = (r, values) => selftestDeterminism({ values: { sample: 'all', ...values }, paths: r.paths, log: quiet, journal: r.journal });
const approvalFile = async (r, id) => path.join(r.paths.approvalsDir,
  (await readdir(r.paths.approvalsDir)).find((name) => name.startsWith(`${id}-`)));

async function grant(r, id, scope = `Harness fix: one approved determinism self-test refresh inside the open node ${NODE}`) {
  await approvalRecord({
    values: { id, stage: 'intent', granted: true, scope, question: 'The self-test expired inside the node; refresh it there?', answer: 'Yes' },
    paths: r.paths, log: quiet, journal: r.journal,
  });
}

/**
 * The real self-test, in a child process with its own TMPDIR so the machine-wide capture lock and
 * capacity ledger of a live run on this host are never touched. The manifest has no URLs: no
 * browser starts and nothing is fetched.
 */
async function realRefresh(r, values) {
  const isolated = await mkdtemp(path.join(tmpdir(), 't3u-refresh-tmp-'));
  try {
    const lib = (rel) => JSON.stringify(pathToFileURL(fileURLToPath(new URL(`../../lib/${rel}`, import.meta.url))).href);
    const script = `
      const { selftestDeterminism } = await import(${lib('actions/compare.mjs')});
      const { RunPaths } = await import(${lib('run/paths.mjs')});
      const { Journal } = await import(${lib('run/journal.mjs')});
      const paths = new RunPaths('.typo3-update', ${JSON.stringify(r.root)});
      const log = new Proxy({}, { get: () => () => {} });
      const result = await selftestDeterminism({ values: ${JSON.stringify({ sample: 'all', 'visual-workers': '1', ...values })},
        paths, log, journal: new Journal(paths.journalPath) });
      process.stdout.write(JSON.stringify(result));
    `;
    const env = { ...process.env, TMPDIR: isolated };
    delete env.T3U_BROWSER_SLOTS;
    delete env.T3U_CPU_SLOTS;
    return JSON.parse((await exec(process.execPath, ['--input-type=module', '-e', script], { env })).stdout);
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
}

describe('t3u selftest-determinism --in-node', () => {
  test('the command parses --in-node and --approval; the refresh ledger is bookkeeping, the hook is measurement', () => {
    const parsed = parse(['selftest-determinism', '--in-node', NODE, '--approval', 'APR-030', '--sample', 'all']);
    assert.equal(parsed.values['in-node'], NODE);
    assert.equal(parsed.values.approval, 'APR-030');
    assert.equal(isMeasurementSource('lib/run/selftest-refresh.mjs'), false);
    assert.equal(isMeasurementSource('lib/actions/compare.mjs'), true);
  });

  test('an approved refresh of an expired lock inside the open node lets the node close as pass', async (t) => {
    const r = await run();
    t.after(() => rm(r.root, { recursive: true, force: true }));
    await open(r);
    const anchored = (await readState(r)).graph.nodes[NODE].anchor.measurement['selftest.lock.json'];
    await grant(r, 'APR-001');

    const result = await realRefresh(r, { 'in-node': NODE, approval: 'APR-001' });
    assert.equal(result.exitCode, EXIT.PASS);
    assert.equal(result.promotedToBaseline, false, 'an in-node refresh never creates a baseline');
    const lockBytes = await readFile(r.paths.selftestLock);
    const current = `sha256:${hex(lockBytes)}`;
    assert.notEqual(current, anchored);
    assert.equal(JSON.parse(lockBytes).selftestHash, LOCK_HASH, 'the same epoch reproduces the same lock hash');

    const state = await readState(r);
    assert.deepEqual(stateSchemaErrors(state), []);
    const [entry] = state.selftest_refreshes;
    assert.deepEqual(Object.keys(entry), ['node', 'attempt', 'approval_id', 'approval_sha256', 'previous_lock_sha256', 'new_lock_sha256', 'recorded_at']);
    assert.equal(entry.node, NODE);
    assert.equal(entry.attempt, 1);
    assert.equal(entry.approval_id, 'APR-001');
    assert.equal(entry.approval_sha256, `sha256:${hex(await readFile(await approvalFile(r, 'APR-001')))}`);
    assert.equal(entry.previous_lock_sha256, anchored);
    assert.equal(entry.new_lock_sha256, current);
    assert.deepEqual(result.selftestRefresh, entry);
    const events = (await readFile(r.paths.journalPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.ok(events.some((e) => e.event === 'selftest-refresh' && e.verdict === 'pass' && e.approval_id === 'APR-001'
      && e.new_lock_sha256 === current));

    assert.equal((await graphValidate({ paths: r.paths, log: quiet })).exitCode, 0);
    assert.equal((await close(r)).exitCode, EXIT.PASS);
    assert.equal((await readState(r)).graph.nodes[NODE].status, 'passed');
    assert.equal((await validateRun({ paths: r.paths, log: quiet })).exitCode, 0);

    // One approval, one decision: the consumed approval refuses a second refresh.
    await writeFile(r.paths.selftestLock, lockBody(new Date(Date.now() - 48 * 3_600_000).toISOString()));
    await new StateStore(r.paths).update((s) => { s.graph.nodes[NODE].status = 'ready'; });
    await open(r);
    await assert.rejects(refresh(r, { 'in-node': NODE, approval: 'APR-001' }), /already authorised an owner decision/);
  });

  test('without an approval the refresh is refused before any capture', async (t) => {
    const r = await run();
    t.after(() => rm(r.root, { recursive: true, force: true }));
    await open(r);
    await assert.rejects(refresh(r, {}), (err) => err.exitCode === EXIT.PRECONDITION
      && /are open and guard the measurement inputs/.test(err.message) && /--in-node <node> --approval APR-NNN/.test(err.message));
    await assert.rejects(refresh(r, { 'in-node': NODE }), /--in-node needs --approval/);
    await assert.rejects(refresh(r, { 'in-node': NODE, approval: 'APR-009' }), /APR-009 cannot authorise a self-test refresh.*no intent approval file/s);
    await grant(r, 'APR-002', 'Harness fix for another node entirely');
    await assert.rejects(refresh(r, { 'in-node': NODE, approval: 'APR-002' }), /does not name node webmcp-readiness in its scope/);
    await grant(r, 'APR-003');
    await assert.rejects(refresh(r, { 'in-node': NODE, approval: 'APR-003', sample: 'intermediate' }), /--sample all/);
    assert.equal((await readState(r)).selftest_refreshes, undefined);
  });

  test('a still-valid lock is never replaced', async (t) => {
    const r = await run({ lockAgeHours: 1 });
    t.after(() => rm(r.root, { recursive: true, force: true }));
    await open(r);
    await grant(r, 'APR-001');
    const before = await readFile(r.paths.selftestLock, 'utf8');
    await assert.rejects(refresh(r, { 'in-node': NODE, approval: 'APR-001' }), /lock is still valid/);
    assert.equal(await readFile(r.paths.selftestLock, 'utf8'), before);
    // An environment re-seal marks the young lock stale: that one may be refreshed.
    await new StateStore(r.paths).update((s) => {
      s.selftest = { ...s.selftest, status: 'stale', lock_hash: null, stale_reason: 'environment re-seal APR-031' };
    });
    assert.equal((await realRefresh(r, { 'in-node': NODE, approval: 'APR-001' })).exitCode, EXIT.PASS);
    assert.equal((await readState(r)).selftest.status, 'green');
    assert.equal((await close(r)).exitCode, EXIT.PASS);
  });

  test('the refresh belongs to the one open guarded node it names', async (t) => {
    const r = await run();
    t.after(() => rm(r.root, { recursive: true, force: true }));
    await open(r);
    await grant(r, 'APR-001', `Self-test refresh inside other-site-node and ${NODE}`);
    await assert.rejects(refresh(r, { 'in-node': 'other-site-node', approval: 'APR-001' }),
      /other-site-node is not an open guarded code or stateful node.*Open guarded node\(s\): webmcp-readiness/s);
    await assert.rejects(refresh(r, { 'in-node': 'harness-recovery', approval: 'APR-001' }), /not an open guarded/);
    await open(r, 'other-site-node');
    await assert.rejects(refresh(r, { 'in-node': NODE, approval: 'APR-001' }), /Other guarded node\(s\) are open as well \(other-site-node\)/);
  });

  test('a dirty project tree is refused', async (t) => {
    const r = await run();
    t.after(() => rm(r.root, { recursive: true, force: true }));
    await open(r);
    await grant(r, 'APR-001');
    await writeFile(path.join(r.root, 'composer.json'), '{"changed":true}\n');
    await assert.rejects(refresh(r, { 'in-node': NODE, approval: 'APR-001' }), /uncommitted project changes.*M composer\.json/s);
    await git(r.root, 'checkout', '--', 'composer.json');
    await writeFile(path.join(r.root, 'new-template.html'), '<p>draft</p>\n');
    await assert.rejects(refresh(r, { 'in-node': NODE, approval: 'APR-001' }), /\?\? new-template\.html/);
  });

  test('a tampered approval voids the refresh for graph-validate, validate-run and node-close', async (t) => {
    const r = await run();
    t.after(() => rm(r.root, { recursive: true, force: true }));
    await open(r);
    await grant(r, 'APR-001');
    assert.equal((await realRefresh(r, { 'in-node': NODE, approval: 'APR-001' })).exitCode, EXIT.PASS);
    const file = await approvalFile(r, 'APR-001');
    await writeFile(file, (await readFile(file, 'utf8')).replace('Yes', 'Yes, and more'));
    await assert.rejects(graphValidate({ paths: r.paths, log: quiet }),
      (err) => err.exitCode === EXIT.INVALID && /selftest_refreshes\[0\] approval APR-001 changed after the refresh was recorded \(sha256 mismatch\)/.test(err.message));
    await assert.rejects(validateRun({ paths: r.paths, log: quiet }), /sha256 mismatch/);
    await assert.rejects(close(r), /changed measurement inputs it may not change: selftest\.lock\.json/);
    assert.equal((await close(r, 'blocked')).verdict, 'blocked', 'blocked stays the honest route');
  });

  test('node-close accepts only the exact recorded chain of lock hashes', () => {
    const state = { run_id: RUN_ID, approvals: ['APR-001'], selftest_refreshes: [
      { node: NODE, attempt: 1, approval_id: 'APR-001', approval_sha256: ref('d'), previous_lock_sha256: ref('1'),
        new_lock_sha256: ref('2'), recorded_at: '2026-10-12T12:00:00.000Z' },
    ] };
    const approvals = new Map([['APR-001', { id: 'APR-001', files: ['APR-001-intent-x.md'], sha256: ref('d'),
      meta: { id: 'APR-001', stage: 'intent', granted_by: 'user', granted_at: '2026-10-12T11:00:00.000Z', run_id: RUN_ID,
        scope: `refresh inside ${NODE}` } }]]);
    const ledger = selftestRefreshLedger(state, DEFINITION, { approvals });
    assert.deepEqual(ledger.issues, []);
    const nodeState = { attempts: 1, anchor: { measurement: { 'selftest.lock.json': ref('1') } } };
    assert.equal(refreshedLockBound(ledger, NODE, nodeState, ref('2')), true);
    assert.equal(refreshedLockBound(ledger, NODE, nodeState, ref('3')), false, 'a later hand edit is not covered');
    assert.equal(refreshedLockBound(ledger, NODE, { ...nodeState, attempts: 2 }, ref('2')), false, 'another attempt is not covered');
    assert.equal(refreshedLockBound(ledger, 'other-site-node', nodeState, ref('2')), false, 'another node is not covered');
    assert.equal(refreshedLockBound(ledger, NODE, { attempts: 1, anchor: { measurement: { 'selftest.lock.json': ref('9') } } }, ref('2')), false);
    assert.equal(refreshedLockBound(selftestRefreshLedger(state, DEFINITION, { approvals: null }), NODE, nodeState, ref('2')), false,
      'an unverifiable entry binds nothing');
    const reused = selftestRefreshLedger({ ...state, runtime: { extensions: [{ approval_id: 'APR-001' }] } }, DEFINITION, { approvals });
    assert.match(reused.issues.join('\n'), /already authorised another owner decision/);
  });
});
