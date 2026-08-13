# P14 — Elevation (loops 500–560)

Track `elevation`. Contract B. Entirely optional and run only after the user explicitly requests a
separate improvement programme. A normal TYPO3 upgrade ends after Contract A and its handover.

Targets in `references/quality-bars.md`; commands in `references/measurement-recipes.md`.

## Preconditions
`contract_b.unlocked == true`, and `contract_a.closed_at` earlier than this loop's `created_at`.
Each track has its own approval and its own derived baseline `B-<n>`.

| Loop | Track |
|---|---|
| 500 | performance and Core Web Vitals — `t3u lighthouse` |
| 510 | technical SEO and structured data — see `references/metadata-and-social.md` |
| 520 | accessibility beyond automated-green — `scripts/a11y-audit.mjs` |
| 530 | security posture, including CSP and other security headers |
| 540 | media and cache |
| 550 | code quality |
| 560 | information architecture and content — **recommendation-only by default** |

## Loop 500 — final reporting sample and improvement handoff

```bash
node scripts/t3u.mjs lighthouse --run-dir .typo3-update \
  --runs 3 --form-factor mobile --loop 500 --label before
node scripts/t3u.mjs lighthouse --run-dir .typo3-update \
  --runs 3 --form-factor desktop --loop 500 --label before
```

The command uses exactly three reproducible pages: the homepage and two seeded random non-home
pages. This is a concise final-report sample, not a field-performance claim. The selected URLs are
stable across reruns even if manifest ordering changes.

The generated `artifacts/report.lighthouse.before.json` is the handoff to the improvement iteration.
It carries measured opportunities, configured quality gaps and an `agentBrief`. Take the highest
measured opportunity, add or update regression tests before changing one cause, run the tests, then
rerun Lighthouse on the identical three pages with `--label after`. Both reports remain available.
Keep the change only when tests pass, the measured target improves, and Contract A remains green;
otherwise restore the loop snapshot. This happens after Contract A closes and before P15 reporting.

Two traps:

- **The site root is frequently `doktype 4`,** a shortcut. Filtering to `doktype = 1` — which you
  must, because shortcuts redirect and link pages leave the site — silently drops the one URL every
  visitor loads. Add `/` explicitly when nothing classified as home.
- **Lighthouse may be declared in `package.json` and not installed.** `npm install lighthouse
  chrome-launcher` in the harness before the first run — the command reports this clearly rather
  than failing obscurely.
- **DDEV serves HTTPS with a locally-generated certificate.** Chrome must be launched with
  `--ignore-certificate-errors` or Lighthouse does not fail, it *waits* — and the command hangs
  until something kills it. A gate that hangs is worse than one that fails, because nobody can
  tell it apart from slow progress. Every audit therefore also carries a `--timeout` deadline.

**The largest single win is almost always the image format.** Before tuning anything else, check
whether images are being re-encoded at all: a source already at the requested dimensions is passed
through untouched, so an unoptimised upload stays unoptimised however the quality is configured.
See [`references/image-formats.md`](../image-formats.md) — on a real run this took performance
89 → 100 and LCP 3.8s → 1.8s by moving two header images to AVIF, with no element moving.

`--runs` controls how many times each of the three URLs is audited; the default of 3 makes a median
meaningful. Report **medians with min–max**, never a single run, and carry the caveat next to the number:
these are loopback network, warm cache, laptop CPU. The absolute score is indicative; the
before/after delta on the same machine is the evidence. TBT is a lab **proxy** for INP.

## Loop 520 — accessibility, split by whether the fix moves pixels

```bash
node scripts/t3u.mjs axe --run-dir .typo3-update --loop 520 --label before \
  --sample 12 --viewports desktop,tablet,mobile \
  --states default,nav-open,consent-modal-open
```

The integrated command uses the sealed URL manifest, origin guard, isolated contexts, consent
adapter and deterministic settle logic. It clusters repeated failures by rule, viewport and visible
state rather than emitting one ticket per URL. Run component-specific states from
`config/interactions.yml` as focused Playwright journeys as well; axe must execute whenever a new
piece of UI becomes visible. `incomplete` results remain manual-review work.

The report separates findings into two groups, because during an invariance run that
distinction decides what may be fixed without a new baseline:

- **invariant** — `alt` text, labels, `lang`, roles, discernible link text, list markup.
  Attribute and structure changes that leave every pixel where it was.
- **visual** — `color-contrast`, `target-size`, `meta-viewport`. These recolour or move
  something and need their own approval and baseline.

**Prove the invariant ones really were invariant.** A structural fix can shift layout
through a descendant selector you did not think about — measure the affected elements
before and after rather than assuming:

```js
[...document.querySelectorAll('#sidebar a')].map(a => {
  const r = a.getBoundingClientRect();
  return { t: a.innerText.trim(), x: Math.round(r.x), y: Math.round(r.y),
           pl: getComputedStyle(a).paddingLeft };
})
```

A real example from a run: the sidebar template wrapped the menu in a second, empty
`<ul>`, so `#sidebar > ul` contained a `<ul>` instead of `<li>` elements — axe's `list`
rule, on every page. Removing the wrapper is obviously correct HTML, **and it would have
silently shifted every top-level link 8px left**, because the stylesheet carried
`#sidebar ul ul a { padding-left: 8px }` and that second `ul` was the wrapper. The
selector had to lose one level in the same commit. Measured after: 13 links, zero
position changes.

**Never report an axe-clean run as "accessible".** Automated rules cover roughly a third
to a half of WCAG. Report it as "no automated violations" and keep keyboard order, focus
visibility and whether the `alt` text is actually *meaningful* as separate, manual work.

## Loop 510 always includes the `<head>` audit
The minimum metadata set, a generated Open Graph card and the Impressum check live in
[`references/metadata-and-social.md`](../metadata-and-social.md). Run the two audit commands at the
top of that file early — they are cheap, and on a v12-era site they usually reveal that the site
ships two meta tags and that 95% of `pages.description` is empty. That measurement is what the
approval for this loop is argued from.

## Rules that still apply
- Each loop measures against **its own** `B-<n>` baseline. `A-original` is never touched, never
  overwritten, and remains the historical record.
- **A regression against A is still a regression**, even during B. Improvement work is not a licence
  to break something that was proven working.
- Only what the approval names may change. Anything else is out of scope for that loop.

## Exit per loop
The track's numeric bars met, or each miss carrying a written justification. A final comparison
against `B-<n>` showing only approved differences.

## Honesty requirement
Every bar is measured locally in DDEV. Local absolute scores are indicative; the *delta* is the
evidence. Never present a local Lighthouse number as a field result, and never write "INP passing"
from lab data — TBT is a proxy.

## Blocking
An unapproved track. A change that would regress the proven Contract A state.
