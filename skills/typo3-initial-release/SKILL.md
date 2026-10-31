---
name: "typo3-initial-release"
description: "Prepares the first public 1.0.0 release of a TYPO3 14.3+ extension. Use for initial TER upload or Packagist publication readiness, composer.json release metadata, PHP/TYPO3 CI matrix verification, changelog, release notes and tagging an unreleased package. Coordinates the final release review and publication checklist; an ordinary conformance audit or whole-site migration is outside this workflow. Publishing requires explicit authorization."
metadata:
  skill_type: preference
  version: "1.1.0"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---

# TYPO3 Initial Extension Release

> Source: https://github.com/dirnbauer/webconsulting-skills

Prepares a TYPO3 14.3+ extension for its first official release, usually `1.0.0`. The release is
ready only when code, Composer metadata, documentation, labels, CI, security posture and the final
review agree with the public promise; updating version strings is the smallest part.

## Rules

- **Publish only on an explicit, current request.** Pushing a tag, creating a GitHub release,
  uploading to TER or submitting to Packagist each needs the user's go-ahead in this session; a
  ready checklist is not authorization. Without it, stop after the local tag and report the manual
  release steps.
- **Tag only after every check passed and the review has no open Critical or Important finding.** A
  tag created too early is a release incident: stop, explain the state and ask before deleting or
  moving it.
- **TYPO3 `^14.3` only.** Never `^14.0`, `^14.1` or `^14.2`: those lines receive no security
  updates. Dual-version (v12/v13/v14) releases and upgrade work belong to `typo3-extension-upgrade`,
  `typo3-rector` or `typo3-conformance`.
- **No `ext_emconf.php`.** Since 14.2 (#108345) `composer.json` carries the release metadata and
  classic mode works without the file; v15 ignores it. Migrate what an existing file holds, then
  remove it unless the project names a tool that still needs it.
- **`require.php` states tested support.** A reusable extension may declare `^8.2`, the v14 Core floor,
  when CI proves it. Project work targets PHP 8.4 instead (`typo3-upgrade-run` owns that); do not copy
  either floor into the other context.
- **No claim without evidence.** "Verified" needs the command and its result, or a statement that
  it could not be run.
- **Keep changes surgical.** Touch only what the release requires, extend existing structures
  before adding parallel ones, and mention unrelated cleanup instead of doing it. Ask before tagging
  when a requirement is ambiguous; for other edits make the smallest defensible assumption and
  state it.
- **Run project commands in DDEV** when it exists, and fix environment drift (certificates, database
  state, PHP version) before debugging application code.

## Done condition

1. Release metadata is consistent: file checks plus `composer validate --strict`.
2. CI and local suites cover the claimed PHP and TYPO3 support.
3. Docs, README, changelog, examples and screenshots match implemented behavior.
4. Labels are release-ready: XLIFF 2.0, ICU where variables or plurals need it, English and German
   coverage, no hardcoded user-facing text.
5. The final review against `origin/main` finds no Critical or Important blockers.
6. The tag exists only after 1–5 hold: `git tag -n` and `git status` prove it.

## Workflow

1. **Triage.** Read `composer.json`, `README.md`, `CHANGELOG.md`, `Documentation/`,
   `.github/workflows/`, `Build/Scripts/runTests.sh`, `phpstan.neon*`, `.php-cs-fixer*.php`,
   `phpunit*.xml*`, `Tests/`, `Configuration/` and `Resources/` where they exist. Summarize branch and
   `origin/main` status, uncommitted changes, current version metadata everywhere it appears,
   TYPO3/PHP constraints, docs structure and stale docs, XLIFF/ICU state and hardcoded strings, test
   suites and CI lanes, and known blockers or assumptions. State the target version, package name,
   extension key and release channel (GitHub only, Packagist, TER or all three) before changing files.
2. **Metadata.** Align `composer.json` (below), docs metadata, install snippets and badges,
   `CHANGELOG.md` (date, version, summary, breaking changes, upgrade and security notes), README and
   the repository About text. Keep one source of truth for the version.
3. **Tooling and CI.** Run the project's gates, adapted to its commands:

   ```bash
   ddev composer validate --strict
   ddev composer normalize --dry-run
   ddev Build/Scripts/runTests.sh -s unit
   ddev Build/Scripts/runTests.sh -s functional
   ddev Build/Scripts/runTests.sh -s phpstan
   ddev Build/Scripts/runTests.sh -s cgl
   ```

   The CI matrix and local runner cover every PHP version `composer.json` promises. For a PHP 8.5
   claim, PHPUnit, PHPStan, PHP-CS-Fixer, the testing framework and Composer constraints must resolve
   on 8.5, not just appear in the matrix. Make the coverage-driver guard explicit when coverage is
   required, so CI fails with a clear message when Xdebug or PCOV is missing.
4. **Behavior.** Match tests to risk: unit tests for pure logic, validators, value objects and DTOs;
   functional tests for repositories, TCA, persistence, DataHandler, workspaces and languages;
   architecture tests for layer boundaries; Playwright or backend smoke tests for modules and editor
   journeys.
5. **Localization.** Load [localization checks](references/localization-checks.md).
6. **Security and conformance pass** over the changed scope: no secrets, tokens or local paths; no
   unsafe shell, unserialize, path traversal, XXE, SQL injection or XSS; FormProtection and route
   access checks on write actions; no unjustified `f:format.raw`; CSP-safe ES module assets; no
   deprecated or removed APIs for the supported Core versions; no constraint that promises an
   untested PHP/TYPO3 combination.
7. **Documentation.** Load [documentation release check](references/documentation-release-check.md);
   `typo3-docs` owns rendering and RST detail.
8. **Final review.** Load [final review brief](references/final-review-brief.md) and run it against
   `origin/main`. Fix Critical findings immediately and Important ones before tagging unless the
   user explicitly accepts the risk; defer Minor ones only with a note.
9. **Tag** with the project convention, then stop unless publication was requested:

   ```bash
   git fetch origin
   git diff --stat origin/main...HEAD
   git status --short
   git tag -a v1.0.0 -m "Release v1.0.0"
   git tag -n v1.0.0
   ```

When the diff touches backend or frontend output, Fluid, styles, JavaScript, Content Blocks
relations or repository queries, also load [UI and architecture checks](references/ui-and-architecture-checks.md).
Use `typo3-testing` for test infrastructure, `typo3-security` for hardening and
`typo3-records-list-types` when the extension is that one.

## composer.json for the release

Without `ext_emconf.php`, `composer.json` carries the extension metadata (TYPO3 14.2 Feature and
Deprecation #108345, checked against the 14.3.9 changelog):

```json
{
  "name": "vendor/my-extension",
  "type": "typo3-cms-extension",
  "description": "My Extension - Short public description",
  "license": "GPL-2.0-or-later",
  "require": {
    "php": "^8.2",
    "typo3/cms-core": "^14.3"
  },
  "autoload": {
    "psr-4": {
      "Vendor\\MyExtension\\": "Classes/"
    }
  },
  "extra": {
    "typo3/cms": {
      "extension-key": "my_extension",
      "version": "1.0.0",
      "Package": {
        "providesPackages": {}
      }
    }
  }
}
```

- `name` is the Composer package name, normally `<vendor>/<dashed-extension-key>`; `type` is
  `typo3-cms-extension`.
- `description` supplies title and description: the text before the first ` - ` becomes the
  extension title (#108304).
- `license` is a GPL expression compatible with TYPO3 for public extensions.
- `require` lists every TYPO3 system extension the code uses directly, for example
  `typo3/cms-backend`, `typo3/cms-extbase` or `typo3/cms-fluid`.
- `extra.typo3/cms.extension-key` matches the extension key.
- `extra.typo3/cms.version` (or the top-level `version`) matches the release tag, for example `1.0.0`
  for tag `v1.0.0`; classic mode reads it.
- `extra.typo3/cms.Package.providesPackages` exists, as an empty object when the extension bundles no
  Composer packages.

## Required output

For release execution, end with:

- Version prepared.
- Files changed.
- Verification commands run and their result.
- Review outcome by severity.
- Tag status, and whether anything was pushed or published (with the request that authorized it).
- Remaining risks or manual release steps.

For review-only requests, return findings first, ordered by severity, with exact `file:line`
references. If no issues are found in a severity, say `None found`.

## References

- [Localization checks](references/localization-checks.md): workflow step 5.
- [Documentation release check](references/documentation-release-check.md): workflow step 7.
- [Final review brief](references/final-review-brief.md): workflow step 8, before any tag.
- [UI and architecture checks](references/ui-and-architecture-checks.md): when output, styles,
  JavaScript, Content Blocks relations or queries changed.
- [Credits and attribution](references/credits-and-attribution.md): when citing where these release
  patterns come from.
