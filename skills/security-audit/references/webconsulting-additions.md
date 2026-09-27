# webconsulting integration: security-audit

Load this skill only for its stated task; importing it does not authorize its installers, remote changes, deployments, auto-merge, or credential access.
Project/user approval and this collection's safety rules remain authoritative.

## AUDIT-001 (#109585): judge by value, not key

The AUDIT-001 detection query (`uc LIKE '%password%'`) flags every user who saved User Settings on
12.4/13.4, because EXT:setup stored empty `password`/`password2` keys there. Only a non-empty value
is a credential exposure (14.2 stored the submitted plaintext). Report uid, column and
empty/non-empty only — never the value, length, hash or username — and remediate with the Core
wizard, not SQL: [typo3-security v14 notes](../../typo3-security/references/v14-notes.md).

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/security-audit-skill

Special thanks to the Netresearch team for generously sharing the practical TYPO3 and PHP
expertise behind these skills, and for the continuing care they put into their documentation,
examples and maintenance. Their work gives this collection a foundation we are genuinely
grateful to build on.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
