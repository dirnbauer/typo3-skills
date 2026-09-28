import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deployCommand, stagingVerdict } from '../../deploy-staging.mjs';
import { localFileadmin, pullLiveDataset, readHosts, rsyncArgs, selectHost } from '../../pull-live-dataset.mjs';

const HOSTS = `
config:
  repository: git@gitlab.example.com:sites/demo.git
hosts:
  staging.demo.at:
    bin/php: /opt/plesk/php/8.4/bin/php
    hostname: staging.demo.at
    port: 22
    branch: develop
    remote_user: demo
    deploy_path: /var/www/vhosts/demo.at/staging.demo.at/public
    labels:
      stage: development
  www.demo.at:
    bin/php: /opt/plesk/php/8.4/bin/php
    hostname: www.demo.at
    port: 22
    branch: main
    remote_user: demo
    deploy_path: /var/www/vhosts/demo.at/httpdocs/public
    labels:
      stage: production
`;

test('Deployer hosts are parsed with stage labels, users and paths', () => {
  const hosts = readHosts(HOSTS);
  assert.deepEqual(hosts.map((h) => [h.alias, h.stage, h.branch]), [['staging.demo.at', 'development', 'develop'], ['www.demo.at', 'production', 'main']]);
  assert.equal(selectHost(hosts, 'www.demo.at').deployPath, '/var/www/vhosts/demo.at/httpdocs/public');
  assert.throws(() => selectHost(hosts, 'nope.demo.at'), /exactly one host/);
  assert.throws(() => selectHost(readHosts(HOSTS.replace('remote_user: demo\n    deploy_path: /var/www/vhosts/demo.at/httpdocs/public', 'remote_user: demo\n    deploy_path: /tmp; rm -rf /')), 'www.demo.at'), /unsafe/);
});

test('only a staging host passes the deploy guard; live hosts and lookalikes are refused', () => {
  const hosts = readHosts(HOSTS);
  assert.deepEqual(stagingVerdict(hosts[0], hosts), { allowed: true, reasons: [] });
  const live = stagingVerdict(hosts[1], hosts);
  assert.equal(live.allowed, false);
  assert.ok(live.reasons.some((r) => r.includes('not a staging label')));
  const lookalike = { ...hosts[0], alias: 'x', hostname: 'www.demo.at' };
  assert.equal(stagingVerdict(lookalike, [...hosts, lookalike]).allowed, false);
  const sharedPath = { ...hosts[0], alias: 'staging2.demo.at', hostname: 'staging.demo.at', deployPath: hosts[1].deployPath };
  assert.ok(stagingVerdict(sharedPath, [...hosts, sharedPath]).reasons.some((r) => r.includes('deploy_path')));
  assert.deepEqual(deployCommand('staging.demo.at', 'feature/typo3-14.3'), ['php', ['vendor/bin/dep', 'deploy', 'staging.demo.at', '-o', 'branch=feature/typo3-14.3']]);
  assert.throws(() => deployCommand('staging.demo.at', '--force'), /Unsafe branch/);
});

test('the local fileadmin that gets deleted is always <project>/<webroot>/fileadmin and never a link', () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'fleet-fa-'));
  try {
    assert.equal(localFileadmin(project, 'public'), path.join(project, 'public', 'fileadmin'));
    assert.throws(() => localFileadmin(project, '../..'), /Refusing to delete/);
    mkdirSync(path.join(project, 'elsewhere'), { recursive: true });
    mkdirSync(path.join(project, 'web'), { recursive: true });
    symlinkSync(path.join(project, 'elsewhere'), path.join(project, 'web', 'fileadmin'));
    assert.throws(() => localFileadmin(project, 'web'), /symlink/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a live sync deletes the local fileadmin first, mirrors the server and compares counts', async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'fleet-pull-'));
  try {
    writeFileSync(path.join(project, '.hosts.yaml'), HOSTS);
    mkdirSync(path.join(project, 'public', 'fileadmin', 'old'), { recursive: true });
    writeFileSync(path.join(project, 'public', 'fileadmin', 'old', 'stale.pdf'), 'stale');
    const calls = [];
    const run = (command, args) => {
      calls.push(command);
      if (command === 'ssh') return 'releases/23\n2\n';
      // Fake rsync: the server holds two files; stale.pdf must already be gone.
      assert.equal(existsSync(path.join(project, 'public', 'fileadmin', 'old', 'stale.pdf')), false, 'delete happens before rsync');
      const target = args[args.length - 1];
      mkdirSync(path.join(target, 'user_upload'), { recursive: true });
      writeFileSync(path.join(target, 'user_upload', 'a.jpg'), 'a');
      writeFileSync(path.join(target, 'b.pdf'), 'b');
      return '';
    };
    const out = path.join(project, 'dataset');
    const manifest = await pullLiveDataset({ project, hostName: 'www.demo.at', out, skipDb: true, run, log: () => {} });
    assert.deepEqual(calls, ['ssh', 'rsync']);
    assert.equal(manifest.files.deleted_local_first, true);
    assert.deepEqual([manifest.files.remote_count, manifest.files.local_count], [2, 2]);
    assert.equal(manifest.release, '23');
    assert.equal(JSON.parse(readFileSync(path.join(out, 'live-dataset.json'), 'utf8')).read_only_on_server, true);
    assert.ok(rsyncArgs(readHosts(HOSTS)[1], 'public', 'x').includes('_processed_/'));

    const mismatch = (command, args) => (command === 'ssh' ? 'releases/23\n5\n' : run(command, args));
    await assert.rejects(pullLiveDataset({ project, hostName: 'www.demo.at', out, skipDb: true, run: mismatch, log: () => {} }), /count mismatch/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test('a dry run lists the delete before the sync and touches nothing', async () => {
  const project = mkdtempSync(path.join(os.tmpdir(), 'fleet-dry-'));
  try {
    writeFileSync(path.join(project, '.hosts.yaml'), HOSTS);
    mkdirSync(path.join(project, 'public', 'fileadmin'), { recursive: true });
    writeFileSync(path.join(project, 'public', 'fileadmin', 'keep.txt'), 'x');
    const lines = [];
    const result = await pullLiveDataset({ project, hostName: 'www.demo.at', out: path.join(project, 'd'), dryRun: true, log: (l) => lines.push(l) });
    assert.deepEqual(result.plan, ['preflight (read-only)', 'database export (read-only, streamed)', 'delete local fileadmin first', 'rsync fileadmin from server (read-only)']);
    assert.ok(existsSync(path.join(project, 'public', 'fileadmin', 'keep.txt')));
    assert.ok(lines.some((l) => l.includes('database:export')));
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
