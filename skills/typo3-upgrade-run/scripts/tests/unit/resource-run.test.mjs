import test from 'node:test';
import assert from 'node:assert/strict';
import { runForeground, resourceRun } from '../../lib/actions/resource-run.mjs';
import { parse } from '../../lib/cli/args.mjs';
import { InvalidRunError } from '../../lib/cli/exit-codes.mjs';

test('resource wrapper forwards the canonical command arguments without shell expansion', async () => {
  const parsed = parse(['resource-run', '--browsers', '4', '--', 'npm', 'run', 'test:e2e', '--', '--workers=4']);
  assert.deepEqual(parsed.positionals, ['npm', 'run', 'test:e2e', '--', '--workers=4']);
  assert.equal(await runForeground([process.execPath, '-e', 'process.exitCode = process.argv[1] === "$(false)" ? 0 : 1', '$(false)'], 1000), 0);
  assert.equal(await runForeground([process.execPath, '-e', 'process.exitCode=7'], 1000), 7);
});
test('a hung or missing child is a failure, not an empty successful test result', async () => {
  await assert.rejects(runForeground([process.execPath, '-e', 'setInterval(()=>{},1000)'], 30), /timeout|deadline/);
  await assert.rejects(runForeground(['/definitely-no-such-t3u-test-command'], 1000), /ENOENT/);
});
test('dry resource runs never execute a child or manufacture test evidence', async () => {
  const result = await resourceRun({ values: { 'dry-run': true }, positionals: ['/missing'] });
  assert.equal(result.executed, false);
  assert.equal(result.reports, undefined);
});

test('an invalid run cannot bypass the wrapper deadline by pretending to have no state', async () => {
  await assert.rejects(resourceRun({ values: {}, positionals: ['/missing'],
    state: { read: async () => { throw new InvalidRunError('invalid state fixture'); } } }), /invalid state fixture/);
});
