#!/usr/bin/env node
/**
 * TYPO3 14 readiness: five silent breakers that Rector, Fractor and the extension scanner miss.
 *
 * Each check comes from a real 13 → 14.3 run where the site broke while every tool was green:
 *
 *   includes        `<INCLUDE_TYPOSCRIPT:` is dropped without a log entry by 14.0 (Breaking-105377).
 *                   Fractor's TypoScript processor reads .typoscript, .tsconfig and .ts by default, so
 *                   .txt static templates (which 14's static-template loader still reads) keep the
 *                   construct, and a dropped include that carried PAGE answers "No page configured for
 *                   type=0" on every page. `@import` loads only *.typoscript (TSconfig: also
 *                   *.tsconfig), so importing a .txt file, or a target that is not there, loads nothing
 *                   just as silently. Database TypoScript comes from --db-export.
 *   relative-links  14.0 stopped rewriting relative resource links in the response (Breaking-108114).
 *                   `src="typo3temp/…"` now resolves against the page URL, so below /page/ the browser
 *                   fetches the soft-404 HTML instead of the image (a captcha that never shows).
 *   class-refs      Class names in TypoScript, TSconfig, YAML, XML, PHP configuration arrays and
 *                   database TSconfig are strings no PHP tool resolves until a request needs them.
 *   parsefunc       14.0 removed fluid_styled_content's parseFunc (Breaking-107438), so overrides
 *                   written against it change meaning: `allowTags := addToList(…)` became a whitelist.
 *   php-classes     Site-package PHP against the INSTALLED core: classes that moved or vanished,
 *                   parents that became final or readonly, constructors that gained a required
 *                   argument which makeInstance() outside DI never passes.
 *
 * includes, relative-links and parsefunc read files only. class-refs and php-classes ask the project's
 * own autoloader through class-exists-check.php and site-package-class-check.php, which are copied to
 * --tools-dir so that a container prefix (--php "ddev exec php") can reach them. Neither helper boots
 * TYPO3, reads the database or instantiates anything: class declarations are loaded, no code path
 * runs. Run the file checks in the mechanical-migration node and everything again in the rung-14 node,
 * before the first 14.3 smoke run (references/typo3-14-readiness-checks.md).
 *
 * Usage:
 *   node typo3-14-readiness.mjs [--project-root DIR] [--checks includes,relative-links,...]
 *     [--db-export FILE] [--dom-dir DIR [--baseline-dom-dir DIR]] [--php "ddev exec php"]
 *     [--autoload vendor/autoload.php] [--tools-dir .typo3-update/tools] [--package-dir DIR ...]
 *     [--asset-prefix media/ ...] [--strict] [--json] [--report FILE]
 *
 * --db-export FILE: database TypoScript and TSconfig as JSON: an array of rows, {"rows": [...]}, or
 * JSON Lines with one row per line. A row is {"table": "sys_template", "uid": 1, "field": "config",
 * "value": "..."}; "pid" and "title" are optional, a null value is skipped. Meant for
 * sys_template.config/constants and the TSconfig field of pages, be_users and be_groups; the reference
 * gives a `ddev mysql -N -B -r` query that writes JSON Lines (-r keeps backslashes and newlines).
 *
 * --dom-dir DIR: a capture of the 14 rung (`captures/<label>` or its `dom/`). The sibling `http/`
 * records supply each page's URL, so a finding states what the browser actually requested.
 *
 * Exit: 0 no error (warnings pass unless --strict) · 1 findings · 2 harness error or unreadable input
 *       · 4 precondition: missing directory, PHP or autoloader unavailable, nothing to scan
 */

import { copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { EXIT, HarnessError, PreconditionError } from './lib/cli/exit-codes.mjs';
import { mapPool } from './lib/util/pool.mjs';

const SCHEMA = 'typo3-upgrade-run/typo3-14-readiness@1';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PHP_HELPERS = Object.freeze({ probe: 'class-exists-check.php', facts: 'site-package-class-check.php' });

export const CHECKS = Object.freeze(['includes', 'relative-links', 'class-refs', 'parsefunc', 'php-classes']);
const PHP_CHECKS = new Set(['class-refs', 'php-classes']);

// Test fixtures, documentation, build tooling and installed dependencies never run as this site's
// configuration; the run directory holds the copied PHP helpers.
const SKIP_DIRS = new Set([
  '.Build', '.ddev', '.git', '.github', '.gitlab', '.idea', '.typo3-update', 'Build', 'Documentation',
  'Documentation-GENERATED-temp', 'node_modules', 'Tests', 'tests', 'vendor',
]);

// Directories whose .txt and .ts files are TypoScript. Elsewhere .ts is TypeScript and .txt is prose.
const TYPOSCRIPT_DIR = /^(typoscript|tsconfig|pagets|userts|pagetsconfig|usertsconfig|ts)$/i;
const TSCONFIG_DIR = /^(tsconfig|pagets|userts|pagetsconfig|usertsconfig)$/i;

// Relative resource links that break below the site root. TYPO3 13 rewrote some of them for the site
// (str_replace of `"<prefix>` by `"/<prefix>` over the whole response, absRefPrefix); 14 rewrites none.
export const DEFAULT_ASSET_PREFIXES = Object.freeze(['_assets/', 'typo3temp/', 'typo3conf/', 'typo3/sysext/', 'fileadmin/', 'uploads/']);
// What 13's TypoScriptFrontendController::setAbsRefPrefix() searched for, before
// $GLOBALS['TYPO3_CONF_VARS']['FE']['additionalAbsRefPrefixDirectories'] added more.
const THIRTEEN_REWRITTEN_PREFIXES = Object.freeze(['_assets/', 'typo3temp/', 'typo3conf/ext/', 'typo3/sysext/']);

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const toPosix = (value) => value.split(path.sep).join('/');
const countNewlines = (text) => (text.match(/\n/g) ?? []).length;
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function finding(check, rule, severity, file, line, message, fix, detail = {}) {
  return { check, rule, severity, file, line, message, fix, detail };
}

/* ------------------------------------------------------------------ reading TypoScript */

const STATEMENT = /^((?:\\.|:(?!=)|[^\s=<>{(:\\])+)\s*(:=|=<|=|<|>|\{|\()(.*)$/;

/**
 * Lines of TypoScript or TSconfig as TYPO3 14's LossyTokenizer sees them: `#` and `//` lines are
 * comments, a `/*` line opens a comment that ends on the first line containing `*\/`, and a `(`
 * assignment swallows the lines up to the one starting with `)`. Comments never produce a finding.
 */
export function typoscriptLines(text) {
  const out = [];
  const lines = String(text).split('\n');
  let comment = false;
  let multiline = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const trimmed = lines[index].replace(/\r$/, '').trim();
    if (comment) {
      if (trimmed.includes('*/')) comment = false;
      continue;
    }
    if (multiline) {
      if (trimmed.startsWith(')')) multiline = false;
      else out.push({ line, kind: 'value', text: trimmed });
      continue;
    }
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    if (trimmed.startsWith('/*')) {
      comment = !trimmed.includes('*/');
      continue;
    }
    if (trimmed.startsWith('[')) out.push({ line, kind: 'condition', text: trimmed });
    else if (trimmed.startsWith('}')) out.push({ line, kind: 'close', text: trimmed });
    else if (trimmed.startsWith('@import')) out.push({ line, kind: 'import', text: trimmed });
    else if (trimmed.startsWith('<INCLUDE_TYPOSCRIPT:')) out.push({ line, kind: 'include', text: trimmed });
    else {
      const statement = STATEMENT.exec(trimmed);
      if (!statement) {
        out.push({ line, kind: 'other', text: trimmed });
        continue;
      }
      const [, objectPath, operator, value] = statement;
      if (operator === '(') multiline = true;
      out.push({ line, kind: 'statement', text: trimmed, path: objectPath, operator, value: value.trim() });
    }
  }
  return out;
}

/** Statements with their full object path, following `{ … }` blocks. */
export function typoscriptStatements(text) {
  const stack = [];
  const out = [];
  for (const entry of typoscriptLines(text)) {
    if (entry.kind === 'condition') {
      stack.length = 0; // conditions are top-level only
      continue;
    }
    if (entry.kind === 'close') {
      stack.pop();
      continue;
    }
    if (entry.kind !== 'statement') continue;
    const fullPath = stack.length ? `${stack.at(-1)}.${entry.path}` : entry.path;
    if (entry.operator === '{') stack.push(fullPath);
    out.push({ ...entry, fullPath });
  }
  return out;
}

/** TypeScript sources also end in .ts; their first lines give them away. */
export function looksLikeTypeScript(text) {
  return /^\s*(?:import|export)\s|^\s*(?:const|let|var|interface|type|enum|declare|abstract\s+class)\s+[A-Za-z_$]/m.test(text);
}

/**
 * 'typoscript', 'tsconfig' or null for a path inside a package or config/. .typoscript and .tsconfig
 * are always TypoScript; .txt and .ts only below a TypoScript-ish directory, or under the legacy
 * static-template names. include_static_file.txt is a list of includes, not TypoScript.
 */
export function typoscriptContext(relativePath) {
  const parts = relativePath.split(/[\\/]/);
  const name = parts.at(-1);
  const extension = path.extname(name).toLowerCase();
  const directories = parts.slice(0, -1);
  const tsconfig = extension === '.tsconfig' || directories.some((part) => TSCONFIG_DIR.test(part));
  if (extension === '.typoscript' || extension === '.tsconfig') return tsconfig ? 'tsconfig' : 'typoscript';
  if (extension !== '.txt' && extension !== '.ts') return null;
  if (name.toLowerCase() === 'include_static_file.txt') return null;
  if (directories.some((part) => TYPOSCRIPT_DIR.test(part))) return tsconfig ? 'tsconfig' : 'typoscript';
  if (directories.length === 0 && /^ext_typoscript_(setup|constants)\.txt$/i.test(name)) return 'typoscript';
  if (directories[0] === 'Configuration' && /^(setup|constants)\.(txt|ts)$/i.test(name)) return 'typoscript';
  return null;
}

/* ------------------------------------------------------------------ includes (#40) */

/** Attributes of one `<INCLUDE_TYPOSCRIPT: …>` line. */
export function parseInclude(text) {
  const body = text.replace(/^<INCLUDE_TYPOSCRIPT:/, '').replace(/>\s*$/, '');
  const attributes = {};
  for (const match of body.matchAll(/([A-Za-z]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3];
  }
  const source = (attributes.source ?? '').trim();
  const typed = /^(FILE|DIR):(.*)$/is.exec(source);
  return {
    type: typed ? typed[1].toUpperCase() : 'FILE',
    target: (typed ? typed[2] : source).trim(),
    extensions: (attributes.extensions ?? '').split(',').map((value) => value.trim().replace(/^\./, '')).filter(Boolean),
    condition: attributes.condition?.trim() || null,
  };
}

/** The `@import` lines that replace an include at the same position, and the renames they need. */
export function suggestImport(include, context = 'typoscript') {
  const wanted = context === 'tsconfig' ? 'tsconfig' : 'typoscript';
  const renames = [];
  let imports;
  if (include.type === 'DIR') {
    const directory = include.target.replace(/\/+$/, '');
    const patterns = new Set((include.extensions.length ? include.extensions : [wanted]).map((extension) => {
      const parts = extension.split('.');
      const last = parts.at(-1).toLowerCase();
      if (last !== 'typoscript' && last !== 'tsconfig') {
        const renamed = [...parts.slice(0, -1), wanted].join('.');
        renames.push({ from: `${directory}/*.${extension}`, to: `${directory}/*.${renamed}` });
        return `${directory}/*.${renamed}`;
      }
      return `${directory}/*.${extension}`;
    }));
    imports = [...patterns].map((pattern) => `@import '${pattern}'`);
  } else {
    let target = include.target;
    const legacy = /\.(txt|ts)$/i.exec(target);
    if (legacy) {
      const renamed = `${target.slice(0, -legacy[0].length)}.${wanted}`;
      renames.push({ from: target, to: renamed });
      target = renamed;
    }
    imports = [`@import '${target}'`];
  }
  const lines = include.condition ? [include.condition, ...imports.map((line) => `  ${line}`), '[END]'] : imports;
  return { lines, renames };
}

const ORIGIN_NOTES = Object.freeze({
  db: 'This is a database record: convert it by hand and ship the conversion as an upgrade wizard that changes only the exact pre-migration value; an edit in the local database never reaches production.',
  php: 'The TypoScript is registered from PHP (addTypoScriptSetup() and friends still exist in 14): convert the string in the PHP source.',
});

function includeFix(include, suggestion, origin) {
  const parts = [`Replace the line at the same position with: ${suggestion.lines.join(' / ')}.`];
  if (suggestion.renames.length) {
    parts.push(`Rename ${suggestion.renames.map((rename) => `${rename.from} to ${rename.to}`).join(', ')} first: @import loads only *.typoscript (TSconfig: also *.tsconfig), and Fractor skips .txt files.`);
  }
  if (include.type === 'DIR') {
    parts.push('DIR: includes were recursive; an @import wildcard covers one directory, so add one @import per subdirectory and list files explicitly where their order matters (@import sorts its matches).');
  }
  if (include.condition) parts.push('@import has no condition attribute: put it inside the condition block, which must use the expression syntax.');
  if (/^(fileadmin|uploads)\//.test(include.target)) parts.push('Better still, move the TypoScript out of fileadmin/ into the site package and import it with EXT:, as the TYPO3 migration note recommends.');
  if (ORIGIN_NOTES[origin]) parts.push(ORIGIN_NOTES[origin]);
  return parts.join(' ');
}

/** The target of an `@import` line, read as TYPO3 14 reads it: from a quote up to the next quote. */
export function parseImport(text) {
  const rest = text.slice('@import'.length).trim();
  if (rest[0] !== "'" && rest[0] !== '"') return { target: null };
  const body = rest.slice(1);
  const end = body.search(/['"]/);
  return { target: end === -1 ? body : body.slice(0, end) };
}

/** File suffixes one `@import` may load (TreeFromLineStreamBuilder::$atImportTypeToSuffixMap). */
export function importSuffixes(context) {
  return context === 'typoscript' ? ['typoscript'] : ['typoscript', 'tsconfig'];
}

/** A reason the import loads nothing whatever is on disk, or null. */
export function staticImportProblem(target) {
  if (target.includes('\\') || /(^|\/)\.\.(\/|$)/.test(target) || target.replace(/^EXT:/, '').includes('//')) return 'invalid-path';
  const slash = target.lastIndexOf('/');
  if (target.slice(0, slash + 1).includes('*')) return 'pattern';
  if ((target.slice(slash + 1).match(/\*/g) ?? []).length > 1) return 'pattern';
  return null;
}

/** 'txt', 'ts' or 'tsconfig' when the target's suffix is one @import never loads in this context. */
export function legacySuffix(target, context) {
  const base = target.replace(/\/+$/, '').split('/').at(-1);
  const extension = /\.([A-Za-z0-9]+)$/.exec(base)?.[1]?.toLowerCase();
  if (extension === 'txt' || extension === 'ts') return extension;
  if (extension === 'tsconfig' && context === 'typoscript') return extension;
  return null;
}

function resolveResource(target, project) {
  if (target.startsWith('EXT:')) {
    const [key, ...rest] = target.slice(4).split('/');
    const directory = project.extensionPaths.get(key);
    if (!directory) {
      return project.extensionMapComplete
        ? { invalid: 'unknown-extension' }
        : { unverifiable: 'the installed extensions are unknown (no vendor/composer/installed.json)' };
    }
    return { path: path.join(directory, rest.join('/')) };
  }
  if (target.startsWith('PKG:')) return { unverifiable: 'PKG: identifiers are not resolved' };
  if (path.isAbsolute(target)) {
    // An absolute path is the server's (/var/www/html/…); only one inside this checkout can be checked.
    return target.startsWith(project.root + path.sep) ? { path: target } : { unverifiable: 'absolute path outside this checkout' };
  }
  return { path: path.join(project.webDir, target) }; // GeneralUtility::getFileAbsFileName(): relative to public/
}

async function importCandidates(absolute, suffix, context) {
  const candidate = absolute.replace(/\/+$/, '');
  const ending = `.${suffix}`;
  const relative = async () => {
    if (context.tryRelative || !context.fromFile) return [];
    const value = context.target.replace(/^[./]+/, '');
    return importCandidates(path.join(path.dirname(context.fromFile), value), suffix, { ...context, tryRelative: true });
  };
  if (candidate.endsWith(ending) && await isFile(candidate)) return [candidate];
  if (await isDir(candidate)) return (await listFiles(candidate)).filter((file) => file.endsWith(ending));
  if (await isFile(candidate + ending)) return [candidate + ending];
  if (candidate.includes('*')) {
    const directory = path.dirname(candidate);
    if (!await isDir(directory)) return context.target.startsWith('./') ? relative() : [];
    let pattern = path.basename(candidate);
    if (!pattern.includes('*') || pattern.split('*').length > 2) return [];
    if (pattern.endsWith(suffix)) pattern = pattern.slice(0, -suffix.length).replace(/\.+$/, '');
    const [left, right] = `${pattern}.${suffix}`.split('*');
    return (await listFiles(directory)).filter((file) => {
      const name = path.basename(file);
      return name.startsWith(left) && name.endsWith(right);
    });
  }
  return relative();
}

/**
 * What one `@import` loads on TYPO3 14.3, mirroring TreeFromLineStreamBuilder::processAtImport():
 * {status: 'loads', files} · {status: 'empty', reason} · {status: 'unverifiable', reason}.
 */
export async function resolveImport(target, { context, fromFile = null, project }) {
  const problem = staticImportProblem(target);
  if (problem) return { status: 'empty', reason: problem };
  const base = resolveResource(target, project);
  if (base.unverifiable) return { status: 'unverifiable', reason: base.unverifiable };
  if (base.invalid) return { status: 'empty', reason: base.invalid };
  const files = new Set();
  for (const suffix of importSuffixes(context)) {
    for (const file of await importCandidates(base.path, suffix, { target, fromFile, tryRelative: false })) files.add(file);
  }
  if (files.size) return { status: 'loads', files: [...files].sort(byText) };
  return { status: 'empty', reason: legacySuffix(target, context) ? 'suffix' : 'missing' };
}

const IMPORT_REASONS = Object.freeze({
  unquoted: ['is not quoted, and TYPO3 14 treats an unquoted @import line as a comment', 'Quote the target.'],
  suffix: ['names a .txt or .ts file (or .tsconfig in TypoScript), and TYPO3 14 imports only *.typoscript (TSconfig: *.typoscript and *.tsconfig)', 'Rename the file to .typoscript (TSconfig: .tsconfig), import the new name, then let Fractor process the renamed file; its TypoScript processor skips .txt.'],
  missing: ['resolves to no file', 'Point the import at where the file is now; check whether the file, or the extension that ships it, was renamed or moved in its TYPO3 14 version.'],
  'unknown-extension': ['names an extension key that is not installed', 'Install the extension or remove the import.'],
  pattern: ['uses a wildcard TYPO3 does not expand (one * at most, and only in the file name)', 'Use one wildcard in the file name, or list the files explicitly.'],
  'invalid-path': ['contains "..", "//" or a backslash, which TYPO3 rejects', 'Use an EXT: path, or a path relative to the importing file that starts with ./.'],
});

function importFinding(document, line, target, reason) {
  const [why, fix] = IMPORT_REASONS[reason];
  const shown = target === null ? '(unquoted)' : `'${target}'`;
  return finding('includes', 'ts-import-loads-nothing', 'error', document.display, line,
    `@import ${shown} loads nothing on TYPO3 14: it ${why}. Nothing is logged; the TypoScript it was meant to load is missing.`,
    [fix, ORIGIN_NOTES[document.origin]].filter(Boolean).join(' '),
    { reason, target, origin: document.origin, ...rowDetail(document) });
}

function txtFileFinding(document) {
  const name = path.basename(document.file);
  const extTypoScript = /^ext_typoscript_(setup|constants)\.txt$/i.exec(name);
  const message = extTypoScript
    ? `TYPO3 14 loads only ext_typoscript_${extTypoScript[1].toLowerCase()}.typoscript; this .txt file is never read, so whatever it configures does not apply.`
    : 'TypoScript in a .txt file: TYPO3 14 still reads it where it is registered directly (setup.txt/constants.txt of a static template), but @import cannot load it and Fractor\'s TypoScript processor skips .txt (default extensions: typoscript, tsconfig, ts), so no automated migration reached it.';
  const fix = extTypoScript
    ? 'Delete the file, or rename it to .typoscript if its content is meant to apply; that changes the output, so declare the change.'
    : `Rename it to ${document.context === 'tsconfig' ? '.tsconfig' : '.typoscript'}, update every @import and static-template registration that names it, then run Fractor again.`;
  return finding('includes', 'ts-txt-file', 'warning', document.display, 1, message, fix, {});
}

function rowDetail(document) {
  return document.row ? { table: document.row.table, uid: document.row.uid, field: document.row.field } : {};
}

/* ------------------------------------------------------------------ relative asset links (#43) */

const TAG = /<([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /(?:^|\s)([A-Za-z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const URL_ATTRIBUTES = new Set(['src', 'href', 'srcset', 'data-src', 'data-srcset', 'poster', 'imagesrcset']);
const SRCSET_ATTRIBUTES = new Set(['srcset', 'data-srcset', 'imagesrcset']);
const CSS_URL = /url\(\s*(['"]?)([^'")\s]+)\1\s*\)/g;

function lineIndexer(text) {
  const starts = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) starts.push(index + 1);
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };
}

/** The resource prefix a reference starts with, or null: no scheme, no leading slash. */
export function relativeAssetPrefix(reference, prefixes = DEFAULT_ASSET_PREFIXES) {
  const value = reference.trim().replace(/^\.\//, '');
  return prefixes.find((prefix) => value.startsWith(prefix)) ?? null;
}

/**
 * Relative resource references in HTML: src, href, srcset (every candidate) and friends, plus CSS
 * url(). With `fluid`, ViewHelper tags are skipped: `<f:image src="fileadmin/…">` takes a file
 * path that the ViewHelper turns into a URL, it is not a URL itself. `quotedStart` marks a reference
 * that opens a double-quoted value: the only form TYPO3 13's response rewrite could ever reach.
 */
export function findRelativeAssetReferences(html, { prefixes = DEFAULT_ASSET_PREFIXES, fluid = false } = {}) {
  const text = String(html);
  const lineAt = lineIndexer(text);
  const hits = [];
  for (const tag of text.matchAll(TAG)) {
    if (fluid && tag[1].includes(':')) continue;
    for (const attribute of (tag[2] ?? '').matchAll(ATTRIBUTE)) {
      const name = attribute[1].toLowerCase();
      if (!URL_ATTRIBUTES.has(name)) continue;
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      const candidates = SRCSET_ATTRIBUTES.has(name)
        ? value.split(',').map((candidate) => candidate.trim().split(/\s+/)[0])
        : [value.trim()];
      candidates.forEach((reference, index) => {
        const prefix = reference ? relativeAssetPrefix(reference, prefixes) : null;
        if (!prefix) return;
        const quotedStart = attribute[2] !== undefined && index === 0 && value.startsWith(reference);
        hits.push({ line: lineAt(tag.index), attribute: name, reference, prefix, quotedStart });
      });
    }
  }
  for (const match of text.matchAll(CSS_URL)) {
    const prefix = relativeAssetPrefix(match[2], prefixes);
    if (prefix) hits.push({ line: lineAt(match.index), attribute: 'url()', reference: match[2], prefix, quotedStart: false });
  }
  return hits;
}

export function baseHref(html) {
  return /<base\b[^>]*?\shref\s*=\s*["']([^"']*)["']/i.exec(String(html))?.[1] ?? null;
}

/**
 * Where the browser takes a relative reference on one page. Without a <base> it resolves against the
 * page URL; a <base href> pointing at the site root makes it work, which is the only rescue.
 */
export function resolveRelativeReference(reference, { pageUrl = null, base = null } = {}) {
  const fallback = 'https://page.invalid/';
  let page;
  try { page = new URL(pageUrl ?? fallback); } catch { page = new URL(fallback); }
  let effective = page;
  if (base !== null) {
    try { effective = new URL(base, page); } catch { /* an unusable base is ignored, as by browsers */ }
  }
  let resolved = null;
  try { resolved = new URL(reference, effective).pathname; } catch { /* unresolvable stays null */ }
  const fromRoot = new URL(reference, fallback).pathname;
  return {
    resolvesTo: pageUrl !== null || base !== null ? resolved : null,
    rescuedByBase: base !== null && resolved === fromRoot,
    pagePath: pageUrl === null ? null : page.pathname,
    rootPath: fromRoot,
  };
}

async function captureUrl(domFile) {
  const id = path.basename(domFile, '.html');
  const record = await readJsonIfExists(path.join(path.dirname(path.dirname(domFile)), 'http', `${id}.json`), { lenient: true });
  return record?.finalUrl ?? record?.requestedUrl ?? null;
}

async function domReferences(directory, prefixes) {
  const files = (await walk(directory)).filter((file) => file.endsWith('.html'));
  const scanned = await mapPool(files, 16, async (file) => {
    const html = await readFile(file, 'utf8');
    const hits = findRelativeAssetReferences(html, { prefixes });
    return { file, hits, base: hits.length ? baseHref(html) : null, pageUrl: hits.length ? await captureUrl(file) : null };
  });
  const failed = scanned.find((entry) => !entry.ok);
  if (failed) throw new HarnessError(`Cannot read a DOM snapshot: ${failed.error.message}`);
  return { files: files.length, pages: scanned.map((entry) => entry.value) };
}

/**
 * One finding per distinct reference: a 14 regression (error), rescued by a root <base href>, or
 * already relative in the baseline capture (warnings). `rewrittenPrefixes` are the prefixes TYPO3 13
 * rewrote, so a regression can say whether the upgrade broke it or it never worked below the root.
 */
export function domFindings(pages, { root, baseline = null, rewrittenPrefixes = THIRTEEN_REWRITTEN_PREFIXES }) {
  const groups = new Map();
  for (const page of pages) {
    for (const hit of page.hits) {
      const where = resolveRelativeReference(hit.reference, { pageUrl: page.pageUrl, base: page.base });
      const key = `${hit.attribute}\u0000${hit.reference}`;
      const status = where.rescuedByBase ? 'base-href' : baseline?.has(key) ? 'pre-existing' : 'regression';
      const rewrittenBy13 = hit.quotedStart && rewrittenPrefixes.some((prefix) => hit.reference.startsWith(prefix));
      const groupKey = `${key}\u0000${status}\u0000${rewrittenBy13}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          attribute: hit.attribute, reference: hit.reference, status, rewrittenBy13, occurrences: 0,
          first: { file: toPosix(path.relative(root, page.file)), line: hit.line }, files: new Set(), pages: new Set(), resolvesTo: new Set(),
        });
      }
      const group = groups.get(groupKey);
      group.occurrences += 1;
      group.files.add(toPosix(path.relative(root, page.file)));
      if (where.pagePath) group.pages.add(where.pagePath);
      if (where.resolvesTo) group.resolvesTo.add(where.resolvesTo);
      // The first page (in capture order) where the reference really goes astray serves as evidence.
      if (!group.example && where.pagePath && where.resolvesTo && where.resolvesTo !== where.rootPath) {
        group.example = { page: where.pagePath, resolvesTo: where.resolvesTo };
      }
    }
  }
  const findings = [];
  for (const group of groups.values()) {
    const pagesList = [...group.pages].sort(byText);
    const resolved = [...group.resolvesTo].sort(byText);
    const shown = group.attribute === 'url()' ? `url(${group.reference})` : `${group.attribute}="${group.reference}"`;
    const absolute = `/${group.reference.replace(/^\.\//, '').split(/[?#]/)[0]}`;
    const spread = plural(group.files.size, 'captured page');
    let severity = 'error';
    let message;
    if (group.status === 'regression') {
      const example = group.example
        ? ` On ${group.example.page} the browser requests ${group.example.resolvesTo} and receives the soft-404 page instead of the resource.`
        : ' Below the site root the browser resolves it against the page URL and receives the soft-404 page instead of the resource.';
      const cause = group.rewrittenBy13
        ? `TYPO3 14 no longer rewrites it to ${absolute} (Breaking-108114).`
        : 'TYPO3 13 did not rewrite this form either (only double-quoted values starting with _assets/, typo3temp/, typo3conf/ext/ or an additionalAbsRefPrefixDirectories entry), so it may predate the upgrade; --baseline-dom-dir tells.';
      message = `${shown} is relative. ${cause}${example} Found on ${spread}.`;
    } else if (group.status === 'base-href') {
      severity = 'warning';
      message = `${shown} is relative and works only because the page has a <base href> pointing at the site root; it breaks wherever the base element goes. Found on ${spread}.`;
    } else {
      severity = 'warning';
      message = `${shown} is relative in the baseline capture too, so it is not a TYPO3 14 regression, but on URLs below the site root it never loaded. Found on ${spread}.`;
    }
    findings.push(finding('relative-links', 'relative-asset-dom', severity, group.first.file, group.first.line, message,
      `Emit an absolute path (${absolute}) where this URL is produced: the Fluid template, the ViewHelper or extension that builds it, or the TypoScript; prefer a URI ViewHelper, f:uri.resource or the System Resource API over string concatenation.`,
      {
        attribute: group.attribute, reference: group.reference, status: group.status, rewrittenBy13: group.rewrittenBy13,
        occurrences: group.occurrences, files: [...group.files].sort(byText).slice(0, 10), pages: pagesList.slice(0, 10),
        resolvesTo: resolved.slice(0, 5),
      }));
  }
  return findings;
}

function referenceFinding(file, hit, sourceKind) {
  const shown = hit.attribute === 'url()' ? `url(${hit.reference})` : `${hit.attribute}="${hit.reference}"`;
  const absolute = `/${hit.reference.replace(/^\.\//, '')}`;
  return finding('relative-links', 'relative-asset-template', 'warning', file, hit.line,
    `${shown} in ${sourceKind === 'fluid' ? 'a Fluid template' : 'TypoScript'} is relative, so it resolves against the page URL and fails below the site root; TYPO3 14 rewrites no relative link in the response any more (Breaking-108114).`,
    `Emit an absolute path, e.g. ${absolute}, in the template or ViewHelper, or build the URL with f:uri.resource or a URI ViewHelper.`,
    { attribute: hit.attribute, reference: hit.reference, source: sourceKind });
}

/** additionalAbsRefPrefixDirectories from settings.php/additional.php: directories 13 also rewrote. */
export function additionalAbsRefPrefixDirectories(phpSource) {
  const found = [];
  for (const match of String(phpSource).matchAll(/additionalAbsRefPrefixDirectories['"]\s*(?:\]\s*=|=>)\s*(['"])(.*?)\1/g)) {
    found.push(...match[2].split(',').map((value) => value.trim()).filter(Boolean));
  }
  return found;
}

function normalizePrefix(prefix) {
  const value = String(prefix).trim().replace(/^\/+/, '');
  return value && !value.endsWith('/') ? `${value}/` : value;
}

/* ------------------------------------------------------------------ class references (#20) */

// Real-site-tested shape: three or more segments, each starting upper-case, joined by one backslash or
// an escaped pair (YAML double quotes, PHP strings). Namespace prefixes ending in a backslash
// (Vendor\Ext\ in Services.yaml) do not match; one-letter segments are regex escapes (\D\S\W), not
// namespaces, and are dropped.
const FQCN = /(?<![A-Za-z0-9_\\])\\{0,2}((?:[A-Z][A-Za-z0-9_]*\\{1,2}){2,}[A-Z][A-Za-z0-9_]*)(?![A-Za-z0-9_\\])/g;

export function classNamesIn(text) {
  return [...String(text).matchAll(FQCN)]
    .map((match) => ({ name: match[1].replace(/\\\\/g, '\\'), index: match.index }))
    .filter(({ name }) => name.split('\\').every((segment) => segment.length > 1));
}

function stripYamlComment(line) {
  let quote = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '#' && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index);
    }
  }
  return line;
}

/**
 * String literals of a PHP file with the line each starts on. Comments are skipped, so a commented-out
 * class name is not a finding. Values stay raw (escapes unprocessed): the class pattern accepts both
 * `\` and `\\`, and raw text keeps line arithmetic exact.
 */
export function phpStringLiterals(source) {
  const text = String(source);
  const literals = [];
  const open = text.indexOf('<?');
  if (open === -1) return literals;
  let line = 1 + countNewlines(text.slice(0, open));
  let index = open + 2;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '\n') {
      line += 1;
      index += 1;
    } else if ((char === '#' && next !== '[') || (char === '/' && next === '/')) {
      while (index < text.length && text[index] !== '\n' && !text.startsWith('?>', index)) index += 1;
    } else if (char === '/' && next === '*') {
      const end = text.indexOf('*/', index + 2);
      const stop = end === -1 ? text.length : end + 2;
      line += countNewlines(text.slice(index, stop));
      index = stop;
    } else if (char === "'" || char === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== char) end += text[end] === '\\' ? 2 : 1;
      const value = text.slice(index + 1, Math.min(end, text.length));
      literals.push({ value, line, quote: char });
      line += countNewlines(value);
      index = end + 1;
    } else if (char === '<' && text.startsWith('<<<', index)) {
      const header = /^<<<[ \t]*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n/.exec(text.slice(index, index + 256));
      if (!header) {
        index += 3;
        continue;
      }
      const bodyStart = index + header[0].length;
      const closing = new RegExp(`\\n[ \\t]*${header[2]}\\b`, 'g');
      closing.lastIndex = bodyStart - 1;
      const match = closing.exec(text);
      const value = text.slice(bodyStart, match ? Math.max(bodyStart, match.index) : text.length);
      literals.push({ value, line: line + 1, quote: header[1] === "'" ? "'" : '"' });
      const stop = match ? match.index + match[0].length : text.length;
      line += countNewlines(text.slice(index, stop));
      index = stop;
    } else {
      index += 1;
    }
  }
  return literals;
}

/** Class names with their line in a TypoScript, YAML, XML or PHP source. */
export function extractClassReferences(text, kind) {
  const out = [];
  const add = (lineText, line) => {
    for (const { name } of classNamesIn(lineText)) out.push({ name, line });
  };
  if (kind === 'typoscript') {
    for (const entry of typoscriptLines(text)) add(entry.text, entry.line);
  } else if (kind === 'yaml') {
    String(text).split('\n').forEach((raw, index) => {
      if (!raw.trim().startsWith('#')) add(stripYamlComment(raw), index + 1);
    });
  } else if (kind === 'xml') {
    String(text).replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '))
      .split('\n').forEach((raw, index) => add(raw, index + 1));
  } else if (kind === 'php') {
    for (const literal of phpStringLiterals(text)) {
      for (const { name, index } of classNamesIn(literal.value)) {
        out.push({ name, line: literal.line + countNewlines(literal.value.slice(0, index)) });
      }
    }
  } else {
    throw new HarnessError(`Unknown class reference source kind: ${kind}`);
  }
  return out;
}

const SOURCE_LABELS = Object.freeze({
  typoscript: 'TypoScript or TSconfig', yaml: 'YAML', xml: 'XML', php: 'class names inside PHP strings', db: 'database TypoScript or TSconfig',
});

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

const uniqueLines = (items) => [...new Set(items.map((item) => item.line))].sort((a, b) => a - b);

function suggestionText(probe, name) {
  const suggestions = probe.suggestions?.[name] ?? [];
  return suggestions.length ? ` Same short name in this install: ${suggestions.join(', ')}.` : '';
}

function aliasFinding(check, rule, file, line, name, canonical, detail) {
  const caseOnly = name.toLowerCase() === canonical.toLowerCase();
  return finding(check, rule, 'warning', file, line,
    caseOnly
      ? `${name} is declared as ${canonical}. The autoloader is case-sensitive on Linux, so this spelling works only when the class was already loaded under its real name.`
      : `${name} exists only as a class alias of ${canonical}; aliases are dropped in a later major.`,
    `Reference ${canonical} directly.`, { name, canonical, ...detail });
}

/** Findings for class names found outside PHP code, judged by the probe of the installed project. */
export function classReferenceFindings(occurrences, probe) {
  const findings = [];
  for (const group of groupBy(occurrences, (item) => `${item.name}\u0000${item.file}`).values()) {
    const { name, file, source } = group[0];
    const lines = uniqueLines(group);
    const detail = { name, source, lines };
    if (probe.namespaces?.[name]) continue;
    const exists = probe.results?.[name];
    if (exists === true) {
      const canonical = probe.canonical?.[name];
      if (canonical) findings.push(aliasFinding('class-refs', 'class-ref-alias', file, lines[0], name, canonical, detail));
      continue;
    }
    if (exists !== false) continue;
    if (probe.errors?.[name]) {
      findings.push(finding('class-refs', 'class-ref-unloadable', 'error', file, lines[0],
        `${name} is named in ${SOURCE_LABELS[source] ?? source} and exists, but cannot be loaded: ${probe.errors[name]}`,
        'Fix the class (or the parent, interface or signature it depends on) so it loads on TYPO3 14; the message is PHP\'s own.', detail));
      continue;
    }
    findings.push(finding('class-refs', 'class-ref-missing', 'error', file, lines[0],
      `${name} does not exist in this install (no class, interface, trait or enum). Rector, Fractor and the extension scanner do not read ${SOURCE_LABELS[source] ?? source}, so nothing else reports it; it fails when a request reaches this configuration.${suggestionText(probe, name)}`,
      'Replace it with its TYPO3 14 successor (changelog, or the class named above) or remove the configuration that uses it.',
      { ...detail, suggestions: probe.suggestions?.[name] ?? [] }));
  }
  return findings;
}

/* ------------------------------------------------------------------ parseFunc (#41) */

const PARSEFUNC_FIX = "Keep fluid_styled_content 13.4's Configuration/TypoScript/Helper/ParseFunc.typoscript in the site package (its constants inlined) and import it before this override, or rebuild the override against TYPO3 14's core lib.parseFunc / lib.parseFunc_RTE; then compare RTE output on the 14 rung.";

/** parseFunc statements whose meaning changed when fluid_styled_content's parseFunc went away. */
export function findParseFuncOverrides(text) {
  const hits = [];
  for (const statement of typoscriptStatements(text)) {
    const objectPath = statement.fullPath;
    if (statement.operator === '{') continue;
    const base = { line: statement.line, path: objectPath, operator: statement.operator, value: statement.value };
    if (/(^|\.)allowTags$/.test(objectPath) && statement.operator === ':=') {
      hits.push({ rule: 'parsefunc-allowtags', ...base });
    } else if (/^lib\.parseFunc(_RTE)?(\.|$)/.test(objectPath)) {
      hits.push({ rule: 'parsefunc-override', root: objectPath.startsWith('lib.parseFunc_RTE') ? 'lib.parseFunc_RTE' : 'lib.parseFunc', ...base });
    } else if (/^styles\.content\.links(\.|$)/.test(objectPath)) {
      hits.push({ rule: 'parsefunc-links-constant', ...base });
    }
  }
  return hits;
}

export function parseFuncFindings(document, hits) {
  const findings = [];
  for (const hit of hits.filter((item) => item.rule === 'parsefunc-allowtags')) {
    const addToList = /^addToList\s*\(/i.test(hit.value);
    findings.push(finding('parsefunc', 'parsefunc-allowtags', 'warning', document.display, hit.line,
      addToList
        ? `${hit.path} := ${hit.value} extended the tag list fluid_styled_content's parseFunc set on 13.4. TYPO3 14 sets no allowTags (Breaking-107438), so this line now allows only these tags and every other RTE tag is escaped.`
        : `${hit.path} := ${hit.value} modifies a list TYPO3 14 no longer sets (Breaking-107438); the result differs from 13.4.`,
      `${PARSEFUNC_FIX} Or drop the line: TYPO3 14 allows every tag and the HTML sanitizer decides; set allowTags explicitly only to restrict output.`,
      { path: hit.path, value: hit.value, ...rowDetail(document) }));
  }
  for (const [root, group] of groupBy(hits.filter((item) => item.rule === 'parsefunc-override'), (item) => item.root)) {
    findings.push(finding('parsefunc', 'parsefunc-override', 'warning', document.display, group[0].line,
      `${plural(group.length, 'line')} override ${root}, which fluid_styled_content no longer provides on TYPO3 14 (Breaking-107438); the override now applies to the core parseFunc and may mean something else.`,
      PARSEFUNC_FIX,
      { root, lines: uniqueLines(group), paths: [...new Set(group.map((item) => item.path))].slice(0, 20), ...rowDetail(document) }));
  }
  const constants = hits.filter((item) => item.rule === 'parsefunc-links-constant');
  if (constants.length) {
    findings.push(finding('parsefunc', 'parsefunc-links-constant', 'warning', document.display, constants[0].line,
      `styles.content.links.* (${[...new Set(constants.map((item) => item.path))].join(', ')}) is no longer read: the fluid_styled_content parseFunc that used it is gone in TYPO3 14 (Breaking-107438), so external-link target and keep silently fall back to the core defaults.`,
      `${PARSEFUNC_FIX} For link handling alone, set lib.parseFunc_RTE.makelinks.http.extTarget / keep explicitly.`,
      { lines: uniqueLines(constants), paths: [...new Set(constants.map((item) => item.path))], ...rowDetail(document) }));
  }
  return findings;
}

/* ------------------------------------------------------------------ site-package PHP (#42) */

const VIA_LABELS = Object.freeze({
  use: 'imported', extends: 'extended', implements: 'implemented', trait: 'used as trait', attribute: 'used as attribute',
  'class-constant': '::class', static: 'static access', new: 'new', makeInstance: 'makeInstance()',
});

function requiredParameters(constructor) {
  return constructor.parameters.filter((parameter) => !parameter.optional)
    .map((parameter) => (parameter.type ? `${parameter.type} $${parameter.name}` : `$${parameter.name}`)).join(', ');
}

/**
 * Findings for site-package PHP: facts from site-package-class-check.php (what the package says),
 * judged by class-exists-check.php --describe (what the installed core looks like).
 */
export function phpClassFindings(facts, probe) {
  const findings = [];
  const declared = new Map();
  for (const declaration of facts.declarations ?? []) {
    if (!declaration.anonymous) declared.set(declaration.name.toLowerCase(), declaration);
  }
  for (const error of facts.parseErrors ?? []) {
    findings.push(finding('php-classes', 'php-parse-error', 'error', error.file, error.line,
      `${facts.php ? `PHP ${facts.php}` : 'PHP'} cannot parse this file: ${error.message}.`,
      'Fix the syntax for the project PHP version; until then nothing declared in this file loads.', {}));
  }

  const inheritance = new Set();
  for (const declaration of facts.declarations ?? []) {
    if (declaration.kind !== 'class') continue;
    for (const parent of declaration.extends ?? []) {
      const shape = probe.shapes?.[parent];
      if (!shape) continue;
      const detail = { class: declaration.name, parent, parentFile: shape.file ?? null };
      if (shape.final) {
        inheritance.add(declaration.name.toLowerCase());
        findings.push(finding('php-classes', 'php-extends-final', 'error', declaration.file, declaration.line,
          `${declaration.name} extends ${parent}, which is final in this install. PHP refuses to load the class (fatal error), so every request that touches it fails.`,
          'Stop extending it: use composition, a PSR-14 event or the documented extension point that replaced subclassing.', detail));
      }
      if (typeof shape.readonly === 'boolean' && shape.readonly !== Boolean(declaration.readonly)) {
        inheritance.add(declaration.name.toLowerCase());
        findings.push(finding('php-classes', 'php-readonly-mismatch', 'error', declaration.file, declaration.line,
          shape.readonly
            ? `${declaration.name} is not readonly but extends ${parent}, which is readonly in this install. PHP refuses to load it: "Non-readonly class ${declaration.name} cannot extend readonly class ${parent}".`
            : `${declaration.name} is readonly but extends ${parent}, which is not. PHP refuses to load it: "Readonly class ${declaration.name} cannot extend non-readonly class ${parent}".`,
          shape.readonly
            ? 'Declare the class readonly (every property typed and assigned once), or stop extending the core class and compose it instead.'
            : 'Remove readonly from the class, or stop extending the parent.',
          detail));
      }
    }
  }

  const references = (facts.references ?? []).filter((reference) => reference.via !== 'namespace-use');
  for (const group of groupBy(references, (item) => `${item.name}\u0000${item.file}`).values()) {
    const { name, file } = group[0];
    const lines = uniqueLines(group);
    const via = [...new Set(group.map((item) => item.via))].sort(byText);
    const detail = { name, via, lines };
    if (probe.namespaces?.[name]) continue;
    const exists = probe.results?.[name];
    if (exists === true) {
      const canonical = probe.canonical?.[name];
      if (canonical) findings.push(aliasFinding('php-classes', 'php-class-alias', file, lines[0], name, canonical, detail));
      continue;
    }
    if (exists !== false || declared.has(name.toLowerCase())) continue; // local classes are judged at their declaration
    if (probe.errors?.[name]) {
      findings.push(finding('php-classes', 'php-unloadable-class', 'error', file, lines[0],
        `${name} (${via.map((item) => VIA_LABELS[item] ?? item).join(', ')}) exists but cannot be loaded here: ${probe.errors[name]}`,
        'Fix the loading error; on an upgrade it is usually a parent class, interface or method signature that changed in TYPO3 14.', detail));
      continue;
    }
    const guarded = group.every((item) => item.guarded);
    findings.push(finding('php-classes', 'php-missing-class', guarded ? 'warning' : 'error', file, lines[0],
      `${name} (${via.map((item) => VIA_LABELS[item] ?? item).join(', ')}) does not exist in this install, so PHP fails where this file uses it.${guarded ? ' Every use is guarded by class_exists() or similar, so it reads as an optional dependency; confirm that.' : ''}${suggestionText(probe, name)}`,
      'Import the class from its new location, or replace it as the TYPO3 14 changelog describes; delete the import if nothing uses it.',
      { ...detail, guarded, suggestions: probe.suggestions?.[name] ?? [] }));
  }

  for (const declaration of declared.values()) {
    const name = declaration.name;
    if (probe.results?.[name] !== false) continue;
    if (probe.errors?.[name]) {
      if (inheritance.has(name.toLowerCase())) continue; // already explained, more precisely
      findings.push(finding('php-classes', 'php-unloadable-class', 'error', declaration.file, declaration.line,
        `${name} is declared here but cannot be loaded on this install: ${probe.errors[name]}`,
        'This is PHP\'s own verdict on the declaration: adapt the class to the TYPO3 14 parent or interface (signature, readonly, final, abstract methods).',
        { name, local: true }));
    } else {
      findings.push(finding('php-classes', 'php-class-not-autoloadable', 'warning', declaration.file, declaration.line,
        `${name} is declared here, but the project autoloader cannot find it.`,
        'Check the package\'s composer.json autoload (PSR-4 prefix and path) and that the package is installed, then run composer dump-autoload.',
        { name, local: true }));
    }
  }

  const calls = (facts.instantiations ?? []).filter((call) => !call.spread && Number.isInteger(call.arguments));
  for (const group of groupBy(calls, (item) => `${item.name}\u0000${item.file}\u0000${item.via}\u0000${item.arguments}`).values()) {
    const { name, file, via, arguments: passed } = group[0];
    const shape = probe.shapes?.[name];
    const constructor = shape?.constructor;
    if (!shape || shape.kind !== 'class' || shape.abstract || !constructor || passed >= constructor.required) continue;
    if (via === 'makeInstance' && shape.publicService) continue;
    const lines = uniqueLines(group);
    const detail = {
      name, via, arguments: passed, required: constructor.required, constructorClass: constructor.class,
      parameters: constructor.parameters, publicService: shape.publicService ?? null, lines,
    };
    const signature = requiredParameters(constructor);
    if (via === 'new') {
      findings.push(finding('php-classes', 'php-constructor-arity', 'error', file, lines[0],
        `new ${name}() passes ${plural(passed, 'argument')} but the constructor (${constructor.class}) requires ${constructor.required}: ${signature}. This throws ArgumentCountError.`,
        'Pass the required arguments, or obtain the instance through dependency injection.', detail));
    } else {
      findings.push(finding('php-classes', 'php-constructor-arity', 'warning', file, lines[0],
        `GeneralUtility::makeInstance(${name}::class) passes ${plural(passed, 'constructor argument')} but the constructor (${constructor.class}) requires ${constructor.required}: ${signature}. makeInstance() autowires only container-public services and otherwise calls new, which throws ArgumentCountError; a content object's exception handler can swallow that and render the element empty.`,
        'Inject the class through the constructor of the calling class (Services.yaml autowiring), or pass the required arguments explicitly. If the class is a public service, record the evidence and ignore this warning.',
        detail));
    }
  }
  return findings;
}

/* ------------------------------------------------------------------ PHP bridge */

/** Split a command prefix such as `ddev exec php` or `"/opt/php 8/bin/php"`. */
export function splitCommand(command) {
  const parts = [...String(command ?? '').matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3]);
  if (!parts.length) throw new HarnessError('--php must name a command');
  return parts;
}

function spawnCapture(command, args, { cwd, timeoutMs }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ status: null, stdout: '', stderr: '', error });
      return;
    }
    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => settle({ status: null, stdout: '', stderr: '', error }));
    child.on('close', (status, signal) => settle({
      status, signal, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'),
    }));
    child.stdin.on('error', () => {}); // the command may exit without reading stdin
    child.stdin.end();
  });
}

function parseJsonOutput(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // A container prefix may print a line of its own before the helper's JSON.
    const last = text.split('\n').reverse().find((line) => line.trim().startsWith('{'));
    try { return last ? JSON.parse(last) : null; } catch { return null; }
  }
}

const lastLine = (text) => String(text ?? '').trim().split('\n').at(-1) ?? '';

/**
 * Runs the PHP helpers through the configured command prefix. They are copied into the project
 * (--tools-dir) because a container sees the project, not this skill directory; every path handed to
 * PHP is relative to the project root, which is the working directory on the host and in DDEV alike.
 */
export function createPhpBridge({ project, command = 'php', autoload = null, toolsDir = null, spawnFn = spawnCapture, timeoutMs = 600_000 }) {
  const prefix = splitCommand(command);
  const root = project.root;
  const tools = path.resolve(root, toolsDir ?? path.join('.typo3-update', 'tools'));
  const autoloadFile = path.resolve(root, autoload ?? path.join(path.relative(root, project.vendorDir), 'autoload.php'));
  const relative = (absolute) => toPosix(path.relative(root, absolute)) || '.';
  let installed = false;

  async function install() {
    if (installed) return;
    await mkdir(tools, { recursive: true });
    for (const helper of Object.values(PHP_HELPERS)) await copyFile(path.join(SCRIPT_DIR, helper), path.join(tools, helper));
    installed = true;
  }

  async function run(helper, args) {
    await install();
    const argv = [...prefix, relative(path.join(tools, helper)), ...args];
    const result = await spawnFn(argv[0], argv.slice(1), { cwd: root, timeoutMs });
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new PreconditionError(`PHP command not found: "${prefix[0]}". Pass the project's PHP with --php, e.g. --php "ddev exec php".`);
      }
      throw new HarnessError(`${helper}: ${result.error.message}`);
    }
    if (result.status === 4) {
      throw new PreconditionError(`${helper}: the project autoloader is missing or broken (${lastLine(result.stderr)}). Run composer install or dump-autoload, or pass --autoload.`);
    }
    const json = parseJsonOutput(result.stdout);
    if (!json) throw new HarnessError(`${helper} printed no JSON (exit ${result.status}): ${lastLine(result.stderr) || 'no output on stderr'}`);
    return json;
  }

  return {
    command: prefix.join(' '),
    async facts(directories) {
      const json = await run(PHP_HELPERS.facts, directories.map(relative));
      if (json.schema !== 'typo3-upgrade-run/php-class-facts@1') throw new HarnessError('site-package-class-check.php returned an unexpected document.');
      return json;
    },
    async probe(names, { describe = false } = {}) {
      await install();
      const input = path.join(tools, `class-exists-input-${process.pid}.json`);
      await writeFile(input, JSON.stringify(names), 'utf8');
      try {
        return await run(PHP_HELPERS.probe, [...(describe ? ['--describe'] : []), `--input=${relative(input)}`, relative(autoloadFile)]);
      } finally {
        await rm(input, { force: true });
      }
    },
  };
}

/**
 * Probe every name, restarting after a class that kills the PHP process (an uncatchable compile error
 * or an exit in its file). The killer is recorded as unloadable and the rest is probed again, so one
 * broken class costs one restart, never the run.
 */
export async function verifyClassNames(names, invoke) {
  let pending = [...new Set(names)].sort(byText);
  const merged = { results: {}, errors: {}, canonical: {}, namespaces: {}, suggestions: {}, shapes: {}, runs: 0, fatal: [] };
  while (pending.length) {
    if (merged.runs > names.length) throw new HarnessError('The class probe made no progress.');
    merged.runs += 1;
    const envelope = await invoke(pending);
    if (envelope?.schema !== 'typo3-upgrade-run/class-exists@1' || typeof envelope.results !== 'object' || envelope.results === null) {
      throw new HarnessError('class-exists-check.php returned an unexpected document.');
    }
    for (const key of ['results', 'errors', 'canonical', 'namespaces', 'suggestions', 'shapes']) Object.assign(merged[key], envelope[key] ?? {});
    if (!envelope.complete) {
      const failed = envelope.fatal?.name;
      if (!failed || !pending.includes(failed)) {
        throw new HarnessError(`The class probe stopped outside a class check: ${envelope.fatal?.message ?? 'no detail'}`);
      }
      merged.results[failed] = false;
      merged.errors[failed] = `PHP stopped while loading it: ${envelope.fatal.message}`;
      merged.fatal.push({ name: failed, message: envelope.fatal.message });
    }
    const before = pending.length;
    pending = pending.filter((name) => !Object.hasOwn(merged.results, name));
    if (envelope.complete && pending.length) throw new HarnessError(`The class probe skipped ${pending.length} name(s).`);
    if (pending.length === before) throw new HarnessError('The class probe made no progress.');
  }
  return merged;
}

/* ------------------------------------------------------------------ project, sources, inputs */

async function statOrNull(file) {
  try { return await stat(file); } catch { return null; }
}
async function isFile(file) { return Boolean((await statOrNull(file))?.isFile()); }
async function isDir(file) { return Boolean((await statOrNull(file))?.isDirectory()); }
async function realpathOrNull(file) {
  try { return await realpath(file); } catch { return null; }
}

async function listFiles(directory) {
  let entries;
  try { entries = await readdir(directory); } catch { return []; }
  const files = [];
  for (const name of entries.sort(byText)) {
    if (await isFile(path.join(directory, name))) files.push(path.join(directory, name));
  }
  return files;
}

async function subdirectories(directory) {
  let entries;
  try { entries = await readdir(directory); } catch { return []; }
  const out = [];
  for (const name of entries.sort(byText)) {
    if (!SKIP_DIRS.has(name) && await isDir(path.join(directory, name))) out.push(path.join(directory, name));
  }
  return out;
}

/** Files below a directory, sorted, following symlinks once; `skip(relativePath)` prunes a directory. */
async function walk(directory, { skip = () => false, limit = 200_000 } = {}) {
  const files = [];
  const seen = new Set();
  async function visit(current, relative) {
    const real = await realpathOrNull(current);
    if (!real || seen.has(real)) return;
    seen.add(real);
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => byText(a.name, b.name));
    for (const entry of entries) {
      const absolute = path.join(current, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      let directoryEntry = entry.isDirectory();
      let fileEntry = entry.isFile();
      if (entry.isSymbolicLink()) {
        const target = await statOrNull(absolute);
        directoryEntry = Boolean(target?.isDirectory());
        fileEntry = Boolean(target?.isFile());
      }
      if (directoryEntry) {
        if (!SKIP_DIRS.has(entry.name) && !skip(childRelative)) await visit(absolute, childRelative);
      } else if (fileEntry) {
        files.push(absolute);
        if (files.length > limit) throw new HarnessError(`More than ${limit} files below ${directory}; pass --package-dir to narrow the scan.`);
      }
    }
  }
  await visit(directory, '');
  return files;
}

async function readJsonIfExists(file, { lenient = false } = {}) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    if (lenient) return null;
    throw new HarnessError(`Cannot read ${file}: ${error.message}`);
  }
  try { return JSON.parse(text); } catch (error) {
    if (lenient) return null;
    throw new HarnessError(`${file} is not valid JSON: ${error.message}`);
  }
}

async function readText(file) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return null; }
  return text.includes('\u0000') ? null : text;
}

function composerPathRepositories(composer) {
  const repositories = Array.isArray(composer?.repositories) ? composer.repositories : Object.values(composer?.repositories ?? {});
  return repositories.filter((repository) => repository?.type === 'path' && typeof repository.url === 'string').map((repository) => repository.url);
}

async function expandPathRepository(root, pattern) {
  const absolute = path.resolve(root, pattern.replace(/\/+$/, ''));
  const base = path.basename(absolute);
  if (!base.includes('*')) return (await isDir(absolute)) ? [absolute] : [];
  if (path.dirname(absolute).includes('*')) return [];
  const [left, right] = base.split('*');
  return (await subdirectories(path.dirname(absolute))).filter((directory) => {
    const name = path.basename(directory);
    return name.startsWith(left) && name.endsWith(right ?? '');
  });
}

/**
 * The project: Composer layout, local packages (Composer path repositories, packages/*, non-vendor
 * typo3conf/ext/*) and every installed extension key with its directory, for EXT: resolution.
 */
export async function discoverProject(projectRoot, { packageDirs = [] } = {}) {
  const root = path.resolve(projectRoot);
  if (!await isDir(root)) throw new PreconditionError(`The project root is not a directory: ${root}`);
  const composer = await readJsonIfExists(path.join(root, 'composer.json'));
  const vendorDir = path.resolve(root, composer?.config?.['vendor-dir'] ?? 'vendor');
  const configuredWebDir = composer?.extra?.['typo3/cms']?.['web-dir'];
  const webDir = path.resolve(root, configuredWebDir ?? ((await isDir(path.join(root, 'public'))) ? 'public' : '.'));

  const candidates = [];
  if (packageDirs.length) {
    for (const directory of packageDirs) {
      const absolute = path.resolve(root, directory);
      if (!await isDir(absolute)) throw new PreconditionError(`--package-dir is not a directory: ${directory}`);
      candidates.push(absolute);
    }
  } else {
    for (const pattern of composerPathRepositories(composer)) candidates.push(...await expandPathRepository(root, pattern));
    candidates.push(...await subdirectories(path.join(root, 'packages')));
    for (const extensions of new Set([path.join(webDir, 'typo3conf', 'ext'), path.join(root, 'typo3conf', 'ext')])) {
      candidates.push(...await subdirectories(extensions));
    }
  }
  const vendorReal = await realpathOrNull(vendorDir);
  const seen = new Set();
  const packages = [];
  for (const directory of candidates) {
    const real = await realpathOrNull(directory);
    if (!real || seen.has(real)) continue;
    // Composer installs (and v11 symlinks into vendor/) are third-party code, maintained upstream.
    if (vendorReal && (real === vendorReal || real.startsWith(vendorReal + path.sep))) continue;
    seen.add(real);
    const manifest = await readJsonIfExists(path.join(directory, 'composer.json'), { lenient: true });
    packages.push({
      dir: directory, real, rel: toPosix(path.relative(root, directory)),
      key: manifest?.extra?.['typo3/cms']?.['extension-key'] ?? path.basename(directory),
    });
  }
  packages.sort((a, b) => byText(a.rel, b.rel));

  const extensionPaths = new Map();
  const installed = await readJsonIfExists(path.join(vendorDir, 'composer', 'installed.json'), { lenient: true });
  const installedList = Array.isArray(installed) ? installed : installed?.packages;
  for (const pkg of Array.isArray(installedList) ? installedList : []) {
    if (!pkg?.['install-path'] || !/^typo3-cms-(extension|framework)$/.test(pkg.type ?? '')) continue;
    const key = pkg.extra?.['typo3/cms']?.['extension-key'] ?? String(pkg.name ?? '').split('/')[1]?.replace(/-/g, '_');
    if (key) extensionPaths.set(key, path.resolve(vendorDir, 'composer', pkg['install-path']));
  }
  const sysext = path.join(webDir, 'typo3', 'sysext');
  for (const directory of await subdirectories(sysext)) extensionPaths.set(path.basename(directory), directory);
  for (const pkg of packages) extensionPaths.set(pkg.key, pkg.dir);

  return {
    root, composer, vendorDir, webDir, packages, extensionPaths,
    extensionMapComplete: Array.isArray(installedList) || await isDir(sysext),
  };
}

async function collectSources(project) {
  const sources = { typoscript: [], templates: [], classFiles: [], settingsFiles: [] };
  const seen = new Set();
  const once = async (file) => {
    const real = (await realpathOrNull(file)) ?? file;
    if (seen.has(real)) return false;
    seen.add(real);
    return true;
  };
  for (const pkg of project.packages) {
    for (const file of await walk(pkg.dir, { skip: (relative) => relative === 'Resources/Public' })) {
      if (!await once(file)) continue;
      const inPackage = toPosix(path.relative(pkg.dir, file));
      const context = typoscriptContext(inPackage);
      const extension = path.extname(file).toLowerCase();
      if (context) sources.typoscript.push({ file, context, origin: 'file' });
      else if (extension === '.html' && inPackage.startsWith('Resources/Private/')) sources.templates.push(file);
      else if (extension === '.yaml' || extension === '.yml') sources.classFiles.push({ file, kind: 'yaml' });
      else if (extension === '.xml') sources.classFiles.push({ file, kind: 'xml' });
      else if (extension === '.php' && (inPackage.startsWith('Configuration/') || /^ext_(localconf|tables)\.php$/.test(inPackage))) {
        sources.classFiles.push({ file, kind: 'php' });
      }
    }
  }
  // Site-level TypoScript and TSconfig next to config.yaml (13+), site YAML, and the system settings.
  for (const directory of [path.join(project.root, 'config'), path.join(project.webDir, 'typo3conf', 'sites')]) {
    for (const file of await walk(directory, { skip: (relative) => relative === 'system' })) {
      if (!await once(file)) continue;
      const context = typoscriptContext(toPosix(path.relative(directory, file)));
      if (context) sources.typoscript.push({ file, context, origin: 'file' });
      else if (/\.ya?ml$/i.test(file)) sources.classFiles.push({ file, kind: 'yaml' });
      else if (/\.xml$/i.test(file)) sources.classFiles.push({ file, kind: 'xml' });
    }
  }
  const settings = [
    path.join(project.root, 'config', 'system', 'settings.php'), path.join(project.root, 'config', 'system', 'additional.php'),
    path.join(project.webDir, 'typo3conf', 'system', 'settings.php'), path.join(project.webDir, 'typo3conf', 'system', 'additional.php'),
    path.join(project.webDir, 'typo3conf', 'LocalConfiguration.php'), path.join(project.webDir, 'typo3conf', 'AdditionalConfiguration.php'),
  ];
  for (const file of settings) {
    if (await isFile(file) && await once(file)) {
      sources.classFiles.push({ file, kind: 'php' });
      sources.settingsFiles.push(file);
    }
  }
  return sources;
}

/** Rows of a --db-export file: a JSON array, {"rows": [...]}, or JSON Lines. */
export function parseDbExport(text, label = 'db export') {
  const trimmed = String(text).trim();
  if (!trimmed) return [];
  let rows;
  try {
    const json = JSON.parse(trimmed);
    rows = Array.isArray(json) ? json : Array.isArray(json?.rows) ? json.rows : json && typeof json === 'object' && 'table' in json ? [json] : null;
  } catch {
    rows = trimmed.split('\n').map((line, index) => {
      if (!line.trim()) return null;
      try { return JSON.parse(line); } catch (error) { throw new HarnessError(`${label}: line ${index + 1} is not JSON (${error.message})`); }
    }).filter((row) => row !== null);
  }
  if (!Array.isArray(rows)) throw new HarnessError(`${label}: expected a JSON array, {"rows": [...]} or JSON Lines`);
  return rows.map((row, index) => {
    const where = `${label}: row ${index + 1}`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new HarnessError(`${where} is not an object`);
    if (typeof row.table !== 'string' || !/^[A-Za-z0-9_]+$/.test(row.table)) throw new HarnessError(`${where} needs a "table" name`);
    if (typeof row.field !== 'string' || !/^[A-Za-z0-9_]+$/.test(row.field)) throw new HarnessError(`${where} needs a "field" name`);
    const uid = typeof row.uid === 'string' && /^\d+$/.test(row.uid) ? Number(row.uid) : row.uid;
    if (!Number.isInteger(uid) || uid < 0) throw new HarnessError(`${where} needs a non-negative integer "uid"`);
    if (row.value !== null && row.value !== undefined && typeof row.value !== 'string') throw new HarnessError(`${where}: "value" must be a string or null`);
    return { table: row.table, uid, field: row.field, value: row.value ?? null, pid: row.pid ?? null, title: row.title ?? null };
  }).filter((row) => row.value !== null && row.value !== '');
}

function dbDocument(row) {
  return {
    origin: 'db', file: null, display: `db:${row.table}:${row.uid}:${row.field}`, row, lineOffset: 0,
    context: /^tsconfig$/i.test(row.field) ? 'tsconfig' : 'typoscript', text: row.value,
  };
}

/** TypoScript inside PHP strings (addTypoScriptSetup() and friends) that includes or imports files. */
function phpStringDocuments(display, source) {
  const documents = [];
  for (const literal of phpStringLiterals(source)) {
    if (!literal.value.includes('<INCLUDE_TYPOSCRIPT:') && !/@import\s+['"]EXT:/.test(literal.value)) continue;
    const text = literal.quote === '"'
      ? literal.value.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(["\\$])/g, '$1')
      : literal.value.replace(/\\(['\\])/g, '$1');
    documents.push({ origin: 'php', file: null, display, lineOffset: literal.line - 1, context: 'any', text });
  }
  return documents;
}

async function includeTargets(include, project) {
  const base = resolveResource(include.target, project);
  if (!base.path) return [];
  if (include.type === 'DIR') {
    const wanted = include.extensions.map((extension) => `.${extension.toLowerCase()}`);
    return (await walk(base.path)).filter((file) => !wanted.length || wanted.some((suffix) => file.toLowerCase().endsWith(suffix)));
  }
  return (await isFile(base.path)) ? [base.path] : [];
}

/**
 * Include and import analysis for every TypoScript document. Targets inside the project (fileadmin/,
 * a package file outside the usual directories) are read too, so the other checks see the TypoScript
 * a database template actually pulls in.
 */
async function includePass(documents, extraDocuments, project) {
  const findings = [];
  const known = new Set();
  for (const document of documents) if (document.file) known.add((await realpathOrNull(document.file)) ?? document.file);
  const vendorReal = (await realpathOrNull(project.vendorDir)) ?? project.vendorDir;
  const rootReal = (await realpathOrNull(project.root)) ?? project.root;
  let followed = 0;
  let unverifiable = 0;
  const queue = [...documents, ...extraDocuments];

  const follow = async (file, context) => {
    const real = (await realpathOrNull(file)) ?? file;
    if (known.has(real) || !real.startsWith(rootReal + path.sep) || real.startsWith(vendorReal + path.sep)) return;
    known.add(real);
    const text = await readText(file);
    if (text === null) return;
    const document = {
      origin: 'file', file, display: toPosix(path.relative(project.root, file)), lineOffset: 0,
      context: context === 'any' ? 'typoscript' : context, text, followed: true,
    };
    documents.push(document);
    queue.push(document);
    followed += 1;
  };

  while (queue.length) {
    const document = queue.shift();
    for (const entry of typoscriptLines(document.text)) {
      const line = entry.line + (document.lineOffset ?? 0);
      if (entry.kind === 'include') {
        const include = parseInclude(entry.text);
        const suggestion = suggestImport(include, document.context === 'tsconfig' ? 'tsconfig' : 'typoscript');
        findings.push(finding('includes', 'ts-include-typoscript', 'error', document.display, line,
          `<INCLUDE_TYPOSCRIPT: source="${include.type}:${include.target}"> is dropped by TYPO3 14 without a log entry (Breaking-105377): nothing it included loads. If it carried the PAGE object, every page answers "No page configured for type=0".`,
          includeFix(include, suggestion, document.origin),
          { origin: document.origin, include, suggestion: suggestion.lines, renames: suggestion.renames, ...rowDetail(document) }));
        for (const file of await includeTargets(include, project)) await follow(file, document.context);
      } else if (entry.kind === 'import') {
        const { target } = parseImport(entry.text);
        // CSS in a PHP string also says @import; only EXT: targets are certainly TypoScript there.
        if (document.origin === 'php' && !target?.startsWith('EXT:')) continue;
        if (target === null || target === '') {
          findings.push(importFinding(document, line, target, target === null ? 'unquoted' : 'missing'));
          continue;
        }
        const resolved = await resolveImport(target, { context: document.context, fromFile: document.file, project });
        if (resolved.status === 'loads') {
          for (const file of resolved.files) await follow(file, document.context);
        } else if (resolved.status === 'empty') {
          findings.push(importFinding(document, line, target, resolved.reason));
        } else {
          unverifiable += 1;
          if (legacySuffix(target, document.context)) findings.push(importFinding(document, line, target, 'suffix'));
        }
      }
    }
  }
  return { findings, followed, unverifiable };
}

async function resolveDomDirectory(directory, label) {
  const absolute = path.resolve(directory);
  const nested = path.join(absolute, 'dom');
  const resolved = (await isDir(nested)) ? nested : absolute;
  if (!await isDir(resolved)) throw new PreconditionError(`${label} is not a directory: ${directory}`);
  return resolved;
}

/* ------------------------------------------------------------------ orchestration */

function compareFindings(a, b) {
  return CHECKS.indexOf(a.check) - CHECKS.indexOf(b.check)
    || byText(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || byText(a.rule, b.rule)
    || byText(a.message, b.message);
}

/**
 * Run the selected checks and return the evidence report. `deps.php` replaces the PHP bridge
 * ({facts(dirs), probe(names, {describe})}), which is how the tests run without PHP.
 */
export async function runReadiness(options = {}, deps = {}) {
  const checks = new Set(options.checks ?? CHECKS);
  for (const check of checks) if (!CHECKS.includes(check)) throw new HarnessError(`Unknown check: ${check}`);
  const project = await discoverProject(options.projectRoot ?? process.cwd(), { packageDirs: options.packageDirs ?? [] });
  const sources = await collectSources(project);
  const relative = (file) => toPosix(path.relative(project.root, file));

  const dbRows = [];
  for (const exportFile of options.dbExports ?? []) {
    let text;
    try { text = await readFile(path.resolve(exportFile), 'utf8'); } catch (error) {
      throw new PreconditionError(`Cannot read --db-export ${exportFile}: ${error.message}`);
    }
    dbRows.push(...parseDbExport(text, exportFile));
  }
  const domDir = options.domDir ? await resolveDomDirectory(options.domDir, '--dom-dir') : null;
  const baselineDomDir = options.baselineDomDir ? await resolveDomDirectory(options.baselineDomDir, '--baseline-dom-dir') : null;
  if (!project.packages.length && !sources.typoscript.length && !dbRows.length && !domDir) {
    throw new PreconditionError('Nothing to scan: no local package (packages/*, Composer path repositories, typo3conf/ext/*), no config/ TypoScript, no --db-export and no --dom-dir.');
  }

  const documents = [];
  for (const source of sources.typoscript) {
    const text = await readText(source.file);
    if (text === null || (source.file.endsWith('.ts') && looksLikeTypeScript(text))) continue;
    documents.push({ origin: 'file', file: source.file, display: relative(source.file), lineOffset: 0, context: source.context, text, followed: false });
  }
  for (const row of dbRows) documents.push(dbDocument(row));
  const classTexts = [];
  for (const source of sources.classFiles) {
    const text = await readText(source.file);
    if (text !== null) classTexts.push({ ...source, text });
  }
  const phpDocuments = classTexts.filter((source) => source.kind === 'php')
    .flatMap((source) => phpStringDocuments(relative(source.file), source.text));

  const findings = [];
  const notes = {};
  const include = await includePass(documents, phpDocuments, project);
  if (checks.has('includes')) {
    findings.push(...include.findings);
    for (const document of documents) {
      // A .txt file pulled in by an include is already named in that include's rename advice.
      if (document.origin === 'file' && !document.followed && document.file.toLowerCase().endsWith('.txt')) findings.push(txtFileFinding(document));
    }
    if (include.unverifiable) {
      notes.includes = `${plural(include.unverifiable, '@import')} could not be resolved in this checkout (unknown installed extensions, a server path or PKG:); only the file suffix was checked.`;
    }
  }

  let templateCount = 0;
  let domFiles = 0;
  if (checks.has('relative-links')) {
    const configured = classTexts.filter((source) => sources.settingsFiles.includes(source.file))
      .flatMap((source) => additionalAbsRefPrefixDirectories(source.text)).map(normalizePrefix).filter(Boolean);
    const prefixes = [...new Set([...DEFAULT_ASSET_PREFIXES, ...configured, ...(options.assetPrefixes ?? []).map(normalizePrefix)].filter(Boolean))];
    for (const template of sources.templates) {
      const text = await readText(template);
      if (text === null) continue;
      templateCount += 1;
      for (const hit of findRelativeAssetReferences(text, { prefixes, fluid: true })) findings.push(referenceFinding(relative(template), hit, 'fluid'));
    }
    for (const document of documents) {
      for (const entry of typoscriptLines(document.text)) {
        for (const hit of findRelativeAssetReferences(entry.text, { prefixes })) {
          findings.push(referenceFinding(document.display, { ...hit, line: entry.line }, 'typoscript'));
        }
      }
    }
    if (domDir) {
      const current = await domReferences(domDir, prefixes);
      if (!current.files) throw new PreconditionError(`--dom-dir holds no DOM snapshots (*.html): ${options.domDir}`);
      domFiles = current.files;
      let baseline = null;
      if (baselineDomDir) {
        const before = await domReferences(baselineDomDir, prefixes);
        baseline = new Set(before.pages.flatMap((page) => page.hits.map((hit) => `${hit.attribute}\u0000${hit.reference}`)));
      }
      findings.push(...domFindings(current.pages, {
        root: project.root, baseline, rewrittenPrefixes: [...THIRTEEN_REWRITTEN_PREFIXES, ...configured],
      }));
    } else {
      notes['relative-links'] = 'Captured DOM not scanned; pass --dom-dir with the 14 rung capture for the regression check.';
    }
  }

  if (checks.has('parsefunc')) {
    for (const document of documents) {
      if (document.context === 'tsconfig') continue; // RTE.default.proc.allowTags is RTE TSconfig, not parseFunc
      findings.push(...parseFuncFindings(document, findParseFuncOverrides(document.text)));
    }
  }

  let classNames = 0;
  let phpFiles = 0;
  let probeRuns = 0;
  if ([...checks].some((check) => PHP_CHECKS.has(check))) {
    const php = deps.php ?? createPhpBridge({
      project, command: options.php ?? 'php', autoload: options.autoload ?? null, toolsDir: options.toolsDir ?? null, spawnFn: deps.spawn,
    });
    const occurrences = [];
    if (checks.has('class-refs')) {
      for (const document of documents) {
        for (const reference of extractClassReferences(document.text, 'typoscript')) {
          occurrences.push({ ...reference, file: document.display, source: document.origin === 'db' ? 'db' : 'typoscript' });
        }
      }
      for (const source of classTexts) {
        for (const reference of extractClassReferences(source.text, source.kind)) {
          occurrences.push({ ...reference, file: relative(source.file), source: source.kind });
        }
      }
    }
    let facts = null;
    if (checks.has('php-classes') && project.packages.length) {
      facts = await php.facts(project.packages.map((pkg) => pkg.dir));
      phpFiles = facts.files ?? 0;
      if (facts.missingDirs?.length) {
        notes['php-classes'] = `PHP could not read ${facts.missingDirs.join(', ')} (outside the container mount?); those packages were not checked.`;
      }
    }
    const names = new Set(occurrences.map((occurrence) => occurrence.name));
    for (const reference of facts?.references ?? []) if (reference.via !== 'namespace-use') names.add(reference.name);
    for (const declaration of facts?.declarations ?? []) {
      if (!declaration.anonymous) names.add(declaration.name);
      for (const parent of declaration.extends ?? []) names.add(parent);
    }
    for (const call of facts?.instantiations ?? []) names.add(call.name);
    classNames = names.size;
    const probe = names.size
      ? await verifyClassNames([...names], (batch) => php.probe(batch, { describe: Boolean(facts) }))
      : { results: {}, errors: {}, canonical: {}, namespaces: {}, suggestions: {}, shapes: {}, runs: 0 };
    probeRuns = probe.runs;
    if (checks.has('class-refs')) findings.push(...classReferenceFindings(occurrences, probe));
    if (facts) findings.push(...phpClassFindings(facts, probe));
  }

  findings.sort(compareFindings);
  const count = (list, severity) => list.filter((item) => item.severity === severity).length;
  const errors = count(findings, 'error');
  const warnings = count(findings, 'warning');
  const failing = errors + (options.strict ? warnings : 0);
  const checkReport = Object.fromEntries(CHECKS.map((check) => {
    if (!checks.has(check)) return [check, { status: 'skipped' }];
    const own = findings.filter((item) => item.check === check);
    const ownErrors = count(own, 'error');
    const ownWarnings = count(own, 'warning');
    return [check, {
      status: ownErrors ? 'findings' : ownWarnings ? 'warnings' : 'pass', errors: ownErrors, warnings: ownWarnings,
      ...(notes[check] ? { note: notes[check] } : {}),
    }];
  }));

  return {
    schema: SCHEMA,
    projectRoot: project.root,
    options: {
      checks: CHECKS.filter((check) => checks.has(check)), strict: Boolean(options.strict),
      dbExports: (options.dbExports ?? []).map((file) => path.resolve(file)), domDir, baselineDomDir,
      php: [...checks].some((check) => PHP_CHECKS.has(check)) ? (deps.php ? 'injected' : options.php ?? 'php') : null,
    },
    scanned: {
      packages: project.packages.map((pkg) => pkg.rel),
      typoscriptFiles: documents.filter((document) => document.origin === 'file' && !document.followed).length,
      followedIncludes: include.followed, dbRows: dbRows.length, templates: templateCount, domFiles,
      classSources: sources.classFiles.length, phpFiles, classNames, probeRuns,
    },
    checks: checkReport,
    counts: { errors, warnings },
    findings,
    verdict: failing ? 'findings' : 'pass',
    exitCode: failing ? EXIT.FINDINGS : EXIT.PASS,
  };
}

/* ------------------------------------------------------------------ CLI */

const USAGE = `Usage: node typo3-14-readiness.mjs [options]
  --project-root DIR       TYPO3 project to check (default: current directory)
  --checks LIST            comma list of ${CHECKS.join(', ')} (default: all)
  --db-export FILE         database TypoScript/TSconfig rows as JSON or JSON Lines (repeatable)
  --dom-dir DIR            DOM capture of the 14 rung: captures/<label> or its dom/
  --baseline-dom-dir DIR   DOM capture of the baseline; references relative there already are warnings
  --asset-prefix PREFIX    another relative resource prefix such as media/ (repeatable)
  --php COMMAND            PHP command prefix (default: php), e.g. "ddev exec php"
  --autoload FILE          autoloader, relative to the project root (default: <vendor-dir>/autoload.php)
  --tools-dir DIR          where the PHP helpers are copied, relative to the project root
                           (default: .typo3-update/tools)
  --package-dir DIR        local package to scan instead of discovery (repeatable)
  --strict                 warnings fail the check too
  --json                   print the JSON report instead of the summary
  --report FILE            also write the JSON report to FILE
Exit: 0 pass · 1 findings · 2 harness error · 4 precondition
`;

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      'project-root': { type: 'string' },
      checks: { type: 'string' },
      'db-export': { type: 'string', multiple: true },
      'dom-dir': { type: 'string' },
      'baseline-dom-dir': { type: 'string' },
      'asset-prefix': { type: 'string', multiple: true },
      php: { type: 'string' },
      autoload: { type: 'string' },
      'tools-dir': { type: 'string' },
      'package-dir': { type: 'string', multiple: true },
      strict: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      report: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const checks = values.checks ? values.checks.split(',').map((check) => check.trim()).filter(Boolean) : [...CHECKS];
  const unknown = checks.filter((check) => !CHECKS.includes(check));
  if (unknown.length) throw new HarnessError(`Unknown check(s): ${unknown.join(', ')}. Known: ${CHECKS.join(', ')}.`);
  if (!checks.length) throw new HarnessError('--checks names no check.');
  if (values['baseline-dom-dir'] && !values['dom-dir']) throw new HarnessError('--baseline-dom-dir needs --dom-dir.');
  return {
    help: values.help,
    projectRoot: values['project-root'] ?? process.cwd(),
    checks,
    dbExports: values['db-export'] ?? [],
    domDir: values['dom-dir'] ?? null,
    baselineDomDir: values['baseline-dom-dir'] ?? null,
    assetPrefixes: values['asset-prefix'] ?? [],
    php: values.php ?? 'php',
    autoload: values.autoload ?? null,
    toolsDir: values['tools-dir'] ?? null,
    packageDirs: values['package-dir'] ?? [],
    strict: values.strict,
    json: values.json,
    report: values.report ?? null,
  };
}

export function formatSummary(report) {
  const lines = [`TYPO3 14 readiness: ${report.projectRoot}`];
  const scanned = report.scanned;
  lines.push(`  scanned: ${plural(scanned.packages.length, 'package')}, ${plural(scanned.typoscriptFiles, 'TypoScript file')}`
    + ` (+${scanned.followedIncludes} followed), ${plural(scanned.dbRows, 'DB row')}, ${plural(scanned.templates, 'template')},`
    + ` ${plural(scanned.domFiles, 'DOM snapshot')}, ${plural(scanned.phpFiles, 'PHP file')}, ${plural(scanned.classNames, 'class name')} probed`);
  lines.push('');
  for (const [check, state] of Object.entries(report.checks)) {
    const summary = state.status === 'skipped' ? 'skipped'
      : state.status === 'pass' ? 'pass' : `${plural(state.errors, 'error')}, ${plural(state.warnings, 'warning')}`;
    lines.push(`  ${check.padEnd(16)}${summary}${state.note ? `  (${state.note})` : ''}`);
  }
  for (const item of report.findings) {
    const where = !item.line ? item.file : item.file.startsWith('db:') ? `${item.file} line ${item.line}` : `${item.file}:${item.line}`;
    lines.push('', `${item.severity === 'error' ? 'ERROR' : 'WARN '} ${item.rule}  ${where}`);
    lines.push(`  ${item.message}`, `  fix: ${item.fix}`);
  }
  lines.push('', report.verdict === 'pass'
    ? `PASS: ${plural(report.counts.errors, 'error')}, ${plural(report.counts.warnings, 'warning')}.`
    : `FINDINGS: ${plural(report.counts.errors, 'error')}, ${plural(report.counts.warnings, 'warning')} (exit ${report.exitCode}).`);
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  let options;
  try {
    options = parseCli(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    return EXIT.HARNESS_ERROR;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return EXIT.PASS;
  }
  try {
    const report = await runReadiness(options);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (options.report) await writeFile(path.resolve(options.report), json, 'utf8');
    process.stdout.write(options.json ? json : formatSummary(report));
    return report.exitCode;
  } catch (error) {
    process.stderr.write(`TYPO3 14 readiness check failed: ${error.message}\n`);
    return error.exitCode ?? EXIT.HARNESS_ERROR;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
