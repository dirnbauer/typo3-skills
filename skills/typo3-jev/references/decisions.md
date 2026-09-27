# Decision design and PHP API

## Model the decision, not a prompt for arbitrary output

In **Administration → Jev decisions**, create a decision with a stable identifier, an explicit
state template, a fallback, a confidence threshold and the questions actually needed. Keep option
IDs, question names and types stable when translating descriptions/instructions.
This module edits live records; use the backend's record editor for translations.

A translation may still override the state template, the default outcome and each option's
outcome value (a routing address): the decision is loaded in the request language. Review every
language as its own data selection and recipient list.

| Type | Criteria | Returned value | Appropriate use |
|---|---|---|---|
| `choice` | At least two options keyed by stable ID | Selected ID and confidence | Request category or approved queue |
| `score` | At least two rubric levels, lowest to highest | Numeric position, possibly fractional, and confidence | Advisory completeness hint |
| `noul` | Optional `yes`/`no` descriptions | Yes-probability | Offer an optional callback block |

The [SupportDecision factory](../examples/SupportDecision.php) defines a topic choice,
an ordered detail rubric and a callback probability. It is a pure PHP example: `uid: 0`
does not create a backend record. Powermail rule selectors require a **persisted** decision
UID; reproduce the relevant definition in the module or an authorized DataHandler workflow.
Remove unused questions instead of asking all three for every task.

Use context shaped like `['field' => ['message' => $message]]` with the state template
`Message: {{field.message}}`. Dotted placeholders only interpolate values; they are not Fluid
or executable expressions. An unknown path becomes an empty string, so a typo can silently
remove required context. Test the rendered state before a live request.

An empty state template sends the collected context after empty values are pruned. The two
Powermail collectors skip `password`, `file`, `captcha` and `friendlycaptcha` field types;
custom PHP callers do not pass through these collectors. Select approved input fields in
both paths. A template limits fields but does not remove sensitive text inside a chosen field.
Treat submitted text as data, not permission to change recipients, instructions or destinations.

## Run stored decisions through the service layer

An integration service can use constructor injection as below. Resolve the namespace/service
configuration in the actual sitepackage, and choose the required language explicitly:

```php
<?php
declare(strict_types=1);

namespace Vendor\SitePackage\Jev;

use Webconsulting\WebconJev\Domain\Repository\DecisionRepository;
use Webconsulting\WebconJev\Service\DecisionRunner;

final readonly class SuggestSupportQueue
{
    public function __construct(
        private DecisionRepository $decisions,
        private DecisionRunner $runner,
    ) {}

    public function suggest(string $approvedMessage, int $languageId = 0): string
    {
        $decision = $this->decisions->findByIdentifier('support_assistance', $languageId);
        if ($decision === null) {
            return 'review';
        }
        $outcome = $this->runner->run(
            $decision,
            ['field' => ['message' => $approvedMessage]],
            'sitepackage_support',
        );
        // Test the particular question, not the aggregate needsHumanReview() flag.
        if ($outcome->confidentAnswer('topic') === null) {
            return 'review';
        }
        $queue = $outcome->outcomeFor('topic');
        return in_array($queue, ['bug_queue', 'help_queue', 'review'], true) ? $queue : 'review';
    }
}
```

This suggests a label; it neither sends mail nor authorizes actions. Calling it may contact the
API. For a code-defined decision, pass `SupportDecision::make()` to the same runner; it receives
the normal settings, caching, modeled-failure fallback and run logging. Use short, stable
context/origin labels rather than visitor content.

`JevClientInterface::ask()` is the lower-level transport: it does not supply the runner's cache,
budget guard, decision mapping or logging workflow. Use it only when intentionally implementing
those policies yourself. Keep fallback handling at the appropriate application boundary and
test infrastructure failures; the runner catches `JevException` from the client, not every
possible cache, database, logging or serialization exception.

## Interpret results deliberately

- `answer('topic')` returns a possibly uncertain answer; `confidentAnswer('topic')` applies
  the decision threshold, **inclusive** at the boundary.
- `outcomeFor('topic')` returns the matching criterion's nonempty outcome value. Missing,
  low-confidence, unknown, unmapped or non-choice answers return `defaultOutcome`.
- `isFallback()` identifies a fallback result, not every weak answer. A successful API response
  can be low confidence with `isFallback() === false`.
- `needsHumanReview()` becomes false if **any** answer clears the threshold. It does not prove
  that a particular routing question is usable.
- For `noul`, absent an explicit response confidence, the DTO derives
  `abs(probability - 0.5) * 2`. This is the extension's calculation, not a calibration guarantee.
  Powermail's noul operators intentionally use the probability without this second gate.

Test synthetic high/low/boundary confidence, unknown choice IDs, missing questions, malformed
definitions, timeout and disabled service. Assert deterministic handling of the typed response,
not that every natural-language example always receives a particular model answer.

Sources and executable checks: [evidence index](source-review.md).
