# Review existing TYPO3 browser journeys

Use this reference for a reported defect or a bounded review of an existing journey suite.
Return findings and evidence to the caller; keep its deadline, retry budget and closure owner.
This reference adds no installation, deployment, publication or application-fix authority.

## Reproduce before changing the test

Record the observed build, approved local origin, fixture, role, language, browser, viewport,
steps, expected outcome and actual outcome. Separate an unknown input from a confirmed value.
Reproduce with the existing project command and preserve the first result.

When the reproduction is large, remove one step or fixture variation per attempt and confirm
that the same failure remains. Stop when the next removal loses it, or when the caller's budget
expires. Report the smallest confirmed reproduction, not an imagined root cause.

| Observation | Next bounded check | Report |
|---|---|---|
| Same inputs both pass and fail | Inspect timing, shared state and trace from both outcomes | Intermittent failure; no clean pass |
| Fails only for a locale, role or browser | Reproduce with that exact configuration | Configuration-specific defect |
| Fails only for particular content | Build an authorized disposable equivalent | Data-dependent defect |
| Cannot reproduce with available access | List configurations and attempts actually tried | Unresolved; missing evidence |

Do not repeat a failing test until it happens to pass. Planned diagnostic repetitions are
separate from infrastructure retries and must fit the caller's budget. A Playwright retry starts
a new worker after failure and may rerun setup; browser isolation does not reset server-side
records. Keep fixture setup/teardown safe on every attempt. See the official
[retry behavior](https://playwright.dev/docs/test-retries).

## Check requirements and test quality separately

Review these two questions without letting a good answer to one conceal a failure in the other:

1. **Required behavior:** which agreed user outcome, role, state transition or denial case is
   absent? Cite the project requirement or sealed assertion ID. Without a requirement, label the
   assumption and seek confirmation instead of inventing a release gate.
2. **Evidence quality:** does the implementation exercise the real local behavior and assert its
   consequence? Cite the test file and assertion. A returned 200, a notification or a screenshot
   can succeed while the promised state transition failed.

Example: an editor test verifies the success toast, but never reopens the record. If persistence
was required, report both the missing round-trip requirement coverage and the weak assertion.
Do not combine them into an unsupported conclusion that persistence actually fails.

Use auto-retrying locator assertions for asynchronous DOM outcomes; a one-time DOM read before
rendering settles can create a test failure unrelated to the requirement. Check installed APIs
against [Playwright assertions](https://playwright.dev/docs/test-assertions).

## Prove that the assertion discriminates

For a regression, capture a failure at the correct assertion on the known-broken implementation,
then an unchanged assertion passing with the authorized fix. A dependency/setup crash is not the
required failing observation. If the test was written after the fix, use an isolated authorized
checkout or an explicitly scoped fixture mutation to check it against the broken condition.
Never revert or stash unrelated work or alter the canonical upgrade dataset for this experiment.

For example, the second operation after an AJAX replacement needs its own outcome assertion:

```javascript
import { test, expect } from '@playwright/test';

test('a replaced filter still changes the result set', async ({ page }) => {
  // Local fixture: this route has a labelled Topic select and deterministic results.
  await page.goto('/qa-search/');
  const topic = page.getByRole('combobox', { name: 'Topic', exact: true });
  const results = page.getByTestId('search-results');

  await topic.selectOption('events');
  await expect(results.getByRole('link')).toHaveText(['Local event']);

  await topic.selectOption('news');
  await expect(results.getByRole('link')).toHaveText(['Local news']);
});
```

This is a fixture-dependent pattern, not a test executed against a TYPO3 installation here.
Adapt the route, labels, IDs and expected result list to observed project markup and fixture data.
The local handler remains real. A test-specific ID belongs in project markup only when that
change is authorized; prefer an existing stable accessible locator where it identifies the list.
The locator is resolved for each operation rather than retaining a removed DOM element; see
[Playwright best practices](https://playwright.dev/docs/best-practices).

## Order by risk; retain the coverage contract

Run the affected journey and its permission/error cases first. Next prioritize critical flows,
roles and languages using observed incidents and the actual change footprint. Treat numerical
risk scores or test-layer ratios as project choices, not universal facts.

Risk ordering changes the diagnostic sequence, not mandatory final coverage. Do not drop sealed
assertions, reclassify unexpected skips, relax parity, refresh a baseline or quarantine a required
journey to obtain closure. Pure PHP logic belongs to `typo3-testing`; keep browser coverage for the
user-visible integration. `typo3-upgrade-closure` alone decides the upgrade verdict.

## Handover

Return requirement/assumption, assertion ID, reproduction command and exit code, expected versus
actual outcome, evidence location, classification and smallest missing next check. Keep red and
green receipts separate. Redact private data before sharing artifacts. Follow the main skill's
coverage accounting and resource controls; do not start another unbounded repair loop.

## Source notes and thanks

These are collection-owned instructions and an original example, informed by the useful
reproduction discipline in [Petr Kindlmann's QA Skills](https://github.com/petrkindlmann/qa-skills/blob/b3bb61bd268b147476252c6ed5a0440c87b97441/skills/bug-reproduction/SKILL.md)
and the separate review dimensions in [Matt Pocock's code-review skill](https://github.com/mattpocock/skills/blob/c55ee46073ed923f86ce59a5eb3b6d895095d1b7/skills/engineering/code-review/SKILL.md).
Thank you to both authors for publishing concrete, inspectable workflows. Their repositories
retain their respective MIT licences and copyright notices; no upstream files are vendored here.
Runtime statements above were checked against the linked Playwright documentation on 2026-09-26;
the project-specific journey and behavioral effectiveness still require real project trials.
