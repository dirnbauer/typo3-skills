/**
 * Subcommand parsing on node:util parseArgs. No commander.
 *
 * Subcommands rather than --action=<string> is deliberate: the old --action dispatch is
 * WHY the exit-code defect existed. A bad flag combination threw a generic error and every
 * success path fell through to one log line with no exit code. Per-command specs plus one
 * wrapper that owns the exit make that shape impossible.
 */

import { parseArgs } from 'node:util';
import { HarnessError } from './exit-codes.mjs';

/** Flags every command accepts. */
export const GLOBAL_OPTIONS = {
  'run-dir': { type: 'string', default: '.typo3-update', help: 'Run directory (must be inside the project)' },
  loop: { type: 'string', help: 'Loop directory name, e.g. 300-invariance-closure' },
  node: { type: 'string', help: 'Upgrade graph node id' },
  config: { type: 'string', help: 'Run configuration file' },
  'env-file': { type: 'string', help: 'Explicit secret file. No .env is ever loaded implicitly.' },
  'allow-origin': { type: 'string', multiple: true, help: 'Additional allowed origin (repeatable)' },
  'redaction-profile': { type: 'string', default: 'local', help: 'local | share' },
  json: { type: 'boolean', default: false, help: 'Machine-readable result on stdout' },
  quiet: { type: 'boolean', default: false, help: 'Suppress progress output' },
  verbose: { type: 'boolean', default: false, help: 'Debug output on stderr' },
  'dry-run': { type: 'boolean', default: false, help: 'Report what would happen; write nothing' },
  help: { type: 'boolean', default: false, short: 'h' },
};

export const COMMANDS = {
  init: { summary: 'Create the run directory and initial state', options: {
    'base-url': { type: 'string' }, 'project-name': { type: 'string' },
    'ddev-project': { type: 'string' },
    languages: { type: 'string' }, force: { type: 'boolean', default: false },
  }},
  'runtime-seal': { summary: 'Classify small/large/huge from intake evidence and seal hard timings', options: {
    evidence: { type: 'string' },
  }},
  doctor: { summary: 'Check the environment can run the harness', options: {
    'base-url': { type: 'string' }, 'ddev-project': { type: 'string' },
  }},
  status: { summary: 'Print the run dashboard', options: {} },
  'graph-init': { summary: 'Seal and initialise the upgrade state graph', options: {
    definition: { type: 'string' },
  }},
  'graph-status': { summary: 'Print graph nodes, locks, and terminal state', options: {} },
  'graph-next': { summary: 'List ready nodes and safe parallel sets', options: {} },
  'graph-forecast': { summary: 'Admit measured work against size, locks, cutoff and closure reserve', options: { evidence: { type: 'string' } } },
  'graph-validate': { summary: 'Validate graph definition, state, locks, and retry bounds', options: {} },
  'node-open': { summary: 'Acquire resources and open one ready graph node', options: {
    snapshot: { type: 'string' }, 'rollback-ref': { type: 'string' }, approval: { type: 'string' },
    'applicability-only': { type: 'boolean', default: false },
  }},
  'node-close': { summary: 'Close a node with evidence and activate outcome routes', options: {
    outcome: { type: 'string' }, evidence: { type: 'string' }, 'evidence-loop': { type: 'string' },
    approval: { type: 'string' },
  }},
  'closure-start': { summary: 'Bind a new final-proof epoch to current code and live inputs', options: {} },
  'closure-check': { summary: 'Refuse incomplete or stale closure evidence', options: { evidence: { type: 'string' } } },
  'closure-verify': { summary: 'Record timely proof, keeping human acceptance pending', options: { evidence: { type: 'string' } } },
  'validate-run': { summary: 'Validate state and current closure evidence when closed', options: { evidence: { type: 'string' } } },
  'loop-start': { summary: 'Scaffold a planned loop from the protocol templates', options: {
    id: { type: 'string' }, track: { type: 'string' }, slug: { type: 'string' },
    contract: { type: 'string' }, phase: { type: 'string' },
    'baseline-ref': { type: 'string' }, 'intent-ref': { type: 'string' },
  }},
  'loop-open': { summary: 'Open a planned loop after rollback-anchor and live freeze checks', options: {
    snapshot: { type: 'string' }, 'rollback-ref': { type: 'string' },
    stateful: { type: 'boolean', default: false },
  }},
  'snapshot-create': { summary: 'Create and record the rollback snapshot for a loop', options: {
    name: { type: 'string' },
  }},
  approval: { summary: 'Record intent authorization or observed-result acceptance', options: {
    id: { type: 'string' }, stage: { type: 'string' }, scope: { type: 'string' },
    question: { type: 'string' }, answer: { type: 'string' }, evidence: { type: 'string' },
    granted: { type: 'boolean', default: false },
  }},
  'env-fingerprint': { summary: 'Record or assert the environment fingerprint', options: {
    'write-baseline': { type: 'boolean', default: false }, assert: { type: 'boolean', default: false },
    'ddev-project': { type: 'string' },
  }},
  'content-fingerprint': { summary: 'Record or assert the content fingerprint', options: {
    'write-baseline': { type: 'boolean', default: false }, 'write-target': { type: 'boolean', default: false },
    transition: { type: 'string' }, assert: { type: 'boolean', default: false },
    'ddev-project': { type: 'string' }, fileadmin: { type: 'string', default: 'fileadmin' },
    tables: { type: 'string' },
    'exclude-tables': { type: 'string' },
    'allow-missing': { type: 'boolean', default: false },
  }},
  'discover-urls': { summary: 'Guarded sitemap/database discovery into a URL manifest', options: {
    'base-url': { type: 'string' }, languages: { type: 'string' }, seed: { type: 'string' },
    'golden-file': { type: 'string' }, 'visual-budget': { type: 'string', default: '360' },
    'lighthouse-sample': { type: 'string', default: '3' },
    states: { type: 'string' }, viewports: { type: 'string' },
    'stabilization-config': { type: 'string' },
    'allow-missing-sitemap': { type: 'boolean', default: false },
    'from-pages': { type: 'boolean', default: false },
  }},
  capture: { summary: 'Capture HTTP, DOM and screenshots for the manifest set', options: {
    label: { type: 'string' }, out: { type: 'string' }, states: { type: 'string' },
    viewports: { type: 'string' }, only: { type: 'string' },
    affected: { type: 'string', multiple: true }, 'affected-file': { type: 'string' },
    resume: { type: 'boolean', default: false }, warmup: { type: 'boolean', default: true },
    stages: { type: 'string', default: 'http,dom,visual' },
    // 'intermediate' = affected/critical/seeded URL slice in default state for loop iterations;
    // 'final' = every URL at HTTP/DOM and the sealed tiered visual sample in three states max.
    scope: { type: 'string', default: 'final' },
    // Retained as a backwards-compatible no-op: final HTTP/DOM are now always exhaustive.
    'all-urls': { type: 'boolean', default: false },
    'visual-workers': { type: 'string' },
    'http-workers': { type: 'string' },
  }},
  'selftest-determinism': { summary: 'Shoot the untouched site twice; require zero differences', options: {
    repeats: { type: 'string', default: '2' }, 'fresh-browser': { type: 'boolean', default: true },
    sample: { type: 'string', default: 'all' },
    'visual-workers': { type: 'string' },
    'http-workers': { type: 'string' },
  }},
  'seal-baseline': { summary: 'Write MANIFEST.sha256 and LOCK.json; make a baseline immutable', options: {
    dir: { type: 'string' }, id: { type: 'string', default: 'A-original' },
  }},
  'verify-baseline': { summary: 'Recompute checksums and verify the lock', options: {
    id: { type: 'string', default: 'A-original' },
  }},
  'compare-http': { summary: 'Compare HTTP status and metadata for all URLs', options: {
    before: { type: 'string' }, after: { type: 'string' }, report: { type: 'string' },
  }},
  'compare-dom': { summary: 'Compare normalised DOM for all URLs', options: {
    before: { type: 'string' }, after: { type: 'string' }, report: { type: 'string' },
  }},
  'compare-visual': { summary: 'Compare screenshots with strict-zero pixel evidence', options: {
    'before-dir': { type: 'string' }, 'after-dir': { type: 'string' }, 'diff-dir': { type: 'string' },
    report: { type: 'string' }, reshoots: { type: 'string', default: '1' },
    'compare-workers': { type: 'string' },
  }},
  'compare-all': { summary: 'Compare HTTP, DOM and visuals, then gate with one live-input check', options: {
    before: { type: 'string' }, after: { type: 'string' }, 'diff-dir': { type: 'string' },
    'compare-workers': { type: 'string' }, 'idempotence-diff': { type: 'string' },
    'require-idempotence': { type: 'boolean', default: false },
  }},
  'backend-sweep': { summary: 'Open every backend module; require full coverage', options: {
    'base-url': { type: 'string' }, report: { type: 'string' },
    'expect-modules': { type: 'string' }, settle: { type: 'string', default: '1500' },
    'credentials-from': { type: 'string', default: 'env' },
  }},
  smoke: { summary: 'Deterministic read-only navigation check', options: {
    report: { type: 'string' }, 'max-steps': { type: 'string', default: '25' },
  }},
  lighthouse: { summary: 'Lighthouse on homepage plus two seeded random pages', options: {
    mode: { type: 'string', default: 'verify' },
    report: { type: 'string' }, runs: { type: 'string', default: '3' },
    sample: { type: 'string', default: '3' }, timeout: { type: 'string', default: '120' },
    'form-factor': { type: 'string', default: 'mobile' }, budget: { type: 'string' },
    label: { type: 'string', default: 'final' },
  }},
  axe: { summary: 'axe-core over representative URLs, viewports, and visible states', options: {
    mode: { type: 'string', default: 'verify' },
    report: { type: 'string' }, sample: { type: 'string', default: '12' },
    viewports: { type: 'string', default: 'desktop,tablet,mobile' },
    states: { type: 'string', default: 'default,keyboard-focus,nav-open' },
    tags: { type: 'string', default: 'wcag2a,wcag2aa,wcag21a,wcag21aa,wcag22aa' },
    'fail-impacts': { type: 'string', default: 'critical,serious' },
    label: { type: 'string', default: 'final' },
  }},
  gate: { summary: 'Aggregate a loop verdict from its stage reports', options: {
    group: { type: 'string' }, 'idempotence-diff': { type: 'string' },
    'require-idempotence': { type: 'boolean', default: false },
  }},
  report: { summary: 'Regenerate markdown from JSON reports', options: {} },
  help: { summary: 'Show help', options: {} },
};

export function parse(argv) {
  const [command, ...rest] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    return { command: 'help', values: {}, positionals: rest };
  }
  if (!COMMANDS[command]) {
    throw new HarnessError(
      `Unknown command: ${command}\nRun "t3u help" for the command list.`,
    );
  }

  const options = { ...GLOBAL_OPTIONS, ...COMMANDS[command].options };
  // parseArgs validates the spec strictly: a key present with an undefined value is an
  // error, not an omission. Build each entry with only the fields that are actually set,
  // and drop our documentation-only `help` field.
  const spec = Object.fromEntries(
    Object.entries(options).map(([k, v]) => {
      const entry = { type: v.type };
      if (v.default !== undefined) entry.default = v.default;
      if (v.short !== undefined) entry.short = v.short;
      if (v.multiple !== undefined) entry.multiple = v.multiple;
      return [k, entry];
    }),
  );

  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: spec, allowPositionals: true, strict: true });
  } catch (err) {
    throw new HarnessError(`${err.message}\nRun "t3u help ${command}" for its flags.`);
  }
  return { command, values: parsed.values, positionals: parsed.positionals };
}

export function helpText(command) {
  if (command && COMMANDS[command]) {
    const opts = { ...COMMANDS[command].options, ...GLOBAL_OPTIONS };
    const lines = Object.entries(opts).map(([k, v]) => `  --${k}${v.type === 'string' ? ' <value>' : ''}`);
    return `t3u ${command} — ${COMMANDS[command].summary}\n\n${lines.join('\n')}\n`;
  }
  const rows = Object.entries(COMMANDS)
    .filter(([k]) => k !== 'help')
    .map(([k, v]) => `  ${k.padEnd(22)} ${v.summary}`);
  return [
    't3u — TYPO3 update evidence graph and equality prover',
    '',
    'Usage: t3u <command> [options]',
    '',
    'Commands:',
    ...rows,
    '',
    'Exit codes:',
    '  0 pass · 1 findings · 2 harness error · 3 invalid · 4 precondition · 5 blocked by policy',
    '',
    'Run "t3u help <command>" for a command\'s flags.',
    '',
  ].join('\n');
}

export function intOpt(values, name, fallback) {
  const raw = values[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n)) throw new HarnessError(`--${name} must be an integer, got: ${raw}`);
  return n;
}

export function listOpt(values, name, fallback = []) {
  const raw = values[name];
  if (!raw) return fallback;
  return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
}
