import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { GRAPH, REFERENCE, renderGraphReference } from '../../generate-graph-reference.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILLS = path.resolve(HERE, '../../../..');

test('the generated node reference matches the shipped graph', async () => {
  const definition = parseYaml(await readFile(GRAPH, 'utf8'));
  assert.equal(await readFile(REFERENCE, 'utf8'), renderGraphReference(definition),
    'references/graph-nodes.md is stale: run node scripts/generate-graph-reference.mjs');
});

test('each upgrade leaf skill names every graph node it owns', async () => {
  const definition = parseYaml(await readFile(GRAPH, 'utf8'));
  for (const skill of ['typo3-upgrade-intake', 'typo3-upgrade-baseline', 'typo3-upgrade-migration', 'typo3-upgrade-closure']) {
    const text = await readFile(path.join(SKILLS, skill, 'SKILL.md'), 'utf8');
    const owned = Object.entries(definition.nodes).filter(([, node]) => node.skill === skill).map(([id]) => id);
    assert.ok(owned.length > 0, `${skill} owns nodes`);
    assert.deepEqual(owned.filter((id) => !text.includes(`\`${id}\``)), [], `${skill} must name each node it owns`);
  }
});
