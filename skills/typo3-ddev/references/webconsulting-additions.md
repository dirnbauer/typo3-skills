# webconsulting additions — `typo3-ddev`

> **Overlay.** The vendored DDEV skill remains upstream-owned. This preflight comes from full-site
> TYPO3 v14 upgrade runs.

## Site, set and locale preflight

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
