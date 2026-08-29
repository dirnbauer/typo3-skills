/**
 * state.json — the ONLY source a graph node or bounded evidence loop may read its
 * preconditions from.
 *
 * Written atomically (tmp + rename) because a half-written state file is worse than none:
 * it still looks authoritative.
 *
 * Transitions are enforced rather than trusted. A tool that cannot make a transition
 * legally must refuse and say why, instead of writing the state it wishes were true.
 */

import { readFile, writeFile, rename, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { HarnessError, PreconditionError, InvalidRunError } from '../cli/exit-codes.mjs';
import { stateSchemaErrors } from './schema.mjs';

export const STATE_SCHEMA = 'typo3-upgrade-run/state@1';

export const LOOP_VERDICTS = Object.freeze(['planned', 'open', 'green', 'aborted', 'superseded', 'invalid']);

export function emptyState({ runId, now }) {
  return {
    schema: STATE_SCHEMA,
    run_id: runId,
    runtime: {
      started_at: now,
      sealed_at: null,
      size_profile: null,
      size_evidence_ref: null,
      migration_cutoff_at: null,
      deadline_at: null,
      max_hours: null,
      closure_reserve_hours: null,
    },
    project: { name: '', trusted_origin: '', ddev_project: '', languages: [], run_dir: '.typo3-update' },
    target: {
      kind: 'project', typo3_from: '', typo3_to: '14.3',
      php_from: '', php_to: '8.4', php_85_evaluated: null, php_85_blockers: [],
    },
    contract_a: { phase: 'P00', status: 'open', closed_at: null, closure_ref: null },
    contract_b: { unlocked: false, unlocked_at: null, tracks: [] },
    baselines: { 'A-original': { sealed: false, sealed_at: null, manifest: null, urls: 0, captures: 0 } },
    fingerprints: {
      environment: null, content: null, content_target: null,
      content_active: 'baseline', content_transition_hash: null, sealed_at: null,
    },
    selftest: { status: 'never-run', at: null, lock_hash: null, coverage: null, quarantined_captures: [] },
    manifest: { path: 'manifests/url-manifest.json', hash: null, seed: '' },
    graph: null,
    loops: {},
    gates: {},
    approvals: [],
    decisions: [],
    snapshots: [],
    open_findings: 0,
    blocked: null,
    updated_at: now,
  };
}

export class StateStore {
  constructor(paths, { now = () => new Date().toISOString() } = {}) {
    this.paths = paths;
    this.now = now;
  }

  async exists() {
    try { await readFile(this.paths.statePath, 'utf8'); return true; }
    catch { return false; }
  }

  async read() {
    let raw;
    try {
      raw = await readFile(this.paths.statePath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw new PreconditionError(
          `No state file at ${this.paths.statePath}. Run "t3u init" first.`,
        );
      }
      throw err;
    }
    return this.#parse(raw);
  }

  /** Atomic: write a temp file, then rename over the target under a lock. */
  async write(state) {
    await mkdir(path.dirname(this.paths.statePath), { recursive: true });
    const lock = await this.#acquireLock();
    try {
      await this.#writeUnlocked(state);
    } finally {
      await lock();
    }
    return state;
  }

  async update(mutator) {
    return this.transaction(mutator);
  }

  /** Read-modify-write while holding one lock, so parallel graph nodes cannot lose updates. */
  async transaction(mutator) {
    await mkdir(path.dirname(this.paths.statePath), { recursive: true });
    const lock = await this.#acquireLock();
    try {
      let raw;
      try { raw = await readFile(this.paths.statePath, 'utf8'); }
      catch (err) {
        if (err.code === 'ENOENT') throw new PreconditionError(`No state file at ${this.paths.statePath}. Run "t3u init" first.`);
        throw err;
      }
      const state = this.#parse(raw);
      const next = (await mutator(state)) ?? state;
      await this.#writeUnlocked(next);
      return next;
    } finally {
      await lock();
    }
  }

  #parse(raw) {
    let state;
    try { state = JSON.parse(raw); }
    catch (err) { throw new InvalidRunError(`state.json is not valid JSON: ${err.message}`); }
    if (state.schema !== STATE_SCHEMA) {
      throw new InvalidRunError(`Unsupported state schema: ${state.schema}`, { expected: STATE_SCHEMA });
    }
    const errors = stateSchemaErrors(state);
    if (errors.length) {
      throw new InvalidRunError(`state schema validation failed:\n  - ${errors.join('\n  - ')}`, { errors });
    }
    return state;
  }

  async #writeUnlocked(state) {
    state.updated_at = this.now();
    const errors = stateSchemaErrors(state);
    if (errors.length) {
      throw new InvalidRunError(`state schema validation failed:\n  - ${errors.join('\n  - ')}`, { errors });
    }
    const tmp = `${this.paths.statePath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(tmp, this.paths.statePath);
  }

  async #acquireLock() {
    let handle;
    try {
      handle = await open(this.paths.stateLock, 'wx');
    } catch (err) {
      if (err.code === 'EEXIST') {
        throw new HarnessError(
          `state.lock exists at ${this.paths.stateLock} — another run may be active. Remove it if not.`,
        );
      }
      throw err;
    }
    return async () => {
      await handle.close();
      const { unlink } = await import('node:fs/promises');
      await unlink(this.paths.stateLock).catch(() => {});
    };
  }
}

/* --------------------------------------------------------------- transitions */

const PHASE_ORDER = ['P00','P01','P02','P03','P04','P05','P06','P07','P08','P09','P10','P11','P12','P13','P14','P15'];

export function assertPhaseAdvance(from, to) {
  const a = PHASE_ORDER.indexOf(from);
  const b = PHASE_ORDER.indexOf(to);
  if (a === -1 || b === -1) throw new HarnessError(`Unknown phase: ${from} -> ${to}`);
  if (b < a) throw new HarnessError(`Phases only move forward: ${from} -> ${to}`);
  if (b > a + 1) throw new HarnessError(`Phases advance one at a time: ${from} -> ${to}`);
  return true;
}

/**
 * green -> open is NOT a transition. A loop that must run again is a NEW loop id with
 * depends_on pointing at the old one, so the record of the first attempt survives.
 */
export function assertLoopTransition(from, to) {
  if (!LOOP_VERDICTS.includes(to)) throw new HarnessError(`Unknown loop verdict: ${to}`);
  if (from === undefined || from === null) return true;
  const legal = {
    planned: ['open', 'superseded'],
    open: ['green', 'aborted', 'superseded'],
    green: ['superseded'],
    aborted: ['superseded'],
    superseded: [],
    invalid: ['superseded'],
  };
  if (!legal[from]?.includes(to)) {
    throw new HarnessError(
      `Illegal loop transition ${from} -> ${to}. A loop that must run again is a new loop id.`,
    );
  }
  return true;
}

export function assertBaselineSeal(baseline) {
  if (baseline?.sealed) {
    throw new HarnessError('A sealed baseline cannot be re-sealed. There is no unseal.');
  }
  return true;
}

/** Contract B may only be unlocked by the closure certificate, and only once. */
export function assertContractBUnlock(state, closureRef) {
  if (state.contract_b.unlocked) throw new HarnessError('Contract B is already unlocked.');
  if (state.contract_a.status !== 'closed') {
    throw new PreconditionError('Contract B cannot unlock before Contract A is closed.');
  }
  if (!closureRef) throw new HarnessError('Unlocking Contract B requires a closure certificate reference.');
  return true;
}
