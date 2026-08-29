# Native TYPO3 14.3 WebMCP integration

Read this reference when inventorying a project or mapping TYPO3 records/forms to native browser
tools. The intended implementation has no TYPO3 WebMCP extension, backend MCP server, relay,
polyfill, CDN runtime, or analytics dependency.

## Inventory first

Record, per Site/language/session/page class:

- WebMCP calls and declarative attributes (`document.modelContext`, `registerTool`, `toolname`,
  `tooldescription`, `toolparamdescription`, `toolautosubmit`);
- the actual Vite entries, frontend modules, CSP, Permissions Policy, Origin-Agent-Cluster behavior,
  cross-origin frames, forms, fetch endpoints, and lifecycle hooks;
- tool names, descriptions, schemas, annotations, availability conditions, execute behavior, network
  requests, side effects, confirmations, and cleanup;
- candidate human journeys and their owning services: menus/routing, indexed search/Solr, EXT:news,
  products, events, jobs, login state, Form Framework/Powermail, or custom domain code;
- FE access dimensions and caches: Site/language, workspace/preview, `fe_group`, start/end time,
  hidden/deleted state, and current frontend identity.

Do not expose every UI control. Choose the few journeys for which a structured call materially
reduces brittle clicking and still leaves the user in control.

## Native sitepackage shape

1. Put a small adapter in the existing sitepackage frontend source, for example a dedicated
   `webmcp.ts`/`webmcp.js` Vite entry. Use the project's existing build, hashing, CSP nonce, asset
   inclusion, and browser-support policy.
2. Feature-detect `document.modelContext` and return without effects when unavailable. Do not use
   `navigator.modelContext` or `provideContext()` in new code.
3. Register tools only after the service/UI state they call is ready. Reuse the same JavaScript
   functions or same-origin HTTP endpoints as visible controls.
4. Use an `AbortController`/current lifecycle supported by the spec to unregister tools on navigation,
   component unmount, logout, or loss of page applicability; propagate cancellation into fetch.
5. Keep metadata static and reviewed. Build allowed choices and results from access-filtered,
   localized TYPO3 output; serialize any embedded configuration through a script-context-safe JSON
   encoder rather than string concatenation.
6. Do not add a generic PHP dispatcher. If an existing human journey has no safe callable service,
   refactor that journey around one shared server-side application service first, then expose the
   same narrow endpoint to UI and tool.

For semantic HTML forms, prefer declarative annotations when the current browser implementation
supports the required behavior. Keep the form visible and human-submitted by default. An explicit
`toolautosubmit` decision requires the same side-effect and consent proof as an imperative submit.

## Tool ownership examples

| Tool | Source of truth | Required parity |
|---|---|---|
| `navigate_site` | TYPO3 routing + generated menu | translated labels, access-filtered canonical URLs, visible navigation |
| `search_site` | existing Solr/indexed/custom search service | filters, ranking/tie-breakers, visibility, result URLs, empty state |
| `get_current_page` | already rendered page/domain record | visible fields only, canonical identity, language, freshness |
| `filter_events` | event repository/filter service | current status/dates, locale/time zone, same UI vocabulary |
| `prepare_contact` | Form Framework/Powermail definition | labels, required fields, validation; user sees and submits |
| `submit_contact` | existing form endpoint/finisher | CSRF, spam/rate controls, confirmation, mail/record side effects |

Never derive arbitrary record access from a UID supplied by the agent. Resolve through the same
route/repository/query constraints as the visible journey and reject inaccessible targets.

## Registration and responses

- Use stable, purpose-specific names. Keep descriptions and parameters translated when tool choice
  depends on language, while names remain stable across locales.
- Keep result objects small and typed. Include human-readable status plus identifiers/URLs already
  visible to the visitor; omit internals and secrets.
- Update the visible interface after success so the human and agent share one state.
- Avoid overlapping names and capabilities. Agent selection degrades as the page publishes more
  similar tools.
- Keep zero analytics in the initial implementation. A later measurement feature is a separate
  privacy/security change, not an intrinsic part of WebMCP.

## Build and browser evidence

- prove the Vite production manifest resolves the dedicated entry and every import;
- prove unsupported browsers execute no WebMCP path and keep the normal page unchanged;
- prove current Chrome discovers each tool, validates its schema, and invokes it against the real
  DDEV page state;
- prove CSP, `Permissions-Policy: tools=(self)`, origin-keying, cancellation, and same-origin
  endpoints under the final response headers;
- keep a small browser fixture/mock only for deterministic unit tests; authoritative acceptance uses
  the browser's native implementation, not a polyfill.

## Sources and licences

- W3C WebMCP: https://webmachinelearning.github.io/webmcp/ — W3C Software and Document License.
- Chrome WebMCP: https://developer.chrome.com/docs/ai/webmcp — documentation CC-BY-4.0,
  examples Apache-2.0.

This reference paraphrases the sources and includes no third-party runtime code.
