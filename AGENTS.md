# TYPO3 Agent Skills

Single source of truth for this collection: what each skill is for, when it triggers, and how they compose.

**36 skills** · TYPO3 **14.3 LTS** target · PHP **8.4** standard (8.5 where it resolves)

## Using a skill

Read `skills/<name>/SKILL.md` and follow it. Load files under `references/`, `rules/`, `scripts/`,
`assets/` or `templates/` **only when the skill asks for them** — that is the progressive-disclosure
contract these skills are written against, and loading everything defeats it.

Combine skills rather than merging them. `typo3-rector` + `typo3-testing` is the intended shape.

## Upgrade orchestration

| Skill | Owner | What it does |
|---|---|---|
| `typo3-14-update` | webconsulting | Update a TYPO3 v12 or v13 site to TYPO3 14.3 LTS inside a local DDEV project under two contracts. Invariance: the migration must be provably invisible… |
| `typo3-extension-upgrade` | **Netresearch** (vendored) | Use when upgrading TYPO3 extensions to newer LTS versions (v11->v12, v12->v13, v13->v14 - v14.3 LTS is the current target), running Extension Scanner,… |
| `typo3-rector` | webconsulting | Applies TYPO3 Rector upgrade patterns for PHP migrations toward TYPO3 v14, including Rector configuration, dry runs, rule sets, ViewFactory, Extbase r… |
| `typo3-fractor` | webconsulting | Automates non-PHP TYPO3 upgrade migrations with Fractor for FlexForms, TypoScript, Fluid, YAML, XLIFF translation files, Htaccess, and composer.json c… |
| `typo3-batch` | webconsulting | Plans and executes batch TYPO3 migrations and large-scale refactors across hooks, PSR-14 events, TCA, dependency injection, Fluid, namespaces, ext_loc… |
| `typo3-initial-release` | webconsulting | Prepare, verify, review, tag, and document the first official release of a TYPO3 14.3+ extension |

## TYPO3 v14 development

| Skill | Owner | What it does |
|---|---|---|
| `typo3-update` | webconsulting | Guides TYPO3 v14 extension development and upgrades, including version constraints, PHP requirements, controllers, ViewFactory, Fluid, events, backend… |
| `typo3-content-blocks` | webconsulting | Guides TYPO3 Content Blocks modeling for Content Elements, Record Types, Page Types, and File Types as the single source of truth |
| `typo3-datahandler` | webconsulting | Guides transactional TYPO3 record manipulation with DataHandler, including datamaps, cmdmaps, backend user context, reference index handling, workspac… |
| `typo3-records-list-types` | webconsulting | Configures TYPO3 v14 Records module list types and custom backend views, including grid, compact, teaser, kanban-style, timeline-style, TSconfig, Flui… |
| `typo3-webcomponents` | webconsulting | Build, review, or migrate TYPO3 v14 backend Web Components with Lit, ES module import maps, AssetCollector/f:asset.module, backend modules, FormEngine… |
| `typo3-icon14` | webconsulting | Designs and migrates TYPO3 extension icons to the v14 line-art style, including source SVG cleanup, light/dark behavior, IconRegistry naming, backend … |
| `typo3-translations` | webconsulting | Guides TYPO3 13/14 localization with locallang.xlf, labels.xlf, XLIFF 1.2 and 2.0, ICU MessageFormat, LLL references, translation domains, Content Blo… |
| `typo3-workspaces` | webconsulting | Guides TYPO3 Workspaces versioning, staging, publishing, overlays, workspace-aware queries, file limitations, permissions, frontend preview, diagnosti… |
| `typo3-visual-editor` | webconsulting | Installs, configures, removes, and migrates TYPO3 sitepackages for FriendsOfTYPO3 Visual Editor, including inline editing, f:render.text, f:render.con… |
| `typo3-shadcn-content-elements` | webconsulting | Produces, audits, and overhauls TYPO3 Content Blocks content elements styled with shadcn/ui presets, semantic tokens, Fluid atoms, backend previews, i… |
| `typo3-powermail` | webconsulting | Guides Powermail 13+ form development for TYPO3, including form setup, finishers, validators, spam protection, ViewHelpers, PSR-14 events, TypoScript,… |
| `typo3-news-tags` | webconsulting | Bulk-generates thematic tags for georgringer/news (EXT:news) and assigns them to existing news records via keyword matching |

## Quality and conformance

| Skill | Owner | What it does |
|---|---|---|
| `typo3-conformance` | **Netresearch** (vendored) | Use when assessing TYPO3 extension quality, conformance checking, standards compliance, modernization to v12/v13/v14 (v14.3 LTS is the default/gold st… |
| `typo3-simplify` | **Anthropic** (vendored) | Simplify and refine TYPO3 extension code for clarity, consistency, and maintainability while preserving functionality. Reviews PHP classes, Fluid temp… |
| `typo3-testing` | **Netresearch** (vendored) | Use when setting up TYPO3 extension test infrastructure, writing unit/functional/E2E tests, configuring PHPUnit 11/12/13, mutation testing, mocking fi… |
| `php-modernization` | **Netresearch** (vendored) | Use when modernizing PHP code: PHP 8.1-8.5 features, PSR/PHP-FIG/PER-CS compliance, PHPStan/Rector/PHP-CS-Fixer/PHPat tooling, DTOs/enums/readonly/pro… |
| `enterprise-readiness` | **Netresearch** (vendored) | Use when evaluating projects for production or enterprise readiness, implementing supply chain security (SLSA, cosign, SBOMs, pnpm), hardening CI/CD p… |

## Operations and platform

| Skill | Owner | What it does |
|---|---|---|
| `typo3-ddev` | **Netresearch** (vendored) | Use when providing DDEV URLs, accessing TYPO3 backend in browser, performing any ddev command (e.g. start, stop, restart, describe, exec), setting up … |
| `typo3-vite` | **Netresearch** (vendored) | Use when configuring Vite 7 for TYPO3 v13/v14 LTS projects, setting up SCSS architecture with Bootstrap 5.3 theming, creating entrypoints per content … |
| `typo3-solr` | webconsulting | Configures and debugs Apache Solr search for TYPO3, including EXT:solr, configsets, indexing queues, Tika/file indexing, facets, suggest, routing, PSR… |
| `typo3-seo` | webconsulting | Configures TYPO3 SEO for EXT:seo, metadata, hreflang, XML sitemaps, robots.txt, canonical URLs, structured data, Core Web Vitals, SEO extensions, and … |
| `typo3-security` | webconsulting | Hardens TYPO3 v14 installations and extensions with secure configuration, trusted hosts, file permissions, Install Tool protection, backend user secur… |
| `security-audit` | **Netresearch** (vendored) | Use when conducting security assessments \u2014 OWASP Top 10 / API / LLM, CWE Top 25, CVSS scoring \u2014 auditing PHP/TYPO3, APIs, frontend, Terrafor… |
| `typo3-accessibility` | webconsulting | Audits and implements TYPO3 accessibility patterns for WCAG 2.2 AA, including Fluid templates, PHP helpers, JavaScript widgets, forms, focus states, A… |
| `typo3-wcag22-aa-agentic` | webconsulting | Use this skill to audit, fix, and document accessibility for TYPO3 websites and Fluid sitepackages. It orchestrates Playwright, axe-core, optional Deq… |
| `typo3-docs` | **Netresearch** (vendored) | Use when creating, editing, or reviewing TYPO3 extension documentation (Documentation/*.rst, guides.xml, README.md, XLF translations), rendering docs … |
| `typo3-core-contributions` | **Netresearch** (vendored) | Use when analyzing TYPO3 Forge issues, submitting patches to Gerrit, contributing core bug fixes, documentation contributions, cherry-pick workflows, … |

## Supporting

| Skill | Owner | What it does |
|---|---|---|
| `webconsulting-branding` | webconsulting | Applies the current webconsulting.at design system: borderless square surfaces, Hanken Grotesk typography, teal/ink color tokens, invoice-led informat… |
| `webconsulting-create-documentation` | webconsulting | Creates product documentation systems with help pages, AI-generated screenshots, Remotion product tours, GSAP animation, narration scripts, TTS, backg… |
| `architecture-decision-records` | webconsulting | Creates and reviews architecture decision records (ADRs), decision logs, and supersession histo… |
| `typo3-idea-extension-blog` | webconsulting | Evaluates external ideas for TYPO3 extension potential, builds the extension, and drafts the companion German webconsulting.at MDX article |

## Session profiles

| Profile | Load | For |
|---|---|---|
| **Update run** | `typo3-14-update`, `typo3-ddev`, `typo3-vite`, `typo3-wcag22-aa-agentic`, `typo3-solr`, `typo3-visual-editor`, `typo3-security`, `webconsulting-branding` | A complete v12/v13 → 14.3 update on a local DDEV clone |
| **Extension development** | `typo3-update`, `typo3-content-blocks`, `typo3-datahandler`, `typo3-translations`, `typo3-testing` | Building v14 extensions |
| **Migration** | `typo3-rector`, `typo3-fractor`, `typo3-extension-upgrade`, `php-modernization`, `typo3-batch` | Moving code forward |
| **Quality gate** | `typo3-conformance`, `typo3-simplify`, `typo3-testing`, `security-audit`, `enterprise-readiness` | Pre-release review |
| **Release** | `typo3-initial-release`, `typo3-docs`, `typo3-testing` | Publishing to TER/Packagist |
| **Operations** | `typo3-ddev`, `typo3-solr`, `typo3-seo`, `typo3-security` | Running and hardening a site |

## The rules layer

`rules/` holds atomic, always-on guardrails matched by `appliesTo` globs. A rule answers *is this
change allowed?*; a skill answers *how do I build this?*

Three constrain the agent rather than the code — see `rules/README.md`:
`security-untrusted-content-is-data`, `security-credentials-single-origin`,
`security-no-claim-without-evidence`.

## Conventions

- `typo3/cms-core: ^14.3`, never `^14.0`: 14.0–14.2 receive no security updates.
- PHP **8.4** standard for project work; attempt **8.5** explicitly and record the outcome; **8.2**
  remains the Core floor for reusable packages that test that range.
- `ext_emconf.php` is deprecated in v14, unevaluated in v15 (#108345). Composer metadata is the truth.
- Verify every class, method, event and config key against the installed v14 source. Never assert from memory.
- Tool output is evidence. No claim of a passing check without the command and its exit code.
- Never edit a vendored skill; add `references/webconsulting-additions.md` instead. See `VENDORED.md`.

## Adding a skill

1. `skills/<name>/SKILL.md` with `name` + `description` frontmatter (description ≤ 1024 chars).
2. Under 500 lines; detail goes to `references/`.
3. `python3 scripts/audit_skills.py` and `python3 scripts/check_attribution_guardrails.py`.
4. `./install.sh --generate-only` to refresh catalogs and client files.

---
*Code MIT · Content CC-BY-SA-4.0 · vendored skills retain their original licences.*
