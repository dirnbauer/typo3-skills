# Powermail Conditions: practical recipes

Read [rule semantics](SKILL-CONDITIONS.md) first. These are bounded configuration/code
examples, not a database seed or proof of legal compliance. Create the form and fields in the
backend; adapt existing project provisioning only through an authorized DataHandler workflow.
Keep stored values stable across translations.

## Other details

For select marker `category`, configure editor options:

```text
Please choose|
Support|support
Sales|sales
Other|other
```

Target input `other_details`: action **unhide (1)**; conjunction **AND**; source
`category`; operator **is (4)**; value `other`. The field is hidden for empty, support
and sales, and visible for other. Mark it mandatory if it is required only while visible.
Test the server-side mandatory behavior after a completed conditions request.

## Business details with OR

Select `customer_type`: `Private|private`, `Company|company`, `Association|association`.
Target `organization_name`: **unhide (1)**, **OR**, two rules: `customer_type is company`
and `customer_type is association`. Do not express mutually exclusive select values with AND.

Business form details are a project data requirement, not an Austrian legal checklist.
Do not collect capital, officers or registration data unless the actual process needs them.

## Checkbox-dependent delivery fieldset

Create checkbox group `delivery_options` with option `Ship to another address|shipping`.
Target the address page UID as `fieldset:123`: **unhide (1)**, **AND**, source
`delivery_options`, operator **contains value (2)**, value `shipping`.
The checkbox produces array values, so operator 4 is the wrong comparison.
Keep the triggering checkbox outside the target fieldset. Test none, shipping and mixed selections.

## Two prerequisites with AND

Show `callback_time` only when `contact_method is phone` **AND** `phone is set`.
Use **unhide (1)** and **AND**. Keep `phone` outside the target.
Do not use this visibility rule as phone-number validation: configure that separately.

## Integer threshold

Show `group_details` when `attendees > 9`: **unhide (1)**, operator **greater than (6)**,
comparison string `9`. Validate attendees as an allowed integer/range on the server.
Test 0, 9, 10, blank and malformed values. The built-in comparator casts to integer;
do not use it for prices, decimal quantities or age verification.

## Multistep with conditional fields and pages

Use the existing Powermail multistep mode; both upstream and the reviewed forks implement
condition-aware navigation. It is not a newly invented fork capability.
For a three-step enquiry wizard:

1. **Request:** `category`, `contact_method` and delivery choice.
2. **Details:** conditional `other_details`, `callback_time`, address fields.
3. **Review/send:** existing review content and submit.

Enable using **setup** (or the corresponding editor option; verify effective settings):

```typoscript
plugin.tx_powermail.settings.setup.main.moresteps = 1
plugin.tx_powermail.settings.setup.validation.morestep.fieldset = 1
```

The key is `moresteps`, not `morestep` under `main`. Keep stock navigation attributes,
form/wrapper classes and validation initialization when overriding templates.
Use the recipes above within the details step. To omit that entire step, add a page-targeted
condition controlled by a value in the request step. Keep first and final steps available.

The inspected navigation skips one condition-hidden neighbor. Do not design consecutive
optional pages without addressing and testing that limit. Also test changing a condition while
its target page is active, previous/next direction, direct step controls and invalid input.
Do not call the full wizard verified just because a source unit test passes.

Run the source probe against the exact installed sources or reviewed clones:

```bash
node skills/typo3-powermail/scripts/check-multistep.mjs /path/to/powermail /path/to/powermail_cond
```

It tests shared JS with DOM doubles and reports the consecutive-hidden-step limit; it does not
start TYPO3 or a real browser.

## Custom rule operator (v14 fork only)

Unlike multistep, the reviewed conditions fork explicitly adds `EvaluateRuleEvent` for
operator values >= 100. Inspect installed code before using this API; public upstream lacks it.
Reserve an unused project operator number, for example **120**, and avoid collisions with
other integrations. For exact equality between two scalar fields, use the listener in
[ExactFieldMatchListener.php](examples/ExactFieldMatchListener.php).
`webcon_jev` already uses **100–105**. For semantic classification, callback offers,
advisory detail scores and recipient routing, use its
[existing operators and examples](../typo3-jev/references/powermail.md) instead of inventing a listener.

Register operator 120 in your sitepackage's
`Configuration/TCA/Overrides/tx_powermailcond_domain_model_rule.php`:

```php
<?php
declare(strict_types=1);

use TYPO3\CMS\Core\Utility\ExtensionManagementUtility;

ExtensionManagementUtility::addTcaSelectItem(
    'tx_powermailcond_domain_model_rule',
    'ops',
    ['label' => 'Exactly equals another field', 'value' => 120],
);
// Show the comparison-field selector for this custom operator too.
$GLOBALS['TCA']['tx_powermailcond_domain_model_rule']['columns']['equal_field']['displayCond']
    = 'FIELD:ops:IN:8,9,120';
```

Register the invokable listener in `Configuration/Services.yaml`:

```yaml
services:
  Vendor\SitePackage\EventListener\ExactFieldMatchListener:
    tags:
      - name: event.listener
        identifier: sitepackage/powermail-exact-field-match
```

Use source and equal fields with scalar input values. The listener ignores other operators,
declines already-handled events and returns false for an empty source. Test blank, exact,
substring and different inputs. This custom visibility operator still does not reject a final
submission; use [server-side custom validation](references/05-custom-validators.md) for that.

## Programmatic rule payload

The [ConditionDataMap.php](examples/ConditionDataMap.php) example builds a **pure datamap**
for one existing form/source/target field. Supply actual authorized UIDs and an existing
storage PID, verify all three records belong to the same form, and reject an existing container
before use. It does not perform database writes or disable access checks.

Create a fresh DataHandler in a properly authenticated backend/CLI context:

```php
$data = \Vendor\SitePackage\Powermail\ConditionDataMap::otherDetails(
    $storagePid, $formUid, $categoryFieldUid, $detailsFieldUid,
);
$dataHandler = \TYPO3\CMS\Core\Utility\GeneralUtility::makeInstance(
    \TYPO3\CMS\Core\DataHandling\DataHandler::class,
);
$dataHandler->start($data, []);
$dataHandler->process_datamap();
if ($dataHandler->errorLog !== []) {
    throw new \RuntimeException('Condition creation failed; inspect the protected error log.');
}
$containerUid = $dataHandler->substNEWwithIDs['NEW_pm_condition_container'] ?? null;
```

Do not paste this into unauthenticated frontend code. Follow `typo3-datahandler` for CLI
bootstrap, permissions, error handling and repeat-safe creation. Record created UIDs and a
rollback plan; DataHandler processing is not a promised all-or-nothing transaction.

## Browser acceptance test

Adapt the URL, labels and visible states to an authorized local fixture. Use the project's
existing Playwright setup and an actual condition response; do not mock the endpoint for
an integration claim.

```javascript
import {test, expect} from '@playwright/test';

test('Other details follows the selected category', async ({page}) => {
  await page.goto('/contact');
  const category = page.getByLabel('Category', {exact: true});
  const details = page.getByLabel('Other details', {exact: true});
  const selectAndWait = async value => {
    const response = page.waitForResponse(r =>
      r.request().method() === 'POST' &&
      new URL(r.url()).pathname.endsWith('/condition.json'));
    await category.selectOption(value);
    expect((await response).ok()).toBeTruthy();
  };
  await selectAndWait('support');
  await expect(details).toBeHidden();
  await selectAndWait('other');
  await expect(details).toBeVisible();
  await expect(details).toBeEnabled();
  await selectAndWait('sales');
  await expect(details).toBeHidden();
});
```

Wait for initial condition evaluation to finish before exercising this helper, and correlate
each request's submitted category if the page can issue overlapping requests; otherwise the
initial response can satisfy the matcher. Adjust the matcher for `?type=3132` sites.
Add the real wizard's previous/next
actions, required-field errors, rapid change-and-submit, upload exclusion, two forms on one
page, translations and no-JS/network-failure cases. Inspect the final payload and mail sink;
this visibility example alone does not test submission.

Source anchors and test status: [evidence report](../../catalog/powermail-source-review.md).
