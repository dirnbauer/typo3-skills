# WebMCP security and evidence

Read this reference before a tool accepts input, returns non-static content, or changes state.

## Threat boundaries

WebMCP crosses four untrusted boundaries at once: agent-selected arguments, natural-language tool
metadata, page/domain content returned as output, and the visitor's authenticated browser session.
Browser mediation does not replace application authorization.

| Risk | Required control |
|---|---|
| tool/metadata poisoning | static reviewed names/descriptions/schemas; no editor-controlled instructions |
| output prompt injection | typed bounded output; `untrustedContentHint`; preserve content as data |
| misleading side effects | exact action verbs and explicit effects; visible confirmation before consequence |
| privacy over-collection | only action-essential parameters; no inferred profile fields or agent identity |
| public-to-private record access | server-side FE access/language/time checks on every call and cache hit |
| arbitrary fetch/redirect | allowlisted TYPO3-generated targets; reject caller-supplied schemes/hosts |
| CSRF/replay/automation abuse | existing CSRF/session protection, one-time intent where needed, rate limits, idempotency |
| cross-origin leakage | `tools=(self)` default; named reviewed secure origins only; no wildcard relay |
| cancellation race | propagate AbortSignal; prove cancelled work has no late side effect |
| hidden analytics | off by default; separate privacy approval, minimization, retention, rights, deletion path |

Consequential actions use two stages when possible: a read-only `prepare_*` tool returns the exact
pending action and focuses/updates the visible UI; the human confirms through the ordinary control.
Do not use a single ambiguous `finalize`, `process`, or `handle` tool.

## Schema and output rules

- Keep schema fields necessary, typed, bounded, and described in plain language. Validate again in
  JavaScript/PHP; schemas are agent guidance, not a trust boundary.
- Use enums only for choices actually available in the current UI state. Do not expose internal IDs
  when a stable human-readable value suffices.
- Return a small structured result and a precise status. Expected validation failures are recoverable
  results; unexpected faults are logged server-side and returned without paths, queries, tokens, or
  traces.
- Follow current Chrome character-budget guidance as a budget, not a protocol promise: concise tool
  and parameter names, descriptions, and outputs reduce agent confusion and leakage.
- Set `readOnlyHint:false` for analytics writes too: tracking a call mutates state even if the primary
  business operation reads. Prefer no analytics on a genuinely read-only tool.

## Deterministic test matrix

For each tool, keep code-based checks for:

- manifest/schema serialization and hostile `</script>`, quotes, Unicode, and oversized text;
- valid, missing, wrong-type, out-of-range, unknown-enum, and extra arguments;
- anonymous, allowed FE group, denied FE group, expired session, hidden/expired record, and language;
- exact side effect count, idempotency/replay behavior, CSRF failure, rate limit, timeout, cancellation;
- allowed target and blocked external/protocol-relative/javascript/data URLs;
- accurate annotations and output truncation/redaction;
- registration once, dynamic removal, duplicate-name failure, unsupported browser, denied policy;
- no console error, no failed asset, and no human-interface regression.

## Agent evals

Deterministic tests cannot show whether an agent chooses the right tool. Run isolated natural-language
journeys against the current inspector/browser agent and retain raw prompts, discovered tools, chosen
tool, arguments, output, browser/model/version, and verdict.

Include:

- obvious positive tasks for each tool;
- close competitors where exactly one tool should win;
- tasks that should stay in the human UI;
- requests for inaccessible/private data;
- misleading page/UGC text that tells the agent to call another tool or reveal data;
- consequential requests without user confirmation;
- multilingual phrasing and realistic misspellings.

A tool is not ready because one prompt worked once. Use repeated trials, report the distribution, and
fix the tool boundary/description instead of adding model-specific prompt patches.

## Upgrade evidence

P00 records the existing/candidate surface without mutation. P10 proves exact parity only when a
surface existed before. P14 creates a B baseline and records:

- approval, repository/DDEV/Core identity, Git rollback, and affected Vite artifacts;
- specification snapshot, browser build, sitepackage commit, and feature enablement;
- tool inventory with side effects, sources of truth, annotations, sessions, and origins;
- deterministic tests and agent-eval outcomes;
- before/after HTTP, DOM, pixels, components, axe, Lighthouse, console, network, and logs;
- privacy/analytics decision and remaining experimental risks.

No origin-trial enrolment, staging/live deployment, or external-origin sharing is implied by a local
upgrade-run approval.

## Sources and licences

- W3C WebMCP security considerations: https://webmachinelearning.github.io/webmcp/#security-and-privacy-considerations
- Chrome secure tools: https://developer.chrome.com/docs/ai/webmcp/secure-tools
- Chrome best practices: https://developer.chrome.com/docs/ai/webmcp/best-practices
- Adapted general skill: https://github.com/Blackie360/webmcp-skill, Copyright (c) 2026 webmcp
  contributors, MIT License, snapshot `5f76ab5e53906ddea832d67fde6198585e35c5ea`.

Chrome documentation is CC-BY-4.0 and its samples Apache-2.0. The W3C report uses the W3C Software
and Document License. This reference paraphrases both.
