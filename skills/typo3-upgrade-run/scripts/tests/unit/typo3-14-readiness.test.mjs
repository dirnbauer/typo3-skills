import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  classNamesIn,
  classReferenceFindings,
  createPhpBridge,
  discoverProject,
  extractClassReferences,
  findParseFuncOverrides,
  findRelativeAssetReferences,
  looksLikeTypeScript,
  parseDbExport,
  parseImport,
  parseInclude,
  phpClassFindings,
  phpStringLiterals,
  resolveImport,
  resolveRelativeReference,
  runReadiness,
  splitCommand,
  suggestImport,
  typoscriptContext,
  typoscriptLines,
  typoscriptStatements,
  verifyClassNames,
} from '../../typo3-14-readiness.mjs';

const SCRIPTS = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = path.join(SCRIPTS, 'typo3-14-readiness.mjs');
const PHP_VERSION_ID = (() => {
  const probe = spawnSync('php', ['-r', 'echo PHP_VERSION_ID;'], { encoding: 'utf8' });
  return probe.status === 0 ? Number(probe.stdout) : null;
})();
const NO_PHP = PHP_VERSION_ID === null ? 'php is not on PATH' : false;

async function project(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), 't3u-readiness-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
}

const SITE_PACKAGE = {
  'composer.json': JSON.stringify({ repositories: [{ type: 'path', url: 'packages/*' }], extra: { 'typo3/cms': { 'web-dir': 'public' } } }),
  'vendor/composer/installed.json': JSON.stringify({ packages: [] }),
  'packages/site_package/composer.json': JSON.stringify({ type: 'typo3-cms-extension', extra: { 'typo3/cms': { 'extension-key': 'site_package' } } }),
};

/** A PHP bridge without PHP: `classes` answers the probe, `dies` names kill the process once. */
function stubBridge({ classes = {}, facts = {}, dies = [] } = {}) {
  const calls = [];
  return {
    calls,
    async facts(directories) {
      calls.push({ facts: directories.length });
      return {
        schema: 'typo3-upgrade-run/php-class-facts@1', php: '8.4.1', files: 1, missingDirs: [], parseErrors: [],
        declarations: [], references: [], instantiations: [], ...facts,
      };
    },
    async probe(names, { describe = false } = {}) {
      calls.push({ names: [...names], describe });
      const envelope = {
        schema: 'typo3-upgrade-run/class-exists@1', complete: true, fatal: null,
        results: {}, errors: {}, canonical: {}, namespaces: {}, suggestions: {}, shapes: {},
      };
      for (const name of names) {
        if (dies.includes(name)) return { ...envelope, complete: false, fatal: { name, message: `Class ${name} cannot extend final class Base` } };
        const known = classes[name] ?? {};
        envelope.results[name] = Boolean(known.exists);
        if (known.error) envelope.errors[name] = known.error;
        if (known.canonical) envelope.canonical[name] = known.canonical;
        if (known.namespace) envelope.namespaces[name] = true;
        if (known.suggestions) envelope.suggestions[name] = known.suggestions;
        if (known.shape && describe) envelope.shapes[name] = known.shape;
      }
      return envelope;
    },
  };
}

const rules = (report) => report.findings.map((item) => item.rule);

describe('reading TypoScript like the TYPO3 14 tokenizer', () => {
  test('comments and multi-line values never look like statements or includes', () => {
    const lines = typoscriptLines([
      '# <INCLUDE_TYPOSCRIPT: source="FILE:EXT:a/b.txt">',
      '// lib.x = TEXT',
      '/* start',
      '<INCLUDE_TYPOSCRIPT: source="FILE:EXT:a/c.txt">',
      'end */',
      'lib.text (',
      '  <INCLUDE_TYPOSCRIPT: inside a value>',
      ')',
      '<INCLUDE_TYPOSCRIPT: source="FILE:EXT:a/d.txt">',
      "@import 'EXT:a/e.typoscript'",
      'page.meta.og:image = x',
    ].join('\n'));
    assert.deepEqual(lines.map((line) => [line.line, line.kind]), [
      [6, 'statement'], [7, 'value'], [9, 'include'], [10, 'import'], [11, 'statement'],
    ]);
    assert.equal(lines.at(-1).path, 'page.meta.og:image');
  });

  test('block paths are followed and conditions reset them', () => {
    const statements = typoscriptStatements([
      'lib.parseFunc_RTE {', '  nonTypoTagStdWrap {', '    encapsLines.addAttributes.P.class = bodytext', '  }',
      '  allowTags := addToList(iframe)', '}', '[frontend.user.isLoggedIn]', 'styles.content.links.keep = path', '[END]',
    ].join('\n'));
    assert.deepEqual(statements.filter((item) => item.operator !== '{').map((item) => item.fullPath), [
      'lib.parseFunc_RTE.nonTypoTagStdWrap.encapsLines.addAttributes.P.class',
      'lib.parseFunc_RTE.allowTags',
      'styles.content.links.keep',
    ]);
  });

  test('.txt and .ts count as TypoScript only in TypoScript locations', () => {
    assert.equal(typoscriptContext('Configuration/TypoScript/setup.typoscript'), 'typoscript');
    assert.equal(typoscriptContext('Configuration/TypoScript/Static/setup.ts'), 'typoscript');
    assert.equal(typoscriptContext('Configuration/TsConfig/Page/rte.txt'), 'tsconfig');
    assert.equal(typoscriptContext('Configuration/page.tsconfig'), 'tsconfig');
    assert.equal(typoscriptContext('Resources/Private/TypoScript/lib.txt'), 'typoscript');
    assert.equal(typoscriptContext('Configuration/setup.txt'), 'typoscript');
    assert.equal(typoscriptContext('ext_typoscript_setup.txt'), 'typoscript');
    assert.equal(typoscriptContext('Resources/Private/TypeScript/app.ts'), null);
    assert.equal(typoscriptContext('Resources/Private/Language/notes.txt'), null);
    assert.equal(typoscriptContext('Configuration/TypoScript/include_static_file.txt'), null);
    assert.equal(looksLikeTypeScript('import { a } from "./b";\nexport const c = 1;'), true);
    assert.equal(looksLikeTypeScript('page = PAGE\npage.10 = TEXT'), false);
  });
});

describe('includes (#40)', () => {
  test('INCLUDE_TYPOSCRIPT becomes an @import at the same position, with the renames it needs', () => {
    const file = parseInclude('<INCLUDE_TYPOSCRIPT: source="FILE:EXT:site/Configuration/TypoScript/menu.txt" condition="[frontend.user.isLoggedIn]">');
    assert.deepEqual(suggestImport(file), {
      lines: ['[frontend.user.isLoggedIn]', "  @import 'EXT:site/Configuration/TypoScript/menu.typoscript'", '[END]'],
      renames: [{ from: 'EXT:site/Configuration/TypoScript/menu.txt', to: 'EXT:site/Configuration/TypoScript/menu.typoscript' }],
    });
    const directory = parseInclude("<INCLUDE_TYPOSCRIPT: source='DIR:EXT:site/Configuration/TypoScript/' extensions='txt,typoscript'>");
    assert.deepEqual(suggestImport(directory).lines, ["@import 'EXT:site/Configuration/TypoScript/*.typoscript'"]);
    assert.deepEqual(suggestImport(parseInclude('<INCLUDE_TYPOSCRIPT: source="FILE:EXT:site/Configuration/TsConfig/Page/rte.txt">'), 'tsconfig').lines,
      ["@import 'EXT:site/Configuration/TsConfig/Page/rte.tsconfig'"]);
  });

  test('@import targets are read up to the next quote; unquoted imports are comments to TYPO3', () => {
    assert.deepEqual(parseImport("@import 'EXT:a/b.typoscript' # note"), { target: 'EXT:a/b.typoscript' });
    assert.deepEqual(parseImport('@import "EXT:a/b.typoscript"'), { target: 'EXT:a/b.typoscript' });
    assert.deepEqual(parseImport('@import EXT:a/b.typoscript'), { target: null });
  });

  test('@import resolution mirrors TYPO3 14: suffixes, wildcards, directories, relative paths', async (t) => {
    const root = await project(t, {
      ...SITE_PACKAGE,
      'packages/site_package/Configuration/TypoScript/setup.typoscript': '',
      'packages/site_package/Configuration/TypoScript/Setup/b.typoscript': '',
      'packages/site_package/Configuration/TypoScript/Setup/a.typoscript': '',
      'packages/site_package/Configuration/TypoScript/Setup/c.txt': '',
      'packages/site_package/Configuration/TsConfig/Page/rte.tsconfig': '',
      'public/fileadmin/ts/main.typoscript': '',
    });
    const project_ = await discoverProject(root);
    const resolve = (target, extra = {}) => resolveImport(target, { context: 'typoscript', project: project_, ...extra });
    const relativeFiles = (result) => result.files.map((file) => path.relative(root, file));
    assert.deepEqual(relativeFiles(await resolve('EXT:site_package/Configuration/TypoScript/Setup/*.typoscript')), [
      'packages/site_package/Configuration/TypoScript/Setup/a.typoscript', 'packages/site_package/Configuration/TypoScript/Setup/b.typoscript',
    ]);
    assert.equal((await resolve('EXT:site_package/Configuration/TypoScript/Setup/')).files.length, 2);
    assert.equal((await resolve('EXT:site_package/Configuration/TypoScript/setup')).status, 'loads');
    assert.equal((await resolve('fileadmin/ts/main.typoscript')).status, 'loads');
    assert.deepEqual(await resolve('EXT:site_package/Configuration/TypoScript/Setup/c.txt'), { status: 'empty', reason: 'suffix' });
    assert.deepEqual(await resolve('EXT:site_package/Configuration/TypoScript/Setup/*.txt'), { status: 'empty', reason: 'suffix' });
    assert.deepEqual(await resolve('EXT:site_package/Configuration/TypoScript/gone.typoscript'), { status: 'empty', reason: 'missing' });
    assert.deepEqual(await resolve('EXT:news/Configuration/TypoScript/setup.typoscript'), { status: 'empty', reason: 'unknown-extension' });
    assert.deepEqual(await resolve('EXT:site_package/Configuration/*/x.typoscript'), { status: 'empty', reason: 'pattern' });
    assert.deepEqual(await resolve('../Setup/a.typoscript'), { status: 'empty', reason: 'invalid-path' });
    const fromFile = path.join(root, 'packages/site_package/Configuration/TypoScript/setup.typoscript');
    assert.equal((await resolve('./Setup/a.typoscript', { fromFile })).status, 'loads');
    const rte = 'EXT:site_package/Configuration/TsConfig/Page/rte.tsconfig';
    assert.equal((await resolve(rte, { context: 'tsconfig' })).status, 'loads');
    assert.deepEqual(await resolve(rte), { status: 'empty', reason: 'suffix' });
    assert.equal((await resolveImport('EXT:news/x.typoscript', {
      context: 'typoscript', project: { ...project_, extensionPaths: new Map(), extensionMapComplete: false },
    })).status, 'unverifiable');
  });

  test('files, database rows and PHP strings are scanned, and include targets are followed into fileadmin/', async (t) => {
    const root = await project(t, {
      ...SITE_PACKAGE,
      'packages/site_package/Configuration/TypoScript/Static/setup.txt': [
        '<INCLUDE_TYPOSCRIPT: source="FILE:EXT:site_package/Configuration/TypoScript/Static/page.txt">',
        "@import 'EXT:site_package/Configuration/TypoScript/Static/menu.txt'",
        "@import 'EXT:site_package/Configuration/TypoScript/Static/page.txt.typoscript'",
      ].join('\n'),
      'packages/site_package/Configuration/TypoScript/Static/page.txt': 'page = PAGE',
      'packages/site_package/ext_typoscript_setup.txt': 'lib.a = TEXT',
      'packages/site_package/ext_localconf.php': [
        '<?php',
        "// ExtensionManagementUtility::addTypoScriptSetup('<INCLUDE_TYPOSCRIPT: source=\"FILE:EXT:x/commented.txt\">');",
        "ExtensionManagementUtility::addTypoScriptSetup('<INCLUDE_TYPOSCRIPT: source=\"FILE:EXT:site_package/Configuration/TypoScript/Static/page.txt\">');",
        "$css = \"@import url('styles.css');\";",
      ].join('\n'),
      'public/fileadmin/templates/legacy.txt': '<INCLUDE_TYPOSCRIPT: source="FILE:fileadmin/templates/missing.txt">\nlib.legacy = TEXT',
      'db.jsonl': `${JSON.stringify({ table: 'sys_template', uid: 7, field: 'config', value: 'page = PAGE\n<INCLUDE_TYPOSCRIPT: source="FILE:fileadmin/templates/legacy.txt">' })}\n`,
    });
    const report = await runReadiness({ projectRoot: root, checks: ['includes'], dbExports: [path.join(root, 'db.jsonl')] });
    const where = report.findings.map((item) => `${item.rule} ${item.file}:${item.line}`);
    assert.deepEqual(where, [
      'ts-include-typoscript db:sys_template:7:config:2',
      'ts-txt-file packages/site_package/Configuration/TypoScript/Static/page.txt:1',
      'ts-include-typoscript packages/site_package/Configuration/TypoScript/Static/setup.txt:1',
      'ts-txt-file packages/site_package/Configuration/TypoScript/Static/setup.txt:1',
      'ts-import-loads-nothing packages/site_package/Configuration/TypoScript/Static/setup.txt:2',
      'ts-import-loads-nothing packages/site_package/Configuration/TypoScript/Static/setup.txt:3',
      'ts-include-typoscript packages/site_package/ext_localconf.php:3',
      'ts-txt-file packages/site_package/ext_typoscript_setup.txt:1',
      'ts-include-typoscript public/fileadmin/templates/legacy.txt:1',
    ]);
    const database = report.findings[0];
    assert.equal(database.severity, 'error');
    assert.deepEqual(database.detail.suggestion, ["@import 'fileadmin/templates/legacy.typoscript'"]);
    assert.match(database.fix, /upgrade wizard/);
    assert.match(database.fix, /out of fileadmin/);
    assert.equal(report.findings[4].detail.reason, 'suffix');
    assert.equal(report.findings[5].detail.reason, 'missing');
    assert.match(report.findings[6].fix, /PHP source/);
    assert.match(report.findings[7].message, /never read/);
    assert.equal(report.scanned.followedIncludes, 1);
    assert.equal(report.exitCode, 1);
    assert.equal(report.checks.includes.errors, 6);
  });
});

describe('relative asset links (#43)', () => {
  test('finds relative src, every srcset candidate and CSS url(), and nothing absolute', () => {
    const html = [
      '<img src="typo3temp/assets/captcha.png"><img src="/typo3temp/ok.png"><img src="https://cdn.example.org/fileadmin/a.png">',
      "<img srcset='/x.png 1x, fileadmin/x@2x.png 2x' data-src=\"./_assets/a/b.svg\">",
      '<div style="background: url(\'fileadmin/bg.jpg\')"></div><a href="#fileadmin/">x</a>',
    ].join('\n');
    assert.deepEqual(findRelativeAssetReferences(html).map((hit) => [hit.line, hit.attribute, hit.reference]), [
      [1, 'src', 'typo3temp/assets/captcha.png'],
      [2, 'srcset', 'fileadmin/x@2x.png'],
      [2, 'data-src', './_assets/a/b.svg'],
      [3, 'url()', 'fileadmin/bg.jpg'],
    ]);
  });

  test('Fluid ViewHelper arguments are file paths, not URLs', () => {
    const template = '<f:image src="fileadmin/logo.png" />\n<img src="{f:uri.image(src: \'fileadmin/a.png\')}">\n<link href="typo3conf/ext/site/Resources/Public/a.css">';
    assert.deepEqual(findRelativeAssetReferences(template, { fluid: true }).map((hit) => hit.reference), ['typo3conf/ext/site/Resources/Public/a.css']);
  });

  test('a reference resolves against the page URL unless a root <base href> rescues it', () => {
    assert.equal(resolveRelativeReference('typo3temp/a.png', { pageUrl: 'https://site.invalid/contact/' }).resolvesTo, '/contact/typo3temp/a.png');
    assert.equal(resolveRelativeReference('typo3temp/a.png', { pageUrl: 'https://site.invalid/contact/', base: '/' }).rescuedByBase, true);
    assert.equal(resolveRelativeReference('typo3temp/a.png', { pageUrl: 'https://site.invalid/contact/', base: '/de/' }).rescuedByBase, false);
  });

  test('captured DOM hits are 14 regressions; template and TypoScript hits are warnings', async (t) => {
    const after = 'captures/after';
    const root = await project(t, {
      ...SITE_PACKAGE,
      'config/system/settings.php': "<?php return ['FE' => ['additionalAbsRefPrefixDirectories' => 'media/']];",
      'packages/site_package/Resources/Private/Templates/Page.html': '<img src="media/logo.png">',
      'packages/site_package/Configuration/TypoScript/setup.typoscript': 'lib.logo.value = <img src="fileadmin/logo.png">\n# <img src="fileadmin/commented.png">',
      [`${after}/dom/one.html`]: '<img src="typo3temp/captcha.png"><img src="typo3temp/old.png">',
      [`${after}/http/one.json`]: JSON.stringify({ requestedUrl: 'https://site.invalid/contact/', finalUrl: 'https://site.invalid/contact/' }),
      [`${after}/dom/two.html`]: '<base href="/"><img src="typo3temp/captcha.png">',
      [`${after}/http/two.json`]: JSON.stringify({ finalUrl: 'https://site.invalid/news/item/' }),
      [`${after}/dom/three.html`]: '<img srcset="/a.png 1x, typo3temp/b.png 2x"><img src="media/c.png">',
      [`${after}/http/three.json`]: JSON.stringify({ finalUrl: 'https://site.invalid/about/' }),
      [`${after}/dom/one.meta.json`]: '{}',
      'captures/before/dom/one.html': '<img src="typo3temp/old.png">',
    });
    const report = await runReadiness({
      projectRoot: root, checks: ['relative-links'], domDir: path.join(root, after), baselineDomDir: path.join(root, 'captures/before'),
    });
    const summary = report.findings.map((item) => [
      item.rule, item.severity, item.detail.reference, item.detail.status ?? item.detail.source, item.detail.rewrittenBy13,
    ]);
    assert.deepEqual(summary, [
      ['relative-asset-dom', 'error', 'typo3temp/captcha.png', 'regression', true],
      ['relative-asset-dom', 'warning', 'typo3temp/old.png', 'pre-existing', true],
      ['relative-asset-dom', 'error', 'media/c.png', 'regression', true],
      ['relative-asset-dom', 'error', 'typo3temp/b.png', 'regression', false],
      ['relative-asset-dom', 'warning', 'typo3temp/captcha.png', 'base-href', true],
      ['relative-asset-template', 'warning', 'fileadmin/logo.png', 'typoscript', undefined],
      ['relative-asset-template', 'warning', 'media/logo.png', 'fluid', undefined],
    ]);
    const regression = report.findings[0];
    assert.match(regression.message, /TYPO3 14 no longer rewrites it to \/typo3temp\/captcha\.png/);
    assert.match(regression.message, /On \/contact\/ the browser requests \/contact\/typo3temp\/captcha\.png/);
    assert.deepEqual(regression.detail.pages, ['/contact/']);
    assert.match(report.findings[3].message, /TYPO3 13 did not rewrite this form either/);
    assert.equal(report.scanned.domFiles, 3);
    assert.equal(report.exitCode, 1);
  });

  test('without --dom-dir only sources are checked, and the report says so', async (t) => {
    const root = await project(t, { ...SITE_PACKAGE, 'packages/site_package/Resources/Private/Layouts/Default.html': '<img src="/ok.png">' });
    const report = await runReadiness({ projectRoot: root, checks: ['relative-links'] });
    assert.equal(report.checks['relative-links'].status, 'pass');
    assert.match(report.checks['relative-links'].note, /--dom-dir/);
    assert.equal(report.exitCode, 0);
  });
});

describe('class references outside PHP (#20)', () => {
  test('matches class names with single or escaped backslashes, not regex escapes or namespaces', () => {
    const names = (text) => classNamesIn(text).map((match) => match.name);
    assert.deepEqual(names('handler = TYPO3\\CMS\\Recordlist\\LinkHandler\\RecordLinkHandler'), ['TYPO3\\CMS\\Recordlist\\LinkHandler\\RecordLinkHandler']);
    assert.deepEqual(names('"Vendor\\\\Ext\\\\Hooks\\\\DataHandler->process"'), ['Vendor\\Ext\\Hooks\\DataHandler']);
    assert.deepEqual(names('userFunc = \\Vendor\\Ext\\Foo::render'), ['Vendor\\Ext\\Foo']);
    assert.deepEqual(names('search = /\\d\\s\\w+/ and \\D\\S\\W'), []);
    assert.deepEqual(names('Vendor\\Ext\\Domain\\: { resource: ../Classes/* }'), []);
    assert.deepEqual(names('Vendor\\Ext and vendor\\ext\\lower'), []);
  });

  test('comments do not count; lines are exact in YAML, XML and PHP strings', () => {
    const yaml = "# TYPO3\\CMS\\Form\\Old\\Gone\nimplementationClassName: 'TYPO3\\CMS\\Form\\Domain\\Model\\FormElements\\GridContainer' # Vendor\\Not\\This";
    assert.deepEqual(extractClassReferences(yaml, 'yaml'), [{ name: 'TYPO3\\CMS\\Form\\Domain\\Model\\FormElements\\GridContainer', line: 2 }]);
    const xml = '<!-- <userFunc>Vendor\\Ext\\Gone</userFunc>\n-->\n<itemsProcFunc>Vendor\\Ext\\Items->get</itemsProcFunc>';
    assert.deepEqual(extractClassReferences(xml, 'xml'), [{ name: 'Vendor\\Ext\\Items', line: 3 }]);
    const php = [
      '<?php',
      '// $x = \'Vendor\\\\Ext\\\\Commented\';',
      "$GLOBALS['TYPO3_CONF_VARS']['SC_OPTIONS']['t3lib/class.t3lib_tcemain.php']['processDatamapClass'][] =",
      "    'Vendor\\\\Ext\\\\Hooks\\\\DataHandler';",
      '/* Vendor\\Ext\\Block */ $y = <<<EOT',
      'first',
      'Vendor\\Ext\\InHeredoc',
      'EOT;',
    ].join('\n');
    assert.deepEqual(extractClassReferences(php, 'php'), [
      { name: 'Vendor\\Ext\\Hooks\\DataHandler', line: 4 },
      { name: 'Vendor\\Ext\\InHeredoc', line: 7 },
    ]);
    assert.equal(phpStringLiterals(php).length, 6);
  });

  test('the probe restarts after a class that kills PHP and records it as unloadable', async () => {
    const bridge = stubBridge({ classes: { 'A\\B\\Two': { exists: true }, 'A\\B\\Three': { exists: false } }, dies: ['A\\B\\One'] });
    const probe = await verifyClassNames(['A\\B\\Three', 'A\\B\\One', 'A\\B\\Two', 'A\\B\\One'], (names) => bridge.probe(names));
    assert.deepEqual(probe.results, { 'A\\B\\One': false, 'A\\B\\Two': true, 'A\\B\\Three': false });
    assert.match(probe.errors['A\\B\\One'], /cannot extend final class/);
    assert.equal(probe.runs, 2);
    assert.deepEqual(bridge.calls.map((call) => call.names), [['A\\B\\One', 'A\\B\\Three', 'A\\B\\Two'], ['A\\B\\Three', 'A\\B\\Two']]);
    await assert.rejects(verifyClassNames(['A\\B\\C'], async () => ({ schema: 'x' })), /unexpected document/);
    await assert.rejects(verifyClassNames(['A\\B\\C'], async () => ({
      schema: 'typo3-upgrade-run/class-exists@1', complete: false, results: {}, fatal: { name: null, message: 'autoloader died' },
    })), /stopped outside a class check/);
    await assert.rejects(verifyClassNames(['A\\B\\C'], async () => ({ schema: 'typo3-upgrade-run/class-exists@1', complete: true, results: {} })), /skipped/);
  });

  test('missing classes are errors with suggestions; namespaces pass; aliases warn', () => {
    const occurrences = [
      { name: 'TYPO3\\CMS\\Recordlist\\LinkHandler\\RecordLinkHandler', file: 'db:pages:1:TSconfig', line: 3, source: 'db' },
      { name: 'Vendor\\Ext\\ViewHelpers', file: 'config/system/settings.php', line: 9, source: 'php' },
      { name: 'TYPO3\\CMS\\Core\\Html\\TextCropper', file: 'a.typoscript', line: 1, source: 'typoscript' },
      { name: 'TYPO3\\CMS\\Core\\Html\\TextCropper', file: 'a.typoscript', line: 4, source: 'typoscript' },
      { name: 'Vendor\\Ext\\Broken', file: 'b.yaml', line: 2, source: 'yaml' },
      { name: 'TYPO3\\CMS\\core\\Utility\\GeneralUtility', file: 'c.xml', line: 5, source: 'xml' },
    ];
    const findings = classReferenceFindings(occurrences, {
      results: {
        'TYPO3\\CMS\\Recordlist\\LinkHandler\\RecordLinkHandler': false, 'Vendor\\Ext\\ViewHelpers': false,
        'TYPO3\\CMS\\Core\\Html\\TextCropper': false, 'Vendor\\Ext\\Broken': false, 'TYPO3\\CMS\\core\\Utility\\GeneralUtility': true,
      },
      errors: { 'Vendor\\Ext\\Broken': 'Error: Class "Vendor\\Ext\\Base" not found' },
      namespaces: { 'Vendor\\Ext\\ViewHelpers': true },
      suggestions: { 'TYPO3\\CMS\\Core\\Html\\TextCropper': ['TYPO3\\CMS\\Core\\Text\\TextCropper'] },
      canonical: { 'TYPO3\\CMS\\core\\Utility\\GeneralUtility': 'TYPO3\\CMS\\Core\\Utility\\GeneralUtility' },
    });
    assert.deepEqual(findings.map((item) => [item.rule, item.severity, item.file, item.line]), [
      ['class-ref-missing', 'error', 'db:pages:1:TSconfig', 3],
      ['class-ref-missing', 'error', 'a.typoscript', 1],
      ['class-ref-unloadable', 'error', 'b.yaml', 2],
      ['class-ref-alias', 'warning', 'c.xml', 5],
    ]);
    assert.match(findings[0].message, /database TypoScript or TSconfig/);
    assert.deepEqual(findings[1].detail.lines, [1, 4]);
    assert.match(findings[1].message, /TYPO3\\CMS\\Core\\Text\\TextCropper/);
    assert.match(findings[3].message, /case-sensitive/);
  });

  test('runs the probe once over every source and never needs PHP for other checks', async (t) => {
    const root = await project(t, {
      ...SITE_PACKAGE,
      'packages/site_package/Configuration/page.tsconfig': 'TCEMAIN.linkHandler.record.handler = TYPO3\\CMS\\Recordlist\\LinkHandler\\RecordLinkHandler',
      'packages/site_package/Resources/Private/Forms/contact.form.yaml': "prototypeName: standard\nimplementationClassName: 'TYPO3\\CMS\\Form\\Domain\\Model\\FormElements\\GridContainer'",
      'packages/site_package/Configuration/FlexForms/list.xml': '<itemsProcFunc>Vendor\\Site\\Items->get</itemsProcFunc>',
      'packages/site_package/Resources/Private/Language/notes.txt': 'Vendor\\Not\\Scanned',
      'packages/site_package/Configuration/TCA/Overrides/tt_content.php': "<?php $x = ['userFunc' => 'Vendor\\\\Site\\\\Render->x'];",
      'db.json': JSON.stringify({ rows: [{ table: 'be_groups', uid: '2', field: 'TSconfig', value: 'options.x = Vendor\\Site\\Items' }] }),
    });
    const bridge = stubBridge({ classes: { 'Vendor\\Site\\Items': { exists: true }, 'Vendor\\Site\\Render': { exists: true } } });
    const report = await runReadiness({ projectRoot: root, checks: ['class-refs'], dbExports: [path.join(root, 'db.json')] }, { php: bridge });
    assert.deepEqual(bridge.calls, [{
      names: [
        'TYPO3\\CMS\\Form\\Domain\\Model\\FormElements\\GridContainer', 'TYPO3\\CMS\\Recordlist\\LinkHandler\\RecordLinkHandler',
        'Vendor\\Site\\Items', 'Vendor\\Site\\Render',
      ],
      describe: false,
    }]);
    assert.deepEqual(report.findings.map((item) => item.file), [
      'packages/site_package/Configuration/page.tsconfig', 'packages/site_package/Resources/Private/Forms/contact.form.yaml',
    ]);
    const refusing = { facts: () => assert.fail('no PHP needed'), probe: () => assert.fail('no PHP needed') };
    const fileOnly = await runReadiness({ projectRoot: root, checks: ['includes', 'parsefunc', 'relative-links'] }, { php: refusing });
    assert.equal(fileOnly.options.php, null);
  });
});

describe('parseFunc overrides (#41)', () => {
  test('flags allowTags := , lib.parseFunc overrides and styles.content.links constants, not their use', () => {
    const hits = findParseFuncOverrides([
      'lib.parseFunc_RTE.allowTags := addToList(object,param,embed,iframe)',
      'lib.parseFunc_RTE < lib.parseFunc',
      'lib.parseFunc.makelinks.http.keep = path',
      'tt_content.text.20.parseFunc =< lib.parseFunc_RTE',
      'tt_content.bullets.20.parseFunc < lib.parseFunc_RTE',
      'styles.content {', '  links.extTarget = _blank', '}',
      'lib.parseFuncFoo = TEXT',
    ].join('\n'));
    assert.deepEqual(hits.map((hit) => [hit.rule, hit.line, hit.path]), [
      ['parsefunc-allowtags', 1, 'lib.parseFunc_RTE.allowTags'],
      ['parsefunc-override', 2, 'lib.parseFunc_RTE'],
      ['parsefunc-override', 3, 'lib.parseFunc.makelinks.http.keep'],
      ['parsefunc-links-constant', 7, 'styles.content.links.extTarget'],
    ]);
  });

  test('reports per file, aggregates overrides, and leaves RTE TSconfig alone', async (t) => {
    const root = await project(t, {
      ...SITE_PACKAGE,
      'packages/site_package/Configuration/TypoScript/setup.typoscript': [
        'lib.parseFunc_RTE {', '  allowTags := addToList(iframe)', '  externalBlocks := addToList(figure)', '  nonTypoTagStdWrap.encapsLines.addAttributes.P.class = bodytext', '}',
      ].join('\n'),
      'packages/site_package/Configuration/page.tsconfig': 'RTE.default.proc.allowTags := addToList(iframe)',
      'db.jsonl': `${JSON.stringify({ table: 'sys_template', uid: 3, field: 'constants', value: 'styles.content.links.extTarget = _blank' })}\n`,
    });
    const report = await runReadiness({ projectRoot: root, checks: ['parsefunc'], dbExports: [path.join(root, 'db.jsonl')] });
    assert.deepEqual(report.findings.map((item) => [item.rule, item.file, item.line]), [
      ['parsefunc-links-constant', 'db:sys_template:3:constants', 1],
      ['parsefunc-allowtags', 'packages/site_package/Configuration/TypoScript/setup.typoscript', 2],
      ['parsefunc-override', 'packages/site_package/Configuration/TypoScript/setup.typoscript', 3],
    ]);
    assert.match(report.findings[1].message, /allows only these tags/);
    assert.match(report.findings[1].fix, /Helper\/ParseFunc\.typoscript/);
    assert.deepEqual(report.findings[2].detail.lines, [3, 4]);
    assert.equal(report.counts.errors, 0);
    assert.equal(report.exitCode, 0);
    assert.equal((await runReadiness({ projectRoot: root, checks: ['parsefunc'], strict: true })).exitCode, 1);
  });
});

describe('site-package PHP against the installed core (#42)', () => {
  const ctor = (required, parameters) => ({ class: 'TYPO3\\CMS\\Core\\Thing', public: true, required, parameters });
  const facts = {
    php: '8.4.1',
    parseErrors: [{ file: 'packages/site/Classes/Broken.php', line: 3, message: 'syntax error, unexpected token "{"' }],
    declarations: [
      { name: 'Site\\Pkg\\Child', kind: 'class', anonymous: false, final: false, abstract: false, readonly: false, extends: ['Core\\Pkg\\Locked'], implements: [], file: 'packages/site/Classes/Child.php', line: 5 },
      { name: 'Site\\Pkg\\Cold', kind: 'class', anonymous: false, final: false, abstract: false, readonly: false, extends: ['Core\\Pkg\\Frozen'], implements: [], file: 'packages/site/Classes/Cold.php', line: 4 },
      { name: 'Site\\Pkg\\Hot', kind: 'class', anonymous: false, final: false, abstract: false, readonly: true, extends: ['Core\\Pkg\\Open'], implements: [], file: 'packages/site/Classes/Hot.php', line: 4 },
      { name: 'Site\\Pkg\\Sig', kind: 'class', anonymous: false, final: false, abstract: false, readonly: false, extends: ['Core\\Pkg\\Open'], implements: [], file: 'packages/site/Classes/Sig.php', line: 6 },
      { name: 'Site\\Pkg\\Lost', kind: 'class', anonymous: false, final: false, abstract: false, readonly: false, extends: [], implements: [], file: 'packages/site/Classes/Misc/Lost.php', line: 3 },
    ],
    references: [
      { name: 'TYPO3\\CMS\\Core\\Html\\TextCropper', via: 'use', file: 'packages/site/Classes/Sig.php', line: 3, guarded: false },
      { name: 'TYPO3\\CMS\\Core\\Html\\TextCropper', via: 'static', file: 'packages/site/Classes/Sig.php', line: 9, guarded: false },
      { name: 'Optional\\Lib\\Thing', via: 'class-constant', file: 'packages/site/Classes/Sig.php', line: 11, guarded: true },
      { name: 'TYPO3\\CMS\\Core\\Utility', via: 'namespace-use', file: 'packages/site/Classes/Sig.php', line: 4, guarded: false },
      { name: 'Site\\Pkg\\Lost', via: 'new', file: 'packages/site/Classes/Sig.php', line: 12, guarded: false },
      { name: 'TYPO3\\CMS\\Core\\Old\\Alias', via: 'use', file: 'packages/site/Classes/Sig.php', line: 5, guarded: false },
    ],
    instantiations: [
      { name: 'TYPO3\\CMS\\Core\\Thing', via: 'makeInstance', arguments: 0, spread: false, file: 'packages/site/Classes/Sig.php', line: 13 },
      { name: 'TYPO3\\CMS\\Core\\Thing', via: 'new', arguments: 0, spread: false, file: 'packages/site/Classes/Sig.php', line: 14 },
      { name: 'TYPO3\\CMS\\Core\\Thing', via: 'new', arguments: null, spread: true, file: 'packages/site/Classes/Sig.php', line: 15 },
      { name: 'TYPO3\\CMS\\Core\\Service', via: 'makeInstance', arguments: 0, spread: false, file: 'packages/site/Classes/Sig.php', line: 16 },
      { name: 'TYPO3\\CMS\\Core\\Thing', via: 'makeInstance', arguments: 2, spread: false, file: 'packages/site/Classes/Sig.php', line: 17 },
    ],
  };
  const shape = (overrides = {}) => ({ kind: 'class', final: false, abstract: false, readonly: false, publicService: null, constructor: null, ...overrides });
  const probe = {
    results: {
      'Core\\Pkg\\Locked': true, 'Core\\Pkg\\Frozen': true, 'Core\\Pkg\\Open': true, 'Site\\Pkg\\Child': false, 'Site\\Pkg\\Cold': false,
      'Site\\Pkg\\Hot': false, 'Site\\Pkg\\Sig': false, 'Site\\Pkg\\Lost': false, 'TYPO3\\CMS\\Core\\Html\\TextCropper': false,
      'Optional\\Lib\\Thing': false, 'TYPO3\\CMS\\Core\\Thing': true, 'TYPO3\\CMS\\Core\\Service': true, 'TYPO3\\CMS\\Core\\Old\\Alias': true,
    },
    errors: {
      'Site\\Pkg\\Child': 'PHP stopped while loading it: Class Site\\Pkg\\Child cannot extend final class Core\\Pkg\\Locked',
      'Site\\Pkg\\Cold': 'PHP stopped while loading it: Non-readonly class Site\\Pkg\\Cold cannot extend readonly class Core\\Pkg\\Frozen',
      'Site\\Pkg\\Hot': 'PHP stopped while loading it: Readonly class Site\\Pkg\\Hot cannot extend non-readonly class Core\\Pkg\\Open',
      'Site\\Pkg\\Sig': 'PHP stopped while loading it: Declaration of Site\\Pkg\\Sig::render(): string must be compatible with Core\\Pkg\\Open::render(): void',
    },
    canonical: { 'TYPO3\\CMS\\Core\\Old\\Alias': 'TYPO3\\CMS\\Core\\New\\Name' },
    namespaces: {},
    suggestions: { 'TYPO3\\CMS\\Core\\Html\\TextCropper': ['TYPO3\\CMS\\Core\\Text\\TextCropper'] },
    shapes: {
      'Core\\Pkg\\Locked': shape({ final: true }),
      'Core\\Pkg\\Frozen': shape({ readonly: true }),
      'Core\\Pkg\\Open': shape(),
      'TYPO3\\CMS\\Core\\Thing': shape({ constructor: ctor(1, [{ name: 'logger', type: 'Psr\\Log\\LoggerInterface', optional: false }, { name: 'x', type: 'int', optional: true }]) }),
      'TYPO3\\CMS\\Core\\Service': shape({ publicService: 'implements TYPO3\\CMS\\Core\\SingletonInterface', constructor: ctor(1, [{ name: 'logger', type: null, optional: false }]) }),
    },
  };

  test('judges inheritance, moved classes, local loading and constructor arity', () => {
    const findings = phpClassFindings(facts, probe);
    assert.deepEqual(findings.map((item) => [item.rule, item.severity, path.basename(item.file), item.line]), [
      ['php-parse-error', 'error', 'Broken.php', 3],
      ['php-extends-final', 'error', 'Child.php', 5],
      ['php-readonly-mismatch', 'error', 'Cold.php', 4],
      ['php-readonly-mismatch', 'error', 'Hot.php', 4],
      ['php-missing-class', 'error', 'Sig.php', 3],
      ['php-missing-class', 'warning', 'Sig.php', 11],
      ['php-class-alias', 'warning', 'Sig.php', 5],
      ['php-unloadable-class', 'error', 'Sig.php', 6],
      ['php-class-not-autoloadable', 'warning', 'Lost.php', 3],
      ['php-constructor-arity', 'warning', 'Sig.php', 13],
      ['php-constructor-arity', 'error', 'Sig.php', 14],
    ]);
    const byRule = (rule, line) => findings.find((item) => item.rule === rule && item.line === line);
    assert.match(byRule('php-missing-class', 3).message, /\(static access, imported\)/);
    assert.match(byRule('php-missing-class', 3).message, /TYPO3\\CMS\\Core\\Text\\TextCropper/);
    assert.match(byRule('php-readonly-mismatch', 4).message, /Non-readonly class Site\\Pkg\\Cold/);
    assert.match(byRule('php-unloadable-class', 6).message, /must be compatible/);
    assert.match(byRule('php-constructor-arity', 13).message, /Psr\\Log\\LoggerInterface \$logger/);
    assert.equal(byRule('php-constructor-arity', 13).detail.required, 1);
  });

  test('runs facts and a describing probe through the bridge', async (t) => {
    const root = await project(t, { ...SITE_PACKAGE, 'packages/site_package/Classes/A.php': '<?php' });
    const bridge = stubBridge({ facts: { declarations: facts.declarations.slice(0, 1) }, classes: { 'Core\\Pkg\\Locked': { exists: true, shape: shape({ final: true }) } }, dies: ['Site\\Pkg\\Child'] });
    const report = await runReadiness({ projectRoot: root, checks: ['php-classes'] }, { php: bridge });
    assert.deepEqual(rules(report), ['php-extends-final']);
    assert.deepEqual(bridge.calls.map((call) => call.facts ?? call.describe), [1, true]);
    assert.equal(report.scanned.probeRuns, 1);
  });
});

describe('inputs and the command line', () => {
  test('database exports are JSON arrays, {rows}, or JSON Lines, validated row by row', () => {
    const row = { table: 'pages', uid: 4, field: 'TSconfig', value: 'mod.x = 1' };
    assert.equal(parseDbExport(JSON.stringify([row])).length, 1);
    assert.equal(parseDbExport(JSON.stringify({ rows: [row, { ...row, value: null }] })).length, 1);
    assert.equal(parseDbExport(`${JSON.stringify(row)}\n\n${JSON.stringify({ ...row, uid: '5' })}\n`)[1].uid, 5);
    assert.equal(parseDbExport(JSON.stringify(row)).length, 1);
    assert.throws(() => parseDbExport('{"table":"pages"}\nnot json', 'x.jsonl'), /line 2 is not JSON/);
    assert.throws(() => parseDbExport(JSON.stringify([{ ...row, uid: -1 }])), /uid/);
    assert.throws(() => parseDbExport(JSON.stringify([{ ...row, table: 'pages; DROP' }])), /table/);
  });

  test('local packages come from path repositories, packages/ and non-vendor typo3conf/ext', async (t) => {
    const root = await project(t, {
      'composer.json': JSON.stringify({ repositories: { local: { type: 'path', url: 'local/*' } } }),
      'local/one/composer.json': JSON.stringify({ extra: { 'typo3/cms': { 'extension-key': 'one_key' } } }),
      'packages/two/ext_emconf.php': '<?php',
      'public/typo3conf/ext/three/ext_emconf.php': '<?php',
      'vendor/acme/four/composer.json': '{}',
      'vendor/composer/installed.json': JSON.stringify([{ name: 'acme/four', type: 'typo3-cms-extension', 'install-path': '../acme/four' }]),
    });
    const found = await discoverProject(root);
    assert.deepEqual(found.packages.map((pkg) => [pkg.rel, pkg.key]), [['local/one', 'one_key'], ['packages/two', 'two'], ['public/typo3conf/ext/three', 'three']]);
    assert.equal(found.extensionPaths.get('four'), path.join(root, 'vendor/acme/four'));
    assert.equal(found.extensionMapComplete, true);
    assert.deepEqual(splitCommand('ddev exec php'), ['ddev', 'exec', 'php']);
    assert.deepEqual(splitCommand('"/opt/php 8/bin/php" -d memory_limit=1G'), ['/opt/php 8/bin/php', '-d', 'memory_limit=1G']);
  });

  test('CLI exit codes: findings 1, help 0, bad flags 2, missing project 4, --strict for warnings', async (t) => {
    const root = await project(t, {
      ...SITE_PACKAGE,
      'packages/site_package/Configuration/TypoScript/setup.typoscript': '<INCLUDE_TYPOSCRIPT: source="FILE:EXT:site_package/a.typoscript">',
      'packages/site_package/Configuration/TypoScript/constants.typoscript': 'styles.content.links.keep = path',
    });
    const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    const json = run('--project-root', root, '--checks', 'includes,parsefunc', '--json');
    assert.equal(json.status, 1);
    assert.deepEqual(JSON.parse(json.stdout).findings.map((item) => item.rule), ['ts-include-typoscript', 'parsefunc-links-constant']);
    const reportFile = path.join(root, 'report.json');
    const summary = run('--project-root', root, '--checks', 'parsefunc', '--report', reportFile);
    assert.equal(summary.status, 0);
    assert.match(summary.stdout, /PASS: 0 errors, 1 warning/);
    assert.equal((await readdir(root)).includes('report.json'), true);
    assert.equal(run('--project-root', root, '--checks', 'parsefunc', '--strict').status, 1);
    assert.equal(run('--help').status, 0);
    assert.equal(run('--bogus').status, 2);
    assert.equal(run('--checks', 'includes,unknown').status, 2);
    assert.equal(run('--baseline-dom-dir', root).status, 2);
    assert.equal(run('--project-root', path.join(root, 'missing')).status, 4);
    assert.equal(run('--project-root', root, '--dom-dir', path.join(root, 'no-capture')).status, 4);
    assert.equal(run('--project-root', root, '--checks', 'php-classes', '--php', 'php-binary-that-does-not-exist').status, 4);
    // No class name to verify, so class-refs never starts PHP and a missing binary does not matter.
    assert.equal(run('--project-root', root, '--checks', 'class-refs', '--php', 'php-binary-that-does-not-exist').status, 0);
  });
});

describe('PHP helpers against a real interpreter', () => {
  const fixture = (version) => ({
    'composer.json': JSON.stringify({ name: 'acme/site' }),
    'vendor/autoload.php': [
      '<?php',
      'spl_autoload_register(static function (string $class): void {',
      "    foreach (['Site\\\\Pkg\\\\' => '/../packages/site/Classes/', 'Core\\\\Pkg\\\\' => '/core/'] as $prefix => $dir) {",
      '        if (str_starts_with($class, $prefix)) {',
      "            $file = __DIR__ . $dir . str_replace('\\\\', '/', substr($class, strlen($prefix))) . '.php';",
      '            if (is_file($file)) { require $file; }',
      '        }',
      '    }',
      '});',
    ].join('\n'),
    'vendor/core/Locked.php': '<?php\nnamespace Core\\Pkg;\nfinal class Locked {}\n',
    'vendor/core/Needs.php': '<?php\nnamespace Core\\Pkg;\nclass Needs { public function __construct(\\Countable $items, int $limit = 3) {} }\n',
    ...(version >= 80200 ? { 'vendor/core/Frozen.php': '<?php\nnamespace Core\\Pkg;\nreadonly class Frozen {}\n' } : {}),
    'packages/site/composer.json': JSON.stringify({ type: 'typo3-cms-extension', extra: { 'typo3/cms': { 'extension-key': 'site' } } }),
    'packages/site/Classes/Child.php': '<?php\nnamespace Site\\Pkg;\nuse Core\\Pkg\\Locked;\nclass Child extends Locked {}\n',
    'packages/site/Classes/Dies.php': '<?php\nexit(0);\n',
    'packages/site/Classes/Broken.php': '<?php\nnamespace Site\\Pkg;\nclass Broken { public function x( { }\n',
    ...(version >= 80200 ? { 'packages/site/Classes/Cold.php': '<?php\nnamespace Site\\Pkg;\nclass Cold extends \\Core\\Pkg\\Frozen {}\n' } : {}),
    'packages/site/Classes/Maker.php': [
      '<?php',
      'namespace Site\\Pkg;',
      'use Core\\Pkg\\{Needs, Html\\Moved as Cropper};',
      'use TYPO3\\CMS\\Core\\Utility\\GeneralUtility;',
      '#[\\Core\\Pkg\\Attribute\\Gone]',
      'final class Maker {',
      '    use \\Core\\Pkg\\SomeTrait;',
      '    public function run(): void {',
      '        GeneralUtility::makeInstance(Needs::class);',
      "        GeneralUtility::makeInstance('Core\\\\Pkg\\\\Needs', 1, ...$rest);",
      '        new Needs($a, 2);',
      '        if (class_exists(\\Optional\\Thing::class)) { Cropper::crop(); }',
      '        $f = function () use ($a) { return new class ($a) extends \\Core\\Pkg\\Locked {}; };',
      '    }',
      '}',
    ].join('\n'),
  });

  test('the facts helper resolves names the way PHP does, without loading anything', { skip: NO_PHP }, async (t) => {
    const root = await project(t, fixture(PHP_VERSION_ID));
    const run = spawnSync('php', [path.join(SCRIPTS, 'site-package-class-check.php'), 'packages/site'], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const facts = JSON.parse(run.stdout);
    const maker = (via) => facts.references.filter((item) => item.file.endsWith('Maker.php') && item.via === via).map((item) => item.name);
    assert.deepEqual(maker('use'), ['Core\\Pkg\\Needs', 'Core\\Pkg\\Html\\Moved', 'TYPO3\\CMS\\Core\\Utility\\GeneralUtility']);
    assert.deepEqual(maker('attribute'), ['Core\\Pkg\\Attribute\\Gone']);
    assert.deepEqual(maker('trait'), ['Core\\Pkg\\SomeTrait']);
    assert.deepEqual(maker('extends'), ['Core\\Pkg\\Locked']);
    assert.equal(facts.references.find((item) => item.name === 'Optional\\Thing').guarded, true);
    assert.deepEqual(facts.instantiations.filter((call) => call.file.endsWith('Maker.php')).map((call) => [call.via, call.arguments, call.spread]), [
      ['makeInstance', 0, false], ['makeInstance', 2, true], ['new', 2, false],
    ]);
    assert.equal(facts.declarations.find((item) => item.anonymous)?.extends[0], 'Core\\Pkg\\Locked');
    assert.equal(facts.parseErrors.length, 1);
    assert.match(facts.parseErrors[0].file, /Broken\.php$/);
  });

  test('the probe survives fatal errors and exit() in class files, and the report names the cause', { skip: NO_PHP }, async (t) => {
    const root = await project(t, fixture(PHP_VERSION_ID));
    const discovered = await discoverProject(root);
    const bridge = createPhpBridge({ project: discovered });
    const probe = await verifyClassNames(
      ['Site\\Pkg\\Child', 'Site\\Pkg\\Dies', 'Site\\Pkg\\Broken', 'Core\\Pkg\\Needs', 'Core\\Pkg\\Missing\\Thing'],
      (names) => bridge.probe(names, { describe: true }),
    );
    assert.equal(probe.runs, 2);
    assert.equal(probe.results['Core\\Pkg\\Needs'], true);
    assert.equal(probe.results['Core\\Pkg\\Missing\\Thing'], false);
    assert.match(probe.errors['Site\\Pkg\\Child'], /cannot extend final class Core\\Pkg\\Locked/);
    assert.match(probe.errors['Site\\Pkg\\Dies'], /exit or die/);
    assert.match(probe.errors['Site\\Pkg\\Broken'], /^ParseError: /);
    assert.equal(probe.shapes['Core\\Pkg\\Needs'].constructor.required, 1);
    assert.deepEqual(await readdir(path.join(root, '.typo3-update/tools')), ['class-exists-check.php', 'site-package-class-check.php']);

    const report = await runReadiness({ projectRoot: root, checks: ['php-classes'] });
    const found = report.findings.map((item) => `${item.rule} ${path.basename(item.file)}:${item.line}`);
    for (const expected of [
      'php-extends-final Child.php:4', 'php-parse-error Broken.php:3', 'php-missing-class Maker.php:3',
      'php-constructor-arity Maker.php:9', 'php-missing-class Maker.php:5', 'php-missing-class Maker.php:7',
    ]) assert.ok(found.includes(expected), `${expected} in ${found.join(' | ')}`);
    if (PHP_VERSION_ID >= 80200) assert.ok(found.includes('php-readonly-mismatch Cold.php:3'), found.join(' | '));
    assert.equal(report.findings.find((item) => item.rule === 'php-missing-class' && item.detail.name === 'Optional\\Thing')?.severity, 'warning');
    assert.equal(report.exitCode, 1);
  });

  test('a missing autoloader is a precondition, not a finding', { skip: NO_PHP }, async (t) => {
    const root = await project(t, { ...SITE_PACKAGE, 'packages/site_package/Configuration/page.tsconfig': 'x = Vendor\\Ext\\Thing' });
    await assert.rejects(runReadiness({ projectRoot: root, checks: ['class-refs'] }), (error) => error.exitCode === 4 && /autoloader/.test(error.message));
  });
});
