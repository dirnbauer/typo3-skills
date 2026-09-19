import { mapPool } from '../util/pool.mjs';
import { HarnessError } from '../cli/exit-codes.mjs';

/** Stable job identities/order, independent of completion order. No silent lost jobs. */
export function axeJobs(urls, viewports, states) {
  const jobs = viewports.flatMap(viewport => urls.flatMap(url => states.map(state => ({ url, viewport, state }))));
  if (!jobs.length || new Set(jobs.map(job => JSON.stringify(job))).size !== jobs.length) {
    throw new HarnessError('axe coverage must contain nonempty, unique URL/viewport/state jobs.');
  }
  return jobs;
}

export async function collectAxeJobs(jobs, workers, runJob) {
  if (!Number.isInteger(workers) || workers < 1 || workers > 12) throw new HarnessError('axe workers must be 1..12.');
  const started = Date.now();
  const outcomes = await mapPool(jobs, workers, async job => {
    const before = Date.now();
    return { result: await runJob(job), durationMs: Date.now() - before };
  });
  const observations = [], coverageFailures = [], timings = [];
  for (let i = 0; i < jobs.length; i++) {
    const outcome = outcomes[i], job = jobs[i];
    if (!outcome?.ok) {
      if (outcome?.error?.exitCode === 5) throw outcome.error;
      coverageFailures.push({ ...job, reason: String(outcome?.error?.message ?? 'Missing worker result').slice(0, 300) });
      continue;
    }
    const { result, durationMs } = outcome.value;
    timings.push({ ...job, durationMs });
    if (!result || (!result.skipped && (!Array.isArray(result.violations) || !Array.isArray(result.incomplete)))
      || (result.skipped && !result.reason)) {
      coverageFailures.push({ ...job, reason: 'Incomplete worker result' });
    } else observations.push({ ...result, ...job });
  }
  return { observations, coverageFailures,
    execution: { workers: Math.min(workers, jobs.length), expected: jobs.length,
      completed: observations.length, failed: coverageFailures.length,
      skipped: observations.filter(row => row.skipped).length, durationMs: Date.now() - started, timings } };
}
