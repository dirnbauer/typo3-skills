/**
 * Where the TYPO3 installation sits inside the project.
 *
 * The project root (where .ddev/, .git and the run directory live) is not always the Composer
 * root. DDEV's `composer_root: app/` puts composer.json, config/sites, config/system, var/ and the
 * TYPO3 CLI one directory down, and Composer's `config.bin-dir` decides whether the CLI is
 * vendor/bin/typo3 or, with `bin-dir: "."`, app/typo3. Reading config/sites from the project root
 * of such a project finds nothing: discovery then guessed /<lang>/sitemap.xml (404, exit 4) and
 * built page URLs without the site's language base and PageType suffix.
 *
 * Dependency-free and synchronous: the diagnostic scripts call it before `npm ci`.
 *
 * Composer root, first match wins:
 *   1. an explicit value (--composer-root, state.project.composer_root, run.yml project.composer_root)
 *   2. `composer_root` in .ddev/config.yaml
 *   3. composer.json in the project root
 *   4. the one immediate subdirectory whose composer.json requires typo3/cms-core (or typo3/cms)
 *   5. the project root
 * Web directory: composer.json extra.typo3/cms.web-dir, DDEV `docroot`, an existing public/, a
 * classic (non-Composer) layout, then the fallback (public/ by default).
 * CLI: <bin-dir>/typo3 (bin-dir defaults to <vendor-dir>/bin), then vendor/bin/typo3, then the
 * classic typo3/sysext/core/bin/typo3, the first that exists; otherwise <bin-dir>/typo3.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { PreconditionError } from '../cli/exit-codes.mjs';

/** DDEV mounts the project root here in the web container; `ddev exec` starts in it. */
export const DDEV_CONTAINER_ROOT = '/var/www/html';

const SCAN_SKIP = new Set(['node_modules', 'vendor', 'var', 'public', 'web', 'packages', 'fileadmin']);

export function resolveProjectLayout(projectRoot = process.cwd(), { composerRoot = null, webDirFallback = 'public' } = {}) {
  const root = path.resolve(projectRoot);
  const ddev = readDdevConfig(root);
  const explicit = typeof composerRoot === 'string' && composerRoot.trim() ? composerRoot.trim() : null;
  if (explicit) assertInside(root, explicit, 'composer root');

  let composerRootRel, composerRootSource;
  if (explicit) [composerRootRel, composerRootSource] = [explicit, 'option'];
  else if (ddev.composerRoot) [composerRootRel, composerRootSource] = [ddev.composerRoot, '.ddev/config.yaml composer_root'];
  else if (isFile(path.join(root, 'composer.json'))) [composerRootRel, composerRootSource] = ['.', 'composer.json'];
  else {
    const found = typo3ComposerSubdirectories(root);
    [composerRootRel, composerRootSource] = found.length === 1 ? [found[0], `${found[0]}/composer.json`] : ['.', 'default'];
  }
  const composerRootAbs = path.resolve(root, composerRootRel);
  const composer = readJson(path.join(composerRootAbs, 'composer.json'));

  const vendorDir = path.resolve(composerRootAbs, String(composer?.config?.['vendor-dir'] ?? 'vendor'));
  const binDir = composer?.config?.['bin-dir'] !== undefined
    ? path.resolve(composerRootAbs, String(composer.config['bin-dir']))
    : path.join(vendorDir, 'bin');

  const configuredWebDir = composer?.extra?.['typo3/cms']?.['web-dir'];
  let webDir, webDirSource;
  if (typeof configuredWebDir === 'string' && configuredWebDir.trim()) [webDir, webDirSource] = [path.resolve(composerRootAbs, configuredWebDir), 'composer.json web-dir'];
  else if (ddev.docroot !== null) [webDir, webDirSource] = [path.resolve(root, ddev.docroot), '.ddev/config.yaml docroot'];
  else if (isDir(path.join(composerRootAbs, 'public'))) [webDir, webDirSource] = [path.join(composerRootAbs, 'public'), 'detected'];
  else if (!composer && (isDir(path.join(composerRootAbs, 'typo3conf')) || isDir(path.join(composerRootAbs, 'typo3', 'sysext')))) {
    [webDir, webDirSource] = [composerRootAbs, 'classic'];
  } else [webDir, webDirSource] = [path.resolve(composerRootAbs, webDirFallback), 'default'];

  const cliCandidates = [path.join(binDir, 'typo3'), path.join(composerRootAbs, 'vendor', 'bin', 'typo3'),
    path.join(webDir, 'typo3', 'sysext', 'core', 'bin', 'typo3')];
  const existing = cliCandidates.find(isFile);
  const typo3Cli = existing ?? cliCandidates[0];

  const rel = (target) => toPosix(path.relative(root, target)) || '.';
  const layout = {
    root,
    composerRoot: composerRootAbs,
    composerRootRel: rel(composerRootAbs),
    composerRootSource,
    composerJson: composer !== null,
    requiresTypo3: requiresTypo3(composer),
    vendorDir,
    binDir,
    webDir,
    webDirRel: rel(webDir),
    webDirSource,
    configDir: path.join(composerRootAbs, 'config'),
    sitesDir: path.join(composerRootAbs, 'config', 'sites'),
    systemDir: path.join(composerRootAbs, 'config', 'system'),
    varDir: path.join(composerRootAbs, 'var'),
    fileadmin: path.join(webDir, 'fileadmin'),
    fileadminRel: rel(path.join(webDir, 'fileadmin')),
    typo3Cli,
    typo3CliExists: existing !== undefined,
    typo3CliRel: rel(typo3Cli),
    sitesDirRel: rel(path.join(composerRootAbs, 'config', 'sites')),
  };
  layout.standard = layout.composerRootRel === '.' && layout.typo3CliRel === 'vendor/bin/typo3';
  /** The CLI as `ddev exec` reaches it from its default directory, the mounted project root. */
  layout.ddevTypo3 = layout.typo3CliRel.includes('/') ? layout.typo3CliRel : `./${layout.typo3CliRel}`;
  layout.containerComposerRoot = layout.composerRootRel === '.' ? DDEV_CONTAINER_ROOT : `${DDEV_CONTAINER_ROOT}/${layout.composerRootRel}`;
  return layout;
}

/** One line for logs and doctor: where the harness looks. */
export function describeLayout(layout) {
  return `Composer root ${layout.composerRootRel} (${layout.composerRootSource}), web dir ${layout.webDirRel} (${layout.webDirSource}), `
    + `sites ${layout.sitesDirRel}, CLI ${layout.typo3CliRel}${layout.typo3CliExists ? '' : ' (not found)'}`;
}

/**
 * The layout of a t3u run: --composer-root, then the value recorded at init, then run.yml
 * project.composer_root, then detection. `runConfig` is the parsed run.yml, when the caller has it.
 */
export function runLayout({ values = {}, state = null, runConfig = null, cwd = process.cwd() } = {}) {
  const composerRoot = [values['composer-root'], state?.project?.composer_root, runConfig?.project?.composer_root]
    .find((value) => typeof value === 'string' && value.trim()) ?? null;
  return resolveProjectLayout(cwd, { composerRoot });
}

/** Top-level `composer_root` and `docroot` of .ddev/config.yaml; a missing key is null. */
export function readDdevConfig(root) {
  let text = '';
  try { text = readFileSync(path.join(root, '.ddev', 'config.yaml'), 'utf8'); } catch { return { composerRoot: null, docroot: null }; }
  const scalar = (key) => {
    const match = new RegExp(`^${key}:[ \\t]*(?:"([^"]*)"|'([^']*)'|([^#\\s]*))`, 'm').exec(text);
    if (!match) return null;
    return normalizeRel(match[1] ?? match[2] ?? match[3] ?? '');
  };
  const composerRoot = scalar('composer_root');
  return { composerRoot: composerRoot === '.' ? null : composerRoot, docroot: scalar('docroot') };
}

function normalizeRel(value) {
  const cleaned = String(value).trim().replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/\/+$/, '');
  return cleaned || '.';
}

function typo3ComposerSubdirectories(root) {
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !SCAN_SKIP.has(entry.name))
    .map((entry) => entry.name)
    .filter((name) => requiresTypo3(readJson(path.join(root, name, 'composer.json'))))
    .sort();
}

function requiresTypo3(composer) {
  const require = composer?.require ?? {};
  return Object.prototype.hasOwnProperty.call(require, 'typo3/cms-core') || Object.prototype.hasOwnProperty.call(require, 'typo3/cms');
}

function assertInside(root, relative, what) {
  const target = path.resolve(root, relative);
  if (path.isAbsolute(relative) || (target !== root && !target.startsWith(root + path.sep))) {
    throw new PreconditionError(`The ${what} must be a directory inside the project: ${relative}`);
  }
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

function isFile(file) {
  try { return statSync(file).isFile(); } catch { return false; }
}

function isDir(dir) {
  try { return statSync(dir).isDirectory(); } catch { return false; }
}

const toPosix = (value) => value.split(path.sep).join('/');
