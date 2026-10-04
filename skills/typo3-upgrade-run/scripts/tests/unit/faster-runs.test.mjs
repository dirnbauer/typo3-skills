/**
 * Faster runs that are not lost: the dev-server seal guard, a content fingerprint that reports a
 * failed query instead of drift, the Spotlight marker, the machine-sized self-test worker count
 * and the self-test expiry warning.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os, { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { EXIT, HarnessError, InvalidRunError } from '../../lib/cli/exit-codes.mjs';
import {
  assertProductionCapture, devServerUrlMarkers, inspectDocument, scanCaptureForDevServer,
} from '../../lib/run/dev-server-guard.mjs';
import { sealBaselineAction } from '../../lib/actions/compare.mjs';
import {
  collectContent, compareContent, createDdevSqlRunner, execFailure, FINGERPRINT_QUERY,
} from '../../lib/fingerprint/content.mjs';
import { assertLiveInputs } from '../../lib/run/evidence.mjs';
import { init, SPOTLIGHT_MARKER } from '../../lib/actions/core.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { emptyState, StateStore } from '../../lib/run/state.mjs';
import { stateSchemaErrors } from '../../lib/run/schema.mjs';
import { Journal } from '../../lib/run/journal.mjs';
import {
  captureAll, machineVisualWorkers, selftestVisualWorkers, MAX_VISUAL_WORKERS,
} from '../../lib/actions/capture.mjs';
import {
  assertSelftestValid, selftestExpiryWarning, selftestValidity, SELFTEST_EXPIRY_WARNING_MS,
} from '../../lib/cli/command.mjs';
import { graphInit, graphStatus, renderSelftestValidity } from '../../lib/actions/graph.mjs';

const exec = promisify(execFile);
const FIXTURES = fileURLToPath(new URL('../fixtures/dev-server/', import.meta.url));
const HOUR = 3_600_000;
const hash = (c) => `sha256:${c.repeat(64)}`;

function recordingLog() {
  const lines = {};
  const log = new Proxy({}, { get: (_, level) => (message) => { (lines[level] ??= []).push(String(message)); } });
  return { log, lines };
}

async function project(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const paths = new RunPaths('.typo3-update', root);
  await mkdir(paths.root, { recursive: true });
  return { root, paths };
}

/* ------------------------------------------------------------ 1. dev-server seal guard */

/** A capture directory shaped like a promoted self-test pass: dom/, http/ and shots/ per page. */
async function captureDir(pages) {
  const dir = await mkdtemp(path.join(tmpdir(), 't3u-devserver-'));
  for (const kind of ['dom', 'http', 'shots']) await mkdir(path.join(dir, kind), { recursive: true });
  for (const [i, { fixture, url }] of pages.entries()) {
    const key = String(i + 1).padStart(16, '0');
    await copyFile(path.join(FIXTURES, fixture), path.join(dir, 'dom', `${key}.html`));
    await writeFile(path.join(dir, 'http', `${key}.json`), JSON.stringify({ requestedUrl: url, url, status: 200 }));
    await writeFile(path.join(dir, 'shots', `${key}.png`), `png ${i}`);
  }
  return dir;
}

const fixture = (name) => readFile(path.join(FIXTURES, name), 'utf8');

describe('dev-server guard before Baseline A is sealed', () => {
  test('reads markers from what the browser loads, never from text that mentions them', async () => {
    assert.deepEqual(inspectDocument(await fixture('production.html')), { markers: [], stylesheets: 1 });
    assert.deepEqual(inspectDocument(await fixture('vite-client.html')), { markers: ['/@vite/client'], stylesheets: 1 });
    assert.deepEqual(inspectDocument(await fixture('react-refresh.html')).markers, ['/__vite_ping', '@react-refresh']);
    // A stylesheet served by the dev host is not a built stylesheet.
    assert.deepEqual(inspectDocument(await fixture('dev-host.html')),
      { markers: [':5173 dev host', 'vite.* dev host', 'webpack-dev-server'], stylesheets: 0 });
    // Body text, code samples, JSON-LD, comments and plain links about dev servers are not markers.
    assert.deepEqual(inspectDocument(await fixture('mentions-only.html')), { markers: [], stylesheets: 1 });
    assert.deepEqual(inspectDocument(await fixture('no-stylesheet.html')), { markers: [], stylesheets: 0 });

    assert.deepEqual(devServerUrlMarkers('//localhost:5173/src/main.ts'), [':5173 dev host']);
    assert.deepEqual(devServerUrlMarkers('https://vite.acme.ddev.site/@vite/client'), ['/@vite/client', 'vite.* dev host']);
    assert.deepEqual(devServerUrlMarkers('/src/main.ts'), []);
    assert.deepEqual(devServerUrlMarkers('https://acme.ddev.site/_assets/app.<H>.js'), []);
    // A dev host is another host than the page's own: a site that lives on vite.* or :5173 is not one.
    assert.deepEqual(devServerUrlMarkers('https://vite.example.com/_assets/app.css', 'https://vite.example.com/about'), []);
    assert.deepEqual(devServerUrlMarkers('/_assets/app.css', 'https://vite.example.com/about'), []);
    assert.deepEqual(devServerUrlMarkers('https://vite.example.com/_assets/app.css', 'https://www.example.com/'), ['vite.* dev host']);
    assert.deepEqual(devServerUrlMarkers('http://127.0.0.1:5173/app.js', 'http://127.0.0.1:5173/'), []);
    assert.deepEqual(devServerUrlMarkers('/@vite/client', 'https://vite.example.com/'), ['/@vite/client'], 'path markers always count');
    const ownHost = inspectDocument(
      '<link rel="stylesheet" href="https://vite.example.com/_assets/app.css"><script src="https://vite.example.com/_assets/app.js"></script>',
      { pageUrl: 'https://vite.example.com/' },
    );
    assert.deepEqual(ownHost, { markers: [], stylesheets: 1 });
    // Inline scripts are judged by Vite's dev-only module specifiers, not by any mention of a tool.
    assert.deepEqual(inspectDocument('<script>console.info("built without webpack-dev-server")</script>').markers, []);
  });

  test('seal-baseline refuses a dev-server baseline with exit 4, names the pages and writes nothing', async () => {
    const { paths } = await project('t3u-seal-dev-');
    await new StateStore(paths).write(emptyState({ runId: '2026-10-04-acme', now: new Date().toISOString() }));
    const dir = await captureDir([
      { fixture: 'production.html', url: 'https://acme.ddev.site/' },
      { fixture: 'vite-client.html', url: 'https://acme.ddev.site/about' },
      { fixture: 'react-refresh.html', url: 'https://acme.ddev.site/team' },
    ]);
    const { log } = recordingLog();
    await assert.rejects(
      sealBaselineAction({ values: { dir }, paths, log }),
      (error) => {
        assert.equal(error.exitCode, EXIT.PRECONDITION);
        assert.match(error.message, /development server: 2 of 3 page\(s\)/);
        assert.match(error.message, /https:\/\/acme\.ddev\.site\/about \(\/@vite\/client\)/);
        assert.match(error.message, /https:\/\/acme\.ddev\.site\/team \(\/__vite_ping, @react-refresh\)/);
        assert.match(error.message, /Nothing was sealed/);
        assert.deepEqual(error.detail.pages.map((page) => page.url),
          ['https://acme.ddev.site/about', 'https://acme.ddev.site/team']);
        return true;
      },
    );
    for (const file of ['LOCK.json', 'SHA256SUMS', 'SEAL.md']) {
      await assert.rejects(access(path.join(dir, file)), `${file} must not exist after a refusal`);
    }
    assert.equal((await new StateStore(paths).read()).baselines['A-original'].sealed, false);
  });

  test('a production baseline seals; a page without a built stylesheet only warns', async () => {
    const { paths } = await project('t3u-seal-prod-');
    await new StateStore(paths).write(emptyState({ runId: '2026-10-04-acme', now: new Date().toISOString() }));
    const dir = await captureDir([
      { fixture: 'production.html', url: 'https://acme.ddev.site/' },
      { fixture: 'production.html', url: 'https://acme.ddev.site/services' },
      { fixture: 'mentions-only.html', url: 'https://acme.ddev.site/blog/dev-servers' },
      { fixture: 'no-stylesheet.html', url: 'https://acme.ddev.site/imprint' },
    ]);
    const { log, lines } = recordingLog();
    const result = await sealBaselineAction({ values: { dir }, paths, log });
    assert.equal(result.exitCode, EXIT.PASS);
    await access(path.join(dir, 'LOCK.json'));
    assert.equal(lines.warn?.length, 1);
    assert.match(lines.warn[0], /1 page\(s\) in baseline A-original link no built stylesheet while 3 other page\(s\) do/);
    assert.match(lines.warn[0], /https:\/\/acme\.ddev\.site\/imprint/);
    assert.equal((await new StateStore(paths).read()).baselines['A-original'].sealed, true);

    // The order of refusals is unchanged: a sealed baseline says so, whatever its pages contain.
    await copyFile(path.join(FIXTURES, 'vite-client.html'), path.join(dir, 'dom', '9999999999999999.html'));
    await assert.rejects(sealBaselineAction({ values: { dir }, paths, log }), /already sealed/);
  });

  test('the stylesheet heuristic stays quiet unless stylesheet-less pages are the exception', async () => {
    const even = await scanCaptureForDevServer(await captureDir([
      { fixture: 'production.html', url: 'https://acme.ddev.site/' },
      { fixture: 'no-stylesheet.html', url: 'https://acme.ddev.site/imprint' },
    ]));
    assert.deepEqual(even.missingStylesheet, []);
    const none = await scanCaptureForDevServer(await captureDir([
      { fixture: 'no-stylesheet.html', url: 'https://acme.ddev.site/a' },
      { fixture: 'no-stylesheet.html', url: 'https://acme.ddev.site/b' },
    ]));
    assert.deepEqual(none.missingStylesheet, []);

    const empty = await mkdtemp(path.join(tmpdir(), 't3u-devserver-empty-'));
    const { log, lines } = recordingLog();
    assert.equal((await assertProductionCapture(empty, { log })).scanned, 0);
    assert.match(lines.warn[0], /no DOM snapshots/);
  });
});

/* -------------------------------------------- 2. content fingerprint: unavailable, not drift */

/** A fixed database. The previous harness fingerprinted it as REFERENCE_FINGERPRINT. */
const STUB_TABLES = {
  pages: {
    columns: 'Field\tType\tNull\tKey\tDefault\tExtra\nuid\tint(11)\tNO\tPRI\tNULL\tauto_increment\ntstamp\tint(11)\tNO\t\t0\t\ntitle\tvarchar(255)\tNO\t\t\t',
    stats: 'row_count\tmax_tstamp\tmax_uid\n2\t1700000100\t2',
    rows: 'uid\ttstamp\ttitle\n1\t1700000000\tHome\n2\t1700000100\tAbout',
  },
  tt_content: {
    columns: 'Field\tType\tNull\tKey\tDefault\tExtra\nuid\tint(11)\tNO\tPRI\tNULL\tauto_increment\ntstamp\tint(11)\tNO\t\t0\t\nbodytext\tmediumtext\tYES\t\tNULL\t',
    stats: 'row_count\tmax_tstamp\tmax_uid\n1\t1700000200\t7',
    rows: 'uid\ttstamp\tbodytext\n7\t1700000200\t<p>Hello</p>',
  },
  tx_news_domain_model_news: {
    columns: 'Field\tType\tNull\tKey\tDefault\tExtra\nuid\tint(11)\tNO\tPRI\tNULL\tauto_increment',
    stats: 'row_count\tmax_tstamp\tmax_uid\n0\t0\t0',
    rows: '',
  },
};
const REFERENCE_FINGERPRINT = 'sha256:235bea15acbf09f626a8064d43555ed3f23a0faf74d18f750db515a1716cefc2';
const FILEADMIN = '/nonexistent-fileadmin-dir';
const ROWS_OF = (table) => (sql) => sql.startsWith('SELECT `') && sql.includes(`FROM \`${table}\``);

function stubSql(sql, tables = STUB_TABLES) {
  if (sql.startsWith('SHOW TABLES')) return `Tables_in_db\n${Object.keys(tables).join('\n')}\nsys_log\ncf_cache_pages`;
  const table = Object.keys(tables).find((name) => sql.includes(`\`${name}\``));
  if (sql.startsWith('SHOW COLUMNS')) return tables[table].columns;
  if (sql.startsWith('SELECT COUNT(*)')) return tables[table].stats;
  return tables[table].rows;
}

/** Fails matching statements with the given error, `times` times, then answers from the stub. */
function flakyRunner({ match = () => false, times = 0, error = () => new Error('failed'), tables = STUB_TABLES } = {}) {
  const calls = [];
  let remaining = times;
  const runner = async (sql) => {
    calls.push(sql);
    if (match(sql) && remaining > 0) {
      remaining -= 1;
      throw error();
    }
    return stubSql(sql, tables);
  };
  return { runner, calls };
}

const exitFailure = (code) => () => Object.assign(new Error('ERROR 2013 (HY000): Lost connection to server during query'), { exitCode: code });
const timeoutFailure = () => execFailure({ killed: true, signal: 'SIGTERM', code: null, message: 'Command failed' });

describe('content fingerprint: a failed query is unavailable, never drift', () => {
  test('a successful collection fingerprints byte-identically to the previous harness', async () => {
    const discovered = await collectContent({ fileadmin: FILEADMIN, runner: flakyRunner().runner, retryDelayMs: 0 });
    assert.equal(discovered.fingerprintHash, REFERENCE_FINGERPRINT);
    assert.deepEqual(discovered.database.tables.map((entry) => entry.table), ['pages', 'tt_content', 'tx_news_domain_model_news']);
    const explicit = await collectContent({
      fileadmin: FILEADMIN, tables: Object.keys(STUB_TABLES), runner: flakyRunner().runner, retryDelayMs: 0,
    });
    assert.equal(explicit.fingerprintHash, REFERENCE_FINGERPRINT);
  });

  test('one failed ddev mysql call is logged with table, exit code and duration, then retried', async () => {
    const { log, lines } = recordingLog();
    const { runner, calls } = flakyRunner({ match: ROWS_OF('tt_content'), times: 1, error: exitFailure(1) });
    const result = await collectContent({ fileadmin: FILEADMIN, runner, log, retryDelayMs: 0 });
    assert.equal(result.fingerprintHash, REFERENCE_FINGERPRINT, 'a retried call must not change the fingerprint');
    assert.equal(calls.filter(ROWS_OF('tt_content')).length, 2);
    assert.equal(lines.warn.length, 1);
    assert.match(lines.warn[0], /ddev mysql failed for tt_content \(SELECT rows\), attempt 1\/2: exit code 1, \d+ ms: ERROR 2013/);
    assert.match(lines.warn[0], /retrying once/);
  });

  test('a table that fails twice is unavailable with exit 2; nothing after it is queried', async () => {
    const { log, lines } = recordingLog();
    const { runner, calls } = flakyRunner({ match: ROWS_OF('tt_content'), times: 2, error: timeoutFailure });
    await assert.rejects(collectContent({ fileadmin: FILEADMIN, runner, log, retryDelayMs: 0 }), (error) => {
      assert.ok(error instanceof HarnessError && !(error instanceof InvalidRunError));
      assert.equal(error.exitCode, EXIT.HARNESS_ERROR);
      assert.match(error.message, /table tt_content is unavailable/);
      assert.match(error.message, /not content drift/);
      const [report] = error.detail.unavailable;
      assert.equal(report.table, 'tt_content');
      assert.equal(report.statement, 'SELECT rows');
      assert.equal(report.status, 'unavailable');
      assert.equal(report.calls.length, 2);
      for (const call of report.calls) {
        assert.equal(call.exitCode, null);
        assert.equal(call.signal, 'SIGTERM');
        assert.equal(call.timedOut, true);
        assert.ok(Number.isFinite(call.durationMs));
        assert.equal(call.error, `timed out after ${FINGERPRINT_QUERY.timeoutMs} ms`);
      }
      assert.deepEqual(error.detail.notQueried, ['tx_news_domain_model_news']);
      return true;
    });
    assert.equal(lines.warn.length, 2);
    assert.match(lines.warn[1], /attempt 2\/2: exit code none, signal SIGTERM, timed out, \d+ ms/);
    assert.ok(!calls.some((sql) => sql.includes('tx_news_domain_model_news')), 'fail fast after an unavailable table');
  });

  test('output beyond the buffer fails loudly once and is never hashed', async () => {
    const { runner, calls } = flakyRunner({
      match: ROWS_OF('tt_content'), times: 5,
      error: () => execFailure({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', message: 'stdout maxBuffer length exceeded' }),
    });
    const { log } = recordingLog();
    await assert.rejects(collectContent({ fileadmin: FILEADMIN, runner, log, retryDelayMs: 0 }), (error) => {
      assert.equal(error.exitCode, EXIT.HARNESS_ERROR);
      assert.match(error.message, /tt_content \(SELECT rows\) exceeded the 256 MiB buffer and was cut off/);
      assert.equal(error.detail.status, 'truncated');
      return true;
    });
    assert.equal(calls.filter(ROWS_OF('tt_content')).length, 1, 'a truncated dump is not retried');
  });

  test('an unreachable database is degraded only on request, otherwise exit 2', async () => {
    const down = flakyRunner({ match: () => true, times: Infinity, error: exitFailure(1) });
    const { log } = recordingLog();
    const degraded = await collectContent({ fileadmin: FILEADMIN, runner: down.runner, log, retryDelayMs: 0, allowMissing: true });
    assert.equal(degraded.degraded, true);
    assert.deepEqual(degraded.database, { available: false, error: 'no tables could be queried' });
    await assert.rejects(
      collectContent({ fileadmin: FILEADMIN, runner: down.runner, log, retryDelayMs: 0 }),
      (error) => error.exitCode === EXIT.HARNESS_ERROR && error.detail.unavailable[0].statement === 'SHOW TABLES',
    );
  });

  test('a table that no longer exists is not queried and still compares as drift', async () => {
    const { log, lines } = recordingLog();
    const { runner, calls } = flakyRunner();
    const current = await collectContent({
      fileadmin: FILEADMIN, tables: ['pages', 'tt_content', 'tx_gone'], runner, log, retryDelayMs: 0,
    });
    assert.ok(!calls.some((sql) => sql.includes('tx_gone')));
    assert.match(lines.warn[0], /tx_gone does not exist/);
    const sealed = { ...current, database: { ...current.database, tables: [...current.database.tables, { table: 'tx_gone', rowHash: 'x' }] } };
    assert.deepEqual(compareContent(sealed, current).drifted.map((entry) => entry.key), ['table:tx_gone']);
  });

  test('the live-input check turns an unreadable table into exit 2, and real drift stays exit 3', async () => {
    const { paths } = await project('t3u-live-');
    const sealedContent = await collectContent({ fileadmin: FILEADMIN, tables: Object.keys(STUB_TABLES), runner: flakyRunner().runner, retryDelayMs: 0 });
    const env = { kind: 'environment-fingerprint', fingerprintHash: hash('b'), components: {} };
    const state = emptyState({ runId: '2026-10-04-acme', now: new Date().toISOString() });
    state.fingerprints.environment = env.fingerprintHash;
    state.fingerprints.content = sealedContent.fingerprintHash;
    state.manifest.hash = hash('a');
    state.selftest.lock_hash = hash('d');
    await mkdir(paths.manifestsDir, { recursive: true });
    await new StateStore(paths).write(state);
    await writeFile(paths.envFingerprint, JSON.stringify(env));
    await writeFile(paths.contentFingerprint, JSON.stringify(sealedContent));
    await writeFile(paths.urlManifest, JSON.stringify({ manifestHash: hash('a') }));
    await writeFile(paths.selftestLock, JSON.stringify({ selftestHash: hash('d') }));
    const { log } = recordingLog();
    const live = (runner) => assertLiveInputs(paths, {
      log,
      environmentCollector: async () => env,
      contentCollector: (options) => collectContent({ ...options, runner, retryDelayMs: 0 }),
    });

    await live(flakyRunner().runner);   // unchanged and readable: passes
    await assert.rejects(live(flakyRunner({ match: ROWS_OF('tt_content'), times: 2, error: timeoutFailure }).runner),
      (error) => error.exitCode === EXIT.HARNESS_ERROR && !/drifted/.test(error.message));
    const edited = { ...STUB_TABLES, tt_content: { ...STUB_TABLES.tt_content, rows: 'uid\ttstamp\tbodytext\n7\t1700000200\t<p>Edited</p>' } };
    await assert.rejects(live(flakyRunner({ tables: edited }).runner),
      (error) => error.exitCode === EXIT.INVALID && /drifted/.test(error.message));
  });

  test('the ddev mysql runner reads up to 256 MiB and reports exit code, signal and timeout', async () => {
    const seen = [];
    const ok = createDdevSqlRunner({ exec: async (...args) => { seen.push(args); return { stdout: 'Tables_in_db\npages\n' }; } });
    assert.equal(await ok('SHOW TABLES'), 'Tables_in_db\npages\n');
    assert.deepEqual(seen[0].slice(0, 2), ['ddev', ['mysql', '-e', 'SHOW TABLES;']]);
    assert.equal(seen[0][2].maxBuffer, 256 * 1024 * 1024);
    assert.equal(seen[0][2].timeout, FINGERPRINT_QUERY.timeoutMs);

    const failing = (error) => createDdevSqlRunner({ exec: async () => { throw error; } })('SELECT 1');
    await assert.rejects(failing(Object.assign(new Error('Command failed: ddev mysql'), {
      code: 1, stderr: "ERROR 2002 (HY000): Can't connect to server\n",
    })), (error) => error.exitCode === 1 && error.timedOut === false && /^ERROR 2002/.test(error.message));
    await assert.rejects(failing(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM', code: null })),
      (error) => error.exitCode === null && error.signal === 'SIGTERM' && error.timedOut === true);

    // Node's own overflow error, not a hand-made one, is what the runner must recognise.
    const overflow = await exec(process.execPath, ['-e', "process.stdout.write('x'.repeat(4096))"], { maxBuffer: 1024 })
      .then(() => null, (error) => error);
    assert.equal(overflow?.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    assert.equal(execFailure(overflow, { maxBuffer: 1024 }).truncated, true);
  });
});

/* ------------------------------------------------------------- 3. Spotlight marker */

describe('run directory hygiene', () => {
  test('init writes .metadata_never_index into the run directory, and a re-init keeps it', async () => {
    const { paths } = await project('t3u-init-');
    const journal = new Journal(paths.journalPath);
    const { log } = recordingLog();
    const values = { 'base-url': 'http://127.0.0.1:8080', 'project-name': 'acme' };
    await init({ values, paths, log, journal });
    const marker = path.join(paths.root, '.metadata_never_index');
    assert.equal(SPOTLIGHT_MARKER, '.metadata_never_index');
    assert.equal((await stat(marker)).size, 0);
    assert.deepEqual(stateSchemaErrors(await new StateStore(paths).read()), []);

    await init({ values: { ...values, force: true }, paths, log, journal });
    assert.equal((await stat(marker)).size, 0);
  });
});

/* ------------------------------------------------- 4. machine-sized self-test workers */

describe('self-test visual workers come from the machine', () => {
  test('min(12, max(2, logical CPUs - 2)), within the browser slot budget', (t) => {
    assert.equal(machineVisualWorkers({ parallelism: 1, browserSlots: 12 }), 2);
    assert.equal(machineVisualWorkers({ parallelism: 4, browserSlots: 12 }), 2);
    assert.equal(machineVisualWorkers({ parallelism: 6, browserSlots: 12 }), 4);
    assert.equal(machineVisualWorkers({ parallelism: 10, browserSlots: 12 }), 8);
    assert.equal(machineVisualWorkers({ parallelism: 14, browserSlots: 12 }), 12);
    assert.equal(machineVisualWorkers({ parallelism: 96, browserSlots: 12 }), MAX_VISUAL_WORKERS);
    assert.equal(machineVisualWorkers({ parallelism: 10, browserSlots: 4 }), 4, 'T3U_BROWSER_SLOTS caps the default');

    const slots = process.env.T3U_BROWSER_SLOTS;
    delete process.env.T3U_BROWSER_SLOTS;
    t.after(() => { if (slots !== undefined) process.env.T3U_BROWSER_SLOTS = slots; });
    t.mock.method(os, 'availableParallelism', () => 6);
    assert.deepEqual(selftestVisualWorkers({}), { visualWorkers: 4, source: 'machine', parallelism: 6 });
    assert.deepEqual(selftestVisualWorkers({ 'visual-workers': '3' }), { visualWorkers: 3, source: 'flag' });
    assert.throws(() => selftestVisualWorkers({ 'visual-workers': 'many' }), /must be an integer/);
  });

  test('a self-test without --visual-workers proves, prints and seals the machine count', async (t) => {
    // Runs the real self-test in a child process with its own TMPDIR, so the machine-wide capture
    // lock and capacity ledger of any live run on this host are never touched. The manifest has
    // no URLs: no browser starts and nothing is fetched.
    const { root, paths } = await project('t3u-selftest-workers-');
    const isolated = await mkdtemp(path.join(tmpdir(), 't3u-isolated-tmp-'));
    t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(isolated, { recursive: true, force: true })]));
    await mkdir(paths.manifestsDir, { recursive: true });
    const state = emptyState({ runId: '2026-10-04-acme', now: new Date().toISOString() });
    state.fingerprints.environment = hash('b');
    state.fingerprints.content = hash('c');
    state.manifest.hash = hash('a');
    await new StateStore(paths).write(state);
    await writeFile(paths.envFingerprint, JSON.stringify({ fingerprintHash: hash('b'), components: {} }));
    await writeFile(paths.contentFingerprint, JSON.stringify({ fingerprintHash: hash('c'), database: { tables: [] } }));
    await writeFile(paths.urlManifest, JSON.stringify({
      manifestHash: hash('a'), allowedOrigins: ['http://127.0.0.1:9'], seed: 's', allUrls: [], captures: [],
    }));

    const lib = (rel) => JSON.stringify(pathToFileURL(fileURLToPath(new URL(`../../lib/${rel}`, import.meta.url))).href);
    const script = `
      import os from 'node:os';
      os.availableParallelism = () => 6;
      const { selftestDeterminism } = await import(${lib('actions/compare.mjs')});
      const { RunPaths } = await import(${lib('run/paths.mjs')});
      const lines = [];
      const log = new Proxy({}, { get: () => (message) => lines.push(String(message)) });
      const result = await selftestDeterminism({ values: {}, paths: new RunPaths('.typo3-update', ${JSON.stringify(root)}), log, journal: null });
      process.stdout.write(JSON.stringify({ exitCode: result.exitCode, lines }));
    `;
    const env = { ...process.env, TMPDIR: isolated };
    delete env.T3U_BROWSER_SLOTS;
    delete env.T3U_CPU_SLOTS;
    const run = async () => JSON.parse((await exec(process.execPath, ['--input-type=module', '-e', script], { env })).stdout);

    const first = await run();
    assert.equal(first.exitCode, EXIT.PASS);
    assert.ok(first.lines.some((line) => /self-test visual workers: 4 \(machine default from 6 logical CPUs/.test(line)), first.lines.join('\n'));
    const lock = JSON.parse(await readFile(paths.selftestLock, 'utf8'));
    assert.equal(lock.visualWorkers, 4);
    assert.equal(lock.visualWorkersSource, 'machine');
    assert.equal(lock.availableParallelism, 6);
    // Final evidence is licensed for exactly that count and no other.
    await assert.rejects(captureAll({ visualWorkers: 12, provenWorkers: lock.visualWorkers }), /requires that exact count proven/);

    // The graph-status hint: a re-run inside an unchanged epoch reproduces the same lock hash.
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal((await run()).exitCode, EXIT.PASS);
    const again = JSON.parse(await readFile(paths.selftestLock, 'utf8'));
    assert.equal(again.selftestHash, lock.selftestHash);
    assert.notEqual(again.passedAt, lock.passedAt);
    assert.equal((await new StateStore(paths).read()).selftest.lock_hash, lock.selftestHash);
  });
});

/* ------------------------------------------------------ 5. self-test expiry visibility */

describe('self-test expiry is visible before it lapses', () => {
  const passedAt = '2026-10-04T00:00:00.000Z';
  const at = (hours) => Date.parse(passedAt) + hours * HOUR;
  const lock = { verdict: 'pass', passedAt, maxAgeMs: 24 * HOUR, visualWorkers: 8 };

  test('validity uses the refusal boundary and warns in the last three hours', () => {
    assert.equal(SELFTEST_EXPIRY_WARNING_MS, 3 * HOUR);
    assert.deepEqual(selftestValidity(null), { status: 'missing' });
    assert.deepEqual(selftestValidity({ verdict: 'findings' }), { status: 'not-passed' });
    assert.deepEqual(selftestValidity(lock, at(1)), {
      status: 'valid', passedAt, expiresAt: '2026-10-05T00:00:00.000Z', maxAgeMs: 24 * HOUR, remainingMs: 23 * HOUR, visualWorkers: 8,
    });
    assert.equal(selftestValidity(lock, at(21)).status, 'valid');
    assert.equal(selftestValidity(lock, at(21) + 1).status, 'expiring');
    assert.equal(selftestValidity(lock, at(24)).status, 'expiring', 'age equal to maxAge is still accepted');
    assert.equal(selftestValidity(lock, at(24) + 1).status, 'expired');
    assert.equal(selftestValidity({ verdict: 'pass' }, at(0)).status, 'expired', 'a lock without passedAt never counts');

    assert.equal(selftestExpiryWarning(selftestValidity(lock, at(1))), null);
    const soon = selftestExpiryWarning(selftestValidity(lock, at(22)));
    assert.match(soon, /expires in 2h 0m \(at 2026-10-05T00:00:00\.000Z\)/);
    assert.match(soon, /t3u selftest-determinism --visual-workers 8" before it lapses/);
    assert.match(soon, /reproduces the same lock hash/);
    const late = selftestExpiryWarning(selftestValidity(lock, at(25)));
    assert.match(late, /expired at 2026-10-05T00:00:00\.000Z \(1h 0m ago\)/);
    assert.match(late, /reproduces the same lock hash/);
  });

  test('assertSelftestValid refuses on exactly the same boundary', async () => {
    const { paths } = await project('t3u-lock-age-');
    await writeFile(paths.selftestLock, JSON.stringify(lock));
    await assertSelftestValid(paths, () => at(24));
    await assert.rejects(assertSelftestValid(paths, () => at(24) + 1),
      (error) => error.exitCode === EXIT.INVALID && /older than 24h/.test(error.message));
  });

  test('graph-status prints the remaining validity and warns before and after expiry', async () => {
    const { paths } = await project('t3u-graph-status-');
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.graphDefinition, JSON.stringify({
      schema: 'typo3-upgrade-run/graph@1', resources: [], start: ['a'], terminal: ['a'], nodes: { a: { outcomes: ['pass'] } }, edges: [],
    }));
    await new StateStore(paths).write(emptyState({ runId: '2026-10-04-acme', now: new Date().toISOString() }));
    const quiet = recordingLog();
    await graphInit({ paths, values: {}, log: quiet.log });
    const status = async (hours) => {
      const { log, lines } = recordingLog();
      const result = await graphStatus({ paths, values: { json: true }, log, now: () => at(hours) });
      return { result, warnings: lines.warn ?? [] };
    };

    const none = await status(1);
    assert.equal(none.result.selftest.status, 'missing');
    assert.deepEqual(none.warnings, []);
    assert.equal(renderSelftestValidity(none.result.selftest), 'not run');

    await writeFile(paths.selftestLock, JSON.stringify(lock));
    const fresh = await status(1);
    assert.equal(fresh.result.exitCode, EXIT.PASS);
    assert.equal(fresh.result.selftest.remainingMs, 23 * HOUR);
    assert.deepEqual(fresh.warnings, []);
    assert.equal(renderSelftestValidity(fresh.result.selftest),
      'valid until 2026-10-05T00:00:00.000Z (23h 0m left; 8 visual worker(s))');

    const soon = await status(22.5);
    assert.equal(soon.result.selftest.status, 'expiring');
    assert.equal(soon.warnings.length, 1);
    assert.match(soon.warnings[0], /expires in 1h 30m/);
    assert.match(renderSelftestValidity(soon.result.selftest), /^EXPIRES SOON: 1h 30m left/);

    const expired = await status(30);
    assert.equal(expired.result.exitCode, EXIT.PASS, 'graph-status reports; it does not refuse');
    assert.equal(expired.result.selftest.status, 'expired');
    assert.match(expired.warnings[0], /expired at 2026-10-05T00:00:00\.000Z \(6h 0m ago\)/);
    assert.match(renderSelftestValidity(expired.result.selftest), /^EXPIRED at 2026-10-05T00:00:00\.000Z/);
  });
});
