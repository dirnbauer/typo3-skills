import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const github = parse(await readFile(new URL('../../../../../.github/workflows/checks.yml', import.meta.url), 'utf8'));
const gitlab = parse(await readFile(new URL('../../../../../.gitlab-ci.yml', import.meta.url), 'utf8'));

test('GitLab and GitHub install the locked harness and run the same full gate', () => {
  const steps = github.jobs.check.steps;
  const install = steps.find(step => step.run === 'npm ci');
  assert.ok(install, 'GitHub must use the lockfile, not npm install');
  const gate = steps.find(step => step.run === './scripts/check.sh');
  assert.ok(gate, 'GitHub must run the shared full gate');
  assert.deepEqual(gitlab.check.script, [
    `npm ci --prefix ${install['working-directory']} --prefer-offline`,
    gate.run,
  ]);
  assert.notEqual(gitlab.check.allow_failure, true);
  assert.notEqual(github.jobs.check['continue-on-error'], true);
  assert.notEqual(gate['continue-on-error'], true);
  assert.deepEqual(gitlab.check.cache.key.files, [`${install['working-directory']}/package-lock.json`]);
  assert.deepEqual(gitlab.check.cache.paths, ['.npm/'], 'cache downloads, never installed dependencies');
  assert.ok(gitlab.check.before_script.every(command => typeof command === 'string'),
    'shell commands must parse as YAML strings, not accidental mappings');
});

test('GitLab keeps the Python minor and Node major selected by GitHub', () => {
  const steps = github.jobs.check.steps;
  const python = steps.find(step => step.uses?.startsWith('actions/setup-python@'));
  const node = steps.find(step => step.uses?.startsWith('actions/setup-node@'));
  assert.equal(gitlab.default.image.match(/^python:(\d+\.\d+)-/)[1], python.with['python-version']);
  assert.equal(gitlab.variables.NODE_VERSION.split('.')[0], node.with['node-version']);
});

test('GitLab supplies the system dependencies used by the existing tests', () => {
  const setup = gitlab.check.before_script;
  const packages = setup.find(command => command.includes('apt-get install')).split(/\s+/);
  for (const dependency of ['git', 'jq', 'php-cli', 'imagemagick']) {
    assert.ok(packages.includes(dependency), `missing CI test dependency: ${dependency}`);
  }
  assert.ok(setup.includes('test "${CI_DISPOSABLE_ENVIRONMENT:-}" = "true"'),
    'package installation must not modify a persistent shell runner');
});
