#!/usr/bin/env node
/** Advisory static audit. Never rewrites skills or launders a heuristic into a model eval. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '0.1.0';
const integrity = 'sha512-80daQIGVLbKxjlGBc9ZBQXaKgz54vYayT1UsFV43j65ResKSjzLrNcY63r+1HhSBms4SeuXlDKAsSRlL8cvnRg==';
const registry = JSON.parse(execFileSync('npm', ['view', `skill-doctor@${version}`, 'dist', '--json'], { encoding: 'utf8', timeout: 30000 }));
if (registry.integrity !== integrity) throw new Error('Skill Doctor package integrity changed; review before execution.');
const raw = JSON.parse(execFileSync('npx', ['--yes', '--ignore-scripts', `--package=skill-doctor@${version}`,
  'skill-doctor', 'skills', '--format', 'json', '--fail-on', 'none'],
{ cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 }));
const vendors = new Set([...readFileSync(path.join(root, 'VENDORED.md'), 'utf8')
  .matchAll(/^\|\s*`([a-z0-9-]+)`\s*\|/gm)].map(m => m[1]));
function disposition(s, d) {
  if (vendors.has(s.skill.name)) return 'upstream-advisory';
  if (['evals.invalid-schema', 'evals.missing-expected-output'].includes(d.ruleId)) return 'native-schema-check-required';
  const ref = d.message.match(/`([^`]+)`/)?.[1];
  if (d.ruleId === 'skill.reference-outside-root' && ref) {
    const target = path.resolve(root, 'skills', s.skill.name, ref);
    if (target.startsWith(path.join(root, 'skills') + path.sep) && existsSync(target)) return 'verified-sibling-reference';
  }
  if (d.ruleId === 'skill.missing-mentioned-resource' && ref?.includes(' ')) {
    const executable = path.resolve(root, 'skills', s.skill.name, ref.split(' ')[0]);
    if (executable.startsWith(path.join(root, 'skills', s.skill.name) + path.sep) && existsSync(executable)) return 'verified-command-with-arguments';
  }
  return 'inspect-owned';
}
const diagnostics = raw.skills.flatMap(s => s.diagnostics.map(d => ({
  skill: s.skill.name, vendored: vendors.has(s.skill.name), file: d.filePath, line: d.line,
  rule: d.ruleId, severity: d.severity, message: d.message,
  disposition: disposition(s, d),
})));
const count = field => Object.fromEntries([...new Set(diagnostics.map(d => d[field]))].sort()
  .map(k => [k, diagnostics.filter(d => d[field] === k).length]));
const report = { schema: 1, tool: `skill-doctor@${version}`, integrity, checkedAt: new Date().toISOString(),
  skills: raw.skills.length, diagnostics: diagnostics.length, byRule: count('rule'), byDisposition: count('disposition'),
  caveat: 'Advisory static scan, not behavioural validation. Native string-ID trigger suites are validated by scripts/validate_evals.py; do not convert reviewed cases to satisfy a different schema. Upstream files stay immutable. Inspect resource warnings individually.',
  findings: diagnostics.filter(d => d.disposition !== 'native-schema-check-required') };
writeFileSync(path.join(root, 'catalog/skill-doctor.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, findings: report.findings.filter(d => !d.vendored) }, null, 2));
