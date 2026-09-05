# webconsulting integration: typo3-ckeditor5

Load this skill only for its stated task; importing it does not authorize its installers, remote changes, deployments, auto-merge, or credential access.
Project/user approval and this collection's safety rules remain authoritative.

## Upgrade regression gate

Use the installed TYPO3 source to verify plugin registration and every legacy link-handler class.
Do not rely on a quick-reference snippet across Core versions. Watchlist's September failures came
from a removed Recordlist link handler and legacy presets, despite a working backend landing page.
Exercise page/record/file link dialogs, toolbar plugins, save/reopen and frontend link rendering as
a non-admin editor with `typo3-playwright`. Also test actual plugin/FlexForm previews and media.
Admin Panel preview options belong to the authorized editor group and individual editor choices;
never force hidden-page/content visibility globally to make a preview test pass.

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/typo3-ckeditor5-skill

Special thanks to Netresearch for publishing and maintaining these skills.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
