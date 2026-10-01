/**
 * Fleet backlog (2026-10-01): processed-image renames in HTTP metadata (#25) and named capture
 * errors (#10).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { compareRecords, foldImageHash, metaImageUrls, imageProof, extractRecord } from '../../lib/compare/http-meta.mjs';
import { normalizeHtml } from '../../lib/compare/dom-normalize.mjs';
import { pngChunks, pngPixelDigest, imageDigestRecord, createImageDigester } from '../../lib/compare/image-digest.mjs';
import { captureErrorTarget } from '../../lib/actions/compare.mjs';
import { PolicyError } from '../../lib/cli/exit-codes.mjs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A PNG of the given RGBA pixels, optionally with extra chunks after IHDR. */
function png(width, height, pixels, extraChunks = []) {
  const image = new PNG({ width, height });
  Buffer.from(pixels).copy(image.data);
  let buf = PNG.sync.write(image);
  const ihdrEnd = 8 + 12 + buf.readUInt32BE(8);
  for (const [type, data] of extraChunks) {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 'latin1');
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
    buf = Buffer.concat([buf.subarray(0, ihdrEnd), chunk, buf.subarray(ihdrEnd)]);
  }
  return buf;
}
const RED = [255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255];
const BLUE = [0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255];
const stamp = (text) => ['tEXt', Buffer.from(`date:timestamp\0${text}`, 'latin1')];

const OLD = 'https://acme.ddev.site/typo3temp/assets/images/csm_logo_1a2b3c4d5e_0334133a12.png';
const NEW = 'https://acme.ddev.site/typo3temp/assets/images/csm_logo_1a2b3c4d5e_71adfc2077.png';

function page(image, metaImages) {
  const record = extractRecord({
    url: 'https://acme.ddev.site/de/', status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<html lang="de"><head><title>Start</title>
      <meta property="og:title" content="Start">
      <meta property="og:image" content="${image}">
      <meta name="twitter:card" content="summary"></head></html>`,
  });
  if (metaImages) record.metaImages = metaImages;
  return record;
}
const digest = (url, over = {}) => ({ url, status: 200, contentType: 'image/png', bytes: 10, sha256: 'sha256:aa', ...over });

describe('processed-image renames in HTTP metadata (#25)', () => {
  test('the fold is the DOM stage asset-hash rule, applied to the URL', () => {
    assert.equal(foldImageHash(OLD), foldImageHash(NEW));
    assert.match(foldImageHash(OLD), /csm_logo_1a2b3c4d5e_<H>\.png$/);
    const dom = normalizeHtml(`<meta property="og:image" content="${OLD}">`).html;
    assert.ok(dom.includes(foldImageHash(OLD)), 'HTTP and DOM must fold the same way');
    assert.equal(foldImageHash('https://acme.ddev.site/fileadmin/og.png'), 'https://acme.ddev.site/fileadmin/og.png');
  });

  test('metaImageUrls lists every image field the metadata names', () => {
    assert.deepEqual(metaImageUrls(page(OLD)), [{ field: 'openGraph.image', url: OLD }]);
  });

  test('a rename with byte-identical content is accepted and stays visible as evidence', () => {
    const cmp = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD) }),
      page(NEW, { 'openGraph.image': digest(NEW) }),
    );
    assert.equal(cmp.identical, true);
    assert.deepEqual(cmp.metaImageRenames, [{ field: 'openGraph.image', before: OLD, after: NEW, proof: 'bytes-identical' }]);
  });

  test('a rename with different content is a difference that says why', () => {
    const cmp = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD) }),
      page(NEW, { 'openGraph.image': digest(NEW, { sha256: 'sha256:bb' }) }),
    );
    assert.equal(cmp.identical, false);
    assert.equal(cmp.differences[0].field, 'openGraph');
    assert.equal(cmp.differences[0].metaImages[0].reason, 'the image content differs');
    assert.deepEqual(cmp.differences[0].metaImages[0].digest, { before: 'sha256:aa', after: 'sha256:bb' });
  });

  test('without a digest on either side the rename is never trusted', () => {
    const cmp = compareRecords(page(OLD), page(NEW, { 'openGraph.image': digest(NEW) }));
    assert.equal(cmp.identical, false);
    assert.equal(cmp.differences[0].metaImages[0].reason, 'no image digest recorded');
  });

  test('a digest that names another URL, or a failed fetch, proves nothing', () => {
    const elsewhere = compareRecords(
      page(OLD, { 'openGraph.image': digest('https://acme.ddev.site/other.png') }),
      page(NEW, { 'openGraph.image': digest(NEW) }),
    );
    assert.equal(elsewhere.differences[0].metaImages[0].reason, 'the image digest names a different URL');
    const missing = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD) }),
      page(NEW, { 'openGraph.image': { url: NEW, status: 404, bytes: 0 } }),
    );
    assert.match(missing.differences[0].metaImages[0].reason, /not fetched \(200 \/ 404\)/);
  });

  test('equal pictures with different file bytes are accepted as pixels-identical', () => {
    const cmp = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD, { pixelSha256: 'sha256:px' }) }),
      page(NEW, { 'openGraph.image': digest(NEW, { sha256: 'sha256:bb', pixelSha256: 'sha256:px' }) }),
    );
    assert.equal(cmp.identical, true);
    assert.equal(cmp.metaImageRenames[0].proof, 'pixels-identical');
  });

  test('another image, or another metadata value, is still a plain difference', () => {
    const other = 'https://acme.ddev.site/typo3temp/assets/images/csm_banner_1a2b3c4d5e_71adfc2077.png';
    const cmp = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD) }),
      page(other, { 'openGraph.image': digest(other) }),
    );
    assert.equal(cmp.identical, false);
    assert.equal(cmp.differences[0].metaImages, undefined);
    const b = page(OLD, { 'openGraph.image': digest(OLD) });
    const a = page(NEW, { 'openGraph.image': digest(NEW) });
    a.openGraph.title = 'Changed';
    assert.equal(compareRecords(b, a).identical, false);
  });

  test('imageProof refuses incomplete evidence', () => {
    assert.equal(imageProof(null, digest(NEW)).proven, false);
    assert.equal(imageProof(digest(OLD), digest(NEW)).kind, 'bytes-identical');
  });
});

describe('image content digests (#25)', () => {
  test('a PNG text stamp changes the bytes but not the picture', async () => {
    const plain = png(2, 2, RED);
    const stamped = png(2, 2, RED, [stamp('2026-10-01T08:00:00')]);
    assert.notDeepEqual(plain, stamped);
    assert.equal(await pngPixelDigest(plain), await pngPixelDigest(stamped));
    assert.notEqual(await pngPixelDigest(plain), await pngPixelDigest(png(2, 2, BLUE)));
  });

  test('a colour chunk is part of the picture', async () => {
    const gamma = Buffer.alloc(4);
    gamma.writeUInt32BE(45455);
    assert.notEqual(await pngPixelDigest(png(2, 2, RED)), await pngPixelDigest(png(2, 2, RED, [['gAMA', gamma]])));
  });

  test('non-PNG content has no pixel digest, only bytes', async () => {
    assert.equal(pngChunks(Buffer.from('GIF89a')), null);
    assert.equal(await pngPixelDigest(Buffer.from([0xff, 0xd8, 0xff])), null);
    const record = await imageDigestRecord({ url: 'u', status: 200, contentType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) });
    assert.match(record.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(record.pixelSha256, undefined);
  });

  test('the digester fetches each image once and records refusals', async () => {
    const calls = [];
    const guard = {
      assertUrl: async (url) => {
        if (url.startsWith('https://cdn.example.org/')) throw new PolicyError('origin not allowed');
        return { url: new URL(url) };
      },
      assertRedirect: async () => { throw new Error('no redirects expected'); },
    };
    const fetchImpl = async (url) => {
      calls.push(url);
      return new Response(png(2, 2, RED), { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const digester = createImageDigester(guard, { fetchImpl });
    const first = await digester('/typo3temp/assets/images/og.png', 'https://acme.ddev.site/de/');
    const second = await digester('https://acme.ddev.site/typo3temp/assets/images/og.png', 'https://acme.ddev.site/en/');
    assert.equal(calls.length, 1);
    assert.equal(first.url, '/typo3temp/assets/images/og.png', 'the record keeps the URL as the page names it');
    assert.equal(second.sha256, first.sha256);
    assert.match(first.pixelSha256, /^sha256:/);
    const refused = await digester('https://cdn.example.org/og.png', 'https://acme.ddev.site/');
    assert.match(refused.error, /^refused by policy: origin not allowed/);
    assert.equal(refused.sha256, undefined);
  });
});

describe('capture errors name their artifact (#10)', () => {
  test('stage 1/2 errors name the record, screenshots the shot, and nothing is undefined', () => {
    assert.equal(captureErrorTarget({ captureId: 'abc', record: 'http', stage: 'http/dom' }), 'http/abc.json');
    assert.equal(captureErrorTarget({ captureId: 'abc', record: 'dom', stage: 'randomized-region-integrity' }), 'dom/abc.html');
    assert.equal(captureErrorTarget({ captureId: 'abc', stage: 'visual' }), 'abc.png');
    assert.equal(captureErrorTarget({ stage: 'http/dom' }), '(http/dom: no capture id)');
  });
});

/* ---------------------------------------------------------------- run lifecycle */

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lateAcceptanceCommand, runCommand } from '../../lib/cli/command.mjs';
import { recordedOutcomeNote, openGuardedNodes, graphInit, nodeOpen } from '../../lib/actions/graph.mjs';
import { selftestDeterminism } from '../../lib/actions/compare.mjs';
import { closureStart } from '../../lib/actions/closure.mjs';
import { loopStart, loopSupersede } from '../../lib/actions/lifecycle.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { StateStore, emptyState } from '../../lib/run/state.mjs';
import { EXIT } from '../../lib/cli/exit-codes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GRAPH = path.resolve(HERE, '../../../templates/run-directory/config/upgrade-graph.yml');
const THRESHOLDS = path.resolve(HERE, '../../../templates/run-directory/config/thresholds.yml');
const quietLog = { success() {}, info() {}, debug() {}, warn() {}, step() {}, finding() {}, error() {} };
const quietJournal = { async append() {} };

async function withRun(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 't3u-backlog-'));
  try {
    const paths = new RunPaths('.typo3-update', root);
    await mkdir(paths.configDir, { recursive: true });
    const state = emptyState({ runId: '2026-10-01-fixture', now: '2026-10-01T06:00:00.000Z' });
    state.project.trusted_origin = 'https://fixture.ddev.site';
    await new StateStore(paths).write(state);
    return await fn(paths, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('late Contract A acceptance (#39)', () => {
  const deadline = '2026-10-01T07:00:00.000Z';
  const verified = (at) => ({
    runtime: { deadline_at: deadline },
    contract_a: { status: 'open', verification: { at, evidence_ref: 'report/closure.json' } },
  });

  test('only the acceptance record and the gate pass, and only for a proof verified in time', () => {
    const timely = verified('2026-10-01T06:30:00.000Z');
    assert.equal(lateAcceptanceCommand('approval', { stage: 'acceptance' }, timely), true);
    assert.equal(lateAcceptanceCommand('node-open', { node: 'contract-a-gate' }, timely), true);
    assert.equal(lateAcceptanceCommand('node-close', { node: 'contract-a-gate' }, timely), true);
    assert.equal(lateAcceptanceCommand('approval', { stage: 'intent' }, timely), false);
    assert.equal(lateAcceptanceCommand('node-open', { node: 'rung-14' }, timely), false);
    assert.equal(lateAcceptanceCommand('closure-start', {}, timely), false);
    assert.equal(lateAcceptanceCommand('approval', { stage: 'acceptance' }, verified('2026-10-01T07:30:00.000Z')), false);
    assert.equal(lateAcceptanceCommand('approval', { stage: 'acceptance' }, { runtime: { deadline_at: deadline }, contract_a: { status: 'open' } }), false);
  });

  test('the command wrapper lets a timely-verified acceptance through after the deadline', async () => {
    await withRun(async (paths, root) => {
      await new StateStore(paths).update((state) => {
        state.runtime.deadline_at = '2026-09-30T07:00:00.000Z';
        state.contract_a.verification = { at: '2026-09-30T06:00:00.000Z', evidence_ref: 'report/closure.json',
          epoch_hash: `sha256:${'e'.repeat(64)}`, manifest_hash: `sha256:${'a'.repeat(64)}` };
      });
      const cwd = process.cwd();
      process.chdir(root);
      try {
        const run = (values) => runCommand({ command: 'approval', values: { 'run-dir': '.typo3-update', quiet: true, ...values },
          positionals: [], argv: ['approval'], actions: { approval: async () => ({ exitCode: 0, message: 'recorded' }) } });
        assert.equal(await run({ stage: 'acceptance' }), EXIT.PASS);
        assert.equal(await run({ stage: 'intent' }), EXIT.PRECONDITION);
      } finally {
        process.chdir(cwd);
      }
    });
  });
});

describe('recorded outcomes are labelled as outcomes (#38)', () => {
  test('reproof and blocked carry a note; pass, findings and invalid keep their labels', () => {
    assert.match(recordedOutcomeNote('closure-harness-recovery', 'reproof', EXIT.HARNESS_ERROR, [{ id: 'reproof-route' }]).exitNote,
      /recorded closure-harness-recovery as "reproof" and activated reproof-route; the exit code reports that outcome/);
    assert.ok(recordedOutcomeNote('rung-14', 'blocked', EXIT.BLOCKED_BY_POLICY).exitNote);
    assert.deepEqual(recordedOutcomeNote('a', 'pass', EXIT.PASS), {});
    assert.deepEqual(recordedOutcomeNote('a', 'findings', EXIT.FINDINGS), {});
    assert.deepEqual(recordedOutcomeNote('a', 'invalid', EXIT.INVALID), {});
  });
});

describe('measurement inputs inside guarded nodes', () => {
  test('the self-test refuses while a guarded site node is open', async () => {
    await withRun(async (paths) => {
      await writeFile(paths.graphDefinition, await readFile(DEFAULT_GRAPH, 'utf8'), 'utf8');
      await graphInit({ values: {}, paths, log: quietLog, journal: quietJournal });
      assert.deepEqual(await openGuardedNodes(paths), []);
      await new StateStore(paths).update((state) => {
        state.graph.nodes['rung-14'].status = 'running';
        state.graph.nodes['closure-harness-recovery'].status = 'running';
      });
      assert.deepEqual(await openGuardedNodes(paths), ['rung-14'], 'measurement nodes do not guard against themselves');
      await assert.rejects(
        selftestDeterminism({ values: {}, paths, log: quietLog, journal: quietJournal }),
        (err) => err.exitCode === EXIT.PRECONDITION && /rung-14/.test(err.message) && /selftest\.lock\.json/.test(err.message),
      );
    });
  });

  test('closure-start refuses a missing or stale self-test lock before binding an epoch', async () => {
    await withRun(async (paths) => {
      await assert.rejects(closureStart({ paths, log: quietLog }),
        (err) => err.exitCode === EXIT.PRECONDITION && /Re-run "t3u selftest-determinism" before closure-start/.test(err.message));
    });
  });
});

describe('Contract A Lighthouse floors are declared before the site changes', () => {
  test('the template nulls are refused for both form factors', async () => {
    const { contractALighthouseBudgetIssues } = await import('../../lib/actions/sweep.mjs');
    const issues = await contractALighthouseBudgetIssues(THRESHOLDS);
    assert.equal(issues.length, 2);
    assert.match(issues.join('\n'), /lighthouse_performance_mobile/);
    assert.match(issues.join('\n'), /lighthouse_performance_desktop/);
  });

  test('the first migration node refuses to open until the floors are set', async () => {
    await withRun(async (paths) => {
      await writeFile(paths.graphDefinition, await readFile(DEFAULT_GRAPH, 'utf8'), 'utf8');
      await graphInit({ values: {}, paths, log: quietLog, journal: quietJournal });
      await new StateStore(paths).update((state) => { state.graph.nodes['dependency-resolution'].status = 'ready'; });
      const template = await readFile(THRESHOLDS, 'utf8');
      await writeFile(paths.thresholds, template, 'utf8');
      await assert.rejects(nodeOpen({ values: { node: 'dependency-resolution' }, paths, log: quietLog, journal: quietJournal }),
        (err) => err.exitCode === EXIT.PRECONDITION && /Contract A Lighthouse floors/.test(err.message));
      const agreed = template
        .replace('lighthouse_performance_mobile: null', 'lighthouse_performance_mobile: 70')
        .replace('lighthouse_performance_desktop: null', 'lighthouse_performance_desktop: 80')
        .replace('lighthouse_best_practices: null', 'lighthouse_best_practices: 90')
        .replace('lighthouse_accessibility: null', 'lighthouse_accessibility: 85')
        .replace('lighthouse_seo: null', 'lighthouse_seo: 90');
      await writeFile(paths.thresholds, agreed, 'utf8');
      await assert.rejects(nodeOpen({ values: { node: 'dependency-resolution' }, paths, log: quietLog, journal: quietJournal }),
        (err) => !/Lighthouse/.test(err.message), 'with floors set, node-open proceeds to its next precondition');
    });
  });
});

describe('loop-supersede (#36)', () => {
  test('an open quality loop is superseded by an existing newer loop and stops counting', async () => {
    await withRun(async (paths) => {
      for (const id of ['301', '303']) {
        await loopStart({ values: { id, track: 'invariance', slug: 'quality' }, paths, log: quietLog, journal: quietJournal });
      }
      await new StateStore(paths).update((state) => { state.loops['301'] = 'open'; });
      const events = [];
      const journal = { async append(kind, data) { events.push({ kind, ...data }); } };
      await assert.rejects(loopSupersede({ values: { loop: '301', by: '302', reason: 'r' }, paths, log: quietLog, journal }),
        (err) => err.exitCode === EXIT.PRECONDITION);
      await assert.rejects(loopSupersede({ values: { loop: '301', by: '301', reason: 'r' }, paths, log: quietLog, journal }));
      await assert.rejects(loopSupersede({ values: { loop: '301', by: '303' }, paths, log: quietLog, journal }));
      const result = await loopSupersede({ values: { loop: '301', by: '303', reason: 'quality loop without stage reports' },
        paths, log: quietLog, journal });
      assert.equal(result.status, 'superseded');
      assert.equal((await new StateStore(paths).read()).loops['301'], 'superseded');
      assert.deepEqual(events, [{ kind: 'transition', loop_id: '301', from: 'open', to: 'superseded', superseded_by: '303',
        reason: 'quality loop without stage reports' }]);
      await assert.rejects(loopSupersede({ values: { loop: '301', by: '303', reason: 'again' }, paths, log: quietLog, journal }),
        /Illegal loop transition superseded -> superseded/);
    });
  });
});

describe('declared DOM rules tolerate normaliser placeholders (#26)', async () => {
  const { placeholderTolerant, validateDeclaredChanges, applyDomRules } = await import('../../lib/compare/declared-changes.mjs');

  test('in-tag classes also accept a whole placeholder; escaped brackets stay literal', () => {
    const doc = '<link href="/a.<H>.css" media="all"/>';
    assert.equal(new RegExp('<link [^>]*media="all"[^>]*/>').test(doc), false, 'the old silent failure');
    assert.equal(new RegExp(placeholderTolerant('<link [^>]*media="all"[^>]*/>')).test(doc), true);
    assert.equal(new RegExp(placeholderTolerant('<link [^<>]*/>')).test(doc), true);
    assert.equal(placeholderTolerant('a\\[^>]b'), 'a\\[^>]b');
    assert.equal(new RegExp(placeholderTolerant('<a [^>]*>')).exec('<a href="x"><b>')[0], '<a href="x">', 'still stops at the tag end');
  });

  test('a DOM rule now rewrites a tag whose URL carries a placeholder', () => {
    const { rules, issues } = validateDeclaredChanges({
      schema: 'typo3-upgrade-run/declared-changes@1',
      changes: [{ id: 'DC-001', approval_ref: 'APR-001', stage: 'dom', reason: 'core drops the type attribute',
        before: '(<link [^>]*?) type="text/css"([^>]*>)', after: '$1$2' }],
    }, new Set(['APR-001']));
    assert.deepEqual(issues, []);
    const before = '<link rel="stylesheet" href="/main.<H>.css" type="text/css" media="all">';
    const after = '<link rel="stylesheet" href="/main.<H>.css" media="all">';
    const result = applyDomRules(before, rules, null, after);
    assert.equal(result.text, after);
    assert.equal(result.applied.length, 1);
  });
});

describe('pre-capture load check (#11)', async () => {
  const { waitForQuietMachine } = await import('../../lib/util/machine-resources.mjs');
  const clock = () => {
    let t = 0;
    return { now: () => t, sleep: async (ms) => { t += ms; } };
  };

  test('waits while the load exceeds twice the cores, then records what it saw', async () => {
    const loads = [50, 40, 10];
    const { now, sleep } = clock();
    const result = await waitForQuietMachine({ env: {}, cores: 8, loadavg: () => loads.shift(), now, sleep, pollMs: 15_000 });
    assert.deepEqual(result, { load1: 10, limit: 16, cores: 8, waitedMs: 30_000, overloaded: false });
  });

  test('gives up after the bound and says so, without refusing', async () => {
    const { now, sleep } = clock();
    const warnings = [];
    const result = await waitForQuietMachine({ env: { T3U_LOAD_WAIT_MS: '60000' }, cores: 8, loadavg: () => 80,
      now, sleep, log: { step() {}, warn: (m) => warnings.push(m) } });
    assert.equal(result.overloaded, true);
    assert.equal(result.waitedMs, 60_000);
    assert.match(warnings[0], /still exceeds 16/);
  });

  test('a quiet machine costs nothing', async () => {
    const { now, sleep } = clock();
    assert.equal((await waitForQuietMachine({ env: {}, cores: 8, loadavg: () => 3, now, sleep })).waitedMs, 0);
  });
});

describe('video first frame under load (#21)', async () => {
  const { settleScript } = await import('../../lib/browser/stabilize.mjs');
  const { readFile: read } = await import('node:fs/promises');

  test('the settle step counts videos still loading, and capture re-shoots them', async () => {
    const script = settleScript();
    assert.match(script, /report\.videoStillLoading = 0/);
    assert.match(script, /!ready && !video\.error && video\.networkState === HTMLMediaElement\.NETWORK_LOADING/);
    const capture = await read(new URL('../../lib/actions/capture.mjs', import.meta.url), 'utf8');
    assert.match(capture, /if \(settle\.videoStillLoading > 0\) \{\s*throw new Error/);
  });
});

describe('harness source hash covers measurement code only (#33)', async () => {
  const { isMeasurementSource, hashSourceTree, HASH_RELEVANT, RECORDED_ONLY } = await import('../../lib/fingerprint/environment.mjs');

  test('evidence code is measurement; run bookkeeping is recorded only', () => {
    for (const file of ['lib/compare/http-meta.mjs', 'lib/browser/stabilize.mjs', 'lib/net/safe-fetch.mjs',
      'lib/fingerprint/content.mjs', 'lib/actions/capture.mjs', 'lib/actions/compare.mjs', 'lib/actions/sweep.mjs',
      'lib/util/rng.mjs', 'package.json']) assert.equal(isMeasurementSource(file), true, file);
    for (const file of ['lib/actions/closure.mjs', 'lib/actions/graph.mjs', 'lib/actions/lifecycle.mjs', 'lib/run/state.mjs',
      'lib/cli/command.mjs', 'lib/report/write.mjs', 't3u.mjs', 'pull-live-dataset.mjs']) assert.equal(isMeasurementSource(file), false, file);
    assert.ok(HASH_RELEVANT.includes('harness.sourceHash'));
    assert.ok(RECORDED_ONLY.includes('harness.bookkeepingHash'));
  });

  test('a bookkeeping edit leaves the compared hash unchanged', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 't3u-source-'));
    try {
      await mkdir(path.join(root, 'lib', 'compare'), { recursive: true });
      await mkdir(path.join(root, 'lib', 'actions'), { recursive: true });
      await writeFile(path.join(root, 'lib', 'compare', 'a.mjs'), 'export const a = 1;\n');
      await writeFile(path.join(root, 'lib', 'actions', 'closure.mjs'), 'export const b = 1;\n');
      const measured = () => hashSourceTree(root, isMeasurementSource);
      const kept = () => hashSourceTree(root, (file) => !isMeasurementSource(file));
      const [m1, k1] = [await measured(), await kept()];
      await writeFile(path.join(root, 'lib', 'actions', 'closure.mjs'), 'export const b = 2;\n');
      assert.equal(await measured(), m1);
      assert.notEqual(await kept(), k1);
      await writeFile(path.join(root, 'lib', 'compare', 'a.mjs'), 'export const a = 2;\n');
      assert.notEqual(await measured(), m1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('standalone scripts run when started through a symlink', async () => {
  const { isMain } = await import('../../lib/cli/is-main.mjs');
  const { symlink, mkdtemp: tmp, rm: remove } = await import('node:fs/promises');
  const { pathToFileURL, fileURLToPath } = await import('node:url');
  const { execFileSync } = await import('node:child_process');

  test('isMain compares real paths, so a symlinked harness pin still runs the script', async () => {
    const real = fileURLToPath(new URL('../../pull-live-dataset.mjs', import.meta.url));
    const dir = await tmp(path.join(os.tmpdir(), 't3u-symlink-'));
    try {
      const link = path.join(dir, 'harness');
      await symlink(path.dirname(real), link);
      const viaLink = path.join(link, 'pull-live-dataset.mjs');
      assert.equal(isMain(pathToFileURL(real).href, viaLink), true);
      assert.equal(isMain(pathToFileURL(real).href, path.join(dir, 'missing.mjs')), false);
      assert.equal(isMain(pathToFileURL(real).href, undefined), false);
      // The old guard made this a silent exit 0 without output.
      let out = '';
      try { execFileSync(process.execPath, [viaLink], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (err) { out = String(err.stderr); }
      assert.match(out, /Usage: pull-live-dataset\.mjs/, 'the script must run and print its usage');
    } finally {
      await remove(dir, { recursive: true, force: true });
    }
  });
});
