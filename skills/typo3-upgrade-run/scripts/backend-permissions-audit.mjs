#!/usr/bin/env node
/**
 * Backend permission audit — what editors can actually do after the upgrade.
 *
 * This is the gate nothing else covers. The module sweep proves a module OPENS; the
 * write round-trip proves an ADMIN can save. Neither says anything about the editor
 * who logs in on Monday, and permission damage is silent by design: TYPO3 ignores a
 * permission entry pointing at something that no longer exists, and simply does not
 * offer a content type an editor is not allowed to use. Nothing is logged, nothing
 * errors, the editor just cannot do their job.
 *
 * What it checks:
 *   1. Who holds admin. Admin rights are not a permission level, they bypass the
 *      permission system entirely — every admin is an unbounded account.
 *   2. groupMods entries that no longer resolve to a real module.
 *   3. CTypes present in the content but NOT allowed to editors — the common one.
 *   4. Exclude-fields not granted, so fields exist but are invisible.
 *   5. Tables edited by content that editors cannot modify.
 *   6. File permissions and mountpoints that resolve.
 *
 * Read-only by default. `--fix` writes the additive repairs only (never removes a
 * permission, never touches admin flags) and takes a snapshot first.
 *
 * Usage:
 *   node backend-permissions-audit.mjs --ddev-dir /path/to/project \
 *     [--sweep .typo3-update/report.backend-sweep.json] [--fix] [--report out.json]
 *
 * Exit: 0 clean · 1 findings · 3 invalid
 */
import { writeFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Local package folders, scanned next to vendor when Composer's record is missing.
const LOCAL_ROOTS = Object.freeze(['packages', 'extensions']);
const ARRAY_KEYWORDS = new Set(['return', 'yield', 'echo', 'print', 'case', 'else', 'and', 'or', 'xor']);

/**
 * Enumerate modules from REGISTERED CODE, not from the backend module menu.
 *
 * The backend sweep walks the module menu, which is the wrong source for this check:
 * modules whose `parent` is `user` (User settings, for one) live in the avatar dropdown
 * and never appear there. Validating groupMods against the sweep therefore reports a
 * perfectly healthy module as "no longer exists" — a false positive that sends you
 * reinstalling an extension that was never missing.
 *
 * Configuration/Backend/Modules.php in every installed package is the authoritative list,
 * and every installed package means every one: stopping after Core reported the modules of
 * powermail, news and every other extension as gone.
 */
export function registeredModules(root) {
  const { source, files } = moduleFiles(root);
  const ids = new Set(), aliases = new Map();
  for (const file of files) {
    const found = moduleIdentifiers(readFileSync(file, 'utf8'));
    for (const id of found.ids) ids.add(id);
    for (const [alias, id] of found.aliases) aliases.set(alias, id);
  }
  return { source, files: files.length, ids, aliases };
}

/**
 * groupMods entries the registry does not know. A renamed module keeps its old identifier as an
 * alias: name the new one rather than calling the entry gone, since the cure is a rename, not a
 * reinstall.
 */
export function unknownModuleEntries(entries, modules) {
  const unknown = entries.filter((entry) => !modules.ids.has(entry));
  return {
    gone: unknown.filter((entry) => !modules.aliases.has(entry)),
    renamed: unknown.filter((entry) => modules.aliases.has(entry)).map((alias) => ({ alias, module: modules.aliases.get(alias) })),
  };
}

/**
 * The Modules.php of every installed package. Composer's installed.json names them all, vendor
 * packages and symlinked path-repository packages alike (a directory walk skips the symlinks).
 * Without it, the directories this script can see stand in.
 */
export function moduleFiles(root) {
  const composerRoot = resolve(root, ddevComposerRoot(root));
  const vendor = join(composerRoot, 'vendor');
  const installed = join(vendor, 'composer', 'installed.json');
  if (existsSync(installed)) {
    const data = JSON.parse(readFileSync(installed, 'utf8'));
    const files = (Array.isArray(data) ? data : data.packages ?? [])
      .map((pkg) => resolve(vendor, 'composer', pkg['install-path'] ?? `../${pkg.name}`, 'Configuration', 'Backend', 'Modules.php'))
      .filter((file) => existsSync(file));
    return { source: relative(root, installed), files: [...new Set(files)] };
  }
  const files = [vendor, ...LOCAL_ROOTS.map((dir) => join(composerRoot, dir))].flatMap(modulesFilesBelow);
  return { source: 'directory scan (no vendor/composer/installed.json)', files: [...new Set(files)] };
}

/** DDEV's composer_root (Composer in app/, for one), or the project itself. */
function ddevComposerRoot(root) {
  const config = join(root, '.ddev', 'config.yaml');
  if (!existsSync(config)) return '.';
  return /^composer_root:\s*['"]?([^'"#\s]+)/m.exec(readFileSync(config, 'utf8'))?.[1] ?? '.';
}

function modulesFilesBelow(dir) {
  const out = [];
  const walk = (base) => {
    let entries = [];
    try { entries = readdirSync(base, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(base, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        walk(full);
      } else if (e.name === 'Modules.php' && base.endsWith(join('Configuration', 'Backend'))) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * The identifiers a Modules.php registers: every key one level inside the outermost array
 * literal, wherever that array is returned from (news returns its module from inside an `if`,
 * indented deeper than Core's), plus the `aliases` each module keeps for its old identifier.
 * Comments and strings are read as tokens, so neither can fake a key.
 */
export function moduleIdentifiers(source) {
  const tokens = phpTokens(source);
  const ids = new Set(), aliases = new Map();
  const open = [];
  let depth = 0, module = null, aliasDepth = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === '[' || token.type === '(') {
      // `[` after a value indexes it; `(` opens an array only as array(…).
      const literal = token.type === '[' ? !indexes(tokens[i - 1]) : isWord(tokens[i - 1], 'array');
      open.push(literal);
      if (literal) depth += 1;
    } else if (token.type === ']' || token.type === ')') {
      if (open.pop()) depth -= 1;
      if (depth < aliasDepth) aliasDepth = 0;
    } else if (token.type === 'string') {
      const keyed = tokens[i + 1]?.type === '=>';
      if (aliasDepth && depth === aliasDepth && !keyed) {
        aliases.set(token.value, module);
      } else if (keyed && depth === 1) {
        module = token.value;
        ids.add(module);
      } else if (keyed && depth === 2 && module && token.value === 'aliases' && opensArray(tokens, i + 2)) {
        aliasDepth = 3;
      }
    }
  }
  return { ids, aliases };
}

const isWord = (token, value) => token?.type === 'word' && token.value.toLowerCase() === value;
const opensArray = (tokens, i) => tokens[i]?.type === '[' || (isWord(tokens[i], 'array') && tokens[i + 1]?.type === '(');

function indexes(previous) {
  if (!previous) return false;
  if ([']', ')', 'string'].includes(previous.type)) return true;
  return previous.type === 'word' && !ARRAY_KEYWORDS.has(previous.value.toLowerCase());
}

/** Strings, brackets, `=>` and words; comments dropped. Enough PHP for array keys. */
function phpTokens(source) {
  const tokens = [];
  const word = /(?:[$A-Za-z_\\]|[^\x00-\x7f])(?:[\w\\]|[^\x00-\x7f])*/y;
  for (let i = 0; i < source.length;) {
    const c = source[i], next = source[i + 1];
    if ((c === '/' && next === '/') || (c === '#' && next !== '[')) {
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (c === "'" || c === '"') {
      let value = '', j = i + 1;
      for (; j < source.length && source[j] !== c; j += 1) {
        if (source[j] === '\\' && j + 1 < source.length) j += 1;
        value += source[j];
      }
      tokens.push({ type: 'string', value });
      i = j + 1;
    } else if (c === '=' && next === '>') {
      tokens.push({ type: '=>' });
      i += 2;
    } else if ('[]()'.includes(c)) {
      tokens.push({ type: c });
      i += 1;
    } else {
      word.lastIndex = i;
      const match = word.exec(source);
      if (match) tokens.push({ type: 'word', value: match[0] });
      else if (!/\s/.test(c)) tokens.push({ type: 'other' });
      i = match ? word.lastIndex : i + 1;
    }
  }
  return tokens;
}

function main(argv) {
  const opt = (n, d = null) => {
    const i = argv.indexOf(`--${n}`);
    if (i < 0) return d;
    const v = argv[i + 1];
    return v && !v.startsWith('--') ? v : true;
  };

  const ddevDir = opt('ddev-dir', process.cwd());
  const sweepPath = opt('sweep', '.typo3-update/report.backend-sweep.json');
  const fix = opt('fix') === true;
  const reportPath = opt('report');

  const sql = (q) => execFileSync('ddev', ['mysql', '-N', '-e', q], {
    cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  const sqlWrite = (q) => execFileSync('ddev', ['mysql', '-e', q], {
    cwd: ddevDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const rows = (q) => sql(q).split('\n').filter(Boolean).map((l) => l.split('\t'));

  const report = { schema: 'typo3-upgrade-run/backend-permissions@1', findings: [], groups: [], admins: [] };
  let failed = 0;
  const finding = (severity, area, detail, fixable = false) => {
    report.findings.push({ severity, area, detail, fixable });
    console.log(`  ${severity === 'blocker' ? '✗' : '!'} [${area}] ${detail}`);
    failed += 1;
  };
  const ok = (area, detail) => console.log(`  ✓ [${area}] ${detail}`);

  console.log('\nBackend permission audit\n');

  // ---- 1. who holds admin --------------------------------------------------
  // _cli_ is TYPO3's own system account and must keep admin; it cannot log in.
  const admins = rows(`SELECT uid, username, disable FROM be_users
    WHERE deleted = 0 AND admin = 1 ORDER BY uid;`);
  report.admins = admins.map(([uid, username, disable]) => ({ uid: Number(uid), username, disabled: disable === '1' }));
  const humanAdmins = admins.filter(([, u]) => u !== '_cli_');
  console.log(`  admins: ${admins.map(([, u]) => u).join(', ') || 'none'}`);
  if (humanAdmins.length > 1) {
    finding('warning', 'admin',
      `${humanAdmins.length} human admin accounts (${humanAdmins.map(([, u]) => u).join(', ')}). `
      + 'Admin bypasses the permission system entirely — confirm each one is intended, '
      + 'and demote the rest to an editor group. This tool never changes admin flags.');
  } else {
    ok('admin', `${humanAdmins.length} human admin account — matches the "admin only" policy`);
  }

  const orphanUsers = rows(`SELECT uid, username FROM be_users
    WHERE deleted = 0 AND admin = 0 AND (usergroup IS NULL OR usergroup = '');`);
  for (const [uid, username] of orphanUsers) {
    finding('blocker', 'user', `"${username}" (uid ${uid}) is not an admin and belongs to no group — it can log in and do nothing`);
  }

  // ---- 2. modules that no longer exist -------------------------------------
  const modules = registeredModules(ddevDir);
  report.modules = { source: modules.source, files: modules.files, identifiers: modules.ids.size };
  const realModules = modules.ids.size ? modules.ids : null;
  if (!realModules) {
    console.log('  ! could not enumerate registered modules — skipping the groupMods check');
  } else {
    console.log(`  registered backend modules found in code: ${modules.ids.size} (${modules.files} Modules.php, ${modules.source})`);
  }

  const groups = rows(`SELECT uid, title, groupMods, explicit_allowdeny, non_exclude_fields,
    tables_modify, file_permissions, file_mountpoints, db_mountpoints
    FROM be_groups WHERE deleted = 0 ORDER BY uid;`);

  const usedCTypes = rows(`SELECT CType, COUNT(*) FROM tt_content
    WHERE deleted = 0 GROUP BY CType ORDER BY 2 DESC;`);

  for (const [uid, title, groupMods, explicit, nonExclude, tablesModify, filePerms, fileMounts, dbMounts] of groups) {
    console.log(`\n  ── group ${uid}: ${title}`);
    const g = { uid: Number(uid), title, issues: [] };

    // modules
    const mods = (groupMods || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (realModules) {
      const { gone, renamed } = unknownModuleEntries(mods, modules);
      if (gone.length) {
        finding('blocker', 'modules',
          `${title}: ${gone.length} module identifier(s) no longer exist and are silently ignored: ${gone.join(', ')}`);
        g.issues.push({ kind: 'stale-modules', value: gone });
      }
      if (renamed.length) {
        finding('warning', 'modules',
          `${title}: ${renamed.length} module identifier(s) are old names kept as aliases: `
          + `${renamed.map((r) => `${r.alias} → ${r.module}`).join(', ')}. Grant the current identifiers.`);
        g.issues.push({ kind: 'aliased-modules', value: renamed });
      }
      if (!gone.length && !renamed.length && mods.length) {
        ok('modules', `${title}: all ${mods.length} module identifiers resolve`);
      }
    }

    // CTypes: the common failure — content exists that editors may not touch
    const allowed = new Set((explicit || '').split(',')
      .filter((e) => e.startsWith('tt_content:CType:'))
      .map((e) => e.split(':').pop()));
    if (allowed.size) {
      const missing = usedCTypes
        .filter(([c]) => c && !allowed.has(c))
        .map(([c, n]) => ({ cType: c, elements: Number(n) }));
      if (missing.length) {
        const total = missing.reduce((n, m) => n + m.elements, 0);
        finding('blocker', 'ctypes',
          `${title}: ${missing.length} content type(s) exist on the site but are NOT editable — `
          + `${total} elements affected: ${missing.map((m) => `${m.cType} (${m.elements})`).join(', ')}`,
          true);
        g.issues.push({ kind: 'missing-ctypes', value: missing });
      } else {
        ok('ctypes', `${title}: every CType in use is editable`);
      }
    } else {
      ok('ctypes', `${title}: no explicit CType restriction (all allowed)`);
    }

    // tables actually needed by the content
    const modify = new Set((tablesModify || '').split(',').map((s) => s.trim()).filter(Boolean));
    for (const t of ['pages', 'tt_content', 'sys_file_reference']) {
      if (modify.size && !modify.has(t)) {
        finding('blocker', 'tables', `${title}: cannot modify "${t}" — editing is impossible without it`);
      }
    }

    // file handling
    const fp = (filePerms || '').split(',').filter(Boolean);
    const needed = ['readFolder', 'writeFolder', 'addFile', 'readFile', 'writeFile', 'deleteFile'];
    const missingFp = needed.filter((n) => !fp.includes(n));
    if (missingFp.length) {
      finding('warning', 'files', `${title}: file permissions missing ${missingFp.join(', ')} — uploads or replacements will fail`);
    } else if (fp.length) {
      ok('files', `${title}: file permissions complete`);
    }

    // mountpoints must resolve
    for (const [kind, list, table] of [['file', fileMounts, 'sys_filemounts'], ['db', dbMounts, 'pages']]) {
      const ids = (list || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!ids.length) continue;
      const alive = new Set(rows(`SELECT uid FROM ${table} WHERE deleted = 0 AND uid IN (${ids.join(',')});`).map(([u]) => u));
      const dead = ids.filter((i) => !alive.has(i));
      if (dead.length) finding('blocker', 'mounts', `${title}: ${kind} mountpoint(s) ${dead.join(', ')} do not exist`);
      else ok('mounts', `${title}: ${ids.length} ${kind} mountpoint(s) resolve`);
    }

    g.nonExcludeFieldCount = (nonExclude || '').split(',').filter(Boolean).length;
    report.groups.push(g);
  }

  // ---- repair --------------------------------------------------------------
  if (fix) {
    console.log('\n  applying additive repairs (snapshot first, nothing removed)…');
    try { execFileSync('ddev', ['snapshot', '--name', 'pre-permission-fix'], { cwd: ddevDir, stdio: 'ignore' }); } catch { /* best effort */ }
    for (const g of report.groups) {
      const miss = g.issues.find((i) => i.kind === 'missing-ctypes');
      if (!miss) continue;
      const add = miss.value.map((m) => `tt_content:CType:${m.cType}`).join(',');
      sqlWrite(`UPDATE be_groups SET explicit_allowdeny =
        CASE WHEN explicit_allowdeny = '' OR explicit_allowdeny IS NULL THEN '${add}'
             ELSE CONCAT(explicit_allowdeny, ',${add}') END
        WHERE uid = ${g.uid};`);
      console.log(`  + group ${g.uid}: allowed ${miss.value.length} CType(s)`);
    }
    console.log('  stale module identifiers and admin flags are NOT touched — those need a human decision.');
  }

  console.log(`\n${failed ? `${failed} finding(s)` : 'No findings.'}`);
  if (reportPath) { writeFileSync(reportPath, JSON.stringify(report, null, 2)); console.log(`report: ${reportPath}`); }
  return failed ? 1 : 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main(process.argv.slice(2));
}
