# Server-side custom validation

Use `CustomValidatorEvent` when validating cross-field rules. Do not use condition
operators 8/9 to prove equality. The event exposes `getMail()` and `getCustomValidator()`.
Scope a listener to its intended form and handle missing/array answers explicitly.

```php
<?php
declare(strict_types=1);
namespace Vendor\SitePackage\EventListener;

use In2code\Powermail\Events\CustomValidatorEvent;

final class RepeatEmailListener
{
    public function __invoke(CustomValidatorEvent $event): void
    {
        $mail = $event->getMail();
        if ($mail->getForm()->getUid() !== 12) { // Replace with project configuration.
            return;
        }
        $answers = $mail->getAnswersByFieldMarker();
        $first = $answers['email'] ?? null;
        $repeat = $answers['email_repeat'] ?? null;
        // Provision both fields; mandatory validation owns a missing answer.
        if ($first === null || $repeat === null || $repeat->getField() === null) {
            return;
        }
        if (!is_string($first->getValue()) || !is_string($repeat->getValue())
            || $first->getValue() !== $repeat->getValue()) {
            $event->getCustomValidator()->setErrorAndMessage($repeat->getField(), 'email_repeat');
        }
    }
}
```

Register the listener through `event.listener` in Services.yaml, and provide the language key:

```typoscript
plugin.tx_powermail._LOCAL_LANG.default.validationerror_email_repeat = Email addresses must match.
```

Verify the installed error partial/ViewHelper consumes this key. Test missing, empty, equal,
substring-only, case and array payloads with server validation enabled. This is an illustrative
field-equality rule, not email deliverability or ownership verification.

Sources: [CustomValidatorEvent](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Events/CustomValidatorEvent.php),
[CustomValidator](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Domain/Validator/CustomValidator.php),
[AbstractValidator](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Domain/Validator/AbstractValidator.php).
