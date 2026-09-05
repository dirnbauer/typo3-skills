# webconsulting additions — `typo3-vite`

Upstream Netresearch files stay byte-identical. This overlay names the project's upgrade choices.

## Existing integrations and security

Keep a working supported `praetorius/vite-asset-collector` integration, or a correct project-owned
manifest loader. Neither adding nor removing the bridge is mandatory for an upgrade. Prove that
manifest imports, CSS, fonts and images are present in served pages, including after cache warmup.
External bundling replaces the removed Core asset optimizers; Vite itself is not a Core requirement.

Use explicit DDEV host/origin allowlists for HMR. Do **not** copy upstream `allowedHosts: true` or
`cors: true` defaults into a customer environment: they broaden who can fetch source code.
Verify the current Vite security documentation and the exact local URL first. Never expose HMR
in the production build. Preserve CSP nonces through the actual integration.

## Bootstrap and native JavaScript gate

When Bootstrap 5 is used, resolve the latest stable **5.x** from official releases at the start
of the assets node, update older 5.x dependencies and commit the lockfile/production assets.
Checked 2026-09-05: 5.3.8. Do not add Bootstrap to unrelated frontends or jump majors implicitly.

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
  preserve the source pipeline during baseline and disable those flags only in the assets node.
- Avoid re-minifying already-minified legacy CSS during parity work; measure before switching.
- Rebuild once per source change; invalidate/warm the local TYPO3 page cache so old asset hashes
  do not survive. Verify both cold and warm requests, not only files on disk.
- Test with no HMR process, zero failed assets/console errors and pinned Lighthouse runs against
  predeclared budgets. Optimize after the appropriate approved graph decision, not in every loop.

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-vite-skill

Special thanks to Netresearch for publishing and maintaining these skills.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
