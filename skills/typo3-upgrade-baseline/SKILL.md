---
name: typo3-upgrade-baseline
description: >-
  Build and seal the deterministic pre-change Baseline A for a whole-site TYPO3 14.3
  upgrade graph. Use when preflight passed and source evidence is ready, or when repeated
  screenshots of an untouched render disagree because of nondeterministic GIF/carousel,
  lazy media, consent state, sitemap, browser session, font, image, or harness input. Owns URL manifest, fingerprints, component journey
  inventory, strict-zero self-test, HTTP/DOM/pixel capture, and the immutable seal. Never
  upgrades code, fixes site regressions, weakens thresholds, or replaces the baseline.
metadata:
  skill_type: preference
---

# TYPO3 upgrade baseline

One job: build a trustworthy source instrument before the first site change.

## Nodes you own

Start every node from `t3u node-brief --node <id>`; it carries the contract, routes and budget.

| Node | Focus |
|---|---|
| `deterministic-baseline` | Workflow steps 1–7; pass only with a green determinism loop and a sealed `A-original` |
| `determinism-recovery` | Measurement node: stabilise the observed nondeterminism shape with an ADR-backed adapter |
| `harness-recovery` | Measurement node: repair the instrument (crash, binary, browser/session setup), never the site |
| `session-recovery` | Measurement node: consent/session handling that made proof compare different states |

Measurement nodes may recalibrate `config/` and the self-test with an ADR. The change guard still
refuses any edit to baseline seals, the URL manifest or the feature plan.

## Worker protocol

Your input is the node brief. Write its evidence file, return one allowed outcome, and never run
`node-open`/`node-close` or edit run state. Details: [graph runner](../typo3-upgrade-run/references/graph-runner.md).
Keep the evidence lean: about 120 lines of proof, earlier artifacts cited by path and hash, one probe
artifact; at the brief's forecast (15 minutes or less) or twice it, stop and return what is proven
plus the open question ([lean profile](../typo3-upgrade-run/references/graph-runner.md#evidence-file)).

## Preconditions

- Intake identity and accepted dataset evidence are green.
- No site/configuration/dependency repair has happened before capture.
- The host renderer and DDEV application environment pass `t3u doctor`.
- The local site renders its production asset build, as live does: no `/@vite/client` or other
  dev-server URL in the DOM. A dev-server render seals an unstyled baseline that no later node can
  repair; intake settles it as an environment decision
  ([fix pack item 9](../typo3-upgrade-run/references/typo3-14-fix-pack.md#9-dev-server-render-before-baseline-a)).

## Workflow

1. Seal environment and source editorial/file fingerprints. Core/PHP are recorded migration
   subjects; renderer/tool/browser/fonts/GFX are comparison inputs.
2. Discover all site/language URLs. If a sitemap is missing/broken, do not repair first: record an
   ADR and use approved page-tree/crawl fallback with uncovered dynamic routes named.
3. Build a sealed manifest: all URLs for HTTP/DOM, tiered visual sample, template clusters, golden
   paths, deterministic seed, viewports, authoritative states, and coverage exclusions.
4. Inventory components and write representative journeys:
   - consent: fresh first visit, settings, reject, no tracker; second fresh context, accept;
   - slider/carousel: settled first, next, previous/return, keyboard, autoplay disabled;
   - nav/dropdown/accordion/modal: open, focus/operate, Escape, restored focus;
   - search: stable query order, empty result, pagination;
   - form: validation and local Mailpit success; external APIs intercepted;
   - login/reset/404/media/language and any project-specific high-value interaction.
   Reuse the intake feature plan. Include subsite/detail/historic routes and distinct integration
   entry points; do not replace their contracts with random homepage screenshots. Keep pointer/touch
   variants inside the affected component journey, not a fourth global visual state.
5. Stabilize clocks/randomness/animations, fonts, image decode, lazy content, scrollbar, consent,
   video, and two stable layout frames. Configuration is hashed evidence, not hidden test code.
6. Run a seeded diagnostic, then one exhaustive unchanged double-capture with fresh isolated browser
   processes. Require zero HTTP, DOM, and pixel differences. Look at two diagnostic screenshots and
   grep its DOM for a dev-server client before the double capture starts.
7. Seal the second exhaustive pass as `A-original` with manifest/checksums/lock. There is no unseal.
   Before sealing, the promoted pass's DOM must show no dev-server client; a hit leaves it unsealed
   and the node returns `harness-error`, so `harness-recovery` settles the render environment.

## Failure routing

- `invalid`: project/data/environment/manifest drift; return to the corresponding identity node.
- `harness-error`: crash, missing binary, bad artifact, wrong browser/session/worker setup; repair the
  harness, then repeat only the affected proof.
- Non-zero unchanged render: determinism recovery by failure shape, never a site fix.
- Missing component inventory or representative journey: baseline remains open.

Never raise tolerance, shrink sample, quarantine a page, reuse the operator browser, or edit the
site to make the self-test pass. A baseline captured after a repair cannot prove that repair safe.

## Output

Immutable `baseline/A-original/`, sealed manifests/fingerprints/self-test lock, interaction inventory,
coverage gaps, exact commands and exit codes, and a green bounded evidence loop for the graph node.

## Boundaries

Use `typo3-upgrade-intake` for source/project decisions and `typo3-upgrade-closure` for target
comparison. Do not modernize Vite, Bootstrap, markup, accessibility, or security here.
