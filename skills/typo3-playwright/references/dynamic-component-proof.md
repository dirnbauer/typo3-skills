# Dynamic components: stable pixels, real behavior

Use for maps, lazy images, code-split dialogs, sliders or rebuilt asset bundles. Reuse the project's
runner, caller's resource lock and retry budget. Add no global visual states.

## Separate rendering fixtures from interaction evidence

Declare any external-tile/image/clock fixture before Baseline A and seal its bytes and application
rules. Apply it identically to source and target. A fixed visual fixture is valid only for the
declared rendering comparison; it cannot prove the replaced component works.

Run a separate representative journey with the **real installed local widget**. Intercept only
external resources with the agreed fixtures, then assert the expected marker/location, loaded
tiles/canvas and the actual exposed control outcome. Inspect the renderer: a MapLibre canvas cannot
be tested with old Leaflet image selectors. A visible iframe is not a loaded map. External service
availability, if requested, needs its own permitted check and is not proved by intercepted tiles.

Never mask a new target defect, replace the implementation under test with a picture, increase
tolerance, or pick the best frame from repeated attempts to get green. Bounded settle criteria must
be fixed before comparison. An independently refreshed current-live comparison is diagnostic only;
it cannot replace the sealed pre-upgrade baseline.

## Lazy loading and first activation

- Start in a fresh context for the first-open path. Open the dialog/widget and assert its CSS and
  JS finished loading, visible styling, accessible name, focus, validation/error path and close/focus
  restoration. Reopen once to catch duplicate listeners. A warmed-only test misses broken imports.
- Exercise relevant lazy images by scrolling them into view. Wait for decoding, verify nonzero
  intrinsic dimensions and settled layout, then return to the sealed capture position. Decode
  failures remain failures; a caught promise or screenshot before scrolling is not image proof.
- Check hover and keyboard-focus styling on one representative of each affected component family.
  Keep those interaction steps inside the journey, not a new state for every sitemap page.

## Build and cache coherence before expensive capture

After the canonical production build, resolve assets from **rendered HTML** and compare them with
the current Vite manifest and files. Check dynamic imports, fonts, CSS MIME types and lazy chunks.
A green build plus cached HTML referencing a deleted hash still produces an unstyled page.

Record the code/build/manifest and dataset identity. Reconcile TYPO3's asset/page caches with the
supported project procedure, warm representative routes once, then freeze the proof inputs. Do not
build concurrently with a capture or flush caches throughout measurement. Stop on external edits
instead of explaining away their differences as a successful test of your own change.

Treat initial byte savings, a successful journey and Lighthouse/LCP results as separate evidence.
Measure performance in the quiet lane; do not infer a faster LCP from a smaller stylesheet.
Preserve the first failure, diagnose its cause and rerun only affected tests while repairing.
The caller still owns final coverage and the unchanged final proof.

Evidence: [October fleet review](../../typo3-upgrade-run/references/run-retrospective-2026-10-21.md),
including actual map-renderer mismatch, on-demand newsletter CSS and lazy-image checks.
Use [Playwright web-first assertions](https://playwright.dev/docs/test-assertions) against the
installed runner; test fixtures do not grant external API, login or deployment authority.
