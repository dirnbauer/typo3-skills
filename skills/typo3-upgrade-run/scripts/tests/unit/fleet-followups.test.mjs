import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECLARED_CHANGES_SCHEMA, validateDeclaredChanges, wholeDocumentRuleFor } from '../../lib/compare/declared-changes.mjs';
import { approvalRecord } from '../../lib/actions/lifecycle.mjs';
import { readCredentials } from '../../lib/actions/sweep.mjs';
import { RunPaths } from '../../lib/run/paths.mjs';
import { StateStore, emptyState } from '../../lib/run/state.mjs';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../lib');
const tmp = () => mkdtemp(path.join(tmpdir(), 't3u-followups-'));
const log = new Proxy({}, { get: () => () => {} });
const journal = { append: async () => {} };

test('declared changes: only a URL-scoped whole-document rule can declare a page screenshot', () => {
  const { rules } = validateDeclaredChanges({
    schema: DECLARED_CHANGES_SCHEMA,
    changes: [
      { id: 'DC-001', approval_ref: 'APR-010', stage: 'dom', before: '<meta a>', after: '<meta b>', reason: 'TYPO3 13 head markup change' },
      { id: 'DC-009', approval_ref: 'APR-010', stage: 'dom', whole_document: true, url: '/sitemap\\.xml$', reason: 'Core exception page on a page broken before the upgrade' },
    ],
  }, new Set(['APR-010']));
  assert.equal(wholeDocumentRuleFor(rules, 'https://demo.ddev.site/sitemap.xml')?.id, 'DC-009');
  assert.equal(wholeDocumentRuleFor(rules, 'https://demo.ddev.site/'), null, 'a text rule never declares pixels');
  assert.equal(wholeDocumentRuleFor(rules, null), null);
});

test('compare-visual classifies through wholeDocumentRuleFor and judges its verdict by blocking findings', async () => {
  const source = await readFile(path.join(LIB, 'actions/compare.mjs'), 'utf8');
  const visual = source.slice(source.indexOf('export async function compareVisual'), source.indexOf('export async function compareAll'));
  assert.match(visual, /wholeDocumentRuleFor\(wholeDocumentRules, pageUrl\)/);
  assert.match(visual, /class: 'declared-change'/);
  assert.match(visual, /findings\.some\(isBlocking\)/);
});

async function runPaths() {
  const dir = await tmp();
  const paths = new RunPaths('.typo3-update', dir);
  await mkdir(paths.root, { recursive: true });
  await new StateStore(paths).write(emptyState({ runId: '2026-09-28-demo', now: '2026-09-28T00:00:00Z' }));
  return paths;
}

test('approval: refuses --dry-run instead of writing a granted record', async () => {
  const paths = await runPaths();
  await assert.rejects(() => approvalRecord({
    values: { id: 'APR-001', stage: 'intent', scope: 'test', question: 'q?', answer: 'a', granted: true, 'dry-run': true },
    paths, log, journal,
  }), /no --dry-run/);
  assert.deepEqual(await readdir(paths.approvalsDir).catch(() => []), []);
  assert.deepEqual((await new StateStore(paths).read()).approvals, []);
});

test('approval: a long scope gets a bounded file name and keeps the full scope; an id cannot be recorded twice', async () => {
  const paths = await runPaths();
  const scope = `rule 30.8: ${'declare the TYPO3 core-mandated output classes listed in the question '.repeat(8)}`;
  await approvalRecord({ values: { id: 'APR-010', stage: 'intent', scope, question: 'May I?', answer: 'Yes', granted: true }, paths, log, journal });
  const [file] = await readdir(paths.approvalsDir);
  assert.ok(file.length <= 110, `file name stays short (${file.length})`);
  assert.match(file, /^APR-010-intent-rule-30-8-declare/);
  assert.ok((await readFile(path.join(paths.approvalsDir, file), 'utf8')).includes(scope.trim()));
  await assert.rejects(() => approvalRecord({
    values: { id: 'APR-010', stage: 'intent', scope: 'other', question: 'q?', answer: 'a', granted: true }, paths, log, journal,
  }), /already recorded/);
});

test('backend-sweep credentials: an explicit file is honoured, otherwise the environment', async () => {
  const dir = await tmp();
  const file = path.join(dir, 'editor.env');
  await writeFile(file, '# test editor\nBE_USER = t3u-editor\nBE_PASSWORD=s3cret=with=equals\n');
  assert.deepEqual(await readCredentials({ 'credentials-from': file }), { user: 't3u-editor', password: 's3cret=with=equals' });
  await assert.rejects(() => readCredentials({ 'credentials-from': path.join(dir, 'missing') }), /Cannot read --credentials-from: ENOENT/);
  const saved = { user: process.env.BE_USER, password: process.env.BE_PASSWORD };
  process.env.BE_USER = 'env-user'; process.env.BE_PASSWORD = 'env-pass';
  try { assert.deepEqual(await readCredentials({}), { user: 'env-user', password: 'env-pass' }); }
  finally {
    if (saved.user === undefined) delete process.env.BE_USER; else process.env.BE_USER = saved.user;
    if (saved.password === undefined) delete process.env.BE_PASSWORD; else process.env.BE_PASSWORD = saved.password;
  }
});
