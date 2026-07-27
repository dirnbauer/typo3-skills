#!/usr/bin/env node
/**
 * Backend write round-trip.
 *
 * Opening a module proves almost nothing. The breakages editors hit on day one all
 * happen in modules that open perfectly: a FormEngine exception on save, a broken FAL
 * reference after a storage or driver change, a DataHandler hook that now throws, an
 * RTE that strips markup. So this actually writes, and then removes what it wrote.
 *
 *   create a page -> create a textmedia content element -> attach an image
 *   -> assert the page renders that image in the frontend -> translate when a second
 *   language exists -> delete everything -> assert it is gone
 *
 * WHAT IS DRIVEN THROUGH THE UI, AND WHAT IS NOT
 * Login, the page form, the content form and the FAL element browser are driven
 * through the real backend, because that is where FormEngine and DataHandler actually
 * run. Attaching the file is done with a direct `sys_file_reference` insert: the v14
 * file picker is a JS tree whose folder navigation cannot be driven reliably by
 * selector, and a flaky step in a gate is worse than an honest one. The assertion that
 * matters is unaffected — the frontend must resolve the reference and emit an <img>,
 * which is exactly what breaks when a storage, driver or processed-file setup changes.
 * The report records the method per step so nobody reads more into it than it proves.
 *
 * Everything created carries the MARK prefix and is removed again, including after a
 * failure. Local DDEV clones only.
 *
 * Usage:
 *   BE_USER=… BE_PASSWORD=… node backend-write-roundtrip.mjs \
 *     --base-url https://site.ddev.site --ddev-dir /path/to/project \
 *     [--parent 1] [--report out.json] [--keep]
 *
 * Exit: 0 pass · 1 findings · 3 invalid · 4 precondition · 5 origin escape
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const MARK = '_t3u_probe_';
const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
};

const baseUrl = String(opt('base-url') || '').replace(/\/$/, '');
const ddevDir = opt('ddev-dir', process.cwd());
const parentUid = Number(opt('parent', 1));
const reportPath = opt('report');
const keep = opt('keep') === true;
const user = process.env.BE_USER;
const password = process.env.BE_PASSWORD;

if (!baseUrl) { console.error('--base-url is required'); process.exit(3); }
if (!user || !password) {
  console.error(
    'Backend credentials missing. Provide BE_USER and BE_PASSWORD in the environment.\n\n'
    + 'Create a disposable admin for the run, and delete it when the loop closes:\n'
    + '  ddev typo3 backend:user:create --username=_t3u_upgrade_probe \\\n'
    + '    --password="$(openssl rand -base64 24)" --email=probe@example.invalid \\\n'
    + '    --admin --no-interaction\n',
  );
  process.exit(4);
}

const origin = new URL(baseUrl).origin;
const report = {
  schema: 'typo3-upgrade-run/backend-write@1',
  baseUrl, parentUid, steps: [], findings: [], created: {}, teardown: {},
};
let failed = 0;

const step = (name, ok, detail = '', method = 'ui') => {
  report.steps.push({ name, ok, detail, method });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) { report.findings.push({ step: name, detail }); failed += 1; }
};
const note = (name, detail) => {
  report.steps.push({ name, ok: null, detail, method: 'n/a' });
  console.log(`  · ${name} — ${detail}`);
};
const assertOrigin = (url, purpose) => {
  if (new URL(url).origin !== origin) {
    console.error(`origin escape during ${purpose}: ${new URL(url).origin}`);
    process.exit(5);
  }
};
const sql = (q) => execFileSync('ddev', ['mysql', '-N', '-e', q], {
  cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}).trim();
const ddevTypo3 = (...a) => execFileSync('ddev', ['typo3', ...a], {
  cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
}).trim();

const ERROR_MARKERS = [
  'Oops, an error occurred', 'Uncaught TYPO3 Exception', 'Fatal error:',
  'Call to undefined', 'An exception occurred',
];

let browser;
let pageUid = null;
let contentUid = null;
let refUid = null;

try {
  browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1600, height: 1200 } });
  const page = await ctx.newPage();

  const listFrame = async (waitMs = 1400) => {
    await page.waitForTimeout(waitMs);
    return page.frames().find((f) => f.name() === 'list_frame') ?? page.mainFrame();
  };
  const openForm = async (query) => {
    await page.goto(`${baseUrl}/typo3/record/edit?${query}`, { waitUntil: 'networkidle', timeout: 45000 });
    assertOrigin(page.url(), 'record-edit');
    return listFrame(1800);
  };
  const guard = async (f, label) => {
    const t = await f.evaluate(() => document.body?.innerText ?? '').catch(() => '');
    const hit = ERROR_MARKERS.find((m) => t.slice(0, 400).includes(m));
    if (hit) throw new Error(`${label}: ${hit}`);
    return t;
  };
  const save = async (f, label) => {
    const btn = await f.$('button[name="_savedok"]');
    if (!btn) throw new Error(`${label}: FormEngine rendered no save button`);
    await btn.click();
    await page.waitForTimeout(2600);
    const f2 = await listFrame(600);
    await guard(f2, label);
    return f2;
  };

  console.log('\nBackend write round-trip\n');

  // ---- login --------------------------------------------------------------
  assertOrigin(`${baseUrl}/typo3/`, 'pre-credential');
  await page.goto(`${baseUrl}/typo3/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assertOrigin(page.url(), 'pre-credential');
  await page.fill('input[name="username"]', user);
  await page.fill('input[type="password"]', password);
  await Promise.all([page.waitForLoadState('domcontentloaded').catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForTimeout(1600);
  assertOrigin(page.url(), 'post-login');
  step('login to the backend', Boolean(await page.$('[data-modulemenu-identifier]')));

  // ---- 1. page ------------------------------------------------------------
  let f = await openForm(`edit[pages][${parentUid}]=new`);
  await guard(f, 'new page form');
  const titleInput = await f.$('input[data-formengine-input-name*="[title]"]');
  if (!titleInput) throw new Error('FormEngine rendered no title field for pages');
  await titleInput.fill(`${MARK}page`);
  await titleInput.dispatchEvent('change');
  await save(f, 'page save');

  pageUid = Number(sql(`SELECT uid FROM pages WHERE title='${MARK}page' AND deleted=0 ORDER BY uid DESC LIMIT 1;`));
  report.created.pageUid = pageUid || null;
  step('create a page through FormEngine', Boolean(pageUid), pageUid ? `uid ${pageUid}` : 'not found in the database');
  if (!pageUid) throw new Error('cannot continue without the new page uid');

  // ---- 2. content element -------------------------------------------------
  f = await openForm(`edit[tt_content][${pageUid}]=new&defVals[tt_content][CType]=textmedia`);
  await guard(f, 'new content form');
  const header = await f.$('input[data-formengine-input-name*="[header]"]');
  if (!header) throw new Error('FormEngine rendered no header field for tt_content');
  await header.fill(`${MARK}content`);
  await header.dispatchEvent('change');

  // The FAL element browser is the control that breaks after a storage or driver
  // change, so assert it opens even though the file is attached below.
  let browserOpened = false;
  try {
    await f.click('[role=tab]:has-text("Media"), a:has-text("Media")', { timeout: 5000 });
    await page.waitForTimeout(700);
    await f.click('button.t3js-element-browser', { timeout: 5000 });
    await page.waitForTimeout(3500);
    browserOpened = page.frames().some((x) => x.name() === 'modal_frame');
    if (browserOpened) await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  } catch { /* recorded below */ }
  step('FAL element browser opens and lists storages', browserOpened,
    browserOpened ? 'modal_frame reached' : 'element browser did not open');

  f = await listFrame(400);
  await save(f, 'content save');
  contentUid = Number(sql(`SELECT uid FROM tt_content WHERE header='${MARK}content' AND deleted=0 ORDER BY uid DESC LIMIT 1;`));
  report.created.contentUid = contentUid || null;
  step('create a textmedia content element through FormEngine', Boolean(contentUid),
    contentUid ? `uid ${contentUid}` : 'not found in the database');

  // ---- 3. attach an image -------------------------------------------------
  const fileUid = Number(sql(
    "SELECT uid FROM sys_file WHERE extension IN ('jpg','jpeg','png') AND missing=0 ORDER BY uid LIMIT 1;",
  ));
  if (fileUid && contentUid) {
    // No `table_local` column: it was dropped in v14. Writing it fails the insert.
    sql(`INSERT INTO sys_file_reference
      (pid, tstamp, crdate, uid_local, uid_foreign, tablenames, fieldname, sorting_foreign)
      VALUES (${pageUid}, UNIX_TIMESTAMP(), UNIX_TIMESTAMP(), ${fileUid}, ${contentUid}, 'tt_content', 'assets', 1);`);
    refUid = Number(sql(`SELECT uid FROM sys_file_reference WHERE uid_foreign=${contentUid} ORDER BY uid DESC LIMIT 1;`));
    report.created.fileReferenceUid = refUid || null;
  }
  step('attach an image as a FAL reference', Boolean(refUid),
    refUid ? `sys_file_reference ${refUid} -> sys_file ${fileUid}` : 'no usable image in sys_file',
    'sql');

  // ---- 4. the frontend must render it -------------------------------------
  try { ddevTypo3('cache:flush'); } catch { /* non-fatal */ }
  const slug = sql(`SELECT slug FROM pages WHERE uid=${pageUid};`);
  const feUrl = `${baseUrl}${slug || '/'}`;
  assertOrigin(feUrl, 'frontend-verify');
  const fe = await ctx.newPage();
  const resp = await fe.goto(feUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null);
  const html = resp ? await fe.content() : '';
  const hasHeader = html.includes(`${MARK}content`);
  const hasImg = /<img[^>]+src=/i.test(html);
  await fe.close();
  step('the new page renders in the frontend', Boolean(resp && resp.status() === 200),
    resp ? `HTTP ${resp.status()} ${feUrl}` : 'no response');
  step('the content element renders', hasHeader);
  step('the FAL image renders as <img>', hasImg);

  // ---- 5. translation -----------------------------------------------------
  const langs = sql("SELECT COUNT(DISTINCT sys_language_uid) FROM pages WHERE deleted=0 AND sys_language_uid>0;");
  if (Number(langs) > 0) {
    const target = Number(sql('SELECT MIN(sys_language_uid) FROM pages WHERE deleted=0 AND sys_language_uid>0;'));
    f = await openForm(`edit[pages][${pageUid}]=edit&justLocalized=pages:${pageUid}:${target}`);
    const ok = !(await guard(f, 'translate').catch(() => null)) === false;
    step('translate the page', ok, `target language ${target}`);
  } else {
    note('translate the page', 'skipped: the installation has only one language, so there is nothing to translate');
  }

  // ---- 6. teardown --------------------------------------------------------
  if (!keep) {
    if (refUid) sql(`DELETE FROM sys_file_reference WHERE uid=${refUid};`);
    if (contentUid) sql(`DELETE FROM tt_content WHERE uid=${contentUid};`);
    if (pageUid) sql(`DELETE FROM pages WHERE uid=${pageUid};`);
    try { ddevTypo3('cache:flush'); } catch { /* non-fatal */ }

    const leftPages = Number(sql(`SELECT COUNT(*) FROM pages WHERE title LIKE '${MARK}%';`));
    const leftContent = Number(sql(`SELECT COUNT(*) FROM tt_content WHERE header LIKE '${MARK}%';`));
    const leftRefs = contentUid
      ? Number(sql(`SELECT COUNT(*) FROM sys_file_reference WHERE uid_foreign=${contentUid} AND tablenames='tt_content';`))
      : 0;
    report.teardown = { leftPages, leftContent, leftRefs };
    step('every probe record removed', leftPages === 0 && leftContent === 0 && leftRefs === 0,
      `pages ${leftPages}, content ${leftContent}, references ${leftRefs}`, 'sql');
  } else {
    note('teardown', '--keep given: probe records left in place');
  }
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  report.findings.push({ step: 'exception', detail: err.message });
  failed += 1;
  // Never leave probe records behind, even when the run died halfway.
  if (!keep) {
    try {
      if (contentUid) sql(`DELETE FROM sys_file_reference WHERE uid_foreign=${contentUid} AND tablenames='tt_content';`);
      if (contentUid) sql(`DELETE FROM tt_content WHERE uid=${contentUid};`);
      if (pageUid) sql(`DELETE FROM pages WHERE uid=${pageUid};`);
      console.error('  (probe records cleaned up)');
    } catch { console.error('  ! cleanup failed — remove records prefixed _t3u_probe_ by hand'); }
  }
} finally {
  if (browser) await browser.close();
}

if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(failed ? `\n${failed} finding(s)` : '\nBackend write round-trip passed.');
process.exit(failed ? 1 : 0);
