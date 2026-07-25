# Vendored skills

These skills are **not** authored by webconsulting. They are vendored here **byte-identical** to
their upstream state so they stay re-syncable and their licences and attribution remain intact.

## The rule

**Vendored `SKILL.md` and reference files are never edited.** Every webconsulting improvement lives
in a separate overlay file inside the skill directory:

```
skills/<skill>/references/webconsulting-additions.md
```

An overlay states what it adds, why, and what it does **not** change. Nothing in an overlay
overrides upstream behaviour silently — where this collection deviates, the deviation is named.

This keeps three things true at once: CC-BY-SA share-alike is honoured, upstream can be re-synced
without a merge conflict, and a reader can always tell whose words they are reading.

## Re-syncing

Each row records the upstream commit these files were taken from. To refresh, clone the source at
its default branch and copy `SKILL.md` plus the standard subdirectories over the vendored copy —
overlay files are separate, so they survive.

## Inventory

| Skill | Upstream | Source | Commit | Synced |
|---|---|---|---|---|
| `enterprise-readiness` | Netresearch | https://github.com/netresearch/enterprise-readiness-skill.git | `c2c1a2d94631` | 2026-07-24 |
| `php-modernization` | Netresearch | https://github.com/netresearch/php-modernization-skill.git | `f8bea9e5b2e7` | 2026-07-24 |
| `security-audit` | Netresearch | https://github.com/netresearch/security-audit-skill.git | `637f9d7b90d9` | 2026-07-24 |
| `typo3-conformance` | Netresearch | https://github.com/netresearch/typo3-conformance-skill.git | `3f4e858f21af` | 2026-07-20 |
| `typo3-core-contributions` | Netresearch | https://github.com/netresearch/typo3-core-contributions-skill.git | `629ac6857144` | 2026-05-28 |
| `typo3-ddev` | Netresearch | https://github.com/netresearch/typo3-ddev-skill.git | `f129799e4615` | 2026-07-13 |
| `typo3-docs` | Netresearch | https://github.com/netresearch/typo3-docs-skill.git | `1f56be5e2ec5` | 2026-07-24 |
| `typo3-extension-upgrade` | Netresearch | https://github.com/netresearch/typo3-extension-upgrade-skill.git | `9eee3c7bdb8a` | 2026-07-13 |
| `typo3-simplify` | Anthropic | (bundled with the collection) | `—` | — |
| `typo3-testing` | Netresearch | https://github.com/netresearch/typo3-testing-skill.git | `bc2987450af5` | 2026-07-21 |
| `typo3-vite` | Netresearch | https://github.com/netresearch/typo3-vite-skill.git | `0c1da9c7433e` | 2026-07-18 |

11 vendored skills · 25 webconsulting skills · 36 total.

## Attribution

Netresearch skills are MIT / CC-BY-SA-4.0 and retain every upstream credit and thank-you line
verbatim. `typo3-simplify` originates from Anthropic's skill collection. Run
`python3 scripts/check_attribution_guardrails.py` to verify no attribution block was lost.
