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

export async function readEvidenceContext(paths) {
  const state = await new StateStore(paths).read();
  const [environment, content, manifest, selftest] = await Promise.all([
    readJsonRequired(paths.envFingerprint, 'environment fingerprint'),
    readJsonRequired(paths.contentFingerprint, 'content fingerprint'),
    readJsonRequired(paths.urlManifest, 'URL manifest'),
    readJsonRequired(paths.selftestLock, 'self-test lock'),
  ]);

  const inputs = {
    manifestHash: manifest.manifestHash ?? null,
    environmentFingerprintHash: environment.fingerprintHash ?? null,
    contentFingerprintHash: content.fingerprintHash ?? null,
    selftestLockHash: state.selftest?.lock_hash ?? selftest.selftestHash ?? null,
  };
  const mismatches = [];
  compareRef(mismatches, 'state.fingerprints.environment', state.fingerprints?.environment, inputs.environmentFingerprintHash);
  compareRef(mismatches, 'state.fingerprints.content', state.fingerprints?.content, inputs.contentFingerprintHash);
  compareRef(mismatches, 'state.manifest.hash', state.manifest?.hash, inputs.manifestHash);
  if (mismatches.length) {
    throw new InvalidRunError('state.json does not match the sealed evidence manifests.', { mismatches });
  }
  for (const [key, value] of Object.entries(inputs)) {
    if (!value) throw new PreconditionError(`Evidence input ${key} is missing; seal the run inputs first.`);
  }

  return {
    run: { runId: state.run_id },
    inputs,
    state,
    sealed: { environment, content, manifest, selftest },
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

function compareRef(out, key, recorded, actual) {
  if (recorded && actual && recorded !== actual) out.push({ key, recorded, actual });
}
