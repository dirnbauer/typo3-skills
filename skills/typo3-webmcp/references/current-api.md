# Current WebMCP API and product boundaries

Source snapshot: 2026-08-28. WebMCP is a living W3C Community Group proposal and Chrome experiment;
recheck the primary sources whenever implementation or release status matters.

## Current surface

- New code targets `document.modelContext`.
- Imperative tools use `document.modelContext.registerTool()` with a name, description, JSON Schema,
  annotations, and an execute callback.
- Tools are page-scoped and discoverable only after an agent visits the page.
- Declarative WebMCP annotates visible HTML forms with `toolname`, `tooldescription`, optional
  `toolparamdescription`, and—only for deliberately automatic submission—`toolautosubmit`.
- Same-origin top-level documents are the default trust boundary. The `tools` Permissions Policy and
  explicit origin lists control iframe sharing.
- A secure, origin-keyed document is required. Do not disable origin-keying with legacy
  `document.domain` behavior or `Origin-Agent-Cluster: ?0`.
- Feature-detect. Unsupported browsers receive the ordinary site with no error or missing journey.

Older materials may use `navigator.modelContext`, `provideContext()`, a readable `.tools` array, or
polyfill-specific transports. Do not introduce those into new project code without a documented
compatibility requirement. Verify the current `document.modelContext.registerTool()` route in the
target Chrome build.

At this snapshot Chrome documents local enablement through
`chrome://flags/#enable-webmcp-testing` and an origin trial beginning with Chrome 149. It also says
the feature remains under active discussion. Record the browser build and feature path instead of
turning that statement into a permanent compatibility claim.

## Different products with similar names

| Product | Location and authority | Purpose |
|---|---|---|
| WebMCP | visitor's active browser tab and website origin | expose frontend page actions as agent-callable tools |
| server MCP | separate HTTP/stdio server with its own authorization | expose remote or development capabilities to MCP clients |

Installing one does not satisfy the acceptance criteria of another. A project may intentionally
compose them, but identities, authorization, data flow, threat model, and tests remain separate.

## Primary sources and licences

- W3C Community Group draft: https://webmachinelearning.github.io/webmcp/
- Specification repository: https://github.com/webmachinelearning/webmcp — W3C Software and
  Document License.
- Chrome overview, imperative/declarative APIs, best practices, and tool security:
  https://developer.chrome.com/docs/ai/webmcp — documentation CC-BY-4.0, samples Apache-2.0.
This reference paraphrases the sources and includes no copied implementation.
