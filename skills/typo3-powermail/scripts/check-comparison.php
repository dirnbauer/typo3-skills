<?php
declare(strict_types=1);

// Load actual comparator/rule source; tiny model doubles are not TYPO3 integration proof.
namespace TYPO3\CMS\Extbase\DomainObject {
    class AbstractEntity {}
}
namespace In2code\Powermail\Domain\Model {
    final class Field
    {
        public function __construct(private string $text) {}
        public function getText(): string { return $this->text; }
    }
}
namespace {
    use In2code\Powermail\Domain\Model\Field;
    use In2code\PowermailCond\Domain\Comparator\Comparison;

    $clone = $argv[1] ?? '';
    if (!is_dir($clone . '/Classes/Domain')) {
        throw new RuntimeException('Usage: php check-comparison.php /clone/powermail_cond');
    }
    require $clone . '/Classes/Domain/Model/Rule.php';
    require $clone . '/Classes/Domain/Comparator/Comparison.php';
    $cases = [
        [0, '0', '', null, false],
        [1, '0', '', null, true],
        [4, 'other', 'other', null, true],
        [4, 'Other', 'other', null, false],
        [2, '["shipping","pickup"]', 'shipping', null, true],
        [4, '["shipping"]', 'shipping', null, false],
        [6, '10', '9', null, true],
        [6, '12.9', '12.1', null, false],
        [8, 'a@example.org', '', 'long-a@example.org', true],
        [8, 'long-a@example.org', '', 'a@example.org', false],
        [9, 'a@example.org', '', 'other@example.org', true],
    ];
    foreach ($cases as $index => [$operator, $left, $match, $right, $expected]) {
        $actual = (new Comparison($operator))->evaluate(
            new Field($left),
            $match,
            $right === null ? null : new Field($right),
        );
        if ($actual !== $expected) {
            throw new RuntimeException('Comparator source changed at case ' . $index);
        }
    }
    echo "PASS: 11 real-comparator probes with model doubles; no TYPO3 integration coverage.\n";
}
