/** Current-code closure, distinct from a valid directory or a successful Composer update. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { EXIT, InvalidRunError, PreconditionError } from '../cli/exit-codes.mjs';
import { assertLiveInputs } from '../run/evidence.mjs';
import { sha256 } from '../run/paths.mjs';
import { browserArgs } from '../browser/launch.mjs';
import { verifyBaseline } from '../run/lockfile.mjs';
import { StateStore } from '../run/state.mjs';
import { featurePlanIssues, featureCoverageIssues } from '../run/feature-contracts.mjs';

const exec = promisify(execFile);
export const CLOSURE_CHECKS = Object.freeze([
  'http-dom', 'visual', 'interactions', 'backend-editor', 'redirects', 'runtime',
  'dependencies', 'schema', 'assets', 'environment', 'deployer', 'lighthouse', 'axe',
]);
const PROOF_NODES = ['migration-join', 'target-content-epoch', 'http-dom-proof', 'visual-proof',
  'component-sentinels', 'backend-operations', 'lighthouse-axe', 'closure-join'];

export async function repositorySubject(cwd, runRoot) {
  const git = async (...args) => (await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;
  const root = await realpath((await git('rev-parse', '--show-toplevel')).trim());
  if (root !== await realpath(cwd)) throw new PreconditionError('Run closure from the repository root.');
  const excluded = path.relative(root, await realpath(runRoot));
  if (!excluded || excluded.startsWith('..')) throw new PreconditionError('Closure evidence must be in a subdirectory of this repository.');
  const pathspec = ['.', `:(exclude,literal)${excluded}`];
  const head = (await git('rev-parse', 'HEAD')).trim();
  const branch = (await git('symbolic-ref', '--short', 'HEAD')).trim();
  const index = await git('ls-files', '--stage', '-z', '--', ...pathspec);
  const diff = await git('diff', '--no-ext-diff', '--no-textconv', '--binary', '--ignore-submodules=none', '--', ...pathspec);
  if (index.split('\0').some(entry => entry.startsWith('160000 ')) && diff.includes('Subproject commit')) {
    throw new PreconditionError('Submodules must be clean and pinned in the index before closure.');
  }
  const untracked = (await git('ls-files', '--others', '--exclude-standard', '-z', '--', ...pathspec)).split('\0').filter(Boolean);
  // Untracked implementation files must be staged/committed before proof. Do not read
  // unknown files (possibly credentials) into evidence just to fingerprint a dirty tree.
  if (untracked.length) throw new PreconditionError('Untracked files outside the run directory: classify/ignore private artifacts and stage implementation files before closure.');
  // Index object IDs + unstaged delta bind code bytes/modes. HEAD is provenance, not
  // the freshness key: committing only run reports must not invalidate their own proof.
  return { root, branch, head, sourceIndexHash: `sha256:${sha256(index)}`, worktreeHash: `sha256:${sha256(diff)}` };
}

async function currentSubject(paths) {
  const context = await assertLiveInputs(paths, { launchArgs: browserArgs() });
  await verifyBaseline(paths.baseline('A-original'));
  const repo = await repositorySubject(process.cwd(), paths.root);
  if (!context.state.graph?.definition_hash || !context.state.baselines?.['A-original']?.sealed) {
    throw new PreconditionError('Closure requires the sealed graph and Baseline A.');
  }
  const features = await sealedFeaturePlan(paths, context.state);
  return { context, features, subject: { ...repo, graphHash: context.state.graph.definition_hash, inputs: context.inputs,
    ...(features ? { featureContractsHash: features.hash } : {}) } };
}

export async function readFeaturePlan(paths, reference, expectedHash, runId) {
  const bytes = await readClosureArtifact(paths.root, reference);
  const hash = `sha256:${sha256(bytes)}`;
  if (hash !== expectedHash) throw new InvalidRunError('Sealed feature plan changed.');
  let plan;
  try { plan = JSON.parse(bytes); } catch { throw new InvalidRunError('Feature plan must be JSON.'); }
  const issues = featurePlanIssues(plan, runId);
  if (issues.length) throw new InvalidRunError(`Feature plan refused:\n  - ${issues.join('\n  - ')}`);
  for (const feature of plan.features) {
    const bytes = await readClosureArtifact(paths.root, feature.evidence.path);
    if (`sha256:${sha256(bytes)}` !== feature.evidence.sha256) throw new InvalidRunError('Feature inventory evidence changed.');
  }
  return { plan, hash };
}

export async function sealedFeaturePlan(paths, state) {
  const bytes = await readClosureArtifact(paths.root, state.graph?.definition_path);
  if (`sha256:${sha256(bytes)}` !== state.graph.definition_hash) throw new InvalidRunError('Graph definition changed.');
  const definition = parseYaml(bytes.toString());
  if (definition?.schema !== 'typo3-upgrade-run/graph@1'
    || (definition.policy?.require_feature_contracts !== undefined && typeof definition.policy.require_feature_contracts !== 'boolean')) {
    throw new InvalidRunError('Invalid graph feature-contract policy.');
  }
  // Do not rewrite a legacy sealed graph or claim it passed a newer evidence contract.
  if (definition.policy?.require_feature_contracts !== true) return null;
  const intake = state.graph.nodes?.['intake-join'];
  if (intake?.status !== 'passed') throw new PreconditionError('Seal feature contracts at intake-join before proof.');
  return readFeaturePlan(paths, intake.evidence, intake.evidence_sha256, state.run_id);
}

export async function closureStart({ paths, log }) {
  const { context, subject } = await currentSubject(paths);
  if (context.state.contract_a.status !== 'closed' && (!Number.isFinite(Date.parse(context.state.runtime?.deadline_at)) || Date.now() >= Date.parse(context.state.runtime.deadline_at))) {
    throw new PreconditionError('The overnight deadline has passed; a new proof epoch cannot extend the run.');
  }
  if (context.state.graph.nodes?.['migration-join']?.status !== 'passed'
    || context.state.graph.nodes?.['target-content-epoch']?.status !== 'passed') {
    throw new PreconditionError('Finish migration and reconcile the target content epoch before starting final proof.');
  }
  const epoch = { schema: 'typo3-upgrade-run/closure-epoch@1', runId: context.state.run_id,
    createdAt: new Date().toISOString(), subject };
  epoch.hash = `sha256:${sha256(JSON.stringify(epoch))}`;
  await mkdir(paths.reportDir, { recursive: true });
  const file = path.join(paths.reportDir, `closure-epoch-${epoch.hash.slice(7, 23)}.json`);
  await writeFile(file, JSON.stringify(epoch, null, 2) + '\n', { flag: 'wx' });
  log.success(`Final proof epoch: ${path.relative(paths.root, file)}. Bind every check to ${epoch.hash}.`);
  return { exitCode: EXIT.PASS, verdict: 'pass', epoch: path.relative(paths.root, file), hash: epoch.hash, message: 'closure epoch started' };
}

export async function readClosureArtifact(root, reference) {
  if (typeof reference !== 'string' || !reference || path.isAbsolute(reference)) throw new InvalidRunError('Evidence paths must be run-relative.');
  const resolved = await realpath(path.resolve(root, reference)).catch(() => null);
  const canonicalRoot = await realpath(root);
  if (!resolved || !resolved.startsWith(canonicalRoot + path.sep)) throw new InvalidRunError(`Missing or escaping closure artifact: ${reference}`);
  const bytes = await readFile(resolved);
  if (!bytes.length) throw new InvalidRunError(`Empty closure artifact: ${reference}`);
  return bytes;
}

export function timelyVerification(manifest, epoch, state, now = Date.now()) {
  const verification = state.contract_a?.verification;
  const at = Date.parse(verification?.at), deadline = Date.parse(state.runtime?.deadline_at);
  return Boolean(verification?.evidence_ref && Number.isFinite(at) && Number.isFinite(deadline)
    && at < deadline && at <= now && Date.parse(epoch?.createdAt) <= at
    && verification.epoch_hash === epoch?.hash
    && verification.manifest_hash === `sha256:${sha256(JSON.stringify(manifest))}`
    && Array.isArray(manifest?.checks) && manifest.checks.length === CLOSURE_CHECKS.length
    && manifest.checks.every(c => c && Number.isFinite(Date.parse(c.finishedAt)) && Date.parse(c.finishedAt) <= at));
}

export function closureIssues(manifest, epoch, subject, state, now = Date.now()) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (![manifest, epoch, subject, state].every(object)) return ['closure, epoch, subject and state must be objects'];
  const issues = [];
  if (!Number.isFinite(Date.parse(epoch.createdAt)) || Date.parse(epoch.createdAt) > now) issues.push('invalid epoch timestamp');
  if (state.contract_a?.status !== 'closed' && (!Number.isFinite(Date.parse(state.runtime?.deadline_at))
    || (now >= Date.parse(state.runtime.deadline_at) && !timelyVerification(manifest, epoch, state, now)))) {
    issues.push('sealed runtime deadline missing or exhausted without a timely verified receipt');
  }
  const { hash, ...body } = epoch;
  if (epoch.schema !== 'typo3-upgrade-run/closure-epoch@1' || hash !== `sha256:${sha256(JSON.stringify(body))}`) issues.push('invalid proof epoch');
  if (manifest.schema !== 'typo3-upgrade-run/closure@1') issues.push('invalid closure schema');
  if (epoch.runId !== state.run_id || manifest.runId !== state.run_id) issues.push('wrong run');
  const { head: recordedHead, ...recordedSource } = epoch.subject ?? {};
  const { head: currentHead, ...currentSource } = subject;
  if (JSON.stringify(recordedSource) !== JSON.stringify(currentSource)) issues.push('STALE: code, branch, graph or live evidence inputs changed; start a new proof epoch');
  if (state.open_findings !== 0) issues.push('unresolved run findings');
  for (const id of PROOF_NODES) if (state.graph?.nodes?.[id]?.status !== 'passed') issues.push(`required node is not passed: ${id}`);
  if (Object.entries(state.graph?.nodes ?? {}).some(([id, n]) => n?.status === 'running' && !['contract-a-gate', 'handover'].includes(id))) issues.push('another node is still running');
  const checks = manifest.checks ?? [];
  if (!Array.isArray(checks)) return [...issues, 'checks must be an array'];
  if (!checks.every(object)) return [...issues, 'every check must be an object'];
  if (checks.length !== CLOSURE_CHECKS.length || new Set(checks.map(c => c.id)).size !== checks.length) issues.push('missing, extra or duplicate checks');
  for (const id of CLOSURE_CHECKS) {
    const c = checks.find(c => c.id === id);
    if (!c) { issues.push(`missing check: ${id}`); continue; }
    if (c.status !== 'pass' || c.exitCode !== 0 || c.failed !== 0 || c.skipped !== 0) issues.push(`${id}: failed, skipped or unproven`);
    if (!Number.isInteger(c.expected) || c.expected < 1 || c.executed !== c.expected) issues.push(`${id}: incomplete coverage`);
    if (c.epoch !== hash || typeof c.command !== 'string' || !c.command.trim()) issues.push(`${id}: missing command or wrong epoch`);
    const start = Date.parse(c.startedAt), end = Date.parse(c.finishedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < Date.parse(epoch.createdAt) || end < start || end > now) issues.push(`${id}: stale or invalid timing`);
    if (!Array.isArray(c.artifacts) || !c.artifacts.length || c.artifacts.some(a => !object(a) || typeof a.path !== 'string' || !a.path || !/^sha256:[a-f0-9]{64}$/.test(a.sha256))) issues.push(`${id}: missing hashed artifacts`);
    if (id === 'visual' && (c.pixelThreshold !== 0 || c.unapprovedDifferences !== 0)) issues.push('visual: strict zero or explicit approved differences not proven');
    if (id === 'lighthouse' && (!Number.isInteger(c.runsPerUrl) || c.runsPerUrl < 3 || c.budgetApplied !== true || !c.toolVersion || !c.chromeVersion)) issues.push('lighthouse: repeated, budgeted, versioned measurements required');
  }
  if (!manifest.coverageRef || !manifest.backupRef || !manifest.restoreRef) issues.push('coverage registry and backup/restore references required');
  for (const key of ['coverage', 'backup', 'restore']) {
    if (!/^sha256:[a-f0-9]{64}$/.test(manifest[`${key}Sha256`])) issues.push(`${key}: reference must have an integrity hash`);
  }
  return issues;
}

export async function closureCheck({ values, paths, log }) {
  const reference = values.evidence ?? 'report/closure-evidence.json';
  const manifestBytes = await readClosureArtifact(paths.root, reference);
  const manifest = JSON.parse(manifestBytes);
  const epoch = JSON.parse(await readClosureArtifact(paths.root, manifest?.epochRef));
  const { context, subject, features } = await currentSubject(paths);
  const issues = closureIssues(manifest, epoch, subject, context.state);
  if (issues.length) throw new InvalidRunError(`Closure refused:\n  - ${issues.join('\n  - ')}`);
  for (const key of ['coverage', 'backup', 'restore']) {
    if (`sha256:${sha256(await readClosureArtifact(paths.root, manifest[`${key}Ref`]))}` !== manifest[`${key}Sha256`]) {
      throw new InvalidRunError(`Closure ${key} artifact changed.`);
    }
  }
  for (const c of manifest.checks) for (const a of c.artifacts) {
    const actual = `sha256:${sha256(await readClosureArtifact(paths.root, a.path))}`;
    if (actual !== a.sha256) throw new InvalidRunError(`Closure artifact changed: ${a.path}`);
  }
  if (features) {
    let coverage;
    try { coverage = JSON.parse(await readClosureArtifact(paths.root, manifest.coverageRef)); }
    catch { throw new InvalidRunError('Feature coverage must be JSON.'); }
    const findings = featureCoverageIssues(features.plan, coverage, manifest);
    if (findings.length) throw new InvalidRunError(`Feature coverage refused:\n  - ${findings.join('\n  - ')}`);
  }
  // A passed state label with a nonexistent report must never be enough for closure.
  for (const id of PROOF_NODES) await readClosureArtifact(paths.root, context.state.graph.nodes[id].evidence);
  log.success('Current-code closure evidence verified; this is not a deployment certificate.');
  return { exitCode: EXIT.PASS, verdict: 'pass', evidence: reference, epoch: epoch.hash,
    stateRevision: sha256(JSON.stringify(context.state)),
    canonicalManifestHash: `sha256:${sha256(JSON.stringify(manifest))}`,
    manifestHash: `sha256:${sha256(manifestBytes)}`,
    proofCompletedAt: Math.max(...manifest.checks.map(c => Date.parse(c.finishedAt))),
    message: 'closure evidence current and complete' };
}

export async function closureVerify({ values, paths, log, journal }) {
  const checked = await closureCheck({ values, paths, log });
  const at = new Date().toISOString();
  const verification = { at, evidence_ref: checked.evidence, epoch_hash: checked.epoch,
    manifest_hash: checked.canonicalManifestHash };
  await new StateStore(paths).transaction(state => {
    if (sha256(JSON.stringify(state)) !== checked.stateRevision) throw new PreconditionError('State changed during verification; check again.');
    if (state.contract_a.status === 'closed' || Date.parse(at) >= Date.parse(state.runtime.deadline_at)) {
      throw new PreconditionError('Record overnight verification before the deadline, while Contract A is open.');
    }
    state.contract_a.verification = verification;
    return state;
  });
  await journal?.append('graph', { action: 'verified-awaiting-acceptance', ...verification });
  log.success('Verification recorded within the overnight budget. Contract A remains open, awaiting actual human acceptance.');
  return { exitCode: EXIT.PASS, verdict: 'pass', verification, message: 'verified awaiting acceptance; no deployment authorized' };
}

export function validClosureAcceptance(acceptance, { runId, approvalId, evidence, manifestHash, proofCompletedAt }, now = Date.now()) {
  const grantedAt = Date.parse(acceptance?.granted_at);
  return Boolean(acceptance?.id === approvalId && acceptance?.stage === 'acceptance'
    && acceptance?.granted_by === 'user' && acceptance.run_id === runId
    && Number.isFinite(grantedAt) && grantedAt >= proofCompletedAt && grantedAt <= now
    && acceptance.evidence_ref === `${evidence}#${manifestHash}`);
}

export async function verifyRecordedClosureAcceptance(paths, state, now = Date.now()) {
  const closedAt = Date.parse(state.contract_a?.closed_at), deadline = Date.parse(state.runtime?.deadline_at);
  const evidence = state.contract_a?.closure_ref;
  const gate = state.graph?.nodes?.['contract-a-gate'];
  if (!Number.isFinite(closedAt) || !Number.isFinite(deadline) || closedAt > now
    || gate?.status !== 'passed' || !evidence || evidence !== gate.evidence) {
    throw new InvalidRunError('Closed label lacks a passed, timely Contract A transition and its evidence reference.');
  }
  // A remains historical after approved B work. Validate its own accepted manifest,
  // independently of the fresh final manifest checked against the current B subject.
  const bytes = await readClosureArtifact(paths.root, evidence);
  const manifest = JSON.parse(bytes);
  if (closedAt > deadline) {
    const epoch = JSON.parse(await readClosureArtifact(paths.root, manifest.epochRef));
    if (state.contract_a.verification?.evidence_ref !== evidence || !timelyVerification(manifest, epoch, state, closedAt)) {
      throw new InvalidRunError('Late acceptance requires the exact proof verified before the overnight deadline.');
    }
  }
  const expected = { runId: state.run_id, evidence, manifestHash: `sha256:${sha256(bytes)}`,
    proofCompletedAt: Math.max(...(manifest.checks ?? []).map(c => Date.parse(c.finishedAt))) };
  for (const file of await readdir(paths.approvalsDir)) {
    const id = file.match(/^(APR-\d{3})-acceptance-.*\.md$/)?.[1];
    if (!id || !state.approvals.includes(id)) continue;
    const body = await readFile(path.join(paths.approvalsDir, file), 'utf8');
    const record = parseYaml(body.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '');
    if (validClosureAcceptance(record, { ...expected, approvalId: id }, closedAt)) return;
  }
  throw new InvalidRunError('Closed label has no recorded human acceptance of its exact manifest hash.');
}
