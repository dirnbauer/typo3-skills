<?php
declare(strict_types=1);

namespace Vendor\SitePackage\EventListener;

use In2code\PowermailCond\Event\EvaluateRuleEvent;

/** Visibility only; use independent server-side validation for submission constraints. */
final class ExactFieldMatchListener
{
    public function __invoke(EvaluateRuleEvent $event): void
    {
        if ($event->getOperation() !== 120 || $event->isHandled()) {
            return;
        }
        $left = $event->getStartField()->getText();
        $right = $event->getEqualField()?->getText();
        $event->setResult($left !== '' && $right !== null && $left === $right);
    }
}
