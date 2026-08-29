---
name: typo3-structured-data
description: >-
  Audits, preserves, implements, and verifies schema.org structured data and server-rendered
  JSON-LD in TYPO3 14.3 projects. Use for FAQPage, Article or NewsArticle, LocalBusiness,
  Organization, Product, Event, JobPosting, Recipe, BreadcrumbList, QAPage, reviews, rich
  results, brotkrueml/schema, mapping EXT:news detail records to article JSON-LD, or other
  page-type-to-schema work during a TYPO3 upgrade. Keeps visible content and structured values
  identical and separates upgrade parity from approved post-upgrade enrichment. Sitemap,
  canonical, hreflang, and meta-tag work belongs to typo3-seo.
metadata:
  skill_type: preference
license: "MIT / CC-BY-SA-4.0; adapted sources retain their original licences"
---

# TYPO3 structured data

> Source: https://github.com/dirnbauer/typo3-skills

Make a TYPO3 page describe what it visibly is. Emit one coherent, testable entity graph from the
same records that render the page; never maintain a second hidden editorial truth.

## Contract

1. Identify the selected repository, DDEV project, TYPO3/Core version, Site bases, languages, and
   canonical public URLs before writing. Run Composer, TYPO3, and PHP through DDEV.
2. Inventory every existing `application/ld+json`, Microdata/RDFa fragment, schema extension,
   TypoScript/Fluid producer, page type, content element, and domain record before changing markup.
3. Derive types and properties only from user-visible, current page content. Never invent a price,
   availability, opening time, author, review, rating, address, job, event, or FAQ answer.
4. Prefer server-rendered JSON-LD. Use absolute canonical URLs, stable `@id` values, ISO-8601 dates,
   real language-specific URLs, crawlable images, and the most specific applicable schema.org type.
5. Keep global and page entities in one connected `@graph` when practical. Reuse stable identities
   instead of emitting contradictory duplicate Organization, WebSite, WebPage, or main-entity nodes.
6. Do not promise rankings, a knowledge panel, stars, or a rich result. Valid markup makes a page
   eligible for supported search features; appearance remains the consumer's decision.
7. Parse and verify the rendered output for every affected page class. A green JSON parser alone is
   insufficient: vocabulary, consumer requirements, visible-content parity, canonical identity,
   duplicates, and representative Google eligibility checks must also pass.

## Upgrade graph modes

Return bounded evidence to the orchestration node; do not start an independent repeat-until-clean
loop.

- **Intake inventory:** read only. Record existing producers, entity types, canonical `@id` values,
  eligible page/content classes, visible source fields, and current validation findings before
  Baseline A.
- **Contract A parity:** preserve the exact pre-upgrade structured meaning and rendered values.
  Repair only upgrade-induced breakage. Missing opportunities become P14 candidates; adding them
  here would change the immutable DOM contract.
- **P14 enrichment:** start only after Contract A closes and the track has an intent approval.
  Implement the approved page-type matrix, derive a B baseline, and verify that visible HTML and
  interaction behavior stay unchanged apart from the declared JSON-LD addition.

## Select types from visible page purpose

Read [type-selection.md](references/type-selection.md) before choosing types. Use the current Google
Search gallery as a consumer-specific subset of the broader schema.org vocabulary.

| Visible page purpose | Primary type | Essential guard |
|---|---|---|
| site/company identity | `Organization` or the specific `LocalBusiness` subtype | one authoritative identity with visible contact facts |
| ordinary page | the most specific `WebPage` subtype | canonical page URL and language agree with HTML |
| visible breadcrumb | `BreadcrumbList` | item order, labels, and URLs match navigation |
| blog/news detail | `Article` or `NewsArticle` | not a listing; visible author and dates agree |
| editor-authored FAQ | `FAQPage` with `Question`/`Answer` | every marked question and answer is visible |
| one user question with user-submitted answers | `QAPage` | never substitute it for an editorial FAQ |
| product detail | `Product` plus valid `Offer` when applicable | visible price, currency, availability, and genuine reviews only |
| event detail | `Event` | current date/status, place or online location, and ticket facts |
| active vacancy | `JobPosting` | real visible job; expiry and `validThrough` stay synchronized |
| recipe detail | `Recipe` | actual ingredients/instructions and truthful times/nutrition |

`FAQPage` can still describe genuine visible FAQ content. Google has, however, limited regular FAQ
rich-result display to well-known authoritative government and health sites. Record this limitation;
do not sell FAQ markup as an expandable Google result for an ordinary commercial site. Google also
removed How-To rich-result support; valid `HowTo` vocabulary may still describe content for other
consumers, but it is not a current Google rich-result target.

## Implement in TYPO3

Read [typo3-integration.md](references/typo3-integration.md) before installing or changing an
integration.

1. Preserve a working project-specific producer when it already yields one correct entity graph.
   Remove parallel generators only after proving which one owns each entity.
2. When a maintained abstraction is needed, prefer the installed-compatible
   `brotkrueml/schema` API and Fluid ViewHelpers over hand-built JSON strings. Verify its exact
   Composer constraint and classes against the locked installation; do not assert an API from memory.
3. If the package is missing, add it only inside the approved Composer/stateful graph node. Resolve a
   version compatible with `typo3/cms-core:^14.3`, snapshot before extension setup, and record the
   lockfile version, source, licence, setup command, and rollback reference.
4. Map TYPO3 records to entities at their owning boundary: Site configuration owns global identity;
   page/rootline data owns WebPage and breadcrumbs; EXT:news owns articles; Content Blocks or domain
   records own FAQ, product, event, job, recipe, review, and media facts.
5. Use one serialization boundary that safely JSON-encodes values. Never concatenate editor text
   into a `<script>` tag, trust already-encoded JSON, or inject markup through a tag manager.
6. In multilingual sites, render translated visible values and language URLs. Reuse a global
   Organization `@id` only when it is the same legal entity; do not merge different businesses or
   locations merely because they share an installation.

## Evidence gate

For every affected canonical page class:

1. Fetch the final rendered HTML in a clean frontend session and extract every JSON-LD block.
2. Parse without recovery; require object/array roots, `https://schema.org` context, known current
   types/properties, stable unique identities, absolute URLs, and no contradictory duplicates.
3. Compare names, questions/answers, prices, ratings, dates, addresses, availability, images, and
   links with the visible page and its authoritative TYPO3 record.
4. Validate the whole graph with Schema.org Validator. Use Google's Rich Results Test only for
   currently supported Google feature types; it has no general public automation contract, so keep
   representative manual evidence rather than claiming an API run that did not happen.
5. Add project tests for each mapping and a rendered-page regression fixture. Run the identical
   language/page sample after a change. Zero invalid JSON-LD, blocking consumer errors, hidden facts,
   fake/self-serving ratings, stale time-sensitive data, and unexplained entity conflicts are allowed.

Search Console evidence is post-deployment monitoring and outside the local upgrade run. Do not
deploy or request indexing from this skill.

## Boundaries

- Use `typo3-seo` for canonical URLs, hreflang, meta tags, XML sitemaps, and robots rules.
- Use `typo3-content-blocks` to create or migrate the visible FAQ/product/event/job/recipe model;
  this skill maps that model to entities.
- Use the general `schema` skill for non-TYPO3 sites. This skill owns TYPO3 records, Fluid/API
  integration, DDEV evidence, and the upgrade-graph contract.

## Credits and licences

This skill adapts the general workflow and type-selection concepts from Corey Haines' `schema`
skill: **Copyright (c) Corey Haines**, MIT License,
https://github.com/coreyhaines31/marketingskills/tree/main/skills/schema.

TYPO3 integration guidance references `brotkrueml/schema`: **Copyright since 2019 Chris Müller**,
extension code GPL-2.0-or-later and documentation CC-BY-4.0. Schema.org vocabulary and documentation
are CC-BY-SA-3.0. Google Search documentation is CC-BY-4.0 and its code samples are Apache-2.0.
No third-party extension code is copied into this skill.
