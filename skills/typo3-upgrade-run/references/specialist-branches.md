# Specialist branches

Load only the branch needed by the current node. Standalone specialist programmes do not restart
the parent workflow; each returns one evidence-backed result inside the shared deadline.

Most specialist branches are conditional: Solr, Content Blocks or an RTE branch closes
`not-applicable` when the feature is absent. The P14 structured-data and WebMCP branches are not:
they are a standard part of every run.

## Standard Contract B branches

After the countersigned Contract A gate the graph always runs `structured-data-enrichment` and
`webmcp-readiness`, each with its own intent approval, derived B baseline and green evidence loop,
and joins them at `elevation-join` before handover. Contract A pages stay unchanged except the
declared enrichment (the added JSON-LD, the WebMCP registrations or form annotations).

- **Scope at intake.** The P00 inventories propose the scope; the controller asks for it in the
  [round-1 questions](overnight-controller.md#batch-the-owner-decisions) — which entity types and
  which tools, not whether. The owner may extend the scope; the minimum below stays.
  An unanswered question holds the P14 node at `node-open` like any approval node; it never turns
  into `not-applicable`.
- **Minimum structured data.** Organization (or the specific LocalBusiness subtype) and WebSite,
  WebPage on every page class, and BreadcrumbList wherever a breadcrumb is visible, all mirroring
  visible content; plus every eligible type the inventory found (Article/NewsArticle, FAQPage,
  Product, Event, JobPosting and the like).
- **Minimum WebMCP.** Read-only navigation and lookup tools (site search, page/section lookup,
  language switch) and prepare-only form tools that fill a visible form and leave submission to the
  human: no `toolautosubmit`, and a recorded security review per form tool. The Permissions-Policy
  decision (`tools=(self)` unless a named cross-origin use is approved) is recorded either way.
- **`not-applicable`** only for a genuine impossibility with a reviewed reason, for example a
  project with no public frontend. "Not requested", "no time" and "nobody asked" are not reasons;
  a missing approval waits, and a deadline problem is re-forecast and reported.

## Redirect module and backend rights

Every upgraded installation must have TYPO3’s Redirects module available. During intake, check for
`typo3/cms-redirects`. If absent, route through dependency resolution and install a constraint
compatible with the locked 14.3 core via DDEV Composer; never guess a version or run host Composer.
Apply schema/setup only inside its stateful node and snapshot first.

During intake, route to `typo3-backend-rights` for a read-only topology inventory. Before any
consolidation, ask whether the project can live with one user-facing, non-admin main editor group.
Explain that this means one directly assigned role with inherited Base, Content, Site, and
Extensions leaves—not one literal `be_groups` row—and that all included editors share one
authorization boundary. Record the exact question, current group/user evidence, recommendation,
answer, and approval id.

The graph branches on that answer. **Yes** activates the approved single-main-group node; it still
requires an intent approval, snapshot, and a later append-versus-replace decision for every user.
**No** activates the preserved-role node, which retains meaningful site/language/module/table/file/
Workspace boundaries and audits each intended group separately. No answer blocks both mutation
paths. Neither route deletes legacy groups or rewrites memberships implicitly.

On the selected branch, grant only the intended trusted editor group or groups access to the
Redirects module and required tables/actions/site roots. Verify with a least-privilege non-admin
test user for every materially different role: module visible, redirect list readable, authorized
create/edit works, unrelated sites/actions remain forbidden, and a redirect performs the expected
frontend response. Admin success is not rights proof.

## Structured-data branch

Route structured data to `typo3-structured-data` in three different graph states:

1. **P00 inventory** records existing JSON-LD/Microdata producers, visible page/content types,
   canonical identities, languages, and validation findings before Baseline A.
2. **P10 parity** proves that existing structured meaning and values survived TYPO3 14 unchanged.
   It repairs only upgrade-induced breakage; missing opportunities do not enter Contract A.
3. **P14 enrichment** (standard, every run) starts after the countersigned Contract A gate with
   the intent approval asked at intake, snapshot, rollback reference, and derived B baseline. It
   maps visible TYPO3 data to the minimum entities above plus the eligible types of the inventory,
   verifies the output, and then waits at `elevation-join` for the WebMCP branch.

Use `FAQPage` for genuine visible publisher-authored FAQ questions and answers, never `QAPage`
unless one question accepts user-submitted alternative answers. Record that Google regularly limits
FAQ rich-result display to authoritative government and health sites; do not promise expandable
results for an ordinary project. Keep Product prices/availability, LocalBusiness facts, reviews,
Article dates/authors, events, jobs, and other entity values synchronized with visible records.

If a maintained producer is needed, inspect and resolve `brotkrueml/schema` against the locked
`typo3/cms-core:^14.3` source. Package installation and extension setup stay inside the approved P14
stateful node. Existing correct output is preserved rather than replaced merely to standardize tools.

## Native WebMCP branch

Route browser-side agent readiness to `typo3-webmcp` in three graph states:

1. **P00 inventory** records existing `document.modelContext` code, declarative form annotations,
   origin/Permissions-Policy headers, exposed tools, endpoints, browser-test configuration, and
   useful visitor journeys. This node is read-only.
2. **P10 parity** proves only a pre-existing WebMCP surface survived the TYPO3/Vite migration:
   names, schemas, page/session/language availability, results, side effects, human-interface
   fallback, and security behavior. A site with no prior WebMCP closes this node as
   `not-applicable`; missing new tools are not a Contract A regression.
3. **P14 readiness** (standard, every run) starts after the countersigned Contract A gate and the
   intent approval asked at intake. Add the minimum tool set above (read-only navigation/lookup,
   prepare-only forms after a security review, the Permissions-Policy decision) in the existing
   project-owned sitepackage/Vite source, seal a derived B baseline, run the bounded evidence gate,
   and then wait at `elevation-join`.

Chrome supplies the browser API; the TYPO3 project supplies the semantic forms, registrations,
services, and authorization. Do not add a TYPO3 WebMCP extension, backend MCP, relay, polyfill, CDN
runtime, or analytics by default. Use current `document.modelContext.registerTool()` for imperative
tools or the current declarative form attributes. Unsupported browsers must retain the unchanged
human journey, and the closure report must record the exact Chrome channel, flag/origin-trial state,
and current specification snapshot rather than claiming universal support.

Keep tools same-origin and task-specific. Reuse visible TYPO3 services, FE access checks, validation,
CSRF protection, rate limits, translations, and confirmation UI. Never expose generic CRUD,
DataHandler, backend-user, arbitrary URL-fetch, cache-flush, file, or SQL tools from the public page.
Mark untrusted/editor/user/indexed content accordingly and require visible human confirmation before
consequential sends or mutations.
