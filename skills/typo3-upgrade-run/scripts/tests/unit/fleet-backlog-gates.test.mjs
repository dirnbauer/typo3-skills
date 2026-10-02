// Fleet backlog #52-#54, found by the first fleet run that reached the handover node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RunPaths, sha256 } from '../../lib/run/paths.mjs';
import { gateClosureEvidence, readClosureArtifact, verifyRecordedClosureAcceptance } from '../../lib/actions/closure.mjs';
import { aggregateAxeIncomplete } from '../../lib/actions/sweep.mjs';

const NOW = Date.parse('2026-10-01T18:00:00Z');
const manifest = { schema: 'typo3-upgrade-run/closure@1', runId: 'run-52', checks: [] };

async function withRun(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-gates-'));
  try {
    const paths = new RunPaths('.typo3-update', root);
    await mkdir(paths.approvalsDir, { recursive: true });
    await mkdir(path.join(paths.root, 'report'), { recursive: true });
    await mkdir(path.join(paths.root, 'nodes/contract-a-gate'), { recursive: true });
    await writeFile(path.join(paths.root, 'report/closure-evidence.json'), JSON.stringify(manifest));
    await writeFile(path.join(paths.root, 'report/fresh-closure.json'), JSON.stringify(manifest));
    await writeFile(path.join(paths.root, 'report/handover.md'), '# Handover\n');
    await writeFile(path.join(paths.root, 'nodes/contract-a-gate/evidence.md'), '# Gate\n');
    await fn(paths);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('#52 gate nodes resolve the closure manifest separately from their own evidence file', () => withRun(async (paths) => {
  const state = { contract_a: { verification: { evidence_ref: 'report/closure-evidence.json' } } };
  // Markdown node evidence: the manifest closure-verify recorded.
  assert.equal(await gateClosureEvidence(paths, {}, state, 'contract-a-gate', 'nodes/contract-a-gate/evidence.md'),
    'report/closure-evidence.json');
  // Legacy call: --evidence is the manifest itself.
  assert.equal(await gateClosureEvidence(paths, {}, {}, 'contract-a-gate', 'report/fresh-closure.json'), 'report/fresh-closure.json');
  // Handover: the accepted manifest, or an explicit fresh one after Contract B work.
  const closed = { contract_a: { closure_ref: 'report/closure-evidence.json' } };
  assert.equal(await gateClosureEvidence(paths, {}, closed, 'handover', 'report/handover.md'), 'report/closure-evidence.json');
  assert.equal(await gateClosureEvidence(paths, { 'closure-evidence': 'report/fresh-closure.json' }, closed, 'handover', 'report/handover.md'),
    'report/fresh-closure.json');
  // Nothing recorded: the conventional path.
  assert.equal(await gateClosureEvidence(paths, {}, {}, 'contract-a-gate', 'report/handover.md'), 'report/closure-evidence.json');
}));

test('#52 a gate closed with its own evidence file keeps the recorded acceptance verifiable', () => withRun(async (paths) => {
  const bytes = JSON.stringify(manifest);
  const state = {
    run_id: 'run-52', approvals: ['APR-011'], runtime: { deadline_at: '2026-10-02T06:30:00Z' },
    contract_a: { status: 'closed', closed_at: '2026-10-01T17:22:58Z', closure_ref: 'report/closure-evidence.json' },
    graph: { nodes: { 'contract-a-gate': { status: 'passed', evidence: 'nodes/contract-a-gate/evidence.md',
      closure_ref: 'report/closure-evidence.json' } } },
  };
  await writeFile(path.join(paths.approvalsDir, 'APR-011-acceptance-contract-a.md'),
    `---\nid: APR-011\nstage: acceptance\nrun_id: run-52\ngranted_by: user\ngranted_at: "2026-10-01T17:22:00Z"\n`
    + `evidence_ref: "report/closure-evidence.json#sha256:${sha256(bytes)}"\n---\n`);
  await verifyRecordedClosureAcceptance(paths, state, NOW);
  // The judged manifest must still be the one the gate recorded.
  state.graph.nodes['contract-a-gate'].closure_ref = 'report/fresh-closure.json';
  await assert.rejects(verifyRecordedClosureAcceptance(paths, state, NOW), /passed, timely Contract A transition/);
  // Older runs: no closure_ref on the node, the manifest was the node's evidence.
  delete state.graph.nodes['contract-a-gate'].closure_ref;
  state.graph.nodes['contract-a-gate'].evidence = 'report/closure-evidence.json';
  await verifyRecordedClosureAcceptance(paths, state, NOW);
}));

test('#53 an empty closure artifact is refused with a hint for commands that print nothing', () => withRun(async (paths) => {
  await writeFile(path.join(paths.root, 'report/empty.txt'), '');
  await assert.rejects(readClosureArtifact(paths.root, 'report/empty.txt'), /Empty closure artifact: report\/empty\.txt\. .*exit code plus a read-back/);
}));

test('#54 axe incomplete results are clustered per rule, viewport and state like violations', () => {
  const observations = [
    { url: 'a', viewport: 'desktop', state: 'default', violations: [],
      incomplete: [{ id: 'color-contrast', impact: 'serious', nodes: 2, targets: ['.hero h1', '.hero p'] }] },
    { url: 'b', viewport: 'desktop', state: 'default', violations: [],
      incomplete: [{ id: 'color-contrast', impact: 'serious', nodes: 1, targets: ['.hero h1'] }] },
    { url: 'a', viewport: 'mobile', state: 'nav-open', violations: [], incomplete: [] },
    { url: 'c', viewport: 'mobile', state: 'default', skipped: true, reason: 'not applicable' },
  ];
  assert.deepEqual(aggregateAxeIncomplete(observations), [{
    rule: 'color-contrast', impact: 'serious', viewport: 'desktop', state: 'default', pages: 2, nodes: 3,
    targets: ['.hero h1', '.hero p'],
  }]);
});

test('the pixel stage normalises the TYPO3 exception code with the DOM rule\'s own pattern', async () => {
  const { settleScript } = await import('../../lib/browser/stabilize.mjs');
  const { RULES } = await import('../../lib/compare/dom-normalize.mjs');
  const rule = RULES.find((r) => r.id === 'typo3-exception-code');
  const script = settleScript({});
  assert.ok(script.includes(`new RegExp(${JSON.stringify(rule.re.source)})`), 'settle script must reuse the DOM rule pattern');
  assert.ok(script.includes("normalizedTexts = { 'typo3-exception-code': 0 }"));
});

test('#58 snapshot entries are found by DDEV file name, so an existing name can be refused and a new write verified', async () => {
  const { snapshotEntries } = await import('../../lib/actions/lifecycle.mjs');
  const { mkdtemp, writeFile: write, mkdir: mk, rm: remove, utimes } = await import('node:fs/promises');
  const dir = await mkdtemp(path.join(os.tmpdir(), 't3u-snapshots-'));
  try {
    await write(path.join(dir, 'node-rung-13-a1-mariadb_10.11.zst'), 'old');
    await write(path.join(dir, 'node-rung-13-a10-mariadb_10.11.zst'), 'other attempt');
    await mk(path.join(dir, 'legacy-dir-snapshot'));
    await utimes(path.join(dir, 'node-rung-13-a1-mariadb_10.11.zst'), new Date('2026-09-28T19:45:14Z'), new Date('2026-09-28T19:45:14Z'));
    const found = await snapshotEntries(dir, 'node-rung-13-a1');
    assert.deepEqual(found.map((e) => e.entry), ['node-rung-13-a1-mariadb_10.11.zst']);
    assert.ok(found[0].mtimeMs < Date.parse('2026-10-01T00:00:00Z'), 'an old file is not a fresh write');
    assert.deepEqual((await snapshotEntries(dir, 'legacy-dir-snapshot')).map((e) => e.entry), ['legacy-dir-snapshot']);
    assert.deepEqual(await snapshotEntries(path.join(dir, 'missing'), 'x'), []);
  } finally { await remove(dir, { recursive: true, force: true }); }
});
