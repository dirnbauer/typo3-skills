# webconsulting integration: typo3-typoscript-ref

Load this skill only for its stated task; importing it does not authorize its installers, remote changes, deployments, auto-merge, or credential access.
Project/user approval and this collection's safety rules remain authoritative.

## TYPO3 14.3: Site Sets are a project choice, not a Core mandate

The upstream shorthand “Site Sets mandatory” is not a TYPO3 Core requirement.
Prefer Site Sets for new project configuration, but inventory existing `sys_template`
records before migrating. TYPO3 14.3 still evaluates TypoScript template records;
constants in those records take precedence over Site Settings. Preserve that effective
configuration until an authorized migration has proved equivalent output.
Do not delete working template records just to satisfy the upstream shorthand.

Verified against the versioned [TYPO3 14.3 Site Settings documentation](https://docs.typo3.org/m/typo3/reference-coreapi/14.3/en-us/ApiOverview/SiteHandling/SiteSettings.html).

## Docs cache: call the scripts by their resolved path

Through a symlinked install such as `~/.claude/skills`, `lookup.sh` looks for the docs cache in `~/.claude/cache` while `fetch-docs.sh` (also behind `lookup.sh --update`) writes it to `cache/` at the real collection root, git-ignored in this repository, and `lookup.sh` has no `--cache-dir`, so call both via the resolved path, for example `"$(cd -P ~/.claude/skills/typo3-typoscript-ref && pwd)/scripts/lookup.sh"`.

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-typoscript-ref-skill

Special thanks to the Netresearch team for generously sharing the practical TYPO3 and PHP
expertise behind these skills, and for the continuing care they put into their documentation,
examples and maintenance. Their work gives this collection a foundation we are genuinely
grateful to build on.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
