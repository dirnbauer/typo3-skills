<?php
declare(strict_types=1);

require dirname(__DIR__) . '/examples/ConditionDataMap.php';

use Vendor\SitePackage\Powermail\ConditionDataMap;

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$data = ConditionDataMap::otherDetails(8, 12, 21, 22);
$container = $data['tx_powermailcond_domain_model_conditioncontainer']['NEW_pm_condition_container'];
$condition = $data['tx_powermailcond_domain_model_condition']['NEW_pm_other_condition'];
$rule = $data['tx_powermailcond_domain_model_rule']['NEW_pm_other_rule'];
check($container['conditions'] === 'NEW_pm_other_condition', 'Container must own its child relation.');
check($condition['rules'] === 'NEW_pm_other_rule', 'Condition must own its child relation.');
check($condition['actions'] === 1 && $rule['ops'] === 4, 'Show-on-equality must not be inverted.');
check($condition['target_field'] === '22' && $rule['start_field'] === 21, 'Resolve persisted UIDs.');
check($rule['cond_string'] === 'other', 'Compare stored option values.');
foreach ([[0, 12, 21, 22], [8, 12, 21, 21]] as $invalid) {
    try {
        ConditionDataMap::otherDetails(...$invalid);
        throw new RuntimeException('Invalid fixture was accepted.');
    } catch (InvalidArgumentException) {
        // Expected.
    }
}
echo "PASS: seven payload/guard checks; no TYPO3 database writes or integration coverage.\n";
