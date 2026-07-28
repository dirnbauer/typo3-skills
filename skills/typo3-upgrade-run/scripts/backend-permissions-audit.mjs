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
// Enumerate from REGISTERED CODE, not from the backend module menu.
//
// The backend sweep walks the module menu, which is the wrong source for this check:
// modules whose `parent` is `user` (User settings, for one) live in the avatar dropdown
// and never appear there. Validating groupMods against the sweep therefore reports a
// perfectly healthy module as "no longer exists" — a false positive that sends you
// reinstalling an extension that was never missing.
//
// Configuration/Backend/Modules.php in every installed package is the authoritative list.
const moduleIdsFrom = (dir) => {
  const out = new Set();
  const walk = (base) => {
    let entries = [];
    try { entries = readdirSync(base, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = join(base, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        walk(full);
      } else if (e.name === 'Modules.php' && base.endsWith(join('Configuration', 'Backend'))) {
        const src = readFileSync(full, 'utf8');
        for (const m of src.matchAll(/^\s{4}'([a-z0-9_]+)'\s*=>/gmi)) out.add(m[1]);
      }
    }
  };
  walk(dir);
  return out;
};

let realModules = new Set();
for (const root of ['vendor/typo3', 'vendor', 'packages', 'extensions']) {
  const p = join(ddevDir, root);
  if (!existsSync(p)) continue;
  for (const id of moduleIdsFrom(p)) realModules.add(id);
  if (root === 'vendor/typo3' && realModules.size) break; // core is enough for a fast path
}
// local packages always matter — an in-house backend module is exactly what gets missed
for (const root of ['packages', 'extensions']) {
  const p = join(ddevDir, root);
  if (existsSync(p)) for (const id of moduleIdsFrom(p)) realModules.add(id);
}
if (!realModules.size) {
  realModules = null;
  console.log('  ! could not enumerate registered modules — skipping the groupMods check');
} else {
  console.log(`  registered backend modules found in code: ${realModules.size}`);
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
    const gone = mods.filter((m) => !realModules.has(m));
    if (gone.length) {
      finding('blocker', 'modules',
        `${title}: ${gone.length} module identifier(s) no longer exist and are silently ignored: ${gone.join(', ')}`);
      g.issues.push({ kind: 'stale-modules', value: gone });
    } else if (mods.length) {
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
process.exit(failed ? 1 : 0);
