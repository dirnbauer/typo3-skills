# webconsulting additions — `typo3-vite`

> **Overlay.** The vendored `SKILL.md` and its references are upstream Netresearch content, kept
> byte-identical. This file is webconsulting's addition and changes nothing above it.

## Deviation: plain Vite without `praetorius/vite-asset-collector`

The upstream skill documents Vite integration through `praetorius/vite-asset-collector`, and that is
a sound, well-maintained approach.

**`typo3-upgrade-run` deliberately deviates**: it requires the build to emit hashed entrypoints plus a
manifest, referenced **directly** from Fluid layouts or TypoScript, with no bridge extension.

Why the deviation exists — it is a trade, not a correction:

| | Bridge extension | Plain Vite |
|---|---|---|
| Integration effort | lower | higher, once |
| Dev-server ergonomics | better (HMR detection built in) | manual |
| Extensions to migrate at the next LTS | one more | one fewer |
| Failure surface during an upgrade | extension compatibility matters | build output only |

During a v12/v13 → 14.3 migration the last two rows dominate: every extension in the critical
rendering path is another thing that must resolve on the new core before the site boots at all.

**Use the upstream skill for the build configuration** — Vite 7 setup, SCSS architecture, selective
Bootstrap imports, PostCSS, SVGO, font loading — and skip its extension-based integration section
when working under `typo3-upgrade-run`. Outside an upgrade run, the upstream approach is fine.

## v14 context

TYPO3 v14 removed core asset concatenation and compression (#108055), so an external build tool is
mandatory and the Vite build owns bundling and minification. Both approaches satisfy that; the
choice is only about how the manifest reaches the template.

## CSP

Under `typo3-upgrade-run` the asset tags are emitted without the bridge, so the CSP nonce has to come
from TYPO3's own API at render time rather than from the extension's ViewHelper. Verify nonce
propagation explicitly — a working page with a silently violated CSP is a common outcome here.

## Upgrade-parity traps

- On the v12/v13 rungs, Bootstrap Package can re-enable all four legacy TYPO3 asset flags after an
  earlier sitepackage setting. Load the theme override after Bootstrap Package and set
  `concatenateCss`, `compressCss`, `concatenateJs` and `compressJs` explicitly to `0`. They become
  inert on v14, but they still alter the source-rung baseline the Vite migration must preserve.
- Use `base: './'` when Vite output is published under TYPO3's content-addressed extension path.
  Root-relative `/assets/...` URLs escape that path and break CSS fonts/images even when entrypoint
  CSS and JS load correctly.
- During Contract A parity, set `cssMinify: false` for an already-minified legacy CSS input. A second
  minification can change text rasterisation across hundreds of screenshots without changing layout
  or content. Re-enable or change minification only in a measured Contract B performance loop.
