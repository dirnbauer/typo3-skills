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

## Inventory

| Skill | Upstream | Source | Commit | Synced |
|---|---|---|---|---|
| `enterprise-readiness` | Netresearch | https://github.com/netresearch/enterprise-readiness-skill | `ff433c30a50653bef2c8e890069669e9819229d8` | 2026-09-05 |
| `php-modernization` | Netresearch | https://github.com/netresearch/php-modernization-skill | `beb2366ed0ea40a161074599b0b357a6c8200994` | 2026-09-05 |
| `postgres-best-practices` | Supabase | https://github.com/supabase/agent-skills | `—` | 2026-07-27 |
| `security-audit` | Netresearch | https://github.com/netresearch/security-audit-skill | `f6999ffc802b41d2d9d8e3ffb4f45faa21c27a1f` | 2026-09-05 |
| `typo3-a11y` | Netresearch | https://github.com/netresearch/typo3-a11y-skill | `fc11392320bcae97df9e38d72c1c8c5fd2e65ff9` | 2026-09-05 |
| `typo3-ckeditor5` | Netresearch | https://github.com/netresearch/typo3-ckeditor5-skill | `c1c6861dac096ed514cfa63d3be4764c728ae58a` | 2026-09-05 |
| `typo3-conformance` | Netresearch | https://github.com/netresearch/typo3-conformance-skill | `ee170961b292bfbc8f6745064d7576d360625e49` | 2026-09-05 |
| `typo3-core-contributions` | Netresearch | https://github.com/netresearch/typo3-core-contributions-skill | `f011f757e0c0a201a3904869b2752264c559e03c` | 2026-09-05 |
| `typo3-ddev` | Netresearch | https://github.com/netresearch/typo3-ddev-skill | `8664eff816eb01fc2aba65c532c0d2a7b1824347` | 2026-09-05 |
| `typo3-docs` | Netresearch | https://github.com/netresearch/typo3-docs-skill | `44ef44a0e3af3f5677443ddb297c0a21d17ee7d2` | 2026-09-05 |
| `typo3-extension-upgrade` | Netresearch | https://github.com/netresearch/typo3-extension-upgrade-skill | `58141271b9196a88d0b576f8d8ffd1c7274c748b` | 2026-09-05 |
| `typo3-project-upgrade` | Netresearch | https://github.com/netresearch/typo3-project-upgrade-skill | `4fc5a9536380efaa8215e133624200d7f0cb2d63` | 2026-09-05 |
| `typo3-simplify` | Anthropic | (bundled with the collection) | `—` | — |
| `typo3-site-conformance` | Netresearch | https://github.com/netresearch/typo3-site-conformance-skill | `2d81070eb0a99487e5bbeac47746da559e4a8fa5` | 2026-09-05 |
| `typo3-testing` | Netresearch | https://github.com/netresearch/typo3-testing-skill | `9e977b10c5e8f3166727ad342ae0687a70ef07ce` | 2026-09-05 |
| `typo3-typoscript-ref` | Netresearch | https://github.com/netresearch/typo3-typoscript-ref-skill | `669b471b872df793de6fb9d075c49460dfdeb90c` | 2026-09-05 |
| `typo3-upgrade-effort-model` | Netresearch | https://github.com/netresearch/typo3-upgrade-effort-model-skill | `9b019fff9bd7cd3395f447811bfd72dee09a97ae` | 2026-09-05 |
| `typo3-vite` | Netresearch | https://github.com/netresearch/typo3-vite-skill | `4f20d09313d27fbf773bd85112aa93f58c428805` | 2026-09-05 |
| `web-design-guidelines` | Vercel | https://github.com/vercel-labs/agent-skills | `—` | 2026-07-27 |
| `web-platform-design` | ehmo | https://github.com/ehmo/platform-design-skills | `—` | 2026-07-27 |

20 vendored skills · 40 collection-maintained skills · 60 total.

## Attribution

Thank you to **Netresearch DTT GmbH** for openly maintaining the 16 selected skills. Their original
licences and upstream text are preserved; explicit collection credits/thanks live in the overlay,
not appended to the upstream SKILL.md. `typo3-simplify` originates from Anthropic's collection. Run
`python3 scripts/check_attribution_guardrails.py` to verify no attribution block was lost.
