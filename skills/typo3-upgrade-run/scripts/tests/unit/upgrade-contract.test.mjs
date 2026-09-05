import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  HASH_RELEVANT,
  compareEnvironment,
  hashComponents,
} from '../../lib/fingerprint/environment.mjs';
import { compareContent, collectContent } from '../../lib/fingerprint/content.mjs';
import { compareDom } from '../../lib/compare/dom-normalize.mjs';
import { compareRecords, extractRecord } from '../../lib/compare/http-meta.mjs';
import { envelope, validateReport } from '../../lib/report/write.mjs';
import {
  LOOP_VERDICTS,
  StateStore,
  emptyState,
} from '../../lib/run/state.mjs';
import { LOOP_DOCS, RunPaths } from '../../lib/run/paths.mjs';
import {
  assertLiveInputs,
  readEvidenceContext,
} from '../../lib/run/evidence.mjs';
import { gate, promoteSelftestBaseline } from '../../lib/actions/compare.mjs';
import { approvalRecord, loopOpen, loopStart, validateRun } from '../../lib/actions/lifecycle.mjs';
import { validateContentTransition } from '../../lib/actions/core.mjs';

const tmp = () => mkdtemp(path.join(tmpdir(), 't3u-contract-'));
const log = new Proxy({}, { get: () => () => {} });
const fingerprint = (hash, components = {}) => ({
  kind: 'environment-fingerprint',
  fingerprintHash: hash,
  components,
});
const content = (hash, tables = []) => ({
  kind: 'content-fingerprint',
  fingerprintHash: hash,
  database: { available: true, tables },
  files: { treeHash: 'sha256:files' },
});
const evidenceInputs = {
  manifestHash: `sha256:${'a'.repeat(64)}`,
  environmentFingerprintHash: `sha256:${'b'.repeat(64)}`,
  contentFingerprintHash: `sha256:${'c'.repeat(64)}`,
  selftestLockHash: `sha256:${'d'.repeat(64)}`,
};

describe('renderer and upgrade-subject fingerprints', () => {
  const components = {
    node: { version: 'v22' },
    os: { type: 'Linux', release: '1', arch: 'arm64', containerImage: null },
    playwright: { version: '1.60' },
    browser: { name: 'chromium', version: '140', channel: null, launchArgsHash: 'args' },
    fonts: { listHash: 'fonts' },
    rendering: {
      deviceScaleFactor: 1,
      colorScheme: 'light',
      reducedMotion: 'reduce',
      forcedColors: 'none',
      locale: 'de-AT',
      timezone: 'Europe/Vienna',
    },
    imageProcessing: { processor: 'ImageMagick', version: '7', gfxHash: 'gfx' },
    php: { version: '8.3.0', extensionsHash: 'php-exts' },
    typo3: { version: '12.4.45' },
    ddev: { version: '1.24.8', dbEngine: 'mariadb:10.11' },
    harness: { version: '2.0.0', depsLockHash: 'lock', sourceHash: 'source' },
  };

  test('the TYPO3 and PHP versions being upgraded are recorded, not immutable renderer inputs', () => {
    assert.equal(HASH_RELEVANT.includes('typo3.version'), false);
    assert.equal(HASH_RELEVANT.includes('php.version'), false);

    const after = structuredClone(components);
    after.php.version = '8.5.5';
    after.typo3.version = '14.3.1';
    const sealed = fingerprint(`sha256:${hashComponents(components).replace(/^sha256:/, '')}`, components);
    const current = fingerprint(`sha256:${hashComponents(after).replace(/^sha256:/, '')}`, after);
    assert.deepEqual(compareEnvironment(sealed, current), { match: true, drifted: [] });
  });

  test('renderer drift still invalidates the comparison', () => {
    const after = structuredClone(components);
    after.browser.version = '141';
    const cmp = compareEnvironment(fingerprint('before', components), fingerprint('after', after));
    assert.equal(cmp.match, false);
    assert.deepEqual(cmp.drifted.map((entry) => entry.key), ['browser.version']);
  });
});

describe('semantic content fingerprinting', () => {
  test('detects an in-place edit even when count, max uid, and max timestamp stay equal', () => {
    const before = content('before', [{
      table: 'tt_content', rowCount: 4, maxTstamp: 100, maxUid: 4, rowHash: 'sha256:old',
    }]);
    const after = content('after', [{
      table: 'tt_content', rowCount: 4, maxTstamp: 100, maxUid: 4, rowHash: 'sha256:new',
    }]);
    const cmp = compareContent(before, after);
    assert.equal(cmp.match, false);
    assert.equal(cmp.drifted[0].key, 'table:tt_content');
  });

  test('project-declared exclusions drop request-log tables and are recorded as evidence', async () => {
    const queried = [];
    const runner = async (sql) => {
      queried.push(sql);
      if (sql.startsWith('SHOW TABLES')) return 'Tables_in_db\npages\ntx_articles_log';
      if (sql.startsWith('SHOW COLUMNS')) return 'Field\tType\tNull\tKey\tDefault\tExtra\nuid\tint\tNO\tPRI\tNULL\t';
      if (sql.startsWith('SELECT COUNT(*)')) return 'row_count\tmax_tstamp\tmax_uid\n1\t0\t1';
      return 'uid\n1';
    };
    const result = await collectContent({
      ddevProject: 'test', fileadmin: '/nonexistent-fileadmin-dir',
      excludeTables: ['tx_articles_log'], runner,
    });
    const tracked = result.database.tables.map((entry) => entry.table);
    assert.ok(tracked.includes('pages'));
    assert.ok(!tracked.includes('tx_articles_log'), 'excluded log table must not be tracked');
    assert.deepEqual(result.database.projectExcludedTables, ['tx_articles_log']);
    assert.ok(!queried.some((sql) => sql.includes('tx_articles_log') && sql.startsWith('SELECT')), 'excluded table must never be read');
  });
});

describe('HTTP and DOM evidence fidelity', () => {
  test('captures XML as HTTP evidence and hashes the body without pretending it is HTML', () => {
    const record = extractRecord({
      requestedUrl: 'https://acme.ddev.site/sitemap.xml',
      url: 'https://acme.ddev.site/sitemap.xml',
      status: 200,
      headers: { 'content-type': 'application/xml' },
      body: '<urlset><url><loc>https://acme.ddev.site/</loc></url></urlset>',
    });
    assert.equal(record.requestedUrl, 'https://acme.ddev.site/sitemap.xml');
    assert.match(record.bodyHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(record.documentKind, 'xml');
    assert.equal(record.canonical, null);
  });

  test('diffs headers independently and normalizes per-response CSP tokens', () => {
    const before = {
      status: 200,
      headers: {
        'cache-control': 'public, max-age=60',
        'content-security-policy': "script-src 'nonce-abc123456'; report-uri /csp?token=one",
      },
    };
    const after = {
      status: 200,
      headers: {
        'cache-control': 'no-cache',
        'content-security-policy': "script-src 'nonce-def987654'; report-uri /csp?token=two",
      },
    };
    const cmp = compareRecords(before, after);
    assert.deepEqual(cmp.differences.map((entry) => entry.field), ['header:cache-control']);
  });

  test('reports multiple separated DOM divergences', () => {
    const before = '<main><h1>Alpha</h1><p>same</p><p>Bravo</p><p>same</p><p>Charlie</p></main>';
    const after = '<main><h1>Omega</h1><p>same</p><p>Delta</p><p>same</p><p>Echo---</p></main>';
    const cmp = compareDom(before, after, { maxSegments: 5, context: 8 });
    assert.equal(cmp.identical, false);
    assert.ok(cmp.segments.length >= 3, JSON.stringify(cmp.segments));
  });
});

describe('evidence inputs and live assertions', () => {
  test('evidence reports reject null run and input hashes', () => {
    const report = envelope({
      kind: 'visual',
      run: { loopId: '300' },
      verdict: 'pass',
      counts: {},
      findings: [],
    });
    const errors = validateReport(report);
    assert.ok(errors.some((entry) => /runId/.test(entry)));
    assert.ok(errors.some((entry) => /manifestHash/.test(entry)));
  });

  test('reads non-null input hashes and proves the live renderer/content, not only sealed JSON', async () => {
    const dir = await tmp();
    const paths = new RunPaths('.typo3-update', dir);
    await mkdir(paths.manifestsDir, { recursive: true });
    const state = emptyState({ runId: '2026-07-29-acme', now: '2026-07-29T00:00:00Z' });
    state.fingerprints.environment = evidenceInputs.environmentFingerprintHash;
    state.fingerprints.content = evidenceInputs.contentFingerprintHash;
    state.manifest.hash = evidenceInputs.manifestHash;
    state.selftest.lock_hash = evidenceInputs.selftestLockHash;
    await new StateStore(paths).write(state);
    await writeFile(paths.envFingerprint, JSON.stringify(fingerprint(
      evidenceInputs.environmentFingerprintHash,
      { browser: { version: '140' } },
    )));
    await writeFile(paths.contentFingerprint, JSON.stringify(content(
      evidenceInputs.contentFingerprintHash,
      [{ table: 'tt_content', rowHash: 'same', rowCount: 1 }],
    )));
    await writeFile(paths.urlManifest, JSON.stringify({ manifestHash: evidenceInputs.manifestHash }));
    await writeFile(paths.selftestLock, JSON.stringify({ selftestHash: evidenceInputs.selftestLockHash }));

    const ctx = await readEvidenceContext(paths);
    assert.equal(ctx.run.runId, '2026-07-29-acme');
    assert.deepEqual(ctx.inputs, {
      ...evidenceInputs,
      baselineContentFingerprintHash: evidenceInputs.contentFingerprintHash,
      targetContentFingerprintHash: null,
      contentTransitionHash: null,
    });

    let envCollected = 0;
    let contentCollected = 0;
    await assertLiveInputs(paths, {
      environmentCollector: async () => {
        envCollected += 1;
        return fingerprint('current', { browser: { version: '140' } });
      },
      contentCollector: async () => {
        contentCollected += 1;
        return content('current', [{ table: 'tt_content', rowHash: 'same', rowCount: 1 }]);
      },
    });
    assert.equal(envCollected, 1);
    assert.equal(contentCollected, 1);
  });
});

describe('state, loop paths, and approval choreography', () => {
  test('a target content epoch requires a recorded rollback anchor and reconciled migration ledger', () => {
    const state = emptyState({ runId: '2026-07-29-acme', now: '2026-07-29T00:00:00Z' });
    state.snapshots.push('pre-v14-migration');
    const ledger = {
      schema: 'typo3-upgrade-run/content-transition@1',
      source_fingerprint: evidenceInputs.contentFingerprintHash,
      snapshot_ref: 'pre-v14-migration',
      commands: [{ argv: ['ddev', 'typo3', 'extension:setup'], exit_code: 0 }],
      checks: {
        upgrade_fixed_point: true,
        schema_reviewed: true,
        reference_index_clean: true,
        row_counts_reconciled: true,
      },
    };
    assert.equal(validateContentTransition(ledger, state, evidenceInputs.contentFingerprintHash), true);
    assert.throws(
      () => validateContentTransition({ ...ledger, checks: { ...ledger.checks, row_counts_reconciled: false } }, state, evidenceInputs.contentFingerprintHash),
      /row_counts_reconciled/,
    );
  });

  test('a proven self-test pass is promoted atomically without overwriting Baseline A', async () => {
    const dir = await tmp();
    const source = path.join(dir, 'selftest-b');
    const target = path.join(dir, 'baseline', 'A-original');
    await mkdir(source, { recursive: true });
    await writeFile(path.join(source, 'capture-index.json'), '{"label":"selftest-b"}\n');

    assert.equal(await promoteSelftestBaseline(source, target), true);
    assert.match(await readFile(path.join(target, 'capture-index.json'), 'utf8'), /selftest-b/);
    await writeFile(path.join(target, 'sentinel.txt'), 'keep');
    assert.equal(await promoteSelftestBaseline(source, target), false);
    assert.equal(await readFile(path.join(target, 'sentinel.txt'), 'utf8'), 'keep');
  });

  test('invalid is a first-class loop verdict and state is fully schema validated', async () => {
    assert.ok(LOOP_VERDICTS.includes('invalid'));
    const dir = await tmp();
    const paths = new RunPaths('.typo3-update', dir);
    await mkdir(paths.root, { recursive: true });
    const state = emptyState({ runId: '2026-07-29-acme', now: '2026-07-29T00:00:00Z' });
    state.unknown = true;
    await writeFile(paths.statePath, JSON.stringify(state));
    await assert.rejects(() => new StateStore(paths).read(), /state schema/i);
  });

  test('gate reads the selected loop artifacts, requires all stages, and writes inside the loop', async () => {
    const dir = await tmp();
    const paths = new RunPaths('.typo3-update', dir);
    const loop = '300-invariance-closure';
    await mkdir(paths.loopArtifacts(loop), { recursive: true });
    const state = emptyState({ runId: '2026-07-29-acme', now: '2026-07-29T00:00:00Z' });
    state.loops['300'] = 'open';
    await new StateStore(paths).write(state);

    for (const kind of ['http', 'dom', 'visual']) {
      const report = envelope({
        kind,
        run: { runId: state.run_id, loopId: '300', track: 'invariance' },
        inputs: evidenceInputs,
        verdict: 'pass',
        counts: { checked: 1 },
        findings: [],
      });
      await writeFile(path.join(paths.loopArtifacts(loop), `report.${kind}.json`), JSON.stringify(report));
    }

    const result = await gate({
      values: { loop, 'idempotence-diff': '0' },
      paths,
      log,
    });
    assert.equal(result.exitCode, 0);
    assert.equal((await new StateStore(paths).read()).loops['300'], 'green');
    const report = JSON.parse(await readFile(paths.loopReport(loop), 'utf8'));
    assert.equal(report.run.loopId, '300');
    assert.deepEqual(report.idempotence, { required: true, ran: true, diffCount: 0 });
  });

  test('ordinary loops accept a code rollback reference without a database snapshot or unchanged rerun', async () => {
    const dir = await tmp();
    const paths = new RunPaths('.typo3-update', dir);
    const loop = '100-migration-core';
    await mkdir(paths.loopArtifacts(loop), { recursive: true });
    const state = emptyState({ runId: '2026-07-29-acme', now: '2026-07-29T00:00:00Z' });
    state.loops['100'] = 'planned';
    await new StateStore(paths).write(state);

    const journalEntries = [];
    const opened = await loopOpen({
      values: { loop, 'rollback-ref': 'git:abc123' }, paths, log,
      journal: { append: async (...entry) => journalEntries.push(entry) },
      liveAssert: async () => {},
    });
    assert.equal(opened.rollbackAnchor, 'git:abc123');
    assert.equal(opened.stateful, false);
    assert.equal(journalEntries[0][1].snapshot, null);

    for (const kind of ['http', 'dom', 'visual']) {
      const report = envelope({
        kind,
        run: { runId: state.run_id, loopId: '100', track: 'invariance' },
        inputs: evidenceInputs,
        verdict: 'pass',
        counts: { checked: 1 },
        findings: [],
      });
      await writeFile(path.join(paths.loopArtifacts(loop), `report.${kind}.json`), JSON.stringify(report));
    }

    const result = await gate({ values: { loop }, paths, log });
    assert.equal(result.exitCode, 0);
    const report = JSON.parse(await readFile(paths.loopReport(loop), 'utf8'));
    assert.deepEqual(report.idempotence, { required: false, ran: false, diffCount: null });
  });

  test('a stateful loop still requires a recorded database snapshot', async () => {
    const dir = await tmp();
    const paths = new RunPaths('.typo3-update', dir);
    await mkdir(paths.root, { recursive: true });
    await mkdir(paths.loop('100-migration-core'), { recursive: true });
    const state = emptyState({ runId: '2026-07-29-acme', now: '2026-07-29T00:00:00Z' });
    state.loops['100'] = 'planned';
    await new StateStore(paths).write(state);

    await assert.rejects(() => loopOpen({
      values: { loop: '100-migration-core', stateful: true, 'rollback-ref': 'git:abc123' },
      paths, log, liveAssert: async () => {},
    }), /snapshot is required before a stateful loop/i);
  });

  test('loop-start scaffolds all protocol documents and acceptance needs evidence', async () => {
    const dir = await tmp();
    const paths = new RunPaths('.typo3-update', dir);
    await mkdir(paths.root, { recursive: true });
    await new StateStore(paths).write(emptyState({
      runId: '2026-07-29-acme',
      now: '2026-07-29T00:00:00Z',
    }));

    const started = await loopStart({
      values: {
        id: '300',
        track: 'invariance',
        slug: 'closure',
        contract: 'A',
        phase: 'P11',
        'baseline-ref': 'A-original',
        snapshot: 'loop-300-pre',
      },
      paths,
      log,
      journal: { append: async () => {} },
    });
    assert.equal(started.loop, '300-invariance-closure');
    for (const doc of LOOP_DOCS) {
      assert.match(await readFile(paths.loopDoc(started.loop, doc), 'utf8'), /loop_id: "300"/);
    }

    await assert.rejects(() => approvalRecord({
      values: {
        id: 'APR-001',
        stage: 'acceptance',
        scope: 'Accept changed header',
        question: 'Accept this change?',
        answer: 'yes',
        loop: '300',
      },
      paths,
      log,
      journal: { append: async () => {} },
    }), /evidence/i);

    await approvalRecord({
      values: {
        id: 'APR-002',
        stage: 'acceptance',
        scope: 'Accept measured header result',
        question: 'Accept this observed result?',
        answer: 'yes',
        evidence: 'loops/300-invariance-closure/artifacts/report.http.json',
        loop: '300',
        granted: true,
      },
      paths,
      log,
      journal: { append: async () => {} },
    });
    assert.match(
      await readFile(paths.loopDoc(started.loop, '06-exit.md'), 'utf8'),
      /acceptance_ref: "APR-002"/,
    );
    assert.equal((await validateRun({ paths, log })).verdict, 'pass');
  });

  test('validate-run rejects front matter that does not match the loop directory', async () => {
    const dir = await tmp();
    const paths = new RunPaths('.typo3-update', dir);
    await mkdir(paths.root, { recursive: true });
    await new StateStore(paths).write(emptyState({
      runId: '2026-07-29-acme',
      now: '2026-07-29T00:00:00Z',
    }));
    const started = await loopStart({
      values: {
        id: '300',
        track: 'invariance',
        slug: 'closure',
        contract: 'A',
        phase: 'P11',
        'baseline-ref': 'A-original',
      },
      paths,
      log,
      journal: { append: async () => {} },
    });
    const charter = paths.loopDoc(started.loop, '00-charter.md');
    await writeFile(charter, (await readFile(charter, 'utf8')).replace(
      'loop_id: "300"',
      'loop_id: "301"',
    ));
    await assert.rejects(() => validateRun({ paths, log }), /loop_id does not match directory/);
  });

  test('validate-run accepts machine-managed loop 000 without a scaffold directory', async () => {
    const dir = await tmp();
    const paths = new RunPaths('.typo3-update', dir);
    await mkdir(paths.root, { recursive: true });
    const state = emptyState({
      runId: '2026-07-29-acme',
      now: '2026-07-29T00:00:00Z',
    });
    state.loops['000'] = 'green';
    await new StateStore(paths).write(state);
    assert.equal((await validateRun({ paths, log })).verdict, 'pass');
  });

  test('Contract B scaffolding requires a sealed derived baseline and carries intent approval', async () => {
    const dir = await tmp();
    const paths = new RunPaths('.typo3-update', dir);
    await mkdir(paths.approvalsDir, { recursive: true });
    const state = emptyState({
      runId: '2026-07-29-acme',
      now: '2026-07-29T00:00:00Z',
    });
    state.contract_a.status = 'closed';
    state.contract_a.closed_at = '2026-07-29T01:00:00Z';
    state.contract_b.unlocked = true;
    state.contract_b.unlocked_at = '2026-07-29T01:00:00Z';
    state.approvals.push('APR-500');
    await new StateStore(paths).write(state);
    await writeFile(path.join(paths.approvalsDir, 'APR-500-intent-performance.md'), 'intent');

    const values = {
      id: '500',
      track: 'elevation',
      slug: 'performance',
      contract: 'B',
      phase: 'P14',
      'baseline-ref': 'B-500-performance',
      'intent-ref': 'APR-500',
    };
    await assert.rejects(
      () => loopStart({ values, paths, log, journal: { append: async () => {} } }),
      /baseline .* not exist or is not sealed/i,
    );

    await new StateStore(paths).update((current) => {
      current.baselines['B-500-performance'] = {
        sealed: true,
        sealed_at: '2026-07-29T01:05:00Z',
        manifest: null,
        urls: 3,
        captures: 3,
      };
    });
    const started = await loopStart({
      values,
      paths,
      log,
      journal: { append: async () => {} },
    });
    for (const doc of LOOP_DOCS) {
      assert.match(
        await readFile(paths.loopDoc(started.loop, doc), 'utf8'),
        /approval_ref: "APR-500"/,
      );
    }
    // Scaffolding still works, but a manually set legacy "closed" label is no
    // longer sufficient for whole-run validation without actual closure evidence.
    await assert.rejects(validateRun({ paths, log }), /Missing or escaping closure artifact/);
  });
});
