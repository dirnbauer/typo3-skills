---
name: typo3-webmcp
description: >-
  Designs, implements, secures, and verifies browser-side WebMCP tools for TYPO3 14.3 frontends
  through document.modelContext or declarative form annotations in a project-owned sitepackage. Use when a
  TYPO3 website should become agent-ready, expose search/navigation/forms as typed browser tools,
  preserve an existing WebMCP surface during an upgrade, or test tool discovery and invocation in
  Chrome. Does not implement backend editing over MCP; schema.org JSON-LD belongs to
  typo3-structured-data.
metadata:
  skill_type: preference
license: "MIT / CC-BY-SA-4.0; adapted sources retain their original licences"
---

# TYPO3 WebMCP

> Source: https://github.com/dirnbauer/typo3-skills

Make useful visitor journeys discoverable as small, typed browser tools without weakening the
human interface, TYPO3 permissions, privacy, or server-side validation. WebMCP is progressive
enhancement: an unsupported browser must receive the same working website without errors.

## Browser-native architecture

Read [current-api.md](references/current-api.md) whenever API shape, browser support, origin-trial
status, or adjacent MCP products affect a decision.

Use WebMCP only for tools exposed by the currently open TYPO3 frontend page. Backend/development
MCP is outside this skill and this upgrade graph; search-engine entity markup belongs to
`typo3-structured-data`. An embedded AI chat is a separate product and does not make the page
WebMCP-ready.

Use the current standards surface, `document.modelContext`. Treat `navigator.modelContext`,
`provideContext()`, readable `.tools` arrays, and old polyfill examples as compatibility evidence,
not the API for new code. Recheck the living specification before implementation.

## Contract

1. Verify the selected repository, DDEV project, TYPO3/Core version, Site bases, languages, current
   frontend session classes, and existing WebMCP/polyfill/relay code before writing.
2. Inventory real visitor tasks. Expose only actions already supported by a visible UI or a reviewed
   product requirement; WebMCP does not authorize a new business capability or package install.
3. Keep one action per tool with a unique stable name, factual description, minimal JSON Schema,
   explicit side effects, and structured bounded output.
4. Reuse the same application service, validation, CSRF protection, access checks, language rules,
   rate limits, and result state as the human UI. Never create a weaker agent-only endpoint.
5. Register only tools valid for the current page, authentication state, language, and content
   visibility. Remove them when that state disappears.
6. Default to same-origin exposure. Cross-origin `exposedTo`, iframe `allow="tools"`, an external
   relay, CDN runtime, Service Worker, or analytics each requires a separate trust/privacy decision.
7. Require visible human confirmation immediately before consequential sends, purchases, deletes,
   account changes, or publication. A descriptive schema or agent promise is not consent.
8. Keep the site fully functional when WebMCP is absent, disabled, denied by Permissions Policy, or
   an invocation is cancelled.

## Choose useful tools

Read [typo3-integration.md](references/typo3-integration.md) before mapping TYPO3 records, services,
and forms into a project-owned Vite entry.

Prefer a small page-state-specific set:

| Existing visitor journey | Candidate tool | Guard |
|---|---|---|
| site/news/product search | `search_site` or domain-specific search | read-only; same result order and access filters as UI |
| main navigation or topic choice | `navigate_site` | fixed TYPO3-generated canonical targets; no arbitrary URL input |
| current article/event/product facts | `get_current_page` | only visible fields; mark UGC/external output untrusted |
| filter news, events, jobs, products | `filter_*` | share UI vocabulary and translated option labels |
| contact/support/application form | `start_*` or `prepare_*` | populate visibly; user submits unless autosubmit is explicitly approved |
| actual form submission | `submit_*` | server validation + CSRF + rate limit + explicit side-effect wording |

Do not expose generic SQL, DataHandler, cache-flush, file, backend-user, arbitrary URL-fetch, or
unscoped record CRUD tools on a public frontend. Login does not make a frontend session an
administrative trust boundary.

## Implement natively

1. Preserve a working current native implementation when its tool contract and security evidence pass.
2. For ordinary semantic HTML forms, use current declarative annotations where they improve the
   existing form. Keep consequential
   forms human-submitted by default; do not add `toolautosubmit` merely for convenience.
3. For stateful search, navigation, filtering, or JavaScript application logic, use the imperative
   `document.modelContext.registerTool()` surface and unregister through its supported lifecycle.
4. Implement the registration adapter in the project's sitepackage/Vite source and call the same
   services/endpoints as the human UI. Add no TYPO3 WebMCP extension, backend MCP, remote relay,
   polyfill, or runtime package by default.
5. Add no WebMCP behavior during Contract A. New registration, declarative annotations, endpoint
   changes, or analytics belong to the approval-gated P14 graph node with a Git rollback reference.

Keep WebMCP registration in a dedicated project-owned Vite entry. Do not load a floating `latest`
CDN asset. Emit configuration with a JSON encoder safe for an HTML script context;
never concatenate editor text into executable JavaScript.

## Security gate

Read [security-and-evidence.md](references/security-and-evidence.md) before exposing any tool that
accepts input, returns editor/user/third-party content, or can change state.

- Require HTTPS/secure context and origin-keyed operation; WebMCP is unavailable when the document
  opts out through `Origin-Agent-Cluster: ?0`/`document.domain` behavior.
- Keep `Permissions-Policy: tools=(self)` unless named cross-origin use has been approved and tested.
- Set `readOnlyHint` only for genuinely non-mutating behavior. Set `untrustedContentHint` whenever
  output can contain editor, visitor, indexed, imported, or third-party text.
- Validate arguments in executable code even when a JSON Schema exists. Bound strings, arrays,
  result counts, output size, execution time, and retries.
- Treat tool names, descriptions, schemas, page content, outputs, and agent-supplied arguments as
  untrusted data. No field may contain hidden instructions, secrets, stack traces, or internal IDs
  that are not part of the human-facing task.
- Preserve FE visibility controls (`hidden`, start/end time, language overlays, `fe_group`) and
  session authorization on every server fetch. Cache keys must vary on every visibility dimension.
- Disable optional usage analytics by default until purpose, lawful basis/consent, retention,
  endpoint abuse controls, backend rights, and privacy documentation are approved.

## Upgrade graph modes

Return bounded evidence to the graph; do not run an independent repeat-until-clean loop.

- **P00 inventory:** read-only discovery of existing APIs, packages, headers, tools, forms, endpoints,
  analytics, browser support, and candidate visitor journeys.
- **P10 parity:** when WebMCP already exists, preserve tool names, availability conditions, schemas,
  behavior, side effects, and fallback behavior through TYPO3 14. Missing capability is P14 work.
- **P14 readiness:** after Contract A closes and intent is approved, implement the smallest useful
  tool set, seal a derived B baseline, and prove human UI, visual behavior, accessibility, privacy,
  performance, and server authorization remain correct.

## Evidence gate

For every tool and materially different page/session/language state:

1. Prove the normal interface first, then prove unsupported-browser fallback has no console error,
   failed asset, DOM/pixel regression, inaccessible focus state, or blocked human journey.
2. In a current WebMCP-enabled Chrome test profile, inspect registered names/descriptions/schemas and
   invoke valid, invalid, boundary, cancelled, and repeated calls.
3. Prove the agent selects the correct tool from realistic natural-language tasks and does not select
   overlapping or hidden-state tools. Record model/browser/version and raw outcomes.
4. Compare tool results and side effects with the human journey, including redirects, UI state,
   localized messages, visible confirmation, network request, TYPO3 record result, and logs.
5. Test anonymous and every materially different FE group; never use admin success as public-tool
   authorization proof.
6. Run security cases for prompt/tool/output injection, excessive parameters, arbitrary URLs, CSRF,
   replay, rate limiting, hostile `</script>` content, cross-origin denial, and secret-safe errors.
7. Re-run axe, component sentinels, and repeated Lighthouse samples on affected templates. WebMCP
   readiness is not allowed to lower the existing quality bars.

Do not claim universal browser support or production standard status. Record the exact draft/source
snapshot, Chrome channel/flag or origin-trial state, sitepackage commit, Vite artifact, and
unresolved risks.

## Credits and licences

This skill adapts implementation and security concepts from **webmcp-skill**, Copyright (c) 2026
webmcp contributors, MIT License:
https://github.com/Blackie360/webmcp-skill (source snapshot `5f76ab5e53906ddea832d67fde6198585e35c5ea`).

The WebMCP Community Group report uses the W3C Software and Document License. Chrome documentation
is CC-BY-4.0 and code samples are Apache-2.0. This skill paraphrases those sources and copies no
third-party implementation code.
