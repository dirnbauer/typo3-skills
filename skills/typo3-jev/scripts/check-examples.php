<?php
declare(strict_types=1);

/**
 * Offline source probe. Load only Jev classes from a trusted checkout/package, never its
 * Composer bootstrap. No tokens, API calls, TYPO3 bootstrap, database access or file writes.
 * The reflection probe covers one pure private selector, not full event dispatch.
 */
use Vendor\SitePackage\Jev\SupportDecision;
use Webconsulting\WebconJev\Client\Dto\Answer;
use Webconsulting\WebconJev\Client\Dto\DecisionResult;
use Webconsulting\WebconJev\Client\Dto\Question;
use Webconsulting\WebconJev\Client\Dto\QuestionType;
use Webconsulting\WebconJev\Client\Dto\Usage;
use Webconsulting\WebconJev\Domain\Model\Decision;
use Webconsulting\WebconJev\Exception\InvalidQuestionException;
use Webconsulting\WebconJev\Powermail\JevOperator;
use Webconsulting\WebconJev\Powermail\JevRuleListener;
use Webconsulting\WebconJev\Service\DecisionOutcome;
use Webconsulting\WebconJev\Service\StateBuilder;

if (PHP_VERSION_ID < 80400) {
    fwrite(STDERR, "Use PHP 8.4+; the reviewed extension requires it.\n");
    exit(2);
}
if ($argc !== 2 || ($jevRoot = realpath($argv[1])) === false
    || !is_file($jevRoot . '/Classes/Powermail/JevOperator.php')) {
    fwrite(STDERR, "Usage: php check-examples.php /trusted/path/to/webcon-jev\n");
    exit(2);
}

spl_autoload_register(static function (string $class) use ($jevRoot): void {
    $prefix = 'Webconsulting\\WebconJev\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $file = $jevRoot . '/Classes/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require_once $file;
    }
});
require_once dirname(__DIR__) . '/examples/SupportDecision.php';

$checks = 0;
$same = static function (mixed $expected, mixed $actual, string $label) use (&$checks): void {
    if ($expected !== $actual) {
        throw new RuntimeException('FAIL: ' . $label);
    }
    ++$checks;
};
$decision = SupportDecision::make();
$stateBuilder = new StateBuilder();
$questions = $decision->toClientQuestions();
$same(['topic', 'detail', 'callback'], array_keys($questions), 'related questions in one decision');
$same(0, $decision->uid, 'factory does not claim a persisted record');
$same('choice', $questions['topic']->toPayload()['type'], 'topic payload type');
$same(['bug', 'question', 'other'], array_keys($questions['topic']->toPayload()['criteria']), 'stable choice IDs');
$same(true, array_is_list($questions['detail']->toPayload()['criteria']), 'ordered score rubric');
$same('No usable description of the problem', $questions['detail']->toPayload()['criteria'][0], 'lowest level first');
$same(['yes', 'no'], array_keys($questions['callback']->toPayload()['criteria']), 'noul meanings');
$same('Message: The preview is blank.', $stateBuilder->build($decision, [
    'form' => ['uid' => 42, 'title' => 'Support'],
    'field' => ['message' => 'The preview is blank.', 'email' => 'synthetic@example.invalid'],
]), 'state template excludes unrelated email and form metadata');
$same('Missing: ', $stateBuilder->render('Missing: {{field.typo}}', ['field' => ['message' => 'text']]), 'unknown placeholder is empty');

$outcome = static fn(array $answers): DecisionOutcome => new DecisionOutcome(
    $decision,
    new DecisionResult($answers, 'offline-fixture', new Usage()),
);
$choice = static fn(string $id, float $confidence): Answer => Answer::fromResponse(
    'topic', QuestionType::Choice, ['choice' => $id, 'confidence' => $confidence],
);
$score = static fn(float $value, float $confidence): Answer => Answer::fromResponse(
    'detail', QuestionType::Score, ['score' => $value, 'confidence' => $confidence],
);
$noul = static fn(float $value): Answer => Answer::fromResponse('callback', QuestionType::Noul, ['noul' => $value]);

// Exercise the installed listener's actual confidence/probability selection, without its
// repositories/runner and without simulating a full TYPO3 event or network request.
$listener = (new ReflectionClass(JevRuleListener::class))->newInstanceWithoutConstructor();
$selector = new ReflectionMethod(JevRuleListener::class, 'usableAnswer');
$matches = static function (DecisionOutcome $result, JevOperator $operator, string $question, string $expected)
    use ($listener, $selector): bool {
    $answer = $selector->invoke($listener, $result, $operator, $question);
    return $answer !== null && $operator->matches($answer, $expected);
};

$confident = $outcome(['topic' => $choice('bug', 0.9)]);
$same('bug_queue', $confident->outcomeFor('topic'), 'choice outcome is mapped queue, not option ID');
$same(true, $matches($confident, JevOperator::ChoiceIs, 'topic', 'bug'), 'bug details match');
$same(true, $matches($confident, JevOperator::ChoiceIs, 'topic', ' bug '), 'comparison trims expected ID');
$same(false, $matches($confident, JevOperator::ChoiceIs, 'topic', 'question'), 'different choice does not match');
$same(true, $matches($confident, JevOperator::ChoiceIsNot, 'topic', 'question'), 'negative choice comparison');
$same(false, $matches($confident, JevOperator::ChoiceIsNot, 'topic', 'bug'), 'negative comparison excludes same option');
$boundary = $outcome(['topic' => $choice('bug', 0.75)]);
$same(true, $matches($boundary, JevOperator::ChoiceIs, 'topic', 'bug'), 'confidence boundary inclusive');
$weak = $outcome(['topic' => $choice('bug', 0.74)]);
$same(false, $matches($weak, JevOperator::ChoiceIs, 'topic', 'bug'), 'low confidence does not show bug details');
$same('review', $weak->outcomeFor('topic'), 'low confidence uses decision default');
$same(false, $weak->isFallback(), 'low confidence is not the fallback flag');
$same(true, $weak->needsHumanReview(), 'only weak answer needs review');
$mixed = $outcome(['topic' => $choice('bug', 0.2), 'detail' => $score(2.0, 0.95)]);
$same(false, $mixed->needsHumanReview(), 'aggregate review flag is cleared by another confident answer');
$same(null, $mixed->confidentAnswer('topic'), 'specific routing answer remains unusable');
$same('review', $outcome(['topic' => $choice('unknown', 0.99)])->outcomeFor('topic'), 'unknown choice maps to default');
$same(null, $outcome([])->answer('topic'), 'missing question stays missing');
$same(false, $matches($outcome([]), JevOperator::ChoiceIsNot, 'topic', 'bug'), 'missing question does not match inequality');

$partial = $outcome(['detail' => $score(1.5, 0.9)]);
$same(true, $matches($partial, JevOperator::ScoreBelow, 'detail', '2'), 'fractional score shows advisory hint');
$same(false, $matches($partial, JevOperator::ScoreAtLeast, 'detail', '2'), 'fractional score stays below');
$complete = $outcome(['detail' => $score(2.0, 0.9)]);
$same(false, $matches($complete, JevOperator::ScoreBelow, 'detail', '2'), 'score below is strict');
$same(true, $matches($complete, JevOperator::ScoreAtLeast, 'detail', '2'), 'score at least is inclusive');
$same(false, $matches($outcome(['detail' => $score(1.5, 0.7)]), JevOperator::ScoreBelow, 'detail', '2'), 'score needs confidence');
$same('review', $complete->outcomeFor('detail'), 'score is not a choice outcome');
$same(false, $matches($confident, JevOperator::ScoreAtLeast, 'topic', '0'), 'wrong answer type cannot match');

$callback = $outcome(['callback' => $noul(0.7)]);
$same(null, $callback->confidentAnswer('callback'), 'derived noul confidence is below decision threshold');
$same(true, abs($callback->answer('callback')->confidence - 0.4) < 0.00001, 'noul derived confidence formula');
$same(true, $matches($callback, JevOperator::NoulAbove, 'callback', '0.7'), 'noul uses probability and includes equality');
$same(false, $matches($callback, JevOperator::NoulBelow, 'callback', '0.7'), 'noul below is strict');
$same(true, $matches($outcome(['callback' => $noul(0.69)]), JevOperator::NoulBelow, 'callback', '0.7'), 'probability below boundary');
$same(true, $matches($outcome(['callback' => $noul(0.17)]), JevOperator::NoulBelow, 'callback', '0.4'), 'noul below is not filtered by derived confidence');
$same(false, $matches($outcome([]), JevOperator::NoulAbove, 'callback', '0'), 'no probability is not zero probability');

$missingChoice = Answer::fromResponse('topic', QuestionType::Choice, ['confidence' => 1.0]);
$same(false, JevOperator::ChoiceIsNot->matches($missingChoice, 'bug'), 'missing value cannot match inequality');
$fallback = new DecisionOutcome($decision, DecisionResult::fallback('offline simulated outage'));
$same(true, $fallback->isFallback(), 'modeled failure sets fallback flag');
$same('review', $fallback->outcomeFor('topic'), 'fallback uses configured outcome');
$same(false, $matches($fallback, JevOperator::ChoiceIs, 'topic', 'review'), 'default outcome is not a synthetic visibility answer');

foreach (['', 'triage@example.org'] as $default) {
    $routingDecision = Decision::fromRow([
        'confidence_threshold' => 0.75,
        'default_outcome' => $default,
    ], $decision->questions);
    $routingFallback = new DecisionOutcome($routingDecision, DecisionResult::fallback('offline fixture'));
    $same($default, $routingFallback->outcomeFor('topic'), 'routing default passes through even on fallback');
    $routingWeak = new DecisionOutcome($routingDecision, $weak->result);
    $same($default, $routingWeak->outcomeFor('topic'), 'routing default passes through on low confidence');
}

try {
    new Question('invalid', QuestionType::Choice, 'Pick one', ['only' => 'Insufficient options']);
    throw new RuntimeException('FAIL: incomplete choice definition was accepted');
} catch (InvalidQuestionException) {
    ++$checks;
}

printf("%d offline checks passed against %s\n", $checks, $jevRoot);
fwrite(STDOUT, "No API/DB/browser/mail integration was executed.\n");
