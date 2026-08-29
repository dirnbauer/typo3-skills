/**
 * init, doctor, status, and the fingerprint actions.
 */

import { mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT, HarnessError, InvalidRunError, PreconditionError } from '../cli/exit-codes.mjs';
import { emptyState, StateStore } from '../run/state.mjs';
import { UrlGuard, assertPlausibleBaseUrl } from '../net/url-guard.mjs';
import { collectEnvironment, compareEnvironment } from '../fingerprint/environment.mjs';
import { collectContent, compareContent } from '../fingerprint/content.mjs';
import { listOpt } from '../cli/args.mjs';
import { renderStatus } from '../run/status.mjs';
import { sha256 } from '../run/paths.mjs';
import {
  classifySiteSize, runtimeWindow, sizingEvidenceIssues,
} from '../run/runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES = path.resolve(HERE, '../../../templates/run-directory');
const exec = promisify(execFile);

export async function init({ values, paths, log, journal }) {
  const baseUrl = values['base-url'];
  if (!baseUrl) throw new HarnessError('--base-url is required for init');

  const existingStore = new StateStore(paths);
  const exists = await existingStore.exists();
  if (exists && !values.force) {
    throw new PreconditionError(
      `A run already exists at ${paths.root}. Use --force to reinitialise (this does not delete baselines).`,
    );
  }
  if (exists && values.force) {
    const previous = await existingStore.read();
    const carriesEvidence = previous.graph
      || Object.values(previous.baselines ?? {}).some((baseline) => baseline.sealed)
      || Object.keys(previous.loops ?? {}).length > 0
      || (previous.snapshots ?? []).length > 0;
    if (carriesEvidence) {
      throw new PreconditionError(
        'Refusing --force because this run contains sealed graph/baseline/loop/snapshot evidence. '
        + 'Choose a new --run-dir; graph history is not destructive scratch state.',
      );
    }
  }

  // The base URL is operator input and becomes the allowlist, so it must be checked on its
  // own terms first — otherwise a metadata endpoint would simply allow-list itself.
  await assertPlausibleBaseUrl(baseUrl);
  const guard = await UrlGuard.create({ allowedOrigins: [baseUrl] });
  const { url } = await guard.assertUrl(baseUrl, { purpose: 'init' });

  const projectName = values['project-name'] ?? url.hostname.split('.')[0];
  const runId = `${new Date().toISOString().slice(0, 10)}-${slug(projectName)}`;

  for (const dir of [paths.root, paths.configDir, paths.manifestsDir, paths.baselineDir,
                     paths.loopsDir, paths.nodesDir, paths.approvalsDir, paths.decisionsDir, paths.reportDir]) {
    await mkdir(dir, { recursive: true });
  }

  await copyTemplate('config/run.yml', paths.runConfig);
  await copyTemplate('config/upgrade-graph.yml', paths.graphDefinition);
  await copyTemplate('config/thresholds.yml', paths.thresholds);
  await copyTemplate('config/interactions.yml', path.join(paths.configDir, 'interactions.yml'));
  await copyTemplate(
    'config/content-transition.example.json',
    path.join(paths.configDir, 'content-transition.example.json'),
  );
  await copyTemplate('gitignore', path.join(paths.root, '.gitignore'));

  const state = emptyState({ runId, now: new Date().toISOString() });
  state.project = {
    name: projectName,
    trusted_origin: url.origin,
    ddev_project: values['ddev-project'] ?? '',
    languages: listOpt(values, 'languages', []),
    run_dir: values['run-dir'] ?? '.typo3-update',
  };
  await new StateStore(paths).write(state);
  await journal.append('transition', { from: null, to: 'P00', note: 'run initialised' });

  log.success(`Initialised ${paths.root} (run ${runId}, origin ${url.origin}; runtime unclassified)`);
  log.info('Next: graph-init, complete the read-only P00 branches, write runtime-size.json, runtime-seal, then close intake-join.');

  return { exitCode: EXIT.PASS, verdict: 'pass', runId, trustedOrigin: url.origin, message: `run ${runId} initialised` };
}

export async function runtimeSeal({ values, paths, log, journal }) {
  const evidenceArg = values.evidence;
  if (!evidenceArg) throw new PreconditionError('--evidence is required for runtime-seal.');
  const evidencePath = path.resolve(process.cwd(), evidenceArg);
  if (!evidencePath.startsWith(`${paths.root}${path.sep}`)) {
    throw new PreconditionError('Runtime sizing evidence must live inside the run directory.');
  }

  let evidence;
  try { evidence = JSON.parse(await readFile(evidencePath, 'utf8')); }
  catch (error) { throw new PreconditionError(`Cannot read runtime sizing evidence: ${error.message}`); }
  const issues = sizingEvidenceIssues(evidence);
  if (issues.length) {
    throw new PreconditionError(`Runtime sizing evidence is incomplete:\n  - ${issues.join('\n  - ')}`);
  }

  const store = new StateStore(paths);
  const state = await store.read();
  if (state.runtime?.sealed_at || state.runtime?.deadline_at) {
    throw new PreconditionError('The runtime profile is already sealed and cannot be changed or extended.');
  }
  const sizeProfile = classifySiteSize(evidence.metrics);
  const window = runtimeWindow(state.runtime.started_at, sizeProfile);
  const relativeEvidence = path.relative(paths.root, evidencePath);
  await store.update((next) => {
    next.runtime = {
      ...next.runtime,
      sealed_at: new Date().toISOString(),
      size_profile: window.sizeProfile,
      size_evidence_ref: relativeEvidence,
      migration_cutoff_at: window.migrationCutoffAt,
      deadline_at: window.deadlineAt,
      max_hours: window.maxHours,
      closure_reserve_hours: window.closureReserveHours,
    };
  });
  await journal.append('note', {
    note: 'runtime profile sealed',
    size_profile: sizeProfile,
    evidence_ref: relativeEvidence,
    migration_cutoff_at: window.migrationCutoffAt,
    deadline_at: window.deadlineAt,
  });
  log.success(
    `Runtime ${sizeProfile}: ${window.maxHours}h hard deadline, `
    + `${window.closureReserveHours}h closure reserve, migration cutoff ${window.migrationCutoffAt}.`,
  );
  return {
    exitCode: EXIT.PASS,
    verdict: 'pass',
    sizeProfile,
    evidence: relativeEvidence,
    ...window,
    message: `${sizeProfile} runtime profile sealed`,
  };
}

export async function doctor({ values, paths, log }) {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  const [major] = process.versions.node.split('.').map(Number);
  add('node >= 20.11', major >= 20, process.version);

  for (const dep of ['playwright', 'pixelmatch', 'pngjs']) {
    try { await import(dep); add(`dependency ${dep}`, true, 'resolved'); }
    catch { add(`dependency ${dep}`, false, 'missing — run npm ci'); }
  }

  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ args: ['--headless=new'] });
    add('chromium launch', true, b.version());
    await b.close();
  } catch (err) {
    add('chromium launch', false, err.message.slice(0, 120));
  }

  if (process.env.T3U_ALLOW_NO_SANDBOX === '1') {
    add('sandbox', false, 'T3U_ALLOW_NO_SANDBOX=1 — the browser is weakened and every report will say so');
  } else {
    add('sandbox', true, 'enabled');
  }

  for (const [name, args] of [
    ['ddev CLI', ['version']],
    ['application PHP via DDEV', ['exec', '--', 'php', '-r', 'echo PHP_VERSION;']],
    ['application Composer via DDEV', ['composer', 'show', '--locked', 'typo3/cms-core', '--format=json']],
  ]) {
    try {
      const { stdout } = await exec('ddev', args, { timeout: 20_000 });
      add(name, true, String(stdout).trim().split('\n')[0].slice(0, 120));
    } catch (error) {
      add(name, false, String(error.stderr || error.message).trim().slice(0, 120));
    }
  }

  const baseUrl = values['base-url'];
  if (baseUrl) {
    try {
      const guard = await UrlGuard.create({ allowedOrigins: [baseUrl] });
      const r = await guard.assertUrl(baseUrl, { purpose: 'doctor' });
      add('base URL guard', true, `${r.origin} -> ${r.addresses.join(', ')} (pinned: ${r.pinned})`);
    } catch (err) {
      add('base URL guard', false, err.message);
    }
  }

  for (const c of checks) (c.ok ? log.success : log.warn)(`${c.name}: ${c.detail}`);
  const failed = checks.filter((c) => !c.ok);
  return {
    exitCode: failed.length ? EXIT.FINDINGS : EXIT.PASS,
    verdict: failed.length ? 'findings' : 'pass',
    checks,
    message: failed.length ? `${failed.length} environment check(s) need attention` : 'environment ready',
  };
}

export async function status({ paths, log, values }) {
  const state = await new StateStore(paths).read();
  const md = renderStatus(state);
  await writeFile(paths.statusPath, md, 'utf8');
  if (!values.json) process.stdout.write(`${md}\n`);
  log.debug(`STATUS.md regenerated at ${paths.statusPath}`);
  return { exitCode: EXIT.PASS, verdict: 'pass', state, message: 'status written' };
}

export async function envFingerprint({ values, paths, log, journal }) {
  const store = new StateStore(paths);
  const state = await store.read();
  const current = await collectEnvironment({
    ddevProject: values['ddev-project'] ?? state.project?.ddev_project ?? null,
    launchArgs: (await import('../browser/launch.mjs')).browserArgs(),
  });

  if (values['write-baseline']) {
    await mkdir(paths.manifestsDir, { recursive: true });
    await writeFile(paths.envFingerprint, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    await store.update((s) => {
      s.fingerprints.environment = current.fingerprintHash;
      s.fingerprints.sealed_at = new Date().toISOString();
      s.target.php_from ||= current.components.php?.version ?? '';
      s.target.typo3_from ||= current.components.typo3?.version ?? '';
    });
    log.success(`Environment fingerprint sealed: ${current.fingerprintHash}`);
    return { exitCode: EXIT.PASS, verdict: 'pass', fingerprint: current.fingerprintHash, message: 'environment sealed' };
  }

  const sealed = await readJson(paths.envFingerprint);
  if (!sealed) {
    throw new PreconditionError('No sealed environment fingerprint. Run with --write-baseline first.');
  }
  const cmp = compareEnvironment(sealed, current);
  if (!cmp.match) {
    await journal.append('drift', { kind: 'environment', drifted: cmp.drifted.map((d) => d.key) });
    for (const d of cmp.drifted) log.error(`drift ${d.key}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`);
    throw new InvalidRunError(
      `Environment drifted in ${cmp.drifted.length} hashed component(s). The run cannot be judged.`,
      { drifted: cmp.drifted },
    );
  }
  log.success('Environment fingerprint matches the sealed value.');
  return { exitCode: EXIT.PASS, verdict: 'pass', message: 'environment matches' };
}

export async function contentFingerprint({ values, paths, log, journal }) {
  const store = new StateStore(paths);
  const state = await store.read();
  const writeBaseline = values['write-baseline'] === true;
  const writeTarget = values['write-target'] === true;
  if (writeBaseline && writeTarget) {
    throw new PreconditionError('--write-baseline and --write-target are mutually exclusive.');
  }
  if (writeBaseline && state.baselines?.['A-original']?.sealed) {
    throw new PreconditionError('Baseline A is sealed; its source content fingerprint cannot be rewritten.');
  }
  const baseline = await readJson(paths.contentFingerprint);
  const target = await readJson(paths.targetContentFingerprint);
  const sealed = state.fingerprints?.content_active === 'target' ? target : baseline;
  if (!writeBaseline && !writeTarget && !sealed) {
    throw new PreconditionError('No sealed content fingerprint. Run with --write-baseline first.');
  }
  if (writeTarget && !baseline) {
    throw new PreconditionError('A target content epoch requires the immutable source fingerprint first.');
  }
  if (writeTarget && !state.baselines?.['A-original']?.sealed) {
    throw new PreconditionError('Seal Baseline A before recording the post-migration target content epoch.');
  }
  const configuredTables = listOpt(values, 'tables', []);
  // Project-declared exclusions: request-driven log tables (view counters and the like)
  // mutate on every crawl and can never be stable under capture load. They come from
  // --exclude-tables or run.yml `fingerprint.exclude_tables` and are recorded in the
  // sealed manifest as projectExcludedTables.
  const projectExcludes = listOpt(values, 'exclude-tables', await runConfigExcludeTables(paths));
  const current = await collectContent({
    ddevProject: values['ddev-project'] ?? state.project?.ddev_project ?? null,
    fileadmin: values.fileadmin ?? sealed?.files?.root ?? baseline?.files?.root ?? 'fileadmin',
    tables: configuredTables.length
      ? configuredTables
      : (writeTarget ? null : sealed?.database?.tables?.map((table) => table.table) ?? null),
    allowMissing: values['allow-missing'] ?? false,
    excludeTables: projectExcludes,
  });

  if (writeBaseline) {
    await mkdir(paths.manifestsDir, { recursive: true });
    await writeFile(paths.contentFingerprint, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    await store.update((s) => {
      s.fingerprints.content = current.fingerprintHash;
      s.fingerprints.content_target = null;
      s.fingerprints.content_active = 'baseline';
      s.fingerprints.content_transition_hash = null;
    });
    if (current.degraded) log.warn('Content fingerprint is DEGRADED (database unavailable) — recorded in the report.');
    log.success(`Content fingerprint sealed: ${current.fingerprintHash}`);
    return { exitCode: EXIT.PASS, verdict: 'pass', fingerprint: current.fingerprintHash, degraded: current.degraded, message: 'content sealed' };
  }

  if (writeTarget) {
    if (!values.transition) {
      throw new PreconditionError('--transition is required with --write-target.');
    }
    let transition;
    try { transition = JSON.parse(await readFile(values.transition, 'utf8')); }
    catch (error) { throw new PreconditionError(`Cannot read content transition ledger: ${error.message}`); }
    validateContentTransition(transition, state, baseline.fingerprintHash);
    const transitionHash = `sha256:${sha256(JSON.stringify(transition))}`;
    current.sourceFingerprintHash = baseline.fingerprintHash;
    current.transitionHash = transitionHash;
    await mkdir(paths.manifestsDir, { recursive: true });
    await Promise.all([
      writeFile(paths.targetContentFingerprint, `${JSON.stringify(current, null, 2)}\n`, 'utf8'),
      writeFile(paths.contentTransition, `${JSON.stringify({ ...transition, transitionHash }, null, 2)}\n`, 'utf8'),
    ]);
    await store.update((s) => {
      s.fingerprints.content_target = current.fingerprintHash;
      s.fingerprints.content_active = 'target';
      s.fingerprints.content_transition_hash = transitionHash;
    });
    await journal.append('content-transition', {
      source: baseline.fingerprintHash,
      target: current.fingerprintHash,
      transitionHash,
      snapshot: transition.snapshot_ref,
    });
    log.success(`Target content epoch sealed: ${current.fingerprintHash}`);
    return {
      exitCode: EXIT.PASS, verdict: 'pass', fingerprint: current.fingerprintHash,
      transitionHash, message: 'target content epoch sealed',
    };
  }

  const cmp = compareContent(sealed, current);
  if (!cmp.match) {
    await journal.append('drift', { kind: 'content', drifted: cmp.drifted.map((d) => d.key) });
    for (const d of cmp.drifted) log.error(`content drift ${d.key}`);
    throw new InvalidRunError(
      'Content changed during the run. Every comparison against this baseline is void until resolved — '
      + 'this is content-drift, not a regression.',
      { drifted: cmp.drifted },
    );
  }
  log.success('Content fingerprint matches the sealed value.');
  return { exitCode: EXIT.PASS, verdict: 'pass', message: 'content matches' };
}

export function validateContentTransition(transition, state, sourceFingerprintHash) {
  if (transition?.schema !== 'typo3-upgrade-run/content-transition@1') {
    throw new PreconditionError('Content transition schema must be typo3-upgrade-run/content-transition@1.');
  }
  if (transition.source_fingerprint !== sourceFingerprintHash) {
    throw new PreconditionError('Content transition source_fingerprint does not match Baseline A.');
  }
  if (!transition.snapshot_ref || !(state.snapshots ?? []).includes(transition.snapshot_ref)) {
    throw new PreconditionError('Content transition snapshot_ref is not recorded in state.json.');
  }
  if (!Array.isArray(transition.commands) || !transition.commands.length
    || transition.commands.some((command) => command?.exit_code !== 0 || !Array.isArray(command?.argv))) {
    throw new PreconditionError('Content transition commands must be recorded as argv arrays with exit_code 0.');
  }
  const requiredChecks = [
    'upgrade_fixed_point', 'schema_reviewed', 'reference_index_clean', 'row_counts_reconciled',
  ];
  const missing = requiredChecks.filter((key) => transition.checks?.[key] !== true);
  if (missing.length) {
    throw new PreconditionError(`Content transition checks are incomplete: ${missing.join(', ')}.`);
  }
  return true;
}

/* --------------------------------------------------------------- helpers */

async function copyTemplate(rel, dest) {
  try { await cp(path.join(TEMPLATES, rel), dest, { force: false, errorOnExist: false }); }
  catch { /* templates are a convenience, not a precondition */ }
}

/** run.yml `fingerprint.exclude_tables` — absent file or key means no exclusions. */
async function runConfigExcludeTables(paths) {
  try {
    const { parse: parseYaml } = await import('yaml');
    const cfg = parseYaml(await readFile(paths.runConfig, 'utf8'));
    const list = cfg?.fingerprint?.exclude_tables;
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

export async function readJson(p) {
  try { return JSON.parse(await readFile(p, 'utf8')); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
}
