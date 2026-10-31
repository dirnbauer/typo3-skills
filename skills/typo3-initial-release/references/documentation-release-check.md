# Documentation release check

Load this for workflow step 7: before tagging, when README, `Documentation/`, the changelog or
screenshots must be checked against the extension source.

## Documentation rules

Apply these before release tagging:

- Do a deep documentation review, not a version-string sweep. Read README, `Documentation/`, changelog,
  examples, screenshots, configuration references, and install snippets against the actual extension source.
- Use the TYPO3 documentation way: `Documentation/` with reStructuredText, `Index.rst`, TYPO3
  roles/directives, toctrees, anchors, `confval` for configuration, `literalinclude` for source-backed
  examples, and screenshots with meaningful alt text where backend workflows are documented.
- Keep README as the public entry point. It should explain the value proposition, supported TYPO3/PHP
  versions, installation, quick start, key features, and links into detailed TYPO3 docs. It must not become a
  second full manual that drifts from `Documentation/`.
- Update documentation when behavior, configuration, CLI commands, labels, screenshots, release metadata, or supported versions change.
- Delete dead documentation. Remove stale pages, orphaned toctree entries, obsolete screenshots, outdated
  examples, old install paths, dead references, and docs for features that no longer exist.
- Verify every code/configuration example against source. Do not publish examples for APIs, TSconfig keys, CLI
  options, Fluid variables, or Composer constraints that do not exist.

## Deep documentation and public release check

Treat documentation as a release artifact. Use `typo3-docs` for detailed documentation work and follow docs.typo3.org conventions.

Documentation structure checks:

- `Documentation/Index.rst` exists and is the main entry point.
- Every subdirectory has an `Index.rst` when it contains documentation pages.
- Toctrees link only live pages; no orphaned or unreachable docs remain.
- Section anchors exist for important pages and cross-references.
- Headings use sentence case and a consistent hierarchy.
- `.editorconfig` exists for `Documentation/` when the extension maintains rendered TYPO3 docs.
- `guides.xml` or equivalent docs configuration is current when the project publishes to docs.typo3.org.

TYPO3 documentation style checks:

- Use TYPO3 RST roles and directives instead of plain prose where structure matters.
- Use `confval` for TSconfig, TypoScript, YAML, Composer, or extension configuration references.
- Use `literalinclude` for longer examples that should stay tied to source files.
- Use `code-block` with captions only for short snippets.
- Use `note`, `tip`, `important`, or `warning` for release-relevant caveats.
- Use screenshots for backend modules and editor workflows, with `:alt:` text and lightbox-style figure directives where supported.

Content accuracy checks:

- Installation works for the release channel: tagged Composer package, VCS repository, Packagist, or TER.
- Composer commands, extension key, namespaces, paths, version numbers, and package names are current.
- Feature docs describe implemented behavior, not planned behavior.
- Configuration references match real TSconfig, TypoScript, YAML, PHP attributes, services, settings, and defaults.
- CLI command examples match the actual Symfony command names, options, defaults, and descriptions.
- Fluid examples use current variable names, ViewHelpers, Partials, and XLIFF labels.
- Screenshots reflect the current backend UI and TYPO3 Styleguide styling.
- Known limitations are explicit and still true.

Dead documentation cleanup:

- Delete stale pages for removed features instead of leaving "legacy" docs in the release manual.
- Remove old screenshots that no longer match the backend UI.
- Remove dead links, obsolete install methods, old TER/Packagist commands, and outdated version badges.
- Remove duplicated README/manual sections when one source can link to the other.
- Remove generated docs artifacts from source control unless the project intentionally tracks them.

README checks:

- README states the value proposition in the first screen.
- README lists supported TYPO3 `14.3+` and tested PHP versions.
- README installation commands match the tagged package name and release channel.
- README quick start is short and links into `Documentation/` for detailed configuration.
- README feature teaser matches implemented behavior.
- README does not contain stale roadmap, TODO, unreleased feature claims, or dead examples.
- README links to docs, changelog, issues, and release notes where appropriate.

Useful checks:

```bash
find Documentation -type f | sort
find Documentation -type f \( -name '*.rst' -o -name '*.md' \) -print0 | xargs -0 rg -n 'TODO|FIXME|WIP|coming soon|planned|deprecated|ext_emconf|14\.[012]'
rg -n 'v?0\.|dev-main|master|TODO|coming soon|planned' README.md Documentation CHANGELOG.md
rg -n 'composer require|typo3/cms-core|extension-key|Package|providesPackages' README.md Documentation composer.json
```

Run the docs tooling from the `typo3-docs` skill (both scripts live in
`skills/typo3-docs/scripts/`; the installers link the whole directory):

```bash
/path/to/skills/typo3-docs/scripts/validate_docs.sh .
/path/to/skills/typo3-docs/scripts/render_docs.sh .
```

If the skill directory is not available in the client, document the fallback checks that were
actually run.
