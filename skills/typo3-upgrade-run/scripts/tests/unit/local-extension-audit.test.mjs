import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import {
  auditLocalExtensions,
  findLegacyAddTcaColumns,
} from '../../local-extension-audit.mjs';

test('finds the removed third addTCAcolumns argument but ignores nested commas and comments', () => {
  const source = `<?php
// addTCAcolumns('comment', [], true);
ExtensionManagementUtility::addTCAcolumns('tt_content', ['x' => ['items' => ['a', 'b']]]);
ExtensionManagementUtility::addTCAcolumns('pages', $columns, true);
`;
  assert.deepEqual(findLegacyAddTcaColumns(source), [{ line: 4, argumentsFound: 3 }]);
});

test('audits every local package for Composer truth, ext_emconf and legacy TCA calls', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 't3u-local-audit-'));
  const pkg = path.join(root, 'packages', 'site_package');
  await mkdir(path.join(pkg, 'Configuration', 'TCA', 'Overrides'), { recursive: true });
  await writeFile(path.join(pkg, 'composer.json'), JSON.stringify({
    type: 'typo3-cms-extension',
    extra: { 'typo3/cms': { 'extension-key': 'site_package' } },
  }));
  await writeFile(path.join(pkg, 'ext_emconf.php'), '<?php');
  await writeFile(
    path.join(pkg, 'Configuration', 'TCA', 'Overrides', 'pages.php'),
    "<?php ExtensionManagementUtility::addTCAcolumns('pages', $columns, true);",
  );

  const result = await auditLocalExtensions({ root });
  assert.deepEqual(result.findings.map((finding) => finding.id).sort(), [
    'legacy-add-tca-columns-signature',
    'local-ext-emconf-retained',
  ]);

  const publishable = await auditLocalExtensions({ root, publishable: ['site_package'] });
  assert.deepEqual(publishable.findings.map((finding) => finding.id), ['legacy-add-tca-columns-signature']);
});
