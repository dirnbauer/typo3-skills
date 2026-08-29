# TYPO3 14.3 integration

Use this reference when selecting, installing, upgrading, or changing the structured-data producer.

## Inspect before choosing

Record:

- `composer show` results for `brotkrueml/schema` and other SEO/schema packages;
- every `application/ld+json` producer in Fluid, TypoScript, PHP, JavaScript, and extensions;
- configured Site bases, languages, canonical behavior, and rootline processors;
- the TCA/Content Block/domain fields that own FAQ, article, product, event, job, recipe, review,
  organization, and location facts;
- duplicate or contradictory rendered entities and which producer emitted them.

Do not add a second framework because one page is missing a property. Extend the current producer
when it is compatible, testable, and has a single clear ownership boundary.

## `brotkrueml/schema`

The maintained extension provides schema.org type models, a manager API, and generated Fluid
ViewHelpers. At the 2026-08-27 source snapshot, stable `4.2.3` declares PHP `>=8.2` and TYPO3 Core,
Fluid, and Frontend `^13.4 || ^14.3`. These facts are discovery hints, not permission to install that
version blindly: verify current Composer metadata, the selected project's lockfile, and installed
source before choosing a constraint or API.

For an approved new installation:

1. Prove project/Core/DDEV/database identity and record a code rollback reference.
2. Resolve the compatible package inside DDEV Composer; include it in the planned dependency
   transaction rather than running an unreviewed floating update.
3. Record the exact package version, source URL, GPL-2.0-or-later licence, lockfile diff, dependency
   audit, and `composer why-not` evidence.
4. Snapshot immediately before any TYPO3 extension setup or schema change. Inspect the installed
   CLI help and package documentation for the actual setup command; do not infer it from an older
   TYPO3 version.
5. Verify frontend rendering, Admin Panel/schema diagnostics when installed, caches, logs, and a
   second fixed-point setup/schema pass.

Use the installed API or ViewHelpers for model construction. Verify names such as `SchemaManager`,
`TypeFactory`, type classes, events, and ViewHelper arguments against the locked source. The
extension's generated models follow the evolving schema.org vocabulary, so copied older class lists
are not authoritative.

## Ownership model

| TYPO3 source | Entity responsibility |
|---|---|
| Site configuration/sitepackage settings | Organization/LocalBusiness identity, WebSite, logo, contact facts |
| page/rootline/menu processor | canonical WebPage subtype and BreadcrumbList |
| EXT:news detail record | Article/NewsArticle, author, dates, images, publisher reference |
| FAQ Content Block/record relation | ordered visible Question/Answer entities |
| commerce/domain model | Product, Offer, price/currency/availability, genuine reviews |
| event/job/recipe domain record | its matching primary entity and current lifecycle fields |
| FAL metadata | crawlable ImageObject/VideoObject facts only when the asset is visible |

Keep site identity configuration centralized and translatable. Keep content-specific data in the
same record that renders the visible component. A free-form JSON textarea is not an editorial model:
it bypasses TCA validation, translations, relations, access rules, and content parity.

## Rendering rules

- Render on the server. Do not depend on consent, analytics, a tag manager, or post-load JavaScript.
- Serialize through one tested JSON encoder. Escape editor-controlled text for an HTML `<script>`
  context; never concatenate strings or accept pre-encoded fragments from records.
- Prefer a connected `@graph` and stable `@id` references. If the selected extension emits separate
  blocks, prove they resolve to one non-contradictory graph.
- Use the final canonical URL from TYPO3 routing. Do not hardcode a production host into reusable
  Fluid or copy the current request host before trusted-host/canonical resolution.
- Preserve null/absence semantics. An unknown price, end date, author, rating, or address is omitted,
  not converted to an empty string, zero, or guessed fallback.

## Test contract

For every mapped page class and language, keep fixtures for:

- minimum valid data;
- complete recommended data;
- absent optional fields;
- translated values and canonical URLs;
- hidden/deleted/expired records;
- hostile editor text containing quotes, markup, and `</script>`-like content;
- duplicate producer detection;
- visible HTML versus JSON-LD parity.

Use the upgrade harness's sealed URL manifest and captured response bodies so structured-data proof
does not invent a second crawler or leak credentials. A local parser can prove JSON and project
invariants. Schema.org Validator and Google Rich Results Test remain representative external
evidence, not replacements for deterministic project tests.

## Sources, copyright, and licences

- `brotkrueml/schema`, Copyright since 2019 Chris Müller, GPL-2.0-or-later:
  https://github.com/brotkrueml/schema
- TYPO3 extension documentation, Copyright since 2019 Chris Müller, CC-BY-4.0:
  https://docs.typo3.org/p/brotkrueml/schema/main/en-us/
- Packagist package metadata: https://packagist.org/packages/brotkrueml/schema

This reference paraphrases the integration contract and copies no extension source code.
