# Operating a sealed (read-only) settings.php

The gold standard keeps `config/system/settings.php` committed, secret-free and
**read-only** (`chmod 0444`): TYPO3 rewrites the file on boot whenever the
runtime can write it (stripping comments, normalizing `::class` to strings,
persisting extension defaults), and the absent write bit is what enforces the
managed-config contract.

Not every blocked write behaves the same: the routine **boot-time rewrite** is
caught — it fails silently and the page still renders — but the **ext-conf
synchronize** write below is an uncaught hard failure (HTTP 500). Two
operational rules follow — both verified end-to-end on `typo3-14-gold`.

## Adding an extension: pre-populate the complete ext-config key set

`ExtensionConfiguration::get($ext, $path)` with a path missing from
`settings.php` calls
`synchronizeExtConfTemplateWithLocalConfigurationOfAllExtensions(true)`, which
**writes** `settings.php`. On the sealed file that throws core exception
`#1346323822` ("settings.php is not writable") and the frontend returns
HTTP 500. A *partial* `EXTENSIONS.<ext>` block does not help: the
per-extension presence check passes, but the first missing *path* still
triggers the synchronize-write.

**Rule:** when requiring any extension that ships an `ext_conf_template.txt`,
copy **every** key into `EXTENSIONS.<ext>` in `settings.php` (grep
`^[a-zA-Z_]+ =` in the template), not just the keys you override. Example —
`praetorius/vite-asset-collector` has three keys, all required:

```php
'vite_asset_collector' => [
    'useDevServer' => '0',
    'devServerUri' => 'auto',
    'defaultManifest' => '_assets/vite/.vite/manifest.json',
],
```

`extension:setup` is no alternative: it writes `settings.php` by design.

## The seal does not survive git checkout

git stores only the executable bit, not the 0444 mode. Every fresh clone,
branch switch or `git checkout -- <file>` resets `settings.php` to a writable
mode — and the next stack boot lets TYPO3 mangle the curated file, leaving a
dirty working tree.

**Remedies (gold reference implements both):**

- the install path and the image build re-seal
  (`chmod 0444 config/system/settings.php` in the install script and
  Dockerfile; the carrier's `rsync -a` preserves the mode), and
- a `post-checkout` git hook re-seals on every checkout, e.g. captainhook
  (the path is relative to the repo root — prefix the composer-project dir in
  a wrapper layout, e.g. `app/config/system/settings.php` on `typo3-14-gold`):

```json
"post-checkout": {
    "enabled": true,
    "actions": [
        { "action": "chmod 0444 config/system/settings.php" }
    ]
}
```

To edit the file intentionally: `chmod u+w`, edit, re-run the install (which
re-seals).
