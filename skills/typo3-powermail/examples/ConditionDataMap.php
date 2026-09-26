<?php
declare(strict_types=1);

namespace Vendor\SitePackage\Powermail;

/** Pure payload builder; the caller owns authorization, existence and duplicate checks. */
final class ConditionDataMap
{
    public static function otherDetails(
        int $storagePid,
        int $formUid,
        int $categoryFieldUid,
        int $detailsFieldUid,
    ): array {
        if (min($storagePid, $formUid, $categoryFieldUid, $detailsFieldUid) < 1) {
            throw new \InvalidArgumentException('Pass persisted, positive record UIDs.');
        }
        if ($categoryFieldUid === $detailsFieldUid) {
            throw new \InvalidArgumentException('Do not hide the source of its own condition.');
        }
        return [
            'tx_powermailcond_domain_model_conditioncontainer' => [
                'NEW_pm_condition_container' => [
                    'pid' => $storagePid,
                    'title' => 'Enquiry conditions',
                    'form' => $formUid,
                    'conditions' => 'NEW_pm_other_condition',
                ],
            ],
            'tx_powermailcond_domain_model_condition' => [
                'NEW_pm_other_condition' => [
                    'pid' => $storagePid,
                    'title' => 'Other details',
                    'target_field' => (string)$detailsFieldUid,
                    'actions' => 1,
                    'conjunction' => 'AND',
                    'rules' => 'NEW_pm_other_rule',
                ],
            ],
            'tx_powermailcond_domain_model_rule' => [
                'NEW_pm_other_rule' => [
                    'pid' => $storagePid,
                    'title' => 'Category equals other',
                    'start_field' => $categoryFieldUid,
                    'ops' => 4,
                    'cond_string' => 'other',
                ],
            ],
        ];
    }
}
