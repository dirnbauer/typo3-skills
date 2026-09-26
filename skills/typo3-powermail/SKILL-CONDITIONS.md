# Powermail Conditions: configure, inspect, verify

Use `in2code/powermail_cond`, extension key `powermail_cond` (not `powermail_condition`).
Resolve the [version line](references/v14-only-changes.md) before installation.

## Rule meaning: action on match, opposite action otherwise

Create one condition container for the form, add a condition targeting a field or fieldset,
and add at least one rule. Set `AND` or `OR` explicitly. Avoid duplicate containers and
competing conditions on the same target.

| Configuration | Rule true | Rule false |
|---|---|---|
| `actions = 0` (hide) | Hide target | Show target |
| `actions = 1` (unhide) | Show target | Hide target |

For **show Other details only when category = other**, use **unhide (1)** + **is (4)** +
`other`. A hide action with the same rule does the reverse. Compare stored option values,
not translated labels. Use separate conditions for separate targets.

Source: [Condition apply/negate](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Classes/Domain/Model/Condition.php).

## Operators and edge cases

| `ops` | Meaning in reviewed source | Pitfall |
|---|---|---|
| 0 / 1 | PHP nonempty / empty | String `"0"` is empty |
| 2 / 3 | Contains / does not contain static value | String substring; array membership; not strict equality |
| 4 / 5 | Strict equality / inequality with static string | Array-valued checkbox cannot equal a string |
| 6 / 7 | Greater / less after integer casts | Not decimal-safe; not input validation |
| 8 / 9 | Equal-field value contains / does not contain start-field value | Not an email/password equality check |

Operators 2–7 use `cond_string`; 8–9 use `equal_field`; 0–1 ignore the comparison string.
Use operator 2 for a checkbox option `shipping` in an array. For thresholds use validated
integers only. Test empty/zero/malformed values. The built-in contains implementation has
array/multiline edge cases; do not generalize string examples to arbitrary nested data.
For exact equality between two fields, use server-side validation or the fork-specific
[custom operator recipe](SKILL-EXAMPLES.md#custom-rule-operator-v14-fork-only).

Source: [Comparison](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Classes/Domain/Comparator/Comparison.php).

## Targets, relations and loops

Resolve real persisted UIDs before writing conditions:

- `target_field = "42"`: field UID 42.
- `target_field = "fieldset:5"`: page/fieldset UID 5.
- Container → `conditions` uses child foreign key `conditioncontainer`.
- Condition → `rules` uses child foreign key `conditions`.
- A rule references field UIDs through `start_field` and optionally `equal_field`.

Keep one owner per target. A hidden input's in-memory value can be cleared during evaluation;
that can change later rules. The engine iterates until the argument state stabilizes or
`conditionLoopCount` (default 100) is reached. Do not raise the limit to hide a cyclic rule
graph. Inspect `loops` and `loopLimit`; reaching the limit is a diagnostic warning, not proof
of convergence. The reviewed JS warning checks `loops > loopLimit`, so absence of its console
warning does not prove safety.

Source: [ConditionContainer](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Classes/Domain/Model/ConditionContainer.php),
[JavaScript](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Resources/Public/JavaScript/PowermailCondition.js).

## Frontend and endpoint integration

Include the shipped configuration. It supplies `PowermailCondition.js`, the
`data-condition-uri` element and a JSON endpoint with typeNum **3132**.
The reviewed v14 fork uses **USER_INT**; upstream v13 uses **USER**. Do not replace the
whole endpoint with an old copied snippet.

If the site already uses a PageType enhancer, merge this entry into its map:

```yaml
routeEnhancers:
  PageTypeSuffix:
    type: PageType
    map:
      condition.json: 3132
```

Preserve the site's existing default/index/suffix and mappings. Inspect the actual generated
URI; a JSON parser error often means a redirect, HTML error page or missing TypoScript.
Check the response shape `todo[formUid][pageUid][marker]["#action"]`, with `hide` or
`un_hide`; page-level actions omit the marker segment.

Keep the stock form classes/wrappers, hidden `powermail_form_uid`, field names and fieldset
classes when overriding Fluid. The script listens to eligible field `change` events,
initializes on `pageshow`, sets disabled/required attributes and toggles wrapper visibility.
Do not replace these mechanisms with CSS-only hiding.

### Exclude uploads from condition AJAX

Only when rules do **not** inspect upload fields, add this attribute to the existing
`f:form` attributes passed through the Powermail validation ViewHelper:

```html
additionalAttributes="{vh:validation.enableJavascriptValidationAndAjax(
    form: form,
    additionalAttributes: {'data-powermail-cond-excluded-fields': '.powermail_file'}
)}"
```

Preserve any other existing attributes. The implemented attribute is
`data-powermail-cond-excluded-fields`, **without** a `-selector` suffix (the README prose
disagrees with its own working example). This removes files from condition requests only;
verify the final multipart submission still includes the selected files.

### Optional prerendering

The fork provides `In2code\PowermailCond\ViewHelpers\ConditionsViewHelper` and reads
`#form-{form.uid}-actions` JSON to skip the first AJAX request. Do not blindly copy the
README's global hidden-fieldset CSS: failed JavaScript can leave the form inaccessible.
Before using raw JSON in a script element, inspect escaping, personalized/cache behavior,
duplicate form instances, CSP and the no-JavaScript fallback. Retain AJAX initialization
until those requirements are proved in the actual template.

## Validation and support boundaries

The extension XCLASSes `InputValidator` with `ConditionAwareValidator`. It overrides
**mandatory-field validation**, reading `tx_powermail_cond` session state; it does not
guarantee that every validator or custom business rule ignores a hidden field.
Check conflicting XCLASS registrations and test submission without a successful condition
request. Never trust hidden/disabled browser inputs for access control, prices or routing.

**Multistep forms and conditions do work together in the inspected implementation.**
Both upstream and fork have byte-identical `MoreStepForm.js` and `PowermailCondition.js`:
navigation skips a condition-hidden step, and the condition script toggles step controls
and field required/disabled state. This is shared upstream behavior, not a fork-added feature.
The blanket README incompatibility line is stale against this source and the executable
unit probe. Use the [wizard recipe](SKILL-EXAMPLES.md#multistep-with-conditional-fields-and-pages).

Respect the demonstrated limit: navigation skips **one** hidden neighbor, not a sequence of
hidden steps. Test consecutive/first/last hidden steps and conditions that hide the currently
active step. The unit probe demonstrates source behavior with DOM doubles; it does not certify
browser timing, validation, AJAX submission or mail delivery.

The reviewed condition TCA sets **versioningWS = false**. Do not promise workspace-aware
publication or add version columns by hand. See [workspace limits](references/15-workspace-support.md).

Sources: [mandatory validator](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Classes/Domain/Validator/ConditionAwareValidator.php),
[README conflicts](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/readme.md),
[condition TCA](https://github.com/dirnbauer/powermail_cond/tree/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Configuration/TCA).
