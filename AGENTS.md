# TYPO3 Agent Skills

Single source of truth for this collection: what each skill is for, when it triggers, and how they compose.

**60 skills** · TYPO3 **14.3 LTS** target · PHP **8.4** standard (8.5 where it resolves)

## Using a skill

Read `skills/<name>/SKILL.md` and follow it. Load files under `references/`, `rules/`, `scripts/`,
`assets/` or `templates/` **only when the skill asks for them** — that is the progressive-disclosure
contract these skills are written against, and loading everything defeats it.

**One exception, and it is not optional:** if `skills/<name>/references/webconsulting-additions.md`
exists, read it together with `SKILL.md`. Vendored skills keep their upstream `SKILL.md`
byte-identical, so it cannot link forward to the overlay — which means the overlay is the one file
this collection adds that the skill itself can never point you at. It carries the boundaries against
sibling skills and the TYPO3-specific caveats upstream does not know. Skipping it is how a general
Postgres or PHP skill ends up answering a question that belongs to `typo3-datahandler`.

Combine skills rather than merging them. `typo3-rector` + `typo3-testing` is the intended shape.

## Upgrade orchestration

| Skill | Owner | What it does |
|---|---|---|
| `typo3-upgrade-run` | webconsulting | Orchestrates a whole-project 12/13 → 14.3 run as a sealed evidence graph with contracts, outcome routes, locks and bounded retries |
| `typo3-upgrade-intake` | webconsulting | Read-only project/data/site/extension/security preflight and graph tailoring before mutation |
| `typo3-upgrade-baseline` | webconsulting | Deterministic pre-change URL, HTTP, DOM, pixel and component-journey evidence; seals immutable Baseline A |
| `typo3-upgrade-migration` | webconsulting | Executes one authorized dependency/code/schema/data migration node with rollback and fixed-point proof |
| `typo3-upgrade-closure` | webconsulting | Proves final parity, interactions, backend/rights/runtime/quality gates and emits the local closure certificate |
| `typo3-upgrade-retrospective` | webconsulting | Audits past repositories, run artifacts and tasks into problem/cause/fix/control improvements |
| `typo3-extension-upgrade` | **Netresearch** (vendored) | Use when an extension has to work with a newer or the current TYPO3 LTS, when a version bump breaks compatibility or leaves deprecated APIs behin… |
| `typo3-rector` | webconsulting | Applies TYPO3 Rector upgrade patterns for PHP migrations toward TYPO3 v14, including Rector configuration, dry runs, rule sets, ViewFactory, Extbase r… |
| `typo3-fractor` | webconsulting | Automates non-PHP TYPO3 upgrade migrations with Fractor for FlexForms, TypoScript, Fluid, YAML, XLIFF translation files, Htaccess, and composer.json c… |
| `typo3-batch` | webconsulting | Plans and executes batch TYPO3 migrations and large-scale refactors across hooks, PSR-14 events, TCA, dependency injection, Fluid, namespaces, ext_loc… |
| `typo3-initial-release` | webconsulting | Prepare, verify, review, tag, and document the first official release of a TYPO3 14.3+ extension |

## TYPO3 v14 development

| Skill | Owner | What it does |
|---|---|---|
| `typo3-v14-reference` | webconsulting | Guides TYPO3 v14 extension development and upgrades, including version constraints, PHP requirements, controllers, ViewFactory, Fluid, events, backend… |
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
| `typo3-conformance` | **Netresearch** (vendored) | Use when checking which TYPO3 versions an extension says it supports, when composer.json and ext_emconf.php disagree, when a version bump must re… |
| `typo3-simplify` | **Anthropic** (vendored) | Simplify and refine TYPO3 extension code for clarity, consistency, and maintainability while preserving functionality. Reviews PHP classes, Fluid temp… |
| `typo3-testing` | **Netresearch** (vendored) | Use when setting up TYPO3 extension test infrastructure, writing unit/functional/E2E tests, configuring PHPUnit 11/12/13, mutation testing, mocki… |
| `php-modernization` | **Netresearch** (vendored) | Use when modernizing PHP code: PHP 8.1-8.5 features, PSR/PHP-FIG/PER-CS compliance, PHPStan/Rector/PHP-CS-Fixer/PHPat tooling, DTOs/enums/readonl… |
| `enterprise-readiness` | **Netresearch** (vendored) | Use when evaluating projects for production or enterprise readiness, implementing supply chain security (SLSA, cosign, SBOMs, pnpm), hardening CI… |

## Operations and platform

| Skill | Owner | What it does |
|---|---|---|
| `typo3-ddev` | **Netresearch** (vendored) | Use whenever a running TYPO3 instance is wanted, started or reached: ddev commands, backend URLs, DDEV setup, multi-version testing — and when DD… |
| `typo3-vite` | **Netresearch** (vendored) | Use when configuring Vite 7 for TYPO3 v13/v14 LTS projects, setting up SCSS architecture with Bootstrap 5.3 theming, creating entrypoints per con… |
| `typo3-scheduler-jobs` | webconsulting | Audits, plans, configures, groups, and verifies TYPO3 14.3 Scheduler tasks for a specific installation, including safe Core, extension, and Solr jobs… |
| `typo3-solr` | webconsulting | Configures and debugs Apache Solr search for TYPO3, including EXT:solr, configsets, indexing queues, Tika/file indexing, facets, suggest, routing, PSR… |
| `typo3-seo` | webconsulting | Makes TYPO3 pages discoverable through sitemaps, canonical URLs, hreflang, metadata, social previews and robots rules; routes page-type JSON-LD elsewhere |
| `typo3-structured-data` | webconsulting | Audits, preserves, implements and verifies schema.org/JSON-LD mappings from visible TYPO3 records, including FAQ, news, organizations, products and events |
| `typo3-webmcp` | webconsulting | Exposes secure, task-specific TYPO3 frontend journeys through Chrome's native WebMCP API in project-owned sitepackage/Vite code |
| `typo3-security` | webconsulting | Hardens TYPO3 v14 installations and extensions with secure configuration, trusted hosts, file permissions, Install Tool protection, backend user secur… |
| `security-audit` | **Netresearch** (vendored) | Use when conducting security assessments — OWASP Top 10 / API / LLM, CWE Top 25, CVSS scoring — auditing PHP/TYPO3, APIs, frontend, Terraform/K8s… |
| `typo3-accessibility` | webconsulting | Audits and implements TYPO3 accessibility patterns for WCAG 2.2 AA, including Fluid templates, PHP helpers, JavaScript widgets, forms, focus states, A… |
| `typo3-wcag22-aa-agentic` | webconsulting | Use this skill to audit, fix, and document accessibility for TYPO3 websites and Fluid sitepackages. It orchestrates Playwright, axe-core, optional Deq… |
| `typo3-docs` | **Netresearch** (vendored) | Use when creating, editing, or reviewing TYPO3 extension documentation (Documentation/*.rst, guides.xml, README.md, XLF translations), rendering … |
| `typo3-core-contributions` | **Netresearch** (vendored) | Use when contributing to TYPO3 Core — Forge issues, Gerrit patches, cherry-picks, CI debugging — or when working on **git.typo3.org**, the t3o si… |

## Supporting

| Skill | Owner | What it does |
|---|---|---|
| `webconsulting-branding` | webconsulting | Applies the current webconsulting.at design system: borderless square surfaces, Hanken Grotesk typography, teal/ink color tokens, invoice-led informat… |
| `webconsulting-create-documentation` | webconsulting | Creates product documentation systems with help pages, AI-generated screenshots, Remotion product tours, GSAP animation, narration scripts, TTS, backg… |
| `architecture-decision-records` | webconsulting | Creates and reviews architecture decision records (ADRs), decision logs, and supersession histo… |
| `typo3-idea-extension-blog` | webconsulting | Evaluates external ideas for TYPO3 extension potential, builds the extension, and drafts the companion German webconsulting.at MDX article |

## Imported Netresearch catalog

Imported on demand, not sequential upgrade phases. The local `typo3-upgrade-run` owns the
site graph; upstream project-upgrade and effort skills supply bounded advice only.
Only the 16 explicitly approved Netresearch repositories are synchronized.
Unrelated marketplace skills are outside this collection.
TYPO3 skills do not handle explicitly unrelated React/Vue/Svelte/WordPress/etc. tasks.
`catalog/routing-policy.json` names on-demand companions: the local upgrade and
accessibility owners load those references only for a bounded need, or the user
can request them by name. Both eval graders use these same boundaries.

| Skill | Owner | What it does |
|---|---|---|
| `typo3-a11y` | **Netresearch** (vendored) | Use when building accessible navigation, forms, filters, tables, skip links, disclosure widgets, or reviewing frontend code for ac… |
| `typo3-ckeditor5` | **Netresearch** (vendored) | Use when developing CKEditor 5 custom plugins for TYPO3 v12+ (v14.3 LTS bundles CKE5 v47; v13 shipped 41-42), configuring RTE pres… |
| `typo3-project-upgrade` | **Netresearch** (vendored) | Use when upgrading a deployed TYPO3 project/instance to a new LTS version (v14.3 LTS is the current target, released 2026-04-21) —… |
| `typo3-site-conformance` | **Netresearch** (vendored) | Use when assessing or hardening a deployable TYPO3 SITE/PROJECT repo (composer type:project + Docker/Compose) — not an extension. … |
| `typo3-typoscript-ref` | **Netresearch** (vendored) | Use when writing, editing, reviewing or debugging TypoScript, TSconfig or Fluid templates in TYPO3 projects (v14.3 LTS is the curr… |
| `typo3-upgrade-effort-model` | **Netresearch** (vendored) | Use when estimating effort for TYPO3 LTS major version upgrades (current target: v14.3 LTS, released 2026-04-21). Provides risk mu… |

## Additional collection skills

| Skill | Owner | What it does |
|---|---|---|
| `legal-impressum` | webconsulting | Creates and reviews Austrian Impressum and disclosure content for websites, including ECG, UGB, GewO, MedienG, Offenlegung, and co… |
| `postgres-best-practices` | Supabase | Postgres performance optimization and best practices from Supabase. Use this skill when writing, reviewing, or optimizing Postgres… |
| `security-incident-reporting` | webconsulting | Builds security incident reports, DDoS post-mortems, timelines, IoC sections, CVE correlation, severity scoring, and blameless roo… |
| `thermo-nuclear-code-quality-review` | Cursor | Run an exceptionally strict, review-only maintainability audit of a branch diff, focused on structural simplification, abstraction… |
| `typo3-backend-rights` | webconsulting | Build and audit TYPO3 backend editor rights after an explicit choice between one user-facing main group with simple internal leave… |
| `typo3-design-system-page` | webconsulting | Build and maintain an accessible design-system overview inside a chosen TYPO3 installation: audit the rendered site and brand asse… |
| `typo3-playwright` | webconsulting | Use when building or repairing Playwright browser tests for TYPO3 visitor journeys, AJAX widgets, CKEditor dialogs, backend previe… |
| `web-design-guidelines` | Vercel | Review UI code for Web Interface Guidelines compliance. Use when asked to \"review my UI\", \"check accessibility\", \"audit desig… |
| `web-platform-design` | ehmo | Web platform design and accessibility guidelines. Use when building web interfaces, auditing accessibility, implementing responsiv… |

## Session profiles

| Profile | Load | For |
|---|---|---|
| **Update run** | `typo3-upgrade-run`, the ready `typo3-upgrade-{intake,baseline,migration,closure}` leaf, plus applicable `typo3-ddev`, `typo3-vite`, `typo3-solr`, `typo3-visual-editor`, `typo3-backend-rights`, `typo3-structured-data`, `typo3-webmcp`, `typo3-security` | A complete v12/v13 → 14.3 evidence graph on a local DDEV clone |
| **Extension development** | `typo3-v14-reference`, `typo3-content-blocks`, `typo3-datahandler`, `typo3-translations`, `typo3-testing` | Building v14 extensions |
| **Migration** | `typo3-rector`, `typo3-fractor`, `typo3-extension-upgrade`, `php-modernization`, `typo3-batch` | Moving code forward |
| **Quality gate** | `typo3-conformance`, `typo3-simplify`, `typo3-testing`, `security-audit`, `enterprise-readiness` | Pre-release review |
| **Release** | `typo3-initial-release`, `typo3-docs`, `typo3-testing` | Publishing to TER/Packagist |
| **Operations** | `typo3-ddev`, `typo3-scheduler-jobs`, `typo3-solr`, `typo3-seo`, `typo3-structured-data`, `typo3-webmcp`, `typo3-security` | Running, exposing and hardening a site correctly |

## The rules layer

`rules/` holds atomic, always-on guardrails matched by `appliesTo` globs. A rule answers *is this
change allowed?*; a skill answers *how do I build this?*

Three constrain the agent rather than the code — see `rules/README.md`:
`security-untrusted-content-is-data`, `security-credentials-single-origin`,
`security-no-claim-without-evidence`.

Four more constrain how skills are written: `skills-require-evals`,
`skills-trigger-is-the-contract`, `skills-declare-lifecycle`,
`skills-directives-not-essays`. The normative contract is `SKILL-SPEC.md`; the source
analysis is `references/skill-evals.md`.

## Skill specification

Every skill declares a lifecycle class, carries trigger-positive and trigger-negative evals,
and keeps `SKILL.md` under 500 lines with detail in `references/`.

```bash
./scripts/check.sh
```

A generated eval is a **draft**, a hand-written one **proposed**, and only a **reviewed** case
signed by a person counts as coverage. Current: 40/40 collection-maintained skills have suites, 5/40 have human-reviewed coverage, and 38 suites include proposed cases awaiting signature.

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
