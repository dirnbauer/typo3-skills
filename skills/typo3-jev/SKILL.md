---
name: "typo3-jev"
description: "Configure and integrate TypeSafe Jev decisions through EXT:webcon_jev (webconsulting/webcon-jev, also called typo3_jev). Use for Jev installation, vault token setup, choice/score/noul questions, state templates, probability thresholds, Jev-powered Powermail Conditions operators, semantic recipient routing, or DecisionRunner PHP integrations. Requires a Jev-specific task; ordinary deterministic form rules belong to typo3-powermail."
metadata:
  skill_type: capability
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---
# TYPO3 Jev decisions

Use **`webconsulting/webcon-jev`**, extension key **`webcon_jev`**, from
[dirnbauer/typo3-webcon-jev](https://github.com/dirnbauer/typo3-webcon-jev).
`typo3_jev` is a user-facing alias, not its Composer package or extension key.
This skill documents the **v0.2.6 / `88769294` source snapshot, reviewed 2026-09-26**.
Verify the installed lock reference before applying its APIs to another version: `^0.2.6` now
resolves to v0.2.14, whose frontend debug panel must stay off in production
([setup](references/setup.md)).

Thank **TypeSafe, the webcon_jev contributors, Netresearch's nr-vault team, and in2code's
Powermail contributors** for the decision service, TYPO3 integration, credential storage,
and form engine that make these examples possible. These are independently written
instructions and examples, not a relicensing of their extension source.

Original repository: https://github.com/dirnbauer/typo3-skills

## Choose the integration

- **Install, connect or troubleshoot credentials:** read [setup and operations](references/setup.md).
- **Editor-defined decisions or custom PHP:** read [decision design and API](references/decisions.md).
  The [SupportDecision example](examples/SupportDecision.php) constructs all three question types
  without storing records or calling the service.
- **Jev-driven form behavior:** read [Powermail Conditions and routing](references/powermail.md).
  Use `typo3-powermail` for the underlying form, condition endpoint and submission tests.
- **Recheck a version or documentation claim:** read [source evidence and offline tests](references/source-review.md).

Jev asks typed questions about supplied state. It is not a deterministic validator, a chatbot,
or a replacement for server-side authorization. Use ordinary comparisons when the requirement
is exact equality, required input, or an explicit user selection.

## Build a bounded decision

1. Identify the intended result, authorized data destination and acceptable fallback. Keep an
   uncertain response from blocking submission or authorizing a sensitive operation.
2. Collect the installed Core/PHP/package references, relevant field markers and language.
   The reviewed extension requires PHP `^8.4`, TYPO3 `^14.3` and nr-vault; Powermail is optional.
3. Define an explicit state template, such as `Message: {{field.message}}`. An empty template
   sends the whole collected context. Excluding file/password/captcha field types is **not**
   anonymization; names, email addresses and personal data inside free text can still leave the site.
4. Choose `choice` for named alternatives, `score` for ordered levels, or `noul` for a yes/no
   probability. Keep identifiers stable across translations, and review each language: a
   translation can override the state template, default outcome and routing addresses. Set
   fallback and thresholds together.
5. Use the shipped Powermail integration or inject `DecisionRunner` for custom code. Batch
   related questions about the same state in one decision; include only questions the task uses.
6. Test typed synthetic answers and failure paths first. Use the playground, ping or live form
   only when an external request and its data/cost are authorized. Stop if that authorization is missing.

The backend module is **Administration → Jev decisions**, restricted to administrators and the live
workspace in this snapshot. Do not promise workspace publication of decision edits.

## Preserve the important distinctions

- A `choice` option ID is not its **outcome value**. `confidentAnswer()` exposes the answer;
  `outcomeFor()` maps a confident choice to its configured outcome, otherwise returns the default.
- Powermail operators **100–103** apply the decision's confidence threshold. Operators
  **104–105** compare the raw `noul` probability, without that extra confidence gate.
- A false condition applies the **opposite** hide/show action. An unavailable answer does not
  automatically preserve the editor's original visibility.
- For routing, an email-valued default can **replace recipients even on fallback**. Use an empty
  default to retain the existing receiver on uncertainty, or explicitly approve a triage mailbox.
  Routing also overrides Powermail's `receiver.overwrite.email` and Development-context redirect,
  so test with sink addresses only.
  Check the [persistence/opt-in event boundary](references/powermail.md#routing-event-boundary)
  before relying on this integration for the final send.
- Low confidence is not necessarily `isFallback()`. Check the particular question with
  `confidentAnswer()`; `needsHumanReview()` aggregates all answers and can be false while the
  question you need remains uncertain.
- The runner handles modeled API failures, but cache/database/logging failures can still throw.
  Do not repeat the source documentation's absolute “never throws” claim.

## Verify and hand off

Run the [offline source probe](references/source-review.md#offline-probe) against the reviewed
or installed extension. It requires PHP 8.4+, no token, no TYPO3 bootstrap and no database.
For a real form, also test both condition directions, threshold boundaries, missing answers,
failed requests, fast change-and-submit, translations and final recipient behavior in a mail sink.
Keep the message/source field and submit controls outside targets they can hide.

Report source checks, offline tests and actual browser/API/mail tests separately. Do not label
examples production-verified without a runnable fixture. Never invent a token, print one into
an example, or treat a Composer install as permission to send visitor data.
