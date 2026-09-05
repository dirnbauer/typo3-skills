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

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-ddev-skill

Special thanks to Netresearch for publishing and maintaining these skills.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
