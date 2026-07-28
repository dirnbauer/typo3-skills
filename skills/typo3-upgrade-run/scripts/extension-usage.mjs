#!/usr/bin/env node
/**
 * Extension inventory with USAGE EVIDENCE.
 *
 * `composer why-not` finds the extensions that block the target. It says nothing about
 * the ones that upgrade cleanly and nobody uses — and those are the expensive ones,
 * because they get migrated, tested, forked and carried forward forever without anyone
 * asking whether the site needs them.
 *
 * Removing beats migrating, and it beats forking by a wide margin. But "unused" has to
 * be a measurement, not an impression: this counts the records, the content elements and
 * the plugin instances belonging to each extension, and reports the number.
 *
 * It does NOT decide anything. An extension with zero records may be genuinely dead, or
 * may be a library another package depends on, or may power something that stores
 * nothing (a middleware, a link handler, a scheduler task). The `requiredBy` column and
 * a human are what separate those.
 *
 * Read-only.
 *
 * Usage:
 *   node extension-usage.mjs --ddev-dir /path/to/project [--report out.json]
 *
 * Exit: 0 always — this is an inventory, not a gate.
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};
const ddevDir = opt('ddev-dir', process.cwd());
const reportPath = opt('report');

const sql = (q) => {
  try {
    return execFileSync('ddev', ['mysql', '-N', '-e', q], {
      cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return ''; }
};
const num = (q) => Number(sql(q) || 0);

const composerPath = join(ddevDir, 'composer.json');
if (!existsSync(composerPath)) { console.error('no composer.json'); process.exit(3); }
const composer = JSON.parse(readFileSync(composerPath, 'utf8'));

// typo3/cms-* are Core subpackages: they are not decisions, they come with the version.
const isCore = (n) => n.startsWith('typo3/cms-') || n === 'typo3/cms';
const require_ = composer.require ?? {};
const requireDev = composer['require-dev'] ?? {};

// Extension key: the vendor directory's composer.json knows it; fall back to the name.
const extKeyOf = (pkg) => {
  const p = join(ddevDir, 'vendor', pkg, 'composer.json');
  if (existsSync(p)) {
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      const k = j.extra?.['typo3/cms']?.['extension-key'];
      if (k) return k;
    } catch { /* fall through */ }
  }
  const local = ['packages', 'extensions'].map((d) => join(ddevDir, d));
  for (const base of local) {
    if (!existsSync(base)) continue;
    const guess = pkg.split('/')[1]?.replace(/-/g, '_');
    if (guess && existsSync(join(base, guess))) return guess;
  }
  return pkg.split('/')[1]?.replace(/-/g, '_') ?? pkg;
};

// Tables belonging to an extension, by TYPO3's own naming convention.
const tablesFor = (key) => sql(
  `SELECT table_name FROM information_schema.tables
   WHERE table_schema = DATABASE() AND table_name LIKE 'tx_${key}\\_%';`,
).split('\n').filter(Boolean);

const rowsIn = (t) => num(`SELECT COUNT(*) FROM \`${t}\`
  WHERE ${sql(`SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='${t}' AND column_name='deleted';`) === '1'
    ? 'deleted = 0' : '1=1'};`);

// Columns an extension ADDS TO EXISTING TABLES. Extensions of this shape own no table
// and register no CType, so counting only tx_<key>_* tables reports them as unused while
// the site depends on them — a false "remove me" on something load-bearing.
const extendedColumnUsage = (key) => {
  const cols = sql(`SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = DATABASE() AND column_name LIKE 'tx_${key}\\_%';`)
    .split('\n').filter(Boolean).map((l) => l.split('\t'));
  let filled = 0;
  const seen = [];
  for (const [tbl, col] of cols) {
    if (!tbl || !col) continue;
    const n = num(`SELECT COUNT(*) FROM \`${tbl}\`
      WHERE \`${col}\` IS NOT NULL AND \`${col}\` <> '' AND \`${col}\` <> '0';`);
    if (n > 0) { filled += n; seen.push(`${tbl}.${col}`); }
  }
  return { columns: cols.length, filled, where: seen.slice(0, 3) };
};

// Content elements and plugins the extension contributes.
const contentFor = (key) => {
  const like = key.replace(/_/g, '');
  const byCType = num(`SELECT COUNT(*) FROM tt_content
    WHERE deleted = 0 AND (CType LIKE '${key}\\_%' OR CType LIKE '${like}\\_%' OR CType = '${key}');`);
  let byListType = 0;
  if (sql(`SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema=DATABASE() AND table_name='tt_content' AND column_name='list_type';`) === '1') {
    byListType = num(`SELECT COUNT(*) FROM tt_content
      WHERE deleted = 0 AND (list_type LIKE '${key}\\_%' OR list_type LIKE '${like}\\_%');`);
  }
  return byCType + byListType;
};

const whyRequiredBy = (pkg) => {
  try {
    const out = execFileSync('ddev', ['composer', 'why', pkg], {
      cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    // `composer why` also prints `replaces` and `provides` lines. Taking the first token
    // of those reports a package as requiring itself.
    return out.split('\n')
      .filter((l) => / requires /.test(l))
      .map((l) => l.trim().split(/\s+/)[0])
      .filter((n) => n && n !== composer.name).slice(0, 3);
  } catch { return []; }
};

const rootName = composer.name ?? '';
const rows = [];

for (const [scope, list] of [['require', require_], ['require-dev', requireDev]]) {
  for (const pkg of Object.keys(list)) {
    if (pkg === 'php' || pkg.startsWith('ext-') || isCore(pkg)) continue;
    const key = extKeyOf(pkg);
    const tables = tablesFor(key);
    const records = tables.reduce((n, t) => n + rowsIn(t), 0);
    const content = contentFor(key);
    const extended = extendedColumnUsage(key);
    const requiredBy = whyRequiredBy(pkg).filter((n) => n !== rootName);
    rows.push({
      package: pkg, scope, constraint: list[pkg], extensionKey: key,
      tables: tables.length, records, contentElements: content,
      extendedColumns: extended.columns, extendedRowsFilled: extended.filled,
      extendedWhere: extended.where,
      requiredBy,
      evidence: records + content + extended.filled,
    });
  }
}

rows.sort((a, b) => a.evidence - b.evidence || a.package.localeCompare(b.package));

const pad = (s, n) => String(s).padEnd(n);
console.log('\nExtension inventory — usage evidence from the database\n');
console.log(`  ${pad('package', 38)} ${pad('tbl', 4)} ${pad('records', 8)} ${pad('content', 8)} ${pad('fields', 7)} required-by / where`);
console.log(`  ${'-'.repeat(38)} ${'-'.repeat(4)} ${'-'.repeat(8)} ${'-'.repeat(8)} ${'-'.repeat(7)} -------------------`);
for (const r of rows) {
  // Dev tooling stores nothing by definition — flagging it as unused is noise that
  // trains the reader to ignore the column.
  const flag = r.scope === 'require' && r.evidence === 0 && !r.requiredBy.length
    ? '  ← no usage found' : '';
  const where = r.extendedWhere.length ? r.extendedWhere.join(', ') : (r.requiredBy.join(', ') || '-');
  console.log(`  ${pad(r.package, 38)} ${pad(r.tables, 4)} ${pad(r.records, 8)} ${pad(r.contentElements, 8)} ${pad(r.extendedRowsFilled, 7)} ${where}${flag}`);
}

const unused = rows.filter((r) => r.evidence === 0 && !r.requiredBy.length && r.scope === 'require');
console.log(`\n  ${rows.length} non-Core package(s); ${unused.length} with no usage evidence.`);
if (unused.length) {
  console.log('\n  No usage evidence is a QUESTION, not a verdict. Before removing any of these, check');
  console.log('  whether it provides something that stores nothing — a middleware, a link handler,');
  console.log('  a scheduler task, a backend module, a TypoScript library, a frontend asset:');
  console.log('    ddev typo3 extension:list --active');
  console.log('    grep -rn "<ext-key>" packages/ config/ fileadmin/');
  console.log('    ddev mysql -N -e "SELECT uid,title FROM sys_template WHERE deleted=0 AND (config LIKE \'%<ext-key>%\' OR include_static_file LIKE \'%<ext-key>%\');"');
  console.log('\n  Then remove, and prove the removal with the invariance gate rather than by looking.');
}

if (reportPath) {
  writeFileSync(reportPath, JSON.stringify({
    schema: 'typo3-upgrade-run/extension-usage@1',
    caveat: 'Zero usage evidence is a question, not a verdict. Extensions that store nothing '
      + '(middlewares, link handlers, scheduler tasks, TypoScript libraries) legitimately show zero.',
    packages: rows,
  }, null, 2));
  console.log(`\nreport: ${reportPath}`);
}
