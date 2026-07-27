# P14 — Elevation (loops 500–560)

Track `elevation`. Contract B. This is where "a top-10 TYPO3 project" is actually delivered.

Targets in `references/quality-bars.md`; commands in `references/measurement-recipes.md`.

## Preconditions
`contract_b.unlocked == true`, and `contract_a.closed_at` earlier than this loop's `created_at`.
Each track has its own approval and its own derived baseline `B-<n>`.

| Loop | Track |
|---|---|
| 500 | performance and Core Web Vitals |
| 510 | technical SEO and structured data — see `references/metadata-and-social.md` |
| 520 | accessibility beyond automated-green |
| 530 | security posture |
| 540 | media and cache |
| 550 | code quality |
| 560 | information architecture and content — **recommendation-only by default** |

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

