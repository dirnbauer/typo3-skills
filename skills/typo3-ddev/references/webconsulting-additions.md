# webconsulting additions — `typo3-ddev`

> **Overlay.** The vendored DDEV skill remains upstream-owned. This preflight comes from full-site
> TYPO3 v14 upgrade runs.

## Site, set and locale preflight

For live-to-local helper preparation or DDEV throughput, read
[`webconsulting-live-sync.md`](webconsulting-live-sync.md). Execution against live needs a separate
explicit request. The upstream multiversion/demo URL and credentials are not defaults for customer
projects: use `ddev describe -j` and authorized local credentials. Keep PHP 8.4 for site work,
try 8.5 explicitly; never apply destructive demo cleanup to an existing site.

Before sealing a baseline and again on every target rung that exposes the commands, inspect TYPO3's
runtime view of each site rather than only reading YAML:

```bash
ddev typo3 site:list
ddev typo3 site:show <site-identifier>
ddev typo3 site:sets:list
ddev exec locale -a
```

Treat the configured OS locale and the site's BCP 47/hreflang value as separate contracts:
`de_DE`/`de_AT` availability in the container does not prove that `de-DE`/`de-AT` is the correct
public language tag, and changing hreflang cannot install a missing runtime locale. Record the match
for every site language.

Inventory selected site sets and their dependency graph. A missing container locale invalidates the
local rendering baseline; an unavailable set or unresolved set dependency blocks the target rung.
Do these checks before frontend debugging so a configuration precondition does not masquerade as a
template or routing fault.

## Image processing like production

A clone regenerates every processed image (`_processed_/` is never copied from live) with its own
`GFX` configuration. Give DDEV the processor live uses, with a colourspace that processor reads as
production does: GraphicsMagick with `RGB`, or ImageMagick with `sRGB`. ImageMagick 6.7.7+ reads
`RGB` as linear RGB and renders every derivative darker. TYPO3 12.4 defaults `processor_colorspace`
to `RGB` for both processors; 13.4 and 14.3 resolve an empty value to `sRGB` for ImageMagick and
`RGB` for GraphicsMagick, and an explicit value wins in every version. A DDEV override that only
switches `processor` to ImageMagick therefore darkens a 12.4 site. The DDEV v1.25 web image ships
both `gm` and ImageMagick 7; add `graphicsmagick` to `webimage_extra_packages` on an older image.

```bash
ddev exec gm version                                   # GraphicsMagick present?
ddev typo3 configuration:show GFX --type=active        # 14.x; on 12.4/13.4 read settings.php + additional.php
ddev typo3 cleanup:localprocessedfiles --all --force   # 13.4+; on 12.4: Maintenance > Remove Temporary Assets
ddev typo3 cache:flush
node skills/typo3-upgrade-run/scripts/gfx-colour-parity.mjs \
  --live https://www.example.org/<page>/ --local https://<project>.ddev.site/<page>/
```

Both `typo3` commands come with EXT:lowlevel. The check fetches one page from both sides (read-only
GETs) and compares the processed images as a browser shows them; exit 0 means the local derivatives
match live. Regenerate after every `GFX` change: a processed file's name hashes the file and the
processing instruction, not the processor, so stale derivatives survive until the cleanup. In an
upgrade run, settle this before Baseline A
([intake checklist item 12](../../typo3-upgrade-intake/SKILL.md#evidence-checklist)).

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-ddev-skill

Special thanks to the Netresearch team for generously sharing the practical TYPO3 and PHP
expertise behind these skills, and for the continuing care they put into their documentation,
examples and maintenance. Their work gives this collection a foundation we are genuinely
grateful to build on.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
