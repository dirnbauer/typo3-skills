# P08 — Manual v14 migration (loop 130)

Track `invariance`. Everything Rector and Fractor could not do.

Load `typo3-v14-reference` here as the **v14 API reference** — but constraints, PHP target and process stay
with this skill.

## Steps
1. Resolve v14 changelog items and extension-scanner findings for every used API surface, including
   what the tools do not cover.
2. Remove `TYPO3_version` branches, v12/v13 constraints, compatibility helpers, deprecated hooks that
   have documented event replacements, legacy backend module registration, obsolete TypoScript,
   unused XLF keys and dead imports.
3. **Keep legitimate DataHandler hooks where no real PSR-14 event exists.** Never replace a hook with
   a guessed event name — verify against the installed source.
4. Work through the v14 changes that no tool closes. These are the ones that fail at *render* or
   *runtime* rather than at boot, so an unbudgeted one surfaces during the invariance loop as a mass
   regression with no owning phase — estimate them at P05, fix them here:
   - **`$GLOBALS['TSFE']` / `TypoScriptFrontendController` is gone.** The single largest v14 break
     for sitepackages and custom extensions, not covered by Rector, and each usage needs a different
     `$request->getAttribute(...)` replacement. Look them up in `typo3-v14-reference`; do not guess.
   - **Fluid 5 is strict.** String-for-int ViewHelper arguments are rejected, `_`-prefixed variables
     are disallowed, CDATA is no longer stripped. A custom ViewHelper namespace must be declared in
     every template or partial that uses it; a caller or layout does not donate its namespaces to a
     separately parsed partial. Verify `templateRootPaths`, `partialRootPaths` and `layoutRootPaths`,
     then render every retained CType, plugin/list type and page template at least once. Cache warm-up
     alone does not compile template paths no request reaches. These failures live in `.html` files
     Fractor does not fully cover and appear only on the affected render path.
   - **`$GLOBALS['TCA']` is read-only after boot.** An extension mutating TCA from `ext_tables.php`,
     middleware or an event listener now fails — an architectural refactor, not a patch.
   - **Doctrine DBAL and Symfony majors moved.** Custom queries using removed DBAL APIs fail at
     runtime on the pages that run them; a Symfony major also breaks custom console commands and DI
     wiring. Rector covers much of this, not all.
5. **Migrate the site configuration, not just the code.** Apply the P01 site-YAML inventory: base
   variants per environment, language fallback type and order, route enhancers, per-site error
   handling, and site sets where the project uses them. A changed fallback silently changes which
   language renders; an error handler pointing at a page uid passes locally and 404s after deploy.
6. **Migrate moved Form Framework definitions as data.** When a `*.form.yaml` file moves into a new
   sitepackage, register its directory under `persistenceManager.allowedExtensionPaths` in the v14
   form configuration. Then migrate the stored `settings.persistenceIdentifier` inside
   `tt_content.pi_flexform` with a repeatable, structured-data-aware upgrade wizard — not a raw SQL or
   regex replacement. Cover translated and workspace records, prove zero live references to the old
   identifier, render and submit every migrated form, and verify its finishers and mail in Mailpit.
7. Make TCA and schema v14-compliant, preserve localisation and relations, and add upgrade wizards
   for persisted data changes. Test migrations with representative data.
8. Make record reads, writes, previews, overlays, file handling and rendering workspace-aware. Add
   tests for create, edit, preview, publish, discard, localisation and relations. Account explicitly
   for FAL's workspace limitations.
9. Preserve extension behaviour unless the user approved a breaking change. Add regression tests
   **before** risky rewrites, not after.

## Exit
0 strong extension-scanner matches; no `TYPO3_version` branch or v12/v13 constraint left in
executable code or configuration.

## Blocking
A guessed event name. A behaviour change without an approval.

## Note
Historical mentions of v12/v13 may remain in upgrade documentation and the changelog — that is
documentation, not executable code.
