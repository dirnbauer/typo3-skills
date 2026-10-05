# webconsulting additions — `typo3-vite`

Upstream Netresearch files stay byte-identical. This overlay names the project's upgrade choices.

## Latest stable versions, not fixed examples

For installation/update work, follow [the shared version policy](../../typo3-upgrade-run/references/latest-version-policy.md).
Upgrade existing Vite, used plugins and frontend build dependencies to their latest stable
compatible releases. The upstream Vite 7 examples are not a version ceiling. Check official releases,
Node engines, peer dependencies and migration guides; update old constraints and compatible plugins
instead of limiting discovery to the already-installed major. Record any blocker and obtain explicit
acceptance for an older fallback. Lock the selected versions and prove the production build.

## Existing integrations and security

Keep a working supported `praetorius/vite-asset-collector` integration, or a correct project-owned
manifest loader; preserving the integration does not exempt its package from version updates.
Neither adding nor removing the bridge is mandatory for an upgrade. Prove that
manifest imports, CSS, fonts and images are present in served pages, including after cache warmup.
External bundling replaces the removed Core asset optimizers; Vite itself is not a Core requirement.

Use explicit DDEV host/origin allowlists for HMR. Do **not** copy upstream `allowedHosts: true` or
`cors: true` defaults into a customer environment: they broaden who can fetch source code.
Verify the current Vite security documentation and the exact local URL first. Never expose HMR
in the production build. Preserve CSP nonces through the actual integration.

## Bootstrap and native JavaScript gate

Every site that uses Bootstrap ends on the latest stable **5.x** (owner preference 2026-10-04).
Resolve it from the official version list at the start of the assets node, not from a dist-tag or
a dated example, update older 5.x dependencies and commit the lockfile/production assets. A
Bootstrap 3 or 4 site migrates to 5.x in this node after the invariance loop, following the
[migration procedure](../../typo3-upgrade-run/references/bootstrap-5-migration.md): old-look Sass
variables, a small compatibility layer, a before/after review of every URL and a separately
recorded owner acceptance. Do not add Bootstrap to a frontend that does not use it.

Inventory imports, globals, inline snippets and plugins before removing jQuery. Convert
project-owned selectors/events/AJAX to DOM APIs and fetch; preserve delegation, abort/error
handling, initialization after AJAX replacement, keyboard controls and focus. Replace jQuery-only
widgets only with compatible, tested native alternatives. Verify no jQuery scripts/globals load
on representative pages and run the real slider/tab/form/filter journeys. A retained plugin
needs explicit user acceptance, current vulnerability checks and a removal plan.

A supported Bootstrap release does not guarantee pixel parity. Keep an audited compatibility
stylesheet only for known rendered differences; do not leave the entire obsolete distribution
loaded alongside the new one. Freeze screenshot inputs before migration and require strict-zero
comparison or specific accepted visible changes. Broad SCSS redesign remains Contract B.

## Production-build regression checks

- Use a relative base such as `./` when assets live below content-addressed extension paths.
- On older Core rungs, inherited Bootstrap Package settings may re-enable legacy concatenation;
  preserve the source pipeline during baseline and keep those flags while 13.4 still honours them.
  Remove them from the 14.3 rung on, where they do nothing ([fix pack item 5](../../typo3-upgrade-run/references/typo3-14-fix-pack.md#5-core-compress-and-concatenate-keys)).
- Vite 5 → 8 changes the CSS bundle (Lightning CSS minifier, newer targets, modern Sass API) in ways
  screenshots miss, such as a collapsed `transition` list: keep Vite 5's output with the
  [fix pack item 10](../../typo3-upgrade-run/references/typo3-14-fix-pack.md#10-vite-5-to-8-rewrites-the-css)
  configuration and compare the bundles as CSS tuples.
- Avoid re-minifying already-minified legacy CSS during parity work; measure before switching.
- Rebuild once per source change; invalidate/warm the local TYPO3 page cache so old asset hashes
  do not survive. Verify both cold and warm requests, not only files on disk.
- Test with no HMR process, zero failed assets/console errors and pinned Lighthouse runs against
  predeclared budgets. Optimize after the appropriate approved graph decision, not in every loop.

## Web fonts: self-host, never inline

- Self-host Google Fonts instead of `@import url(https://fonts.googleapis.com/…)` in Sass: the import
  is a render-blocking request chain and sends every visitor's IP to Google. Fetch Google's CSS with
  a current Chrome user agent, keep its `@font-face` rules unchanged (all subsets with their
  `unicode-range`), store the `woff2` files under `Resources/Private/Fonts/`, and rewrite the URLs
  relative to the Sass file; Vite emits and hashes them.
- Never let Vite inline a font. Google's subset files are often under the 4 KB default
  `assetsInlineLimit`, and each `@font-face` rule that uses one gets its own base64 copy in the
  render-blocking CSS (+24 KB measured on one site). Keep other assets on the default:
  `assetsInlineLimit: (file) => (/\.(woff2?|ttf|eot|otf)$/.test(file) ? false : undefined)`.
  Check the built CSS for `url(data:font` before committing.
- More Lighthouse fixes: [typo3-seo Lighthouse pass](../../typo3-seo/references/11-lighthouse-pass.md).

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-vite-skill

Special thanks to the Netresearch team for generously sharing the practical TYPO3 and PHP
expertise behind these skills, and for the continuing care they put into their documentation,
examples and maintenance. Their work gives this collection a foundation we are genuinely
grateful to build on.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
