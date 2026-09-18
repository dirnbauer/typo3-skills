import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPushTarget, parsePushDestination } from '../../check-push-target.mjs';

const script = fileURLToPath(new URL('../../check-push-target.mjs', import.meta.url));
const allowed = 'https://github.com/dirnbauer/typo3-skills.git';
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0' };
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CONFIG_PARAMETERS']) delete env[key];

function fixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 't3u-push-policy-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('remote', 'add', 'origin', allowed);
  return { repo, git, check: () => checkPushTarget({ repo, remote: 'origin', env }) };
}

describe('explicit push destination policy', () => {
  test('accepts only the approved GitHub owner and exact webconsulting GitLab host', () => {
    for (const url of [allowed, 'https://github.com:443/dirnbauer/repo',
      'git@github.com:dirnbauer/repo.git', 'ssh://git@github.com:22/dirnbauer/repo.git',
      'git@gitlab.webconsulting.at:sites/project.git',
      'https://gitlab.webconsulting.at/webcon/subgroup/project.git']) {
      assert.ok(parsePushDestination(url).target, url);
    }
  });

  test('rejects other owners, lookalike hosts and GitHub subgroup paths', () => {
    for (const url of ['https://github.com/netresearch/typo3-skills.git',
      'https://github.com/dirnbauer-other/repo', 'https://github.com/dirnbauer/repo/extra',
      'https://github.com.attacker.example/dirnbauer/repo',
      'https://gitlab.com/webconsulting/repo', 'git@gitlab.webconsulting.at.attacker.example:sites/repo']) {
      assert.ok(parsePushDestination(url).issue, url);
    }
  });

  test('rejects credentials, encoded paths, dot segments, helpers and ambiguous transports', () => {
    for (const url of ['https://token@github.com/dirnbauer/repo',
      'https://github.com/dirnbauer/%2e%2e/netresearch/repo',
      'https://github.com/dirnbauer/../repo', 'https://github.com/dirnbauer/repo?token=secret',
      'https://github.com/dirnbauer/repo#fragment', 'https://github.com:8443/dirnbauer/repo',
      'http://github.com/dirnbauer/repo', 'git://github.com/dirnbauer/repo',
      'ext::sh -c command', '/local/repo', 'git@personal-alias:dirnbauer/repo',
      'ssh://other@github.com/dirnbauer/repo', 'https://github.com/dirnbauer/repo\n',
      'https://github.com/dirnbauer/repo\\path', '', null]) {
      assert.ok(parsePushDestination(url).issue, String(url));
    }
  });

  test('checks pushurl instead of assuming a safe fetch URL is sufficient', (t) => {
    const f = fixture(t);
    f.git('config', 'remote.origin.pushurl', 'https://github.com/netresearch/upstream.git');
    assert.equal(f.check().status, 'refused');
  });

  test('refuses the whole remote when any one of multiple push targets is forbidden', (t) => {
    const f = fixture(t);
    f.git('config', '--add', 'remote.origin.pushurl', allowed);
    f.git('config', '--add', 'remote.origin.pushurl', 'https://other.example/private/repo');
    assert.equal(f.check().status, 'refused');
    assert.equal(f.check().issues.length, 1);
  });

  test('reports every allowed destination without granting push authority', (t) => {
    const f = fixture(t);
    f.git('config', '--add', 'remote.origin.pushurl', allowed);
    f.git('config', '--add', 'remote.origin.pushurl', 'git@gitlab.webconsulting.at:dirnbauer/typo3-skills.git');
    const result = f.check();
    assert.equal(result.status, 'pass');
    assert.equal(result.targets.length, 2);
    assert.equal(result.authorizesPush, false);
    assert.equal(result.transportVerified, false);
  });

  test('resolves insteadOf before applying the policy', (t) => {
    const f = fixture(t);
    f.git('config', 'url.https://other.example/.insteadOf', 'https://github.com/');
    assert.equal(f.check().status, 'refused');
  });

  test('resolves pushInsteadOf before applying the policy', (t) => {
    const f = fixture(t);
    f.git('config', 'url.https://other.example/.pushInsteadOf', 'https://github.com/');
    assert.equal(f.check().status, 'refused');
  });

  test('fails closed for an unknown remote, invalid name or non-repository', (t) => {
    const f = fixture(t);
    for (const remote of ['missing', '--all', '', 'origin\n']) {
      assert.equal(checkPushTarget({ repo: f.repo, remote, env }).status, 'refused');
    }
    assert.equal(checkPushTarget({ repo: join(f.repo, 'missing'), remote: 'origin', env }).status, 'refused');
  });

  test('is read-only and requires no network or upgrade run directory', (t) => {
    const f = fixture(t);
    const config = readFileSync(join(f.repo, '.git/config'));
    assert.equal(f.check().status, 'pass');
    assert.deepEqual(readFileSync(join(f.repo, '.git/config')), config);
    assert.equal(f.git('status', '--porcelain'), '');
  });

  test('CLI returns 0 or policy refusal 5 and never prints credential URLs', (t) => {
    const f = fixture(t);
    const run = () => spawnSync(process.execPath, [script, '--repo', f.repo, '--remote', 'origin'], { env, encoding: 'utf8' });
    assert.equal(run().status, 0);
    f.git('config', 'remote.origin.pushurl', 'https://sensitive-token@github.com/dirnbauer/repo');
    const refused = run();
    assert.equal(refused.status, 5);
    assert.doesNotMatch(refused.stdout + refused.stderr, /sensitive-token/);
    assert.equal(JSON.parse(refused.stdout).status, 'refused');
  });

  test('CLI refuses omitted arguments and unsupported options', () => {
    for (const args of [[], ['--all'], ['--repo', '/tmp'], ['--help']]) {
      assert.equal(spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' }).status, 4);
    }
  });
});
