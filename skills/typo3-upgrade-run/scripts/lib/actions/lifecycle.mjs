/**
 * Executable loop, snapshot, approval, and validation lifecycle.
 *
 * The prose protocol remains the policy; these commands make its state transitions
 * mechanical so an agent cannot accidentally skip the scaffold, live freeze check, or
 * two-stage approval choreography.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { EXIT, HarnessError, PreconditionError } from '../cli/exit-codes.mjs';
import { LOOP_DOCS } from '../run/paths.mjs';
import { StateStore, assertLoopTransition } from '../run/state.mjs';
import { assertLiveInputs, readEvidenceContext } from '../run/evidence.mjs';
import { loopDocSchemaErrors } from '../run/schema.mjs';
import { validateReport } from '../report/write.mjs';
import { graphValidate } from './graph.mjs';

const exec = promisify(execFile);
const TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../templates/run-directory/loop',
);

export async function loopStart({ values, paths, log, journal }) {
  const id = normalizeLoopId(values.id);
  const track = values.track;
  const contract = values.contract ?? (track === 'elevation' ? 'B' : 'A');
  const slugValue = slug(values.slug ?? 'work');
  const phase = values.phase ?? (contract === 'B' ? 'P14' : 'P11');
  const baseline = values['baseline-ref'] ?? (contract === 'A' ? 'A-original' : null);
  if (!track) throw new HarnessError('--track is required.');
  if (!baseline) throw new PreconditionError('--baseline-ref is required.');
  if (contract === 'A' && baseline !== 'A-original') {
    throw new PreconditionError('Every Contract A loop must bind to A-original.');
  }

  const store = new StateStore(paths);
  const state = await store.read();
  if (state.loops[id]) throw new PreconditionError(`Loop ${id} already exists with verdict ${state.loops[id]}.`);
  if (contract === 'B') {
    if (!state.contract_b.unlocked) throw new PreconditionError('Contract B is locked.');
    if (!state.baselines[baseline]?.sealed) {
      throw new PreconditionError(`Contract B baseline ${baseline} does not exist or is not sealed.`);
    }
    const intentRef = values['intent-ref'];
    if (!intentRef || !state.approvals.includes(intentRef)) {
      throw new PreconditionError('A Contract B loop needs a recorded intent approval (--intent-ref).');
    }
  }

  const loopName = paths.loopDirName(id, track, slugValue);
  await mkdir(paths.loop(loopName), { recursive: true });
  const replacements = {
    RUN_ID: state.run_id,
    LOOP_ID: id,
    LOOP_SLUG: slugValue,
    TRACK: track,
    CONTRACT: contract,
    PHASE: phase,
    BASELINE_REF: baseline,
    INTENT_REF: values['intent-ref'] ? JSON.stringify(values['intent-ref']) : 'null',
    NOW: new Date().toISOString(),
  };
  for (const doc of LOOP_DOCS) {
    const source = await readFile(path.join(TEMPLATE_DIR, doc), 'utf8');
    await writeFile(paths.loopDoc(loopName, doc), render(source, replacements), 'utf8');
  }
  await mkdir(paths.loopArtifacts(loopName), { recursive: true });
  await store.update((current) => { current.loops[id] = 'planned'; });
  await journal?.append('transition', { loop_id: id, from: null, to: 'planned', loop: loopName });
  log.success(`Loop ${loopName} scaffolded with all ${LOOP_DOCS.length} protocol documents.`);
  return { exitCode: EXIT.PASS, verdict: 'pass', loop: loopName, status: 'planned', message: `${loopName} planned` };
}

export async function loopOpen({ values, paths, log, journal, liveAssert = assertLiveInputs }) {
  const loopName = await resolveLoop(paths, values.loop);
  const id = loopName.slice(0, 3);
  const snapshot = values.snapshot;
  const rollbackRef = values['rollback-ref'];
  const stateful = values.stateful === true;
  if (stateful && !snapshot) {
    throw new PreconditionError('--snapshot is required before a stateful loop may open.');
  }
  if (!snapshot && !rollbackRef) {
    throw new PreconditionError('Open a loop with --snapshot for stateful work or --rollback-ref for code/read-only work.');
  }
  const store = new StateStore(paths);
  const state = await store.read();
  assertLoopTransition(state.loops[id], 'open');
  if (snapshot && !state.snapshots.includes(snapshot)) {
    throw new PreconditionError(`Snapshot ${snapshot} is not recorded. Run snapshot-create first.`);
  }
  await liveAssert(paths);
  await store.update((current) => { current.loops[id] = 'open'; });
  await journal?.append('transition', {
    loop_id: id, from: 'planned', to: 'open', snapshot: snapshot ?? null,
    rollback_ref: rollbackRef ?? null, stateful,
  });
  log.success(`Loop ${loopName} opened against live-verified sealed inputs.`);
  return {
    exitCode: EXIT.PASS, verdict: 'pass', loop: loopName, status: 'open',
    rollbackAnchor: snapshot ?? rollbackRef, stateful, message: `${loopName} open`,
  };
}

export async function snapshotCreate({ values, paths, log, journal, runner = runDdev }) {
  const state = await new StateStore(paths).read();
  const loopName = await resolveLoop(paths, values.loop);
  const id = loopName.slice(0, 3);
  const name = values.name ?? `loop-${id}-pre`;
  await runner(name, state.project?.ddev_project || null);
  await new StateStore(paths).update((current) => {
    if (!current.snapshots.includes(name)) current.snapshots.push(name);
  });
  await journal?.append('snapshot', { loop_id: id, name });
  log.success(`DDEV snapshot ${name} created and recorded.`);
  return { exitCode: EXIT.PASS, verdict: 'pass', snapshot: name, message: `snapshot ${name} created` };
}

export async function approvalRecord({ values, paths, log, journal }) {
  const id = String(values.id ?? '');
  const stage = values.stage;
  if (!/^APR-\d{3}$/.test(id)) throw new HarnessError('--id must be APR-NNN.');
  if (!['intent', 'acceptance'].includes(stage)) throw new HarnessError('--stage must be intent or acceptance.');
  for (const key of ['scope', 'question', 'answer']) {
    if (!values[key]) throw new HarnessError(`--${key} is required.`);
  }
  if (stage === 'acceptance' && !values.evidence) {
    throw new PreconditionError('Acceptance approval requires --evidence from the observed result.');
  }

  const state = await new StateStore(paths).read();
  const granted = values.granted === true;
  const now = new Date().toISOString();
  const file = path.join(paths.approvalsDir, `${id}-${stage}-${slug(values.scope)}.md`);
  const body = [
    '---',
    `id: "${id}"`,
    `stage: "${stage}"`,
    `run_id: "${state.run_id}"`,
    `requested_at: "${now}"`,
    `granted_at: ${granted ? `"${now}"` : 'null'}`,
    'granted_by: "user"',
    `scope: ${JSON.stringify(values.scope)}`,
    `loops: [${values.loop ? JSON.stringify(String(values.loop).slice(0, 3)) : ''}]`,
    `evidence_ref: ${values.evidence ? JSON.stringify(values.evidence) : 'null'}`,
    '---',
    '',
    `# ${id} — ${stage}`,
    '',
    '## Question shown to the user',
    '',
    values.question,
    '',
    '## Answer',
    '',
    `> ${values.answer}`,
    '',
    `**${granted ? 'Granted' : 'Declined'}**`,
    '',
    '## Scope',
    '',
    values.scope,
    '',
    '## Evidence',
    '',
    values.evidence ?? 'Not applicable: this record authorises intent before implementation.',
    '',
  ].join('\n');
  await mkdir(paths.approvalsDir, { recursive: true });
  await writeFile(file, body, 'utf8');
  if (granted) {
    await new StateStore(paths).update((current) => {
      if (!current.approvals.includes(id)) current.approvals.push(id);
    });
    if (stage === 'acceptance' && values.loop) {
      const loopName = await resolveLoop(paths, values.loop);
      const exitPath = paths.loopDoc(loopName, '06-exit.md');
      const exit = await readFile(exitPath, 'utf8');
      const current = exit.match(/^acceptance_ref:\s*(.+)$/m)?.[1]?.trim();
      if (!current) throw new HarnessError(`${exitPath} has no acceptance_ref front-matter field.`);
      if (current !== 'null' && current !== `"${id}"` && current !== `'${id}'`) {
        throw new PreconditionError(`Loop ${loopName} already carries acceptance_ref ${current}.`);
      }
      await writeFile(exitPath, exit.replace(
        /^acceptance_ref:\s*.+$/m,
        `acceptance_ref: "${id}"`,
      ), 'utf8');
    }
  }
  await journal?.append('approval', { id, stage, granted, loop_id: values.loop ?? null, evidence: values.evidence ?? null });
  log.success(`${id} ${stage} recorded as ${granted ? 'granted' : 'declined'}.`);
  return { exitCode: EXIT.PASS, verdict: 'pass', id, stage, granted, file, message: `${id} recorded` };
}

export async function validateRun({ paths, log }) {
  const state = await new StateStore(paths).read();
  const issues = [];
  const loopDirs = await readdir(paths.loopsDir).catch(() => []);
  const approvalFiles = await readdir(paths.approvalsDir).catch(() => []);
  for (const [id, status] of Object.entries(state.loops)) {
    // Loop 000 is represented by selftest.json and selftest.lock.json. It is a
    // machine-managed evidence unit and deliberately has no scaffolded loop directory.
    if (id === '000') continue;
    const matches = loopDirs.filter((name) => name.startsWith(`${id}-`));
    if (matches.length !== 1) issues.push(`loop ${id} (${status}) has ${matches.length} directories`);
    if (matches.length === 1) {
      for (const doc of LOOP_DOCS) {
        try {
          const body = await readFile(paths.loopDoc(matches[0], doc), 'utf8');
          const frontMatter = parseFrontMatter(body);
          const schemaErrors = loopDocSchemaErrors(frontMatter);
          for (const error of schemaErrors) issues.push(`${matches[0]}/${doc}: ${error}`);
          if (frontMatter.run_id !== state.run_id) issues.push(`${matches[0]}/${doc}: run_id does not match state`);
          if (frontMatter.loop_id !== id) issues.push(`${matches[0]}/${doc}: loop_id does not match directory`);
          if (frontMatter.doc !== docName(doc)) issues.push(`${matches[0]}/${doc}: doc does not match filename`);
          if (frontMatter.approval_ref && !approvalFiles.some(
            (file) => file.startsWith(`${frontMatter.approval_ref}-intent-`),
          )) {
            issues.push(`${matches[0]}/${doc}: intent approval ${frontMatter.approval_ref} is missing`);
          }
          if (frontMatter.acceptance_ref && !approvalFiles.some(
            (file) => file.startsWith(`${frontMatter.acceptance_ref}-acceptance-`),
          )) {
            issues.push(`${matches[0]}/${doc}: acceptance approval ${frontMatter.acceptance_ref} is missing`);
          }
        }
        catch (error) { issues.push(`${matches[0]}/${doc}: ${error.message}`); }
      }
      try {
        const report = JSON.parse(await readFile(paths.loopReport(matches[0]), 'utf8'));
        for (const error of validateReport(report)) issues.push(`${matches[0]}/report.json: ${error}`);
      } catch (error) {
        if (error.code !== 'ENOENT' || status === 'green') {
          issues.push(`${matches[0]} has no valid report.json: ${error.message}`);
        }
      }
    }
  }
  if (state.fingerprints.environment || state.fingerprints.content || state.manifest.hash) {
    try { await readEvidenceContext(paths); } catch (error) { issues.push(error.message); }
  }
  if (issues.length) throw new PreconditionError(`Run validation failed:\n  - ${issues.join('\n  - ')}`);
  if (state.graph) await graphValidate({ paths, log });
  log.success('Run directory, state schema, loop documents, and evidence references are valid.');
  return { exitCode: EXIT.PASS, verdict: 'pass', loops: Object.keys(state.loops).length, message: 'run valid' };
}

async function runDdev(name, project) {
  const args = ['snapshot', '--name', name];
  await exec('ddev', args, { timeout: 10 * 60 * 1000 });
}

async function resolveLoop(paths, reference) {
  const value = String(reference ?? '');
  if (/^\d{3}-(?:harness|invariance|elevation|report)-/.test(value)) return value;
  const id = value.match(/^\d{3}/)?.[0];
  if (!id) throw new PreconditionError('--loop must be NNN or a complete loop directory name.');
  const matches = (await readdir(paths.loopsDir).catch(() => [])).filter((name) => name.startsWith(`${id}-`));
  if (matches.length !== 1) throw new PreconditionError(`Expected one directory for loop ${id}, found ${matches.length}.`);
  return matches[0];
}

function normalizeLoopId(value) {
  const id = String(value ?? '').padStart(3, '0');
  if (!/^\d{3}$/.test(id)) throw new HarnessError('--id must be a three-digit loop id.');
  return id;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'work';
}

function render(source, replacements) {
  return Object.entries(replacements).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
    source,
  );
}

function parseFrontMatter(body) {
  const match = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('invalid or missing YAML front matter');
  return parseYaml(match[1]);
}

function docName(file) {
  return file.replace(/^\d{2}-/, '').replace(/\.md$/, '');
}
