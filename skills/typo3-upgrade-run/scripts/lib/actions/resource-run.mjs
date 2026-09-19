/** Run the project's existing foreground command inside the same machine budget.
 * No shell, package installation, test selection or remote execution is added here.
 * The child command must itself use the declared worker count. Its exit is not closure.
 */
import { spawn } from 'node:child_process';
import { EXIT, HarnessError, PreconditionError } from '../cli/exit-codes.mjs';
import { intOpt } from '../cli/args.mjs';
import { withMachineResources } from '../util/machine-resources.mjs';

export async function resourceRun({ values, positionals, state, log }) {
  if (!positionals?.length) throw new PreconditionError('Supply the existing foreground command after --.');
  const browsers = intOpt(values, 'browsers', 0), cpu = intOpt(values, 'cpu', 0);
  const seconds = intOpt(values, 'timeout', 1800);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 172800) throw new PreconditionError('Command timeout must be 1..172800 seconds.');
  if (values['dry-run']) return { exitCode: EXIT.PASS, verdict: 'pass', executed: false,
    message: 'Dry run: would reserve machine capacity and run the supplied command; no test evidence collected.' };
  const runState = await state.read().catch(error => {
    if (error instanceof PreconditionError && error.message.startsWith('No state file at ')) return null;
    throw error;
  });
  const remainingMs = Date.parse(runState?.runtime?.deadline_at) - Date.now();
  if (Number.isFinite(remainingMs) && remainingMs <= 0) throw new PreconditionError('Sealed run deadline has passed.');
  return withMachineResources({ browsers, cpu, exclusive: values.exclusive === true,
    owner: 'project-command', log, deadlineAt: runState?.runtime?.deadline_at }, async lease => {
    const started = Date.now();
    const untilDeadline = Date.parse(runState?.runtime?.deadline_at) - started;
    if (Number.isFinite(untilDeadline) && untilDeadline <= 0) throw new PreconditionError('Sealed run deadline passed while waiting for capacity.');
    const timeoutMs = Math.min(seconds * 1000, Number.isFinite(untilDeadline) ? untilDeadline : Infinity);
    const childExitCode = await runForeground(positionals, timeoutMs, { json: values.json });
    return { exitCode: childExitCode === 0 ? EXIT.PASS : EXIT.FINDINGS,
      verdict: childExitCode === 0 ? 'pass' : 'findings', childExitCode, executed: true,
      execution: { browsers, cpu, exclusive: lease.exclusive, machineWaitMs: lease.waitMs, durationMs: Date.now() - started },
      message: `Project command exited ${childExitCode}. Merge and validate its complete test evidence separately; this is not an upgrade verdict.` };
  });
}

export function runForeground(argv, timeoutMs, { json = false } = {}) {
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== 'win32';
    const child = spawn(argv[0], argv.slice(1), { stdio: ['inherit', json ? 2 : 'inherit', 'inherit'], shell: false, detached: grouped,
      env: { ...process.env, T3U_RESOURCE_RUN_ACTIVE: '1' } });
    let stopped = null, escalation;
    const kill = signal => {
      try { if (grouped && child.pid) process.kill(-child.pid, signal); else child.kill(signal); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const stop = reason => {
      if (stopped) return;
      stopped = reason; kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), 1000);
    };
    const interrupt = () => stop('Project command interrupted.');
    process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
    const timer = setTimeout(() => stop('Project command exceeded its timeout or run deadline.'), timeoutMs);
    const clean = () => {
      clearTimeout(timer); clearTimeout(escalation);
      process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    };
    child.on('error', error => { clean(); reject(error); });
    child.on('close', (code, signal) => {
      clean();
      // This wrapper is for foreground jobs, not retained dev servers. Clean up
      // descendants before making its reserved capacity available again.
      if (grouped && child.pid) kill('SIGKILL');
      if (stopped || signal || !Number.isInteger(code)) reject(new HarnessError(stopped ?? `Project command terminated (${signal ?? 'unknown exit'}).`));
      else resolve(code);
    });
  });
}
