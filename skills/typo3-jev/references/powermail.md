# Jev with Powermail Conditions and mail routing

The addon is **`in2code/powermail_cond` / `powermail_cond`**, sometimes called
`powermail_condition`. Jev's semantic operators require the reviewed v14 fork's
`EvaluateRuleEvent`; ordinary comparisons do not. Read [setup](setup.md) before installing.
Use [the existing Powermail guide](../../typo3-powermail/SKILL-CONDITIONS.md) for condition
containers, shipped site sets, the `3132` JSON endpoint, mandatory fields and multistep limits.

## Wire an existing form

Create a persisted Jev decision, then one condition container for the existing form. Add a
condition for each target and select the Jev operator, decision and question in its rule.
Use an actual **start field** in the form even though Jev receives the collected context:
the underlying `Rule::applies()` dispatches the event only while visiting that field.
Keep it outside every target it can hide. Jev already registers the TCA items/listener;
do not register a second implementation for operators 100–105.

| `ops` | Compared question | Match | Gate |
|---|---|---|---|
| 100 | `choice` | ID equals expected ID | Decision confidence |
| 101 | `choice` | ID differs from expected ID | Decision confidence |
| 102 | `score` | Value **>=** threshold | Decision confidence |
| 103 | `score` | Value **<** threshold | Decision confidence |
| 104 | `noul` | Probability **>=** threshold | Probability only |
| 105 | `noul` | Probability **<** threshold | Probability only |

Despite its enum name `NoulAbove`, **104 includes equality**. Numeric operators accept decimals.
Keep probability thresholds in `[0, 1]` and score thresholds meaningful for the chosen rubric;
the rule's numeric TCA field is not a complete semantic validator. A wrong answer type or
missing value never matches, including operator 101.

The rule record uses `tx_webconjev_decision` (UID), `tx_webconjev_question` (name),
`tx_webconjev_expect` (choice ID), and `tx_webconjev_threshold` (number).
These are not the built-in comparator's `cond_string` setting.

Choose the **condition action**, not only its predicate:

| Action | Rule true | Rule false, including unavailable answer |
|---|---|---|
| `1` / unhide | Show target | Hide target |
| `0` / hide | Hide target | Show target |

The decision's default outcome is **not** substituted as a choice answer for visibility rules.
A fallback has no usable answer, so the condition follows its false branch.

## 1. Show bug-report details from a free-text message

Keep message field `message` visible. Create a `topic` choice with options `bug`, `question`,
`other`, confidence threshold `0.75`, and state template `Message: {{field.message}}`.
The [PHP factory](../examples/SupportDecision.php) shows the matching question definition.

Target the optional reproduction-details field or fieldset: **unhide (1)**, **AND**, source
`message`, **operator 100**, question `topic`, expected option **`bug`**.
A confident bug shows details; another category, low confidence or failure hides them. Keep
the basic message and submit path usable in every branch; do not make these optional details
the only way to submit a bug report.

Example rule-row values for an **existing** authorized decision/source pair:

```php
$ruleValues = [
    'title' => 'Jev identifies a bug report',
    'start_field' => $messageFieldUid,
    'ops' => 100,
    'tx_webconjev_decision' => $decisionUid,
    'tx_webconjev_question' => 'topic',
    'tx_webconjev_expect' => 'bug',
];
```

This is not a complete insert or runnable migration. Supply a valid storage PID and parent
relations through the backend or the project's authenticated DataHandler workflow. Reuse the
[condition datamap pattern](../../typo3-powermail/SKILL-EXAMPLES.md#programmatic-rule-payload),
substitute these Jev rule fields and set the matching target/action. Reject cross-form source
UIDs, duplicate containers and conflicting target rules before persisting anything.

## 2. Offer an optional callback block

Ask `callback` as `noul`: “Does the message explicitly request a telephone callback?”
Define yes/no meanings, use the same limited state template, and target a callback-preference
block with **unhide (1)**, source `message`, **operator 104**, threshold **0.70**.

For a numeric rule, the corresponding payload is:

```php
$ruleValues = [
    'title' => 'Jev suggests offering a callback',
    'start_field' => $messageFieldUid,
    'ops' => 104,
    'tx_webconjev_decision' => $decisionUid,
    'tx_webconjev_question' => 'callback',
    'tx_webconjev_threshold' => 0.70,
];
```

A probability of exactly `0.70` matches even when the decision threshold is `0.75` and the
DTO's derived confidence is only `0.40`. Missing answers do not match. Keep explicit manual
contact preferences available: this hint is not consent to call, and the model does not replace
an explicit visitor choice. Do not infer phone numbers or send all contact fields to Jev.

## 3. Display an advisory completeness hint

Ask `detail` as `score` with ordered levels: no usable detail, partial description, reproducible
description. Levels are positions 0…n-1, so threshold `2` is the third level. Use
**operator 103**, threshold `2`, decision confidence `0.75`, and **unhide (1)**
for a hint such as “You can add steps to reproduce the problem.” The numeric rule payload
above changes to `ops => 103`, question `detail`, threshold `2.0`.

A confident value `1.5` shows the hint; `2.0` does not. An uncertain/missing answer hides the
hint. Keep the rubric order stable and inspect the returned score/legend when testing. Never
hide the submit button, reject a submission, assign a price, or bypass a server-side validator
based on this advisory score. If a hint must always be visible on uncertainty, choose a rule
and its opposite action deliberately rather than treating fallback as “leave unchanged”.

## 4. Route a submitted enquiry to approved receivers

Use a **choice** question such as `department`, with stable option IDs and curated **outcome
values** containing approved receiver addresses. For example, map `technical` to the project's
support test mailbox and `general` to its enquiry test mailbox. Do not take an address from
visitor input or free-form model output. A syntactically valid email is not automatically an
authorized recipient.

On the Powermail form's **Jev routing** tab, select:

```php
$formValues = [
    'tx_webconjev_routing_decision' => $routingDecisionUid,
    'tx_webconjev_routing_question' => 'department',
];
```

Use an **empty default outcome** to retain the normal Powermail receiver on low confidence,
missing answers or service fallback. Alternatively set an explicitly approved triage address
as the default; that **replaces the receiver even on fallback**. A nonempty parsed address
list replaces the whole receiver array, not just one entry. Multiple addresses may be comma,
semicolon or newline separated. Start with one authorized mail-sink address while testing.

The replacement also overrides Powermail's `receiver.overwrite.email` TypoScript and its
Development-context `powermailDevelopContextEmail` redirect: Powermail applies both before it
dispatches the receiver event this listener uses, so test mail can reach real departments. While
testing, make every outcome value and the default a sink address, or sink at the mail transport.

This ships as two event listeners, **not a custom finisher**: the decision runs at
`FormControllerCreateActionAfterMailDbSavedEvent`, and recipients are applied at
`ReceiverMailReceiverPropertiesServiceSetReceiverEmailsEvent`. A normal finisher is too late
to choose that outgoing receiver. Inspect the installed Powermail event flow and verify the
actual confirmation/opt-in settings used by the project. A saved mail may receive the
`tx_webconjev_routing_summary` field when routing produced recipients.

### Routing event boundary

In the reviewed Powermail fork, the decision event is inside
`isMailPersistActive($hash)`: `(db.enable === '1' || optin enabled) && $hash === ''`.
This creates two concrete limits:

- With database persistence **off** and opt-in **off**, that event is skipped. The shipped
  Jev listener does not compute a receiver decision on that path.
- Opt-in confirmation forwards to `create` with a nonempty hash. That final-send path skips
  the decision event, and the first request's `RoutingDecisionStore` is only in memory.
  The stored summary is not a persisted recipient decision and is not restored by this listener.

Use an existing, authorized persisted **non-opt-in** fixture for the basic routing example.
Do not enable storage or disable opt-in just to make routing work: those change the site's
data and consent workflow. If the project needs either unsupported path, report this source
limitation and scope/test a suitable integration change separately. Do not claim all Powermail
submission modes work from a successful decision playground run.

## Request cost, loops and acceptance checks

The rule listener memoizes one outcome per **decision UID + form UID in the current request**.
It does not re-evaluate that decision when the condition engine clears hidden fields within
the same request. Do not build cycles in which Jev reads a value that its own conditions hide
or mutate. Reuse a decision for related rules with stable inputs; distinct requests/states can
still make separate external calls. This is not a guarantee of one call per browser interaction.

Test high/low/exact thresholds, wrong/missing question, disabled service, unavailable token,
timeout and a JSON-endpoint failure. Inspect `todo`, iteration counts, disabled/required state
and final submission. Test rapid edits, initial load, back navigation and every used language.
Use an authorized mail sink to verify routing on confident, low-confidence and fallback paths
with both empty and email-valued defaults. Offline probes do not establish browser timing,
TYPO3 event ordering, delivery or natural-language classification quality.

Sources: [pinned evidence index](source-review.md).
