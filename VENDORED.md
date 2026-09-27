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

The 16 selected Netresearch repositories are pinned in `vendor-lock.json`: repository commit,
source directory, licences and SHA-256 per file. The marketplace is discovery evidence, not
authorization to import every plugin. Fetch the selected repository heads into a dedicated
temporary cache, inspect them, then run `python3 scripts/sync_netresearch.py --cache PATH --write`.
Run `./install.sh --generate-only` and `./scripts/check.sh` afterwards. Ordinary installation
never refreshes upstream or runs plugin hooks. Local overlays survive. Broken upstream symlinks
are explicitly recorded in the lock; safe internal symlinks are materialized as identical content.
Each approved repository must still contain exactly its already-selected skill. A new sibling
skill or rename fails preflight; expanding the collection requires a separate explicit decision.

## Inventory

| Skill | Upstream | Source | Commit | Synced |
|---|---|---|---|---|
| `enterprise-readiness` | Netresearch | https://github.com/netresearch/enterprise-readiness-skill | `3b3086ca1e0194b9e24a0ada43badd879f98591b` | 2026-09-26 |
| `php-modernization` | Netresearch | https://github.com/netresearch/php-modernization-skill | `b7255b8e1f078c30d30ba2ed12b55e24e3bed28c` | 2026-09-26 |
| `postgres-best-practices` | Supabase | https://github.com/supabase/agent-skills | `—` | 2026-07-27 |
| `security-audit` | Netresearch | https://github.com/netresearch/security-audit-skill | `8e53e88029d6303024da0a5cb4f14bcb9965e3b4` | 2026-09-26 |
| `typo3-a11y` | Netresearch | https://github.com/netresearch/typo3-a11y-skill | `9c87aa66c88c2a80ee81d592a13c77b02c10cd70` | 2026-09-26 |
| `typo3-ckeditor5` | Netresearch | https://github.com/netresearch/typo3-ckeditor5-skill | `8a3822d99b1c632078374b27200aa1834366f502` | 2026-09-26 |
| `typo3-conformance` | Netresearch | https://github.com/netresearch/typo3-conformance-skill | `4013a3536ef522df335ea28701d2b3815346c58f` | 2026-09-26 |
| `typo3-core-contributions` | Netresearch | https://github.com/netresearch/typo3-core-contributions-skill | `b0709667e0834ba862a08d3eb985088d006f78d5` | 2026-09-26 |
| `typo3-ddev` | Netresearch | https://github.com/netresearch/typo3-ddev-skill | `286f01ec06ab609cca8f72c90b47e489d8eaf765` | 2026-09-26 |
| `typo3-docs` | Netresearch | https://github.com/netresearch/typo3-docs-skill | `0b33870f6a29ee1158b928ba11bea33e25eaddd3` | 2026-09-26 |
| `typo3-extension-upgrade` | Netresearch | https://github.com/netresearch/typo3-extension-upgrade-skill | `f6172ce4226a5f8e730fe864b5441f13f758f862` | 2026-09-26 |
| `typo3-project-upgrade` | Netresearch | https://github.com/netresearch/typo3-project-upgrade-skill | `90e66c0585fbc8061c7e9c71ef005e1e85e02ec0` | 2026-09-26 |
| `typo3-simplify` | Anthropic | (bundled with the collection) | `—` | — |
| `typo3-site-conformance` | Netresearch | https://github.com/netresearch/typo3-site-conformance-skill | `1f5a464ed2a05ac809457f6b492e1fb0a8aabedf` | 2026-09-26 |
| `typo3-testing` | Netresearch | https://github.com/netresearch/typo3-testing-skill | `dd344935feaf1261f56c6d4660b765d8adcba549` | 2026-09-26 |
| `typo3-typoscript-ref` | Netresearch | https://github.com/netresearch/typo3-typoscript-ref-skill | `9956a36ad8e1b51b29696ed57f9737e6db787a9d` | 2026-09-26 |
| `typo3-upgrade-effort-model` | Netresearch | https://github.com/netresearch/typo3-upgrade-effort-model-skill | `df64cdd53cb35949e89dbe24aa852f3ef52e61cc` | 2026-09-26 |
| `typo3-vite` | Netresearch | https://github.com/netresearch/typo3-vite-skill | `047754d9abae6b6cb69f31a36549e6b880d44208` | 2026-09-26 |
| `web-design-guidelines` | Vercel | https://github.com/vercel-labs/agent-skills | `—` | 2026-07-27 |
| `web-platform-design` | ehmo | https://github.com/ehmo/platform-design-skills | `—` | 2026-07-27 |

20 vendored skills · 41 collection-maintained skills · 61 total.

## Attribution

Special thanks to the team at **Netresearch DTT GmbH** for generously sharing the practical
TYPO3 and PHP expertise behind the 16 selected skills, and for the continuing care they put
into their documentation, examples and maintenance. Their work gives this collection a
foundation we are genuinely grateful to build on. Their original
licences and upstream text are preserved; explicit collection credits/thanks live in the overlay,
not appended to the upstream SKILL.md. `typo3-simplify` originates from Anthropic's collection. Run
`python3 scripts/check_attribution_guardrails.py` to verify no attribution block was lost.
