/**
 * Evidence context and live input assertions.
 *
 * Reports never guess their run id or hashes. Comparisons also re-collect the live
 * renderer and content inputs; comparing two sealed JSON files would only prove that the
 * files were not edited, not that the application stayed comparable.
 */

import { readFile } from 'node:fs/promises';
import { InvalidRunError, PreconditionError } from '../cli/exit-codes.mjs';
import { collectEnvironment, compareEnvironment } from '../fingerprint/environment.mjs';
import { collectContent, compareContent } from '../fingerprint/content.mjs';
import { StateStore } from './state.mjs';
import { sha256 } from './paths.mjs';

export async function readEvidenceContext(paths) {
  const state = await new StateStore(paths).read();
  const [environment, contentBaseline, contentTarget, transition, manifest, selftest] = await Promise.all([
    readJsonRequired(paths.envFingerprint, 'environment fingerprint'),
    readJsonRequired(paths.contentFingerprint, 'content fingerprint'),
    readJsonOptional(paths.targetContentFingerprint),
    readJsonOptional(paths.contentTransition),
    readJsonRequired(paths.urlManifest, 'URL manifest'),
    readJsonRequired(paths.selftestLock, 'self-test lock'),
  ]);
  const targetActive = state.fingerprints?.content_active === 'target';
  if (targetActive && !contentTarget) {
    throw new InvalidRunError('state.json activates a target content epoch whose manifest is missing.');
  }
  if (targetActive) {
    const { transitionHash: recordedHash, ...transitionBody } = transition ?? {};
    const actualHash = transition ? `sha256:${sha256(JSON.stringify(transitionBody))}` : null;
    if (!transition || recordedHash !== actualHash
      || recordedHash !== state.fingerprints?.content_transition_hash
      || contentTarget.transitionHash !== recordedHash) {
      throw new InvalidRunError('The active content transition ledger is missing, edited, or not bound to the target epoch.');
    }
  }
  const content = targetActive ? contentTarget : contentBaseline;

  const inputs = {
    manifestHash: manifest.manifestHash ?? null,
    environmentFingerprintHash: environment.fingerprintHash ?? null,
    contentFingerprintHash: content.fingerprintHash ?? null,
    baselineContentFingerprintHash: contentBaseline.fingerprintHash ?? null,
    targetContentFingerprintHash: targetActive ? contentTarget?.fingerprintHash ?? null : null,
    contentTransitionHash: targetActive ? state.fingerprints?.content_transition_hash ?? null : null,
    selftestLockHash: state.selftest?.lock_hash ?? selftest.selftestHash ?? null,
  };
  const mismatches = [];
  compareRef(mismatches, 'state.fingerprints.environment', state.fingerprints?.environment, inputs.environmentFingerprintHash);
  compareRef(mismatches, 'state.fingerprints.content', state.fingerprints?.content, inputs.baselineContentFingerprintHash);
  compareRef(mismatches, 'state.fingerprints.content_target', state.fingerprints?.content_target, inputs.targetContentFingerprintHash);
  compareRef(mismatches, 'state.manifest.hash', state.manifest?.hash, inputs.manifestHash);
  if (mismatches.length) {
    throw new InvalidRunError('state.json does not match the sealed evidence manifests.', { mismatches });
  }
  for (const key of ['manifestHash', 'environmentFingerprintHash', 'contentFingerprintHash', 'baselineContentFingerprintHash', 'selftestLockHash']) {
    if (!inputs[key]) throw new PreconditionError(`Evidence input ${key} is missing; seal the run inputs first.`);
  }

  return {
    run: { runId: state.run_id },
    inputs,
    state,
    sealed: { environment, content, contentBaseline, contentTarget, transition, manifest, selftest },
  };
}

export async function assertLiveInputs(paths, {
  environmentCollector = collectEnvironment,
  contentCollector = collectContent,
  launchArgs = [],
} = {}) {
  const context = await readEvidenceContext(paths);
  const { state, sealed } = context;
  const tables = sealed.content.database?.tables?.map((entry) => entry.table) ?? null;
  const [environment, content] = await Promise.all([
    environmentCollector({
      ddevProject: state.project?.ddev_project || null,
      launchArgs,
    }),
    contentCollector({
      ddevProject: state.project?.ddev_project || null,
      fileadmin: sealed.content.files?.root ?? 'fileadmin',
      tables,
      allowMissing: sealed.content.degraded === true,
    }),
  ]);

  const env = compareEnvironment(sealed.environment, environment);
  const data = compareContent(sealed.content, content);
  if (!env.match || !data.match) {
    throw new InvalidRunError(
      'Live environment or content drifted from the sealed inputs. Comparisons are void.',
      {
        environment: env.drifted,
        content: data.drifted,
      },
    );
  }
  return { ...context, live: { environment, content } };
}

async function readJsonRequired(file, label) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') throw new PreconditionError(`Missing ${label}: ${file}`);
    throw new InvalidRunError(`Unreadable ${label}: ${error.message}`);
  }
}

async function readJsonOptional(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new InvalidRunError(`Unreadable optional evidence ${file}: ${error.message}`);
  }
}

function compareRef(out, key, recorded, actual) {
  if (recorded && actual && recorded !== actual) out.push({ key, recorded, actual });
}
