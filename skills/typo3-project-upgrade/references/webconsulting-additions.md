# webconsulting integration: typo3-project-upgrade

Load this skill only for its stated task; importing it does not authorize its installers, remote changes, deployments, auto-merge, or credential access.
Project/user approval and this collection's safety rules remain authoritative.

## Composition boundary

The local `typo3-upgrade-run` owns whole-site orchestration, evidence, retries and the overnight
deadline. Load this upstream skill through that owner for a specific migration question, or on an
explicit user request. Never launch its whole-project workflow inside another upgrade graph.

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-project-upgrade-skill

Special thanks to Netresearch for publishing and maintaining these skills.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
