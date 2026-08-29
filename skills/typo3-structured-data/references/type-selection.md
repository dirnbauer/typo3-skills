# Page-purpose and entity selection

Source snapshot: 2026-08-27. Consumer galleries and eligibility rules change; recheck the current
primary documentation when internet access is available.

## Selection order

1. Identify the page's visible primary purpose and canonical URL.
2. Find the TYPO3 record or Site setting that owns each fact.
3. Select the most specific stable schema.org type.
4. Check whether the intended consumer supports a feature for that type.
5. Add required properties only when their values are visible and authoritative; then add truthful
   recommended properties.
6. Connect the entity to WebPage, WebSite, Organization, breadcrumb, author, image, location, or
   offer identities with stable `@id` references.

Schema.org describes entities for many consumers. Google's Search gallery is a changing subset; a
valid schema.org type is not automatically a Google rich-result feature.

## Page matrix

| Page/content signal | Use | Do not use when |
|---|---|---|
| legal/company homepage with consistent identity | `Organization`, or the most specific `LocalBusiness` subtype for a real customer-facing location | the address/hours/phone are absent, stale, or describe a different branch |
| every canonical HTML page | `WebPage` or a specific subtype such as `AboutPage`, `ContactPage`, `FAQPage`, `ProfilePage` | another generator already emits the same page identity correctly |
| visible hierarchical navigation | `BreadcrumbList` with ordered `ListItem`s | labels or destinations differ from what users can follow |
| one article/news detail record | `Article`, `BlogPosting`, or `NewsArticle` | a listing, search result, teaser, or generic page is being described |
| several publisher-authored questions with one accepted answer each | `FAQPage` containing all visible `Question`/`Answer` pairs | the content is promotional, hidden, incomplete, or actually a community Q&A |
| one question where users can submit alternative answers | `QAPage` | an editorial FAQ, blog answer, product FAQ, or multi-question page |
| one buyable or reviewed product | `Product`; attach `Offer`, `AggregateOffer`, `Review`, or `AggregateRating` only from real visible data | price/availability/reviews are fabricated, partial, imported without provenance, or stale |
| one scheduled public event | the appropriate `Event` subtype | it is a vague announcement, permanently expired, or lacks a truthful location/mode |
| one current vacancy | `JobPosting` | the job is closed, inaccessible, or missing required visible employment facts |
| one actual recipe | `Recipe` | the content is a restaurant menu, product page, or prose without ingredients/instructions |
| one visible video | `VideoObject` | the media is decorative, inaccessible, or metadata describes another asset |
| one person/organization profile | `ProfilePage` plus the represented entity | the page does not primarily profile that entity |

## FAQ and Q&A policy

- Mark every question and full answer visible on the page; do not select only favorable pairs.
- A collapsed accordion still counts as visible when users can open it without authentication or a
  separate navigation, but the rendered DOM must contain the answer.
- Use `FAQPage` for publisher-authored answers. Use `QAPage` only for one-question pages where users
  can submit answers; Google explicitly rejects QAPage on editorial FAQs.
- Google announced that regular FAQ rich results are limited to well-known authoritative government
  and health sites. Other sites may keep accurate FAQPage markup for semantic consumers, but the
  implementation must not promise expandable Google results.
- Google removed How-To rich-result display and Rich Results Test support. Treat `HowTo` as a
  schema.org semantic choice, not a Google enhancement target.

## Reviews and ratings

Use `Review` or `AggregateRating` only for genuine, attributable reviews represented on the page.
Include the full visible set rather than a favorable subset. Do not manufacture ratings from an
editor field or reuse an organization-wide rating on unrelated products. Consumer-specific rules
may disallow self-serving review snippets even when the vocabulary is valid; verify the current
feature guide for the reviewed type.

## Entity identity

Use stable fragments on canonical URLs, for example:

- `https://example.at/#organization`
- `https://example.at/#website`
- `https://example.at/path/#webpage`
- `https://example.at/path/#primary-entity`

Do not create a new Organization identity on every page. Do create different identities for legally
or operationally distinct businesses/locations. On translated pages, keep the same entity `@id`
only when the entity is the same; translate human-readable properties and link the correct language
page.

## Primary sources and copyright

- Google Search structured-data gallery and general guidelines:
  https://developers.google.com/search/docs/appearance/structured-data/search-gallery and
  https://developers.google.com/search/docs/appearance/structured-data/sd-policies — documentation
  CC-BY-4.0, code samples Apache-2.0.
- Google FAQ/How-To change:
  https://developers.google.com/search/blog/2023/08/howto-faq-changes — CC-BY-4.0.
- Google QAPage guide:
  https://developers.google.com/search/docs/appearance/structured-data/qapage — CC-BY-4.0.
- Schema.org vocabulary: https://schema.org/ — CC-BY-SA-3.0.

This reference paraphrases those sources; it does not copy their examples.
