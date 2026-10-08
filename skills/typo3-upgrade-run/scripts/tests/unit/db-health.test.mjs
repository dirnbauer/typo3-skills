import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHECK_ORDER, CHECK_RISK, EXIT, buildCuratedTransaction, defaultRunner, buildRecords, classifyGroups, compareInventories,
  exitForCheck, exitForCompare, ledgerKeysFrom, main, parseCheckOutput, parseSqlLog, recordsDocument, runApply, runProbe,
} from '../../db-health.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '../fixtures/db-health');
const fixture = (name) => readFile(path.join(FIXTURES, name), 'utf8');

test('the pinned check orders match the released tags and every check has a risk', () => {
  assert.equal(CHECK_ORDER['1.0.6'].length, 47, '46 active checks, SysFileReferenceDangling twice');
  assert.equal(CHECK_ORDER['2.2'].length, 49);
  assert.equal(CHECK_ORDER['1.0.6'].filter((c) => c === 'SysFileReferenceDangling').length, 2);
  for (const only of ['PagesTranslatedLanguageParentDuplicates', 'TcaTablesPidTranslatedPage', 'TcaTablesTranslatedLanguageParentDuplicates']) {
    assert.ok(CHECK_ORDER['2.2'].includes(only) && !CHECK_ORDER['1.0.6'].includes(only), only);
  }
  for (const name of new Set([...CHECK_ORDER['1.0.6'], ...CHECK_ORDER['2.2']])) assert.ok(CHECK_RISK[name], `${name} has a risk`);
});

test('a clean 2.2.0 run parses to 49 ok checks, exit 0 and a stable hash', async () => {
  const stdout = await fixture('check-clean-2.2.0.stdout.txt');
  const parsed = parseCheckOutput({ stdout, exitCode: 0, version: '2.2.0' });
  assert.equal(parsed.verdict, 'clean');
  assert.equal(parsed.complete, true);
  assert.equal(parsed.totals.ok, 49);
  assert.equal(parsed.totals.not_run, 0);
  assert.equal(exitForCheck(parsed), EXIT.PASS);
  assert.equal(parseCheckOutput({ stdout, exitCode: 0, version: '2.2.0' }).sha256, parsed.sha256);
  assert.match(parsed.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(parsed.checks.find((c) => c.class === 'TcaTablesTranslatedParentSelf').actions.includes('risky'), true);
});

test('findings carry sorted table counts per check and exit 1', async () => {
  const parsed = parseCheckOutput({ stdout: await fixture('check-findings-2.2.0.stdout.txt'), exitCode: 1, version: '2.2.0' });
  assert.equal(parsed.verdict, 'findings');
  assert.deepEqual(parsed.checks.filter((c) => c.status === 'affected').map((c) => [c.class, c.tables]), [
    ['TtContentPidMissing', { tt_content: 3 }],
    ['SysFileReferenceDangling', { sys_file_reference: 2, tt_content: 1 }],
  ]);
  assert.deepEqual(Object.keys(parsed.checks.find((c) => c.class === 'SysFileReferenceDangling').tables), ['sys_file_reference', 'tt_content']);
  assert.equal(parsed.totals.affected_rows, 6);
  assert.equal(exitForCheck(parsed), EXIT.FINDINGS);
});

test('exit 255 after a chained exception is a partial inventory with the remaining checks not run', async () => {
  const parsed = parseCheckOutput({ stdout: await fixture('check-partial-2.2.0.stdout.txt'),
    stderr: await fixture('check-partial-2.2.0.stderr.txt'), exitCode: 255, version: '2.2.0' });
  assert.equal(parsed.verdict, 'partial-findings');
  assert.equal(parsed.complete, false);
  assert.equal(parsed.aborted.class, 'TtContentPidDeleted');
  assert.equal(parsed.aborted.chained, true);
  assert.equal(parsed.aborted.line, 72);
  assert.equal(parsed.checks.find((c) => c.class === 'TtContentPidDeleted').status, 'aborted');
  const notRun = parsed.checks.filter((c) => c.status === 'not-run').map((c) => c.class);
  assert.equal(notRun[0], 'TtContentDeletedLocalizedParentExists');
  assert.equal(notRun.length, CHECK_ORDER['2.2'].length - CHECK_ORDER['2.2'].indexOf('TtContentPidDeleted') - 1);
  assert.equal(parsed.totals.not_run, CHECK_ORDER['2.2'].length - parsed.totals.checks_run);
  assert.equal(exitForCheck(parsed), EXIT.FINDINGS);
  const crash = parseCheckOutput({ stdout: '', stderr: 'In RecordsHelper.php line 105:\n  Delete query had "0" affected rows', exitCode: 255, version: '2.2.0' });
  assert.equal(crash.verdict, 'crashed');
  const caught = parseCheckOutput({ stdout: ' Class: TtContentLocalizedParentSoftDeleted\n', exitCode: 255, version: '2.2.0',
    stderr: 'In TtContentLocalizedParentSoftDeleted.php line 70:\n  Should have been caught by previous TtContentLocalizedParentExists already' });
  assert.equal(caught.verdict, 'partial-findings', 'the second wording of a chained abort');
  assert.equal(exitForCheck(crash), EXIT.HARNESS_ERROR);
});

test('exit 4 is a schema precondition; exit 124 is a timeout; an unknown version cannot list not-run checks', async () => {
  const schema = parseCheckOutput({ stdout: await fixture('check-schema.stdout.txt'), exitCode: 4, version: '1.0.6' });
  assert.equal(schema.verdict, 'precondition');
  assert.equal(schema.precondition.kind, 'schema');
  assert.equal(exitForCheck(schema), EXIT.PRECONDITION);
  const timeout = parseCheckOutput({ stdout: ' Class: PagesBrokenTree\n', exitCode: 124, version: '2.2.0' });
  assert.equal(timeout.verdict, 'timeout');
  assert.equal(timeout.checks[0].status, 'timed-out');
  assert.equal(exitForCheck(timeout), EXIT.HARNESS_ERROR);
  const unknown = parseCheckOutput({ stdout: await fixture('check-clean-2.2.0.stdout.txt'), exitCode: 0, version: '2.3.0' });
  assert.equal(unknown.tool.order_known, false);
  assert.equal(unknown.totals.not_run, null);
  assert.equal(parseCheckOutput({ stdout: '', exitCode: 1, version: '2.2.0' }).verdict, 'unparseable');
});

test('the SQL log becomes sorted (check, table, uid, action) records with risk-based proposals', async () => {
  const one = parseSqlLog(await fixture('pass1.sql'), { file: 'pass1.sql' });
  const two = parseSqlLog(await fixture('pass2.sql'), { file: 'pass2.sql' });
  assert.deepEqual([...one.unparsed, ...two.unparsed], []);
  const records = buildRecords([...one.statements, ...two.statements]);
  assert.deepEqual(records.map((r) => `${r.check}|${r.table}|${r.uid}|${r.actions.join('+')}`), [
    'InlineForeignFieldChildrenParentLanguageDifferent|sys_file_reference|502|update',
    'SysFileReferenceDangling|sys_file_reference|501|delete',
    'TcaTablesPidTranslatedPage|tx_news_domain_model_news|3|update',
    'TcaTablesTranslatedWithAllowLanguageSynchronization|tt_content|91|update',
    'TtContentLocalizedDuplicates|tt_content|90|soft-delete',
    'TtContentPidMissing|tt_content|12|delete',
    'TtContentPidMissing|tt_content|4711|delete',
  ]);
  assert.deepEqual(records.find((r) => r.uid === 91).fields, { l10n_state: '{"header":"custom","bodytext":"parent"}' });
  const legacy = Object.fromEntries(classifyGroups(records, { version: '1.0.6' }).map((g) => [g.check, g.proposal]));
  assert.equal(legacy.InlineForeignFieldChildrenParentLanguageDifferent, 'do-not-fix-with-1.0.6');
  assert.equal(legacy.TtContentLocalizedDuplicates, 'owner-decision');
  assert.equal(legacy.TcaTablesTranslatedWithAllowLanguageSynchronization, 'fix-candidate');
  const current = Object.fromEntries(classifyGroups(records, { version: '2.2.0' }).map((g) => [g.check, g.proposal]));
  assert.equal(current.InlineForeignFieldChildrenParentLanguageDifferent, 'owner-decision');
  const doc = recordsDocument({ passes: [], statements: [...two.statements, ...one.statements], unparsed: [], version: '2.2.0' });
  assert.equal(doc.sha256, recordsDocument({ passes: [], statements: [...one.statements, ...two.statements], unparsed: [], version: '2.2.0' }).sha256);
});

test('compare: new is a migration defect, unchanged a residual, vanished must be ledgered, target-only needs Baseline A', () => {
  const rec = (check, table, uid) => ({ check, table, uid, actions: ['delete'], fields: {} });
  const intake = { tool: { version: '1.0.6' }, sha256: 'sha256:a', records: [
    rec('TtContentPidMissing', 'tt_content', 1), rec('TtContentPidMissing', 'tt_content', 2), rec('PagesBrokenTree', 'pages', 9)] };
  const target = { tool: { version: '2.2.0' }, sha256: 'sha256:b', records: [
    rec('TtContentPidMissing', 'tt_content', 1), rec('SysFileReferenceDangling', 'sys_file_reference', 7),
    rec('TcaTablesPidTranslatedPage', 'tt_content', 30)] };
  const result = compareInventories(intake, target, { ledgerKeys: ['PagesBrokenTree|pages|9'] });
  assert.deepEqual(result.new.map((r) => r.key), ['SysFileReferenceDangling|sys_file_reference|7']);
  assert.deepEqual(result.unchanged.map((r) => r.key), ['TtContentPidMissing|tt_content|1']);
  assert.deepEqual(result.vanished.map((r) => [r.key, r.ledgered]), [['PagesBrokenTree|pages|9', true], ['TtContentPidMissing|tt_content|2', false]]);
  assert.deepEqual(result.target_only.map((r) => r.key), ['TcaTablesPidTranslatedPage|tt_content|30']);
  assert.ok(result.target_only_checks.includes('TcaTablesPidTranslatedPage'));
  assert.equal(exitForCompare(result), EXIT.FINDINGS);
  const clean = compareInventories(intake, { ...target, records: [rec('TtContentPidMissing', 'tt_content', 1),
    rec('TcaTablesPidTranslatedPage', 'tt_content', 30)] }, { preExisting: ['TcaTablesPidTranslatedPage|tt_content|30'] });
  assert.equal(exitForCompare(clean), EXIT.PASS);
  assert.equal(exitForCompare(clean, { requireLedgered: true }), EXIT.FINDINGS, 'two vanished entries are not ledgered');
  assert.deepEqual(ledgerKeysFrom({ declared_transitions: [{ db_health_resolved: ['a|b|1'] }, { id: 'x' }] }), ['a|b|1']);
  const noIntake = compareInventories(null, target);
  assert.equal(noIntake.counts.target_only, 3, 'without an intake inventory every target finding needs a Baseline A lookup');
});

test('a curated replay refuses statements that are not single-row dbdoctor statements', async () => {
  const refused = buildCuratedTransaction(await fixture('curated-unsafe.sql'));
  assert.deepEqual(refused.refused.map((r) => r.line), [3, 4]);
  assert.equal(refused.sql, null);
  const ok = buildCuratedTransaction(await fixture('pass1.sql'));
  assert.deepEqual(ok.refused, []);
  assert.match(ok.sql, /^START TRANSACTION;\n[\s\S]*\nCOMMIT;\n$/);
  assert.equal(buildCuratedTransaction('DELETE FROM `tt_content` WHERE `uid` = 1;').refused.length, 1, 'no check header');
});

function fakeDdev({ checks = [], executeExit = 1, restoreExit = 0, sql = {}, snapshots = '' } = {}) {
  const calls = [];
  let checkIndex = 0;
  const run = async (cmd, args, options = {}) => {
    calls.push([cmd, ...args].join(' '));
    if (args[0] === 'snapshot' && args[1] === '--name') return { code: 0, stdout: 'Created snapshot', stderr: '' };
    if (args[0] === 'snapshot' && args[1] === '--list') return { code: 0, stdout: snapshots, stderr: '' };
    if (args[0] === 'snapshot' && args[1] === 'restore') return { code: restoreExit, stdout: '', stderr: '' };
    if (args[0] === 'exec' && args[1] === 'cat') {
      const pass = args[2].match(/pass(\d+)\.sql$/)[1];
      return sql[pass] === undefined ? { code: 1, stdout: '', stderr: 'No such file' } : { code: 0, stdout: sql[pass], stderr: '' };
    }
    if (args[0] === 'exec' && /--mode=execute/.test(args.at(-1))) return { code: executeExit, stdout: 'executed', stderr: '' };
    if (args[0] === 'exec' && /--mode=check/.test(args.at(-1))) {
      const next = checks[Math.min(checkIndex++, checks.length - 1)];
      return { code: next.exit, stdout: next.stdout, stderr: next.stderr ?? '' };
    }
    if (args[0] === 'mysql') return { code: 0, stdout: '', stderr: '', input: options.input };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
}

test('the probe loops until check is clean, always restores, and proves the restore', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 't3u-db-health-'));
  try {
    const clean = await fixture('check-clean-2.2.0.stdout.txt');
    const findings = await fixture('check-findings-2.2.0.stdout.txt');
    const { run, calls } = fakeDdev({ checks: [{ exit: 1, stdout: findings }, { exit: 0, stdout: clean }],
      sql: { 1: await fixture('pass1.sql'), 2: await fixture('pass2.sql') } });
    const same = { fingerprintHash: 'sha256:f0', database: { tables: [{ table: 'tt_content', rowHash: 'x', rowCount: 1 }] }, files: { treeHash: 'n' } };
    const result = await runProbe({ run, cwd: out, out, version: '2.2.0', snapshotName: 'dbdoctor-probe-1', fingerprint: async () => same });
    assert.equal(result.exitCode, EXIT.FINDINGS);
    assert.equal(result.probe.converged, true);
    assert.equal(result.probe.restored, true);
    assert.equal(result.document.passes_run, 2);
    assert.equal(result.document.records.length, 7);
    assert.ok(calls.indexOf('ddev snapshot --name dbdoctor-probe-1') < calls.findIndex((c) => /--mode=execute/.test(c)));
    assert.equal(calls.at(-1), 'ddev snapshot restore dbdoctor-probe-1');
    assert.ok(calls.some((c) => /--file='\/var\/www\/html\/\.dbdoctor\/dbdoctor-probe-1-pass1\.sql'/.test(c)));
    assert.equal(JSON.parse(await readFile(path.join(out, 'records.json'), 'utf8')).sha256, result.document.sha256);

    let n = 0;
    const drift = async () => ({ ...same, database: { tables: [{ table: 'tt_content', rowHash: n++ ? 'changed' : 'x', rowCount: 1 }] } });
    const failed = await runProbe({ run: fakeDdev({ checks: [{ exit: 0, stdout: clean }], sql: { 1: '' } }).run, cwd: out,
      out: path.join(out, 'drift'), version: '2.2.0', snapshotName: 'dbdoctor-probe-2', fingerprint: drift });
    assert.equal(failed.exitCode, EXIT.INVALID, 'an unproven restore voids the run');

    const never = await runProbe({ run: fakeDdev({ checks: [{ exit: 1, stdout: findings }], sql: { 1: await fixture('pass1.sql') } }).run,
      cwd: out, out: path.join(out, 'never'), version: '2.2.0', snapshotName: 'dbdoctor-probe-3', maxPasses: 2, fingerprint: async () => same });
    assert.equal(never.probe.converged, false);
    assert.equal(never.exitCode, EXIT.FINDINGS);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('apply refuses without approval or snapshot and replays one transaction with refindex and re-check', async () => {
  const out = await mkdtemp(path.join(os.tmpdir(), 't3u-db-apply-'));
  try {
    const sqlText = await fixture('pass1.sql');
    const fp = async () => ({ fingerprintHash: 'sha256:f' });
    const clean = await fixture('check-clean-2.2.0.stdout.txt');
    const noApproval = await runApply({ run: fakeDdev().run, cwd: out, sqlText, snapshot: 's1', out, version: '2.2.0', fingerprint: fp });
    assert.equal(noApproval.exitCode, EXIT.POLICY);
    const unsafe = await runApply({ run: fakeDdev().run, cwd: out, sqlText: await fixture('curated-unsafe.sql'), approval: 'APR-007',
      snapshot: 's1', out, version: '2.2.0', fingerprint: fp });
    assert.equal(unsafe.exitCode, EXIT.POLICY);
    const noSnapshot = await runApply({ run: fakeDdev({ snapshots: 'other' }).run, cwd: out, sqlText, approval: 'APR-007',
      snapshot: 's1', out, version: '2.2.0', fingerprint: fp });
    assert.equal(noSnapshot.exitCode, EXIT.PRECONDITION);
    const { run, calls } = fakeDdev({ snapshots: 'other s1', checks: [{ exit: 0, stdout: clean }] });
    const applied = await runApply({ run, cwd: out, sqlText, approval: 'APR-007', snapshot: 's1', out, version: '2.2.0', fingerprint: fp });
    assert.equal(applied.exitCode, EXIT.PASS);
    assert.deepEqual(applied.record.statements_per_check, { TcaTablesPidTranslatedPage: 1, TtContentLocalizedDuplicates: 1, TtContentPidMissing: 2 });
    assert.deepEqual(calls.slice(-4).map((c) => c.split(' ').slice(0, 4).join(' ')),
      ['ddev mysql', 'ddev exec vendor/bin/typo3 referenceindex:update', 'ddev exec vendor/bin/typo3 cache:flush', 'ddev exec bash -c']);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

test('the CLI parses saved output with the harness exit codes', async () => {
  const quiet = () => {};
  const dir = await mkdtemp(path.join(os.tmpdir(), 't3u-db-health-cli-'));
  try {
    assert.equal(await main(['parse-check', '--stdout', path.join(FIXTURES, 'check-schema.stdout.txt'), '--exit', '4',
      '--version', '1.0.6', '--json', path.join(dir, 'check.json')], { stderr: quiet }), EXIT.PRECONDITION);
    assert.equal(await main(['parse-sql', '--sql', path.join(FIXTURES, 'pass1.sql'), '--json',
      path.join(dir, 'records.json')], { stderr: quiet }), EXIT.FINDINGS);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'records.json'), 'utf8')).totals.records, 4);
    await assert.rejects(main(['check', '--out', 'x'], { stderr: quiet }), (error) => error.exitCode === EXIT.PRECONDITION);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** A fake child process that emits the given stdout/stderr byte chunks, then closes with code 0. */
function chunkedSpawn({ stdout = [], stderr = [] }) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end() {} };
    child.kill = () => {};
    setImmediate(() => {
      for (const chunk of stdout) child.stdout.emit('data', chunk);
      for (const chunk of stderr) child.stderr.emit('data', chunk);
      child.emit('close', 0, null);
    });
    return child;
  };
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

test('defaultRunner decodes a multibyte character split across two chunks, so the fingerprint is stable', async () => {
  const text = 'uid\ttitle\n1\tGrüße 🚀 Ölfass\n';
  const bytes = Buffer.from(text, 'utf8');
  const umlaut = bytes.indexOf(Buffer.from('ü', 'utf8'));
  const rocket = bytes.indexOf(Buffer.from('🚀', 'utf8'));
  const hashes = new Set();
  // Split inside the 2-byte ü, inside the 4-byte emoji, and at every byte position.
  for (const cut of [umlaut + 1, rocket + 1, rocket + 2, rocket + 3, ...Array.from({ length: bytes.length - 1 }, (_, i) => i + 1)]) {
    const result = await defaultRunner('ddev', ['mysql'], {
      spawnFn: chunkedSpawn({ stdout: [bytes.subarray(0, cut), bytes.subarray(cut)], stderr: [bytes.subarray(0, cut), bytes.subarray(cut)] }),
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, text, `stdout split at byte ${cut}`);
    assert.equal(result.stderr, text, `stderr split at byte ${cut}`);
    assert.ok(!result.stdout.includes('\uFFFD'), 'no replacement character');
    hashes.add(sha256(result.stdout));
  }
  assert.deepEqual([...hashes], [sha256(text)], 'one hash, whatever the chunk boundary');
});

test('defaultRunner decodes a real child process whose multibyte output arrives in two writes', async () => {
  const script = "const b = Buffer.from('Grüße', 'utf8'); process.stdout.write(b.subarray(0, 3));"
    + ' setTimeout(() => process.stdout.write(b.subarray(3)), 50);';
  const result = await defaultRunner(process.execPath, ['-e', script], { timeoutMs: 10_000 });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'Grüße');
  assert.equal(sha256(result.stdout), sha256('Grüße'));
});
