import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { CLOSURE_CHECKS, closureIssues, readClosureArtifact, repositorySubject, verifyRecordedClosureAcceptance } from '../../lib/actions/closure.mjs';
import { resolveQualityLoop } from '../../lib/actions/sweep.mjs';
import { RunPaths, sha256 } from '../../lib/run/paths.mjs';

const NOW = Date.parse('2026-09-05T12:00:00Z');
function fixture() {
  const subject = { head: 'abc', sourceIndexHash: 'source', worktreeHash: 'clean', graphHash: 'graph', inputs: { content: 'dataset' } };
  const epoch = { schema: 'typo3-upgrade-run/closure-epoch@1', runId: '2026-09-05-demo', createdAt: '2026-09-05T10:00:00Z', subject };
  epoch.hash = `sha256:${sha256(JSON.stringify(epoch))}`;
  const state = { run_id: epoch.runId, open_findings: 0, runtime: { deadline_at: '2026-09-05T18:00:00Z' }, graph: { nodes: Object.fromEntries(
    ['migration-join', 'target-content-epoch', 'http-dom-proof', 'visual-proof', 'component-sentinels', 'backend-operations', 'lighthouse-axe', 'closure-join']
      .map(id => [id, { status: 'passed' }])) } };
  const manifest = { schema: 'typo3-upgrade-run/closure@1', runId: epoch.runId,
    coverageRef: 'coverage.json', backupRef: 'backup.json', restoreRef: 'restore.md',
    ...Object.fromEntries(['coverage', 'backup', 'restore'].map(k => [k + 'Sha256', `sha256:${'b'.repeat(64)}`])),
    checks: CLOSURE_CHECKS.map(id => ({ id, epoch: epoch.hash, command: 'actual-check', status: 'pass',
      exitCode: 0, failed: 0, skipped: 0, expected: 1, executed: 1,
      startedAt: '2026-09-05T10:01:00Z', finishedAt: '2026-09-05T10:02:00Z',
      artifacts: [{ path: id + '.json', sha256: `sha256:${'a'.repeat(64)}` }],
      ...(id === 'visual' ? { pixelThreshold: 0, unapprovedDifferences: 0 } : {}),
      ...(id === 'lighthouse' ? { runsPerUrl: 3, budgetApplied: true, toolVersion: '13.4.1', chromeVersion: 'stable-pinned' } : {}),
    })) };
  return { manifest, epoch, subject, state };
}
const issues = f => closureIssues(f.manifest, f.epoch, f.subject, f.state, NOW);
test('complete current closure accounting passes', () => assert.deepEqual(issues(fixture()), []));
test('split quality proofs cannot close via a green compatibility join with a missing or unfinished child', () => {
  const f = fixture();
  f.state.graph.nodes['axe-proof'] = { status: 'passed' };
  assert.ok(issues(f).some(issue => issue.includes('lighthouse-proof')));
  f.state.graph.nodes['lighthouse-proof'] = { status: 'running' };
  assert.ok(issues(f).some(issue => issue.includes('lighthouse-proof')));
  f.state.graph.nodes['lighthouse-proof'].status = 'passed';
  assert.deepEqual(issues(f), []);
});
test('v14 code and passed labels cannot substitute for missing checks', () => {
  const f = fixture(); f.manifest.checks = []; assert.ok(issues(f).some(x => x.includes('missing check')));
});
for (const key of ['sourceIndexHash', 'worktreeHash', 'graphHash', 'inputs', 'featureContractsHash']) test(`${key} changes invalidate historical proof`, () => {
  const f = fixture(); f.subject = { ...f.subject, [key]: 'changed' };
  assert.ok(issues(f).some(x => x.startsWith('STALE')));
});
test('a different HEAD with identical source and inputs does not invalidate proof', () => {
  const f = fixture(); f.subject = { ...f.subject, head: 'evidence-only-commit' }; assert.deepEqual(issues(f), []);
});
for (const change of [c => c.exitCode = 1, c => c.skipped = 1, c => c.executed = 0,
  c => c.startedAt = '2026-09-01T10:00:00Z', c => c.artifacts = [], c => c.expected = 0]) {
  test(`failed, skipped, empty or stale evidence refuses closure: ${change}`, () => {
    const f = fixture(); change(f.manifest.checks[0]); assert.ok(issues(f).length);
  });
}
test('Lighthouse single runs and missing run counts are not closure evidence', () => {
  for (const n of [1, undefined]) { const f = fixture(); f.manifest.checks.find(c => c.id === 'lighthouse').runsPerUrl = n;
    assert.ok(issues(f).some(x => x.startsWith('lighthouse:'))); }
});
test('tolerated pixels and a stale graph join cannot be called strict green', () => {
  const f = fixture(); f.manifest.checks.find(c => c.id === 'visual').pixelThreshold = 0.001;
  f.state.graph.nodes['backend-operations'].status = 'pending'; assert.equal(issues(f).length, 2);
});
test('an open run cannot close after the sealed deadline', () => {
  const f = fixture(); f.state.runtime.deadline_at = '2026-09-05T11:00:00Z'; assert.ok(issues(f).some(x => x.includes('deadline')));
});
test('proof recorded before the deadline can await later human acceptance without a rerun', () => {
  const f = fixture();
  f.state.runtime.deadline_at = '2026-09-05T11:00:00Z';
  f.state.contract_a = { status: 'open', verification: { at: '2026-09-05T10:30:00Z',
    manifest_hash: `sha256:${sha256(JSON.stringify(f.manifest))}`, epoch_hash: f.epoch.hash, evidence_ref: 'closure.json' } };
  assert.deepEqual(issues(f), []);
  f.manifest.checks[0].command = 'changed receipt';
  assert.ok(issues(f).some(x => x.includes('deadline')));
});
test('late verification and tests completed after the recorded verification do not bypass the deadline', () => {
  for (const at of ['2026-09-05T11:01:00Z', '2026-09-05T10:01:00Z']) {
    const f = fixture(); f.state.runtime.deadline_at = '2026-09-05T11:00:00Z';
    f.state.contract_a = { status: 'open', verification: { at,
      manifest_hash: `sha256:${sha256(JSON.stringify(f.manifest))}`, epoch_hash: f.epoch.hash, evidence_ref: 'closure.json' } };
    assert.ok(issues(f).some(x => x.includes('deadline')));
  }
});
test('malformed receipt entries fail validation instead of throwing a TypeError', () => {
  for (const c of [null, 3, 'pass', { command: true, artifacts: [null] }]) {
    const f = fixture(); f.manifest.checks[0] = c; assert.ok(issues(f).length);
  }
  assert.ok(closureIssues(null, {}, {}, {}).length);
});
test('Git identity binds source changes but excludes accumulating run evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-git-proof-'));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  try {
    git('init', '--initial-branch=proof');
    await writeFile(path.join(root, 'source.js'), 'initial');
    git('add', 'source.js'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
    const run = path.join(root, '.typo3-update'); await mkdir(run);
    const before = await repositorySubject(root, run);
    await writeFile(path.join(run, 'report.json'), 'new evidence');
    assert.deepEqual(await repositorySubject(root, run), before);
    git('add', '.typo3-update'); git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'evidence only');
    const afterReport = await repositorySubject(root, run);
    assert.notEqual(afterReport.head, before.head);
    assert.equal(afterReport.sourceIndexHash, before.sourceIndexHash);
    assert.equal(afterReport.worktreeHash, before.worktreeHash);
    await writeFile(path.join(root, 'source.js'), 'changed');
    assert.notEqual((await repositorySubject(root, run)).worktreeHash, before.worktreeHash);
    await writeFile(path.join(root, 'unclassified.txt'), 'private');
    await assert.rejects(repositorySubject(root, run), /Untracked/);
    git('add', 'source.js', 'unclassified.txt');
    const staged = await repositorySubject(root, run);
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'changed');
    const committed = await repositorySubject(root, run);
    assert.notEqual(committed.sourceIndexHash, before.sourceIndexHash);
    assert.equal(committed.sourceIndexHash, staged.sourceIndexHash);
    assert.equal(committed.worktreeHash, staged.worktreeHash);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('artifact resolution refuses missing, empty and symlink-escaping files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-closure-'));
  try {
    const run = path.join(root, 'run'); await mkdir(run); await writeFile(path.join(root, 'outside'), 'private');
    await symlink(path.join(root, 'outside'), path.join(run, 'escape')); await writeFile(path.join(run, 'empty'), '');
    await writeFile(path.join(run, 'valid'), 'evidence');
    for (const p of ['missing', 'empty', '../outside', 'escape']) await assert.rejects(readClosureArtifact(run, p));
    assert.equal((await readClosureArtifact(run, 'valid')).toString(), 'evidence');
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('Lighthouse/axe verification works before Contract A closure; elevation stays locked', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-quality-'));
  try {
    const paths = new RunPaths('.typo3-update', root); const loop = '301-invariance-final';
    await mkdir(paths.loop(loop), { recursive: true });
    await writeFile(paths.loopDoc(loop, '00-charter.md'), '---\ncontract: A\ntrack: invariance\nbaseline_ref: A-original\n---\n');
    const state = { contract_a: { status: 'open' }, contract_b: { unlocked: false }, loops: { '301': 'open' }, baselines: { 'A-original': { sealed: true } } };
    assert.equal(await resolveQualityLoop(paths, { mode: 'verify', loop: '301' }, state), loop);
    await assert.rejects(resolveQualityLoop(paths, { mode: 'elevation', loop: '301' }, state), /locked/);
    state.loops['301'] = 'green'; await assert.rejects(resolveQualityLoop(paths, { mode: 'verify', loop: '301' }, state), /open Contract A/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a historical closed label still needs timely human acceptance of its unchanged manifest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-accepted-closure-'));
  try {
    const paths = new RunPaths('.typo3-update', root); await mkdir(paths.approvalsDir, { recursive: true });
    const { state, manifest } = fixture(); const bytes = JSON.stringify(manifest);
    await writeFile(path.join(paths.root, 'closure.json'), bytes);
    state.contract_a = { status: 'closed', closed_at: '2026-09-05T11:00:00Z', closure_ref: 'closure.json' };
    state.graph.nodes['contract-a-gate'] = { status: 'passed', evidence: 'closure.json' };
    state.approvals = ['APR-399'];
    await assert.rejects(verifyRecordedClosureAcceptance(paths, state, NOW), /no recorded human acceptance/);
    const approval = `---\nid: APR-399\nstage: acceptance\nrun_id: ${state.run_id}\ngranted_by: user\ngranted_at: "2026-09-05T10:30:00Z"\nevidence_ref: "closure.json#sha256:${sha256(bytes)}"\n---\n`;
    await writeFile(path.join(paths.approvalsDir, 'APR-399-acceptance-closure.md'), approval);
    await verifyRecordedClosureAcceptance(paths, state, NOW);
    await writeFile(path.join(paths.root, 'closure.json'), bytes + '\n');
    await assert.rejects(verifyRecordedClosureAcceptance(paths, state, NOW), /exact manifest hash/);
    state.graph.nodes['contract-a-gate'].status = 'pending';
    await assert.rejects(verifyRecordedClosureAcceptance(paths, state, NOW), /passed, timely/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('morning acceptance requires the original timely verification receipt', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-morning-acceptance-'));
  try {
    const paths = new RunPaths('.typo3-update', root); await mkdir(paths.approvalsDir, { recursive: true });
    const { state, manifest, epoch } = fixture(); manifest.epochRef = 'epoch.json';
    const bytes = JSON.stringify(manifest);
    await writeFile(path.join(paths.root, 'epoch.json'), JSON.stringify(epoch));
    await writeFile(path.join(paths.root, 'closure.json'), bytes);
    state.runtime.deadline_at = '2026-09-05T11:00:00Z';
    state.contract_a = { status: 'closed', closed_at: '2026-09-05T11:30:00Z', closure_ref: 'closure.json',
      verification: { at: '2026-09-05T10:30:00Z', evidence_ref: 'closure.json', epoch_hash: epoch.hash,
        manifest_hash: `sha256:${sha256(bytes)}` } };
    state.graph.nodes['contract-a-gate'] = { status: 'passed', evidence: 'closure.json' };
    state.approvals = ['APR-399'];
    await writeFile(path.join(paths.approvalsDir, 'APR-399-acceptance-closure.md'),
      `---\nid: APR-399\nstage: acceptance\nrun_id: ${state.run_id}\ngranted_by: user\ngranted_at: "2026-09-05T11:15:00Z"\nevidence_ref: "closure.json#sha256:${sha256(bytes)}"\n---\n`);
    await verifyRecordedClosureAcceptance(paths, state, NOW);
    delete state.contract_a.verification;
    await assert.rejects(verifyRecordedClosureAcceptance(paths, state, NOW), /Late acceptance requires/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
