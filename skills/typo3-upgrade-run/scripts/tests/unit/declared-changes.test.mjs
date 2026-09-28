import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DECLARED_CHANGES_SCHEMA, applyDomRules, declaredChangesHash, declaredFields, loadDeclaredChanges, splitHttpDifferences,
  validateDeclaredChanges,
} from '../../lib/compare/declared-changes.mjs';
import { compareDom } from '../../lib/compare/dom-normalize.mjs';
import { isBlocking, loopVerdict } from '../../lib/compare/classify.mjs';
import { EVENTS, Journal } from '../../lib/run/journal.mjs';
import { captureRoot } from '../../lib/actions/compare.mjs';

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../lib');

const CACHE_RULE = {
  id: 'DC-001', approval_ref: 'APR-008', stage: 'http', field: 'header:cache-control',
  before: '^max-age=0$', after: '^private, no-store, max-age=0$',
  reason: 'TYPO3 13 sends Cache-Control: private, no-store by default',
};
const CHARSET_RULE = {
  id: 'DC-002', approval_ref: 'APR-008', stage: 'dom',
  before: '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"\\s*/?>',
  after: '<meta charset="utf-8"/>',
  reason: 'TYPO3 13 page template always renders <meta charset>',
};
const doc = (...changes) => ({ schema: DECLARED_CHANGES_SCHEMA, changes });

test('declared changes: only rules backed by a granted user approval are usable', () => {
  const { rules, issues } = validateDeclaredChanges(
    doc(CACHE_RULE, CHARSET_RULE, { ...CACHE_RULE, id: 'DC-003', approval_ref: 'APR-099' }),
    new Set(['APR-008']),
  );
  assert.deepEqual(rules.map((rule) => rule.id), ['DC-001', 'DC-002']);
  assert.equal(issues.length, 1);
  assert.match(issues[0], /DC-003: approval APR-099 is not a granted user approval/);
});

test('declared changes: malformed rules are refused, never applied', () => {
  const granted = new Set(['APR-008']);
  assert.match(validateDeclaredChanges({ changes: [] }, granted).issues[0], /schema/);
  const { rules, issues } = validateDeclaredChanges(doc(
    { ...CACHE_RULE, before: '(' },
    { ...CACHE_RULE, id: 'DC-004', stage: 'visual' },
    { ...CHARSET_RULE, id: 'DC-005', reason: 'short' },
    CACHE_RULE,
    { ...CACHE_RULE },
  ), granted);
  assert.deepEqual(rules.map((rule) => rule.id), ['DC-001']);
  assert.equal(issues.length, 4);
  assert.ok(issues.some((issue) => /not a valid regular expression/.test(issue)));
  assert.ok(issues.some((issue) => /stage must be one of http, dom/.test(issue)));
  assert.ok(issues.some((issue) => /reason must explain/.test(issue)));
  assert.ok(issues.some((issue) => /duplicated/.test(issue)));
});

test('declared changes: an HTTP difference is explained only when field, before and after match', () => {
  const { rules } = validateDeclaredChanges(doc(CACHE_RULE, {
    id: 'DC-006', approval_ref: 'APR-008', stage: 'http', field: 'twitter',
    before: '^\\{"card":"summary"\\}$', after: '^\\{\\}$', url: '/sitemap/$',
    reason: 'EXT:seo 13 renders twitter:card only with Twitter data',
  }), new Set(['APR-008']));
  const differences = [
    { field: 'header:cache-control', before: 'max-age=0', after: 'private, no-store, max-age=0' },
    { field: 'twitter', before: { card: 'summary' }, after: {} },
    { field: 'htmlLang', before: 'de', after: 'de-DE' },
  ];
  const onSitemap = splitHttpDifferences(differences, rules, 'https://demo.ddev.site/sitemap/');
  assert.deepEqual(onSitemap.declared.map((d) => d.declared_change), ['DC-001', 'DC-006']);
  assert.deepEqual(onSitemap.residual.map((d) => d.field), ['htmlLang']);
  const elsewhere = splitHttpDifferences(differences, rules, 'https://demo.ddev.site/impressum/');
  assert.deepEqual(elsewhere.residual.map((d) => d.field), ['twitter', 'htmlLang']);
  const otherValue = splitHttpDifferences(
    [{ field: 'header:cache-control', before: 'max-age=0', after: 'public, max-age=600' }], rules, null,
  );
  assert.equal(otherValue.declared.length, 0, 'a different after-value is not the approved class');
});

test('declared changes: a DOM finding is declared only when the rules explain every segment', () => {
  const { rules } = validateDeclaredChanges(doc(CHARSET_RULE), new Set(['APR-008']));
  const before = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><title>A</title></head><body><p>Same</p></body></html>';
  const after = '<html><head><meta charset="utf-8"/><title>A</title></head><body><p>Same</p></body></html>';
  const transformBefore = (text) => applyDomRules(text, rules, null);

  const explained = compareDom(before, after, { transformBefore });
  assert.equal(explained.identical, false);
  assert.equal(explained.explained, true);
  assert.deepEqual(explained.declared.map((rule) => rule.id), ['DC-002']);
  assert.ok(explained.segments.length > 0, 'the raw difference stays visible in the finding');
  assert.deepEqual(declaredFields(explained.declared), {
    approval_ref: 'APR-008', declared_changes: [{ id: 'DC-002', approval_ref: 'APR-008' }],
  });

  const partly = compareDom(before, after.replace('<p>Same</p>', '<p>Other</p>'), { transformBefore });
  assert.equal(partly.explained, false);
  assert.ok(partly.segments.some((s) => s.after.includes('Other')), 'residual segments show the unexplained change');
  assert.ok(!partly.segments.some((s) => s.before.includes('http-equiv')), 'declared parts are not reported again');

  const unrelated = compareDom(before.replace('http-equiv', 'name'), after, { transformBefore });
  assert.equal(unrelated.explained, false);
  assert.deepEqual(unrelated.declared, []);
});

test('declared changes: approved declared findings do not block, unapproved ones do', () => {
  const declared = { id: 'F-100-001', class: 'declared-change', approval_ref: 'APR-008', status: 'open' };
  const unapproved = { id: 'F-100-002', class: 'declared-change', status: 'open' };
  assert.equal(isBlocking(declared), false);
  assert.equal(isBlocking(unapproved), true);
  const verdict = loopVerdict([declared]);
  assert.equal(verdict.verdict, 'green');
  assert.deepEqual(verdict.residual, ['F-100-001']);
});

test('declared changes: loading checks the approval record and state, and hashes the file', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 't3u-declared-'));
  try {
    mkdirSync(path.join(root, 'approvals'));
    mkdirSync(path.join(root, 'decisions'));
    const approval = (id, grantedAt) => `---\nid: "${id}"\nstage: "intent"\ngranted_at: ${grantedAt}\ngranted_by: "user"\n---\n\n# ${id}\n`;
    writeFileSync(path.join(root, 'approvals', 'APR-008-intent-core-changes.md'), approval('APR-008', '"2026-09-28T14:00:00.000Z"'));
    writeFileSync(path.join(root, 'approvals', 'APR-009-intent-declined.md'), approval('APR-009', 'null'));
    writeFileSync(path.join(root, 'decisions', 'declared-changes.json'),
      JSON.stringify(doc(CACHE_RULE, { ...CHARSET_RULE, approval_ref: 'APR-009' })));
    const paths = { root, approvalsDir: path.join(root, 'approvals') };
    const loaded = await loadDeclaredChanges(paths, { approvals: ['APR-008', 'APR-009'] });
    assert.deepEqual(loaded.rules.map((rule) => rule.id), ['DC-001']);
    assert.match(loaded.issues[0], /APR-009 is not a granted user approval/);
    assert.match(loaded.hash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(await declaredChangesHash(root), loaded.hash, 'the evidence input hashes the same bytes');
    assert.equal(await declaredChangesHash(path.join(root, 'none')), null);
    const unknownToState = await loadDeclaredChanges(paths, { approvals: [] });
    assert.equal(unknownToState.rules.length, 0);
    assert.deepEqual(await loadDeclaredChanges({ root: path.join(root, 'none'), approvalsDir: root }, {}),
      { rules: [], hash: null, issues: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('journal: every event the harness appends is an allowed event', async () => {
  const used = new Set();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.mjs')) {
        for (const match of readFileSync(file, 'utf8').matchAll(/journal\??\.append\('([a-z-]+)'/g)) used.add(match[1]);
      }
    }
  };
  walk(LIB);
  assert.ok(used.has('content-transition'));
  assert.deepEqual([...used].filter((event) => !EVENTS.includes(event)), []);
  const root = mkdtempSync(path.join(os.tmpdir(), 't3u-journal-'));
  try {
    const journal = new Journal(path.join(root, 'journal.jsonl'));
    await journal.append('content-transition', { source: 'sha256:a', target: 'sha256:b' });
    assert.match(readFileSync(path.join(root, 'journal.jsonl'), 'utf8'), /"event":"content-transition"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('compare-all: bare labels resolve to the sealed baseline or a capture directory', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 't3u-labels-'));
  try {
    mkdirSync(path.join(root, 'baseline', 'A-original'), { recursive: true });
    mkdirSync(path.join(root, 'captures', 'rung13-a1'), { recursive: true });
    const paths = { root, baseline: (id) => path.join(root, 'baseline', id) };
    assert.equal(await captureRoot(paths, 'A-original', 'fallback'), path.join(root, 'baseline', 'A-original'));
    assert.equal(await captureRoot(paths, 'rung13-a1', 'fallback'), path.join(root, 'captures', 'rung13-a1'));
    assert.equal(await captureRoot(paths, undefined, 'fallback'), 'fallback');
    assert.equal(await captureRoot(paths, 'nope', 'fallback'), 'nope');
    assert.equal(await captureRoot(paths, path.join(root, 'captures'), 'fallback'), path.join(root, 'captures'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('declared changes: a whole-document rule needs a URL scope and declares only that document', () => {
  const rule = {
    id: 'DC-007', approval_ref: 'APR-008', stage: 'dom', whole_document: true, url: '/sitemap\\.xml$',
    reason: 'Core exception template on the pre-existing HTTP 500 of /sitemap.xml',
  };
  const unscoped = validateDeclaredChanges(doc({ ...rule, url: undefined }), new Set(['APR-008']));
  assert.match(unscoped.issues[0], /whole_document rules must be scoped with url/);
  const { rules } = validateDeclaredChanges(doc(rule), new Set(['APR-008']));
  const before = '<html><body><div class="callout">Old core error</div></body></html>';
  const after = '<html><body><div class="callout"><div class="callout-content">New core error</div></div></body></html>';
  const scoped = compareDom(before, after, { transformBefore: (text) => applyDomRules(text, rules, 'https://demo.ddev.site/sitemap.xml') });
  assert.equal(scoped.explained, true);
  assert.deepEqual(scoped.declared.map((r) => r.id), ['DC-007']);
  const other = compareDom(before, after, { transformBefore: (text) => applyDomRules(text, rules, 'https://demo.ddev.site/') });
  assert.equal(other.explained, false);
});

test('declared changes: a DOM rule does not apply where the new document keeps the old form', () => {
  const { rules } = validateDeclaredChanges(doc(CHARSET_RULE, {
    id: 'DC-008', approval_ref: 'APR-008', stage: 'dom', before: '<meta name="twitter:card" content="summary" ?/>', after: '',
    reason: 'EXT:seo 13 renders twitter:card only when the page has Twitter data',
  }), new Set(['APR-008']));
  const before = '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8" /><meta name="twitter:card" content="summary" /></head><body></body></html>';
  const keeps = '<html><head><meta charset="utf-8"/><meta name="twitter:card" content="summary" /></head><body></body></html>';
  const drops = '<html><head><meta charset="utf-8"/></head><body></body></html>';
  const transformBefore = (text, afterText) => applyDomRules(text, rules, null, afterText);
  const kept = compareDom(before, keeps, { transformBefore });
  assert.equal(kept.explained, true);
  assert.deepEqual(kept.declared.map((rule) => rule.id), ['DC-002']);
  const dropped = compareDom(before, drops, { transformBefore });
  assert.equal(dropped.explained, true);
  assert.deepEqual(dropped.declared.map((rule) => rule.id), ['DC-002', 'DC-008']);
});
