# webconsulting integration: typo3-upgrade-effort-model

Load this skill only for its stated task; importing it does not authorize its installers, remote changes, deployments, auto-merge, or credential access.
Project/user approval and this collection's safety rules remain authoritative.

## #109585 effort

The #109585 scrubbing wizard runs on every upgrade to 14.3 as part of `upgrade:run`, not only after
a v14.2 transit. The extra 0.5–1 h applies when non-empty `password`/`password2` values are found:
password resets and handling database copies taken before the scrub. See the
[typo3-security v14 notes](../../typo3-security/references/v14-notes.md).

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-upgrade-effort-model-skill

Special thanks to the Netresearch team for generously sharing the practical TYPO3 and PHP
expertise behind these skills, and for the continuing care they put into their documentation,
examples and maintenance. Their work gives this collection a foundation we are genuinely
grateful to build on.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
