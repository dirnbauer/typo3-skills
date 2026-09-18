---
name: typo3-playwright
description: >-
  Use when building or repairing Playwright browser tests for TYPO3 visitor journeys,
  AJAX widgets, CKEditor dialogs, backend previews, editor save/reopen flows, and
  consent or local form submissions. Turns a component inventory into executable
  assertions with isolated fixtures, coverage accounting and failure traces.
  Does not orchestrate a CMS upgrade, implement application fixes, choose a pixel
  tolerance, run a WCAG programme, or deploy.
metadata:
  skill_type: capability
---

# TYPO3 browser journeys

> Source: https://github.com/dirnbauer/typo3-skills

## Workflow

1. Read the project's existing Playwright configuration and canonical test command. Reuse them;
   do not install a second browser framework or download browsers on every node.
2. Map every present component, critical route/language and distinct editor role to a named test
   in the coverage registry. Record absent features with inventory evidence, not a skipped test.
3. Use locator roles/labels and web-first assertions. Wait for a visible outcome or a specific
   response, not arbitrary sleeps or permanent `networkidle` on an analytics-heavy page.
4. Isolate each test's browser context and test data. Use local disposable users and fixtures;
   authenticate on the exact approved origin. Keep storage state, traces and screenshots private.
   Never commit auth state, passwords, tokens or a trace containing customer data.
5. Test the real UI consequence. Mock third-party delivery/tracking, not the local TYPO3 handler
   whose behavior is under test. Mailpit success proves local delivery, not production SMTP.
6. Preserve the first failure and its trace. Retry only a classified infrastructure failure,
   at most twice, with identical inputs; a flaky pass is not an unconditional green result.
7. Emit command, exit code, expected/executed/failed/skipped counts, tool/browser versions,
   role/URL coverage, artifact hashes and proof epoch. Missing assertions or unexpected skips fail.

## Required journeys when the feature exists

| Surface | Assertions |
|---|---|
| Consent | Fresh visit → reject; second fresh visit → accept; reopen settings; tracker interception respects the choice |
| Slider/navigation | Next/previous, keyboard and focus restoration; resize across the real mobile breakpoint |
| AJAX search | Apply facet → replace results → operate filter again; empty/pagination/reset; multilingual query and suggest endpoint |
| Forms | Invalid input → errors; valid local submit → persisted record and Mailpit message; restore test data |
| Editor | Non-admin login → create/edit → save → reopen → frontend preview; original markup, links and media survive |
| RTE | Open real link browser, choose page/record/file link, save/reopen; toolbar, effective presets and observed stored formatting survive |
| Backend preview | Real plugin record, raw FlexForm-backed and Record API-backed previews, category selection, media/video |
| Hidden content | Authorized group exposes Admin Panel/Preview; editor chooses hidden-page/content visibility; public visitor still cannot see it |

For affected integration, cache or patch-update work, read the
[fleet regression contracts](../typo3-upgrade-run/references/fleet-regression-contracts.md):
test promised mail recipients and partial failure, DOI states and CAPTCHA protocol, tracking under
actual context/CSP, authenticated layout/image dialogs, and warm-cache edit consequences. Include
touch-capable desktop input when code branches on pointer capability. Test only present features.
Under the upgrade graph, emit [feature results](../typo3-upgrade-run/references/feature-evidence.md)
against the sealed intake assertions and current final epoch. These are representative journeys,
not more global screenshot states. Standalone browser work does not require initializing an upgrade.

For migrated rich text, use the [field round-trip contract](../typo3-content-blocks/references/rich-text-roundtrip.md).
Group fixtures by effective preset/processing/renderer. Record standalone editor, actual authenticated
backend and frontend results separately; missing login is a coverage gap, not a pass.

For save/upload/delete operations, get exact local fixture scope and a snapshot first. Teardown
through supported APIs, verify no test records/files/users remain, including after failure.
Never force-execute real imports, payments, newsletter sends or scheduler jobs to obtain coverage.

## Bounded coverage

Under `typo3-upgrade-run`, use at most three global visual states: default, keyboard focus and
navigation open. Extra widget states belong only to their representative journey, never to the
URL × viewport × every-widget Cartesian product. Intermediate checks prioritize affected pages,
critical routes and a reproducible seeded sample. Final HTTP/DOM coverage remains exhaustive.

Use `typo3-upgrade-baseline` for immutable pixel evidence and `typo3-upgrade-closure` for the
upgrade verdict. Use `typo3-testing` for PHP/test infrastructure, `typo3-ckeditor5` for RTE fixes,
and `typo3-backend-rights` for role changes. A screenshot alone is not interaction proof.

## Sources

Apply Playwright's [best practices](https://playwright.dev/docs/best-practices) and
[authentication isolation](https://playwright.dev/docs/auth). Recheck installed package APIs
before using configuration options. Fleet-derived cases are recorded in the September upgrade
retrospective in `typo3-upgrade-run`.
