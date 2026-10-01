/**
 * Whether a module is the process entry point.
 *
 * Node gives the entry module its real path in import.meta.url, while process.argv[1] keeps the
 * path it was started with. Runs call scripts through the `.typo3-update/harness` symlink, so a
 * plain comparison was false, the script did nothing and still exited 0: a dataset pull or a
 * staging deploy that silently never happened. Compare real paths instead.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isMain(metaUrl, entry = process.argv[1]) {
  if (!entry) return false;
  try {
    return pathToFileURL(realpathSync(entry)).href === metaUrl;
  } catch {
    return false;
  }
}
