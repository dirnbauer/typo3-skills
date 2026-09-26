# Custom finishers

Keep the shipped finishers. Add one unused numeric key; do not replace the entire list.

```typoscript
plugin.tx_powermail.settings.setup.finishers {
    50.class = Vendor\SitePackage\Finisher\EnquiryFinisher
    50.config.formUid = 12
}
```

Extend Powermail's own AbstractFinisher. Check final-submission status **before** side effects;
opt-in changes when that flag is true. Scope the operation to a configured form UID.

```php
<?php
declare(strict_types=1);
namespace Vendor\SitePackage\Finisher;

use In2code\Powermail\Finisher\AbstractFinisher;

final class EnquiryFinisher extends AbstractFinisher
{
    public function prepareEnquiryFinisher(): void
    {
        if (!$this->isFormSubmitted()) {
            return;
        }
        $formUid = (int)($this->getConfiguration()['formUid'] ?? 0);
        if ($formUid < 1 || $this->getMail()->getForm()->getUid() !== $formUid) {
            return;
        }
        $answers = $this->getMail()->getAnswersByFieldMarker();
        $answer = $answers['email'] ?? null;
        if ($answer === null || !is_string($answer->getValue())) {
            return;
        }
        // Hand a validated, minimal payload to your separately tested application service.
        // No network request is implemented by this example.
    }
}
```

The runner invokes public methods ending in `Finisher`, excluding `initialize*`.
It passes constructor arguments itself; do not assume an arbitrary injected constructor works.
Use one side-effect method, idempotency, bounded timeouts and explicit failure reporting for
CRM integration. Never embed API credentials in TypoScript or permit submitted destination URLs.

Source: [FinisherRunner](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Finisher/FinisherRunner.php) and
[AbstractFinisher](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Finisher/AbstractFinisher.php).
