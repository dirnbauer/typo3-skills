# Extension boundaries

Read installed signatures before calling methods. Guard a missing answer before dereferencing it:

```php
$answers = $mail->getAnswersByFieldMarker();
$email = ($answers['email'] ?? null)?->getValue();
```

The nullsafe operator alone does not suppress an undefined array key.
Treat `getValue()` as potentially non-string. `getAdditionalData()`/`addAdditionalData()`
carry in-memory data; do not assume automatic database persistence.

Configure rate-limit methods in the installed spamshield TypoScript. Inspect Scheduler
registration/retention settings rather than claiming all stored mail is automatically deleted.
Keep credentials in the approved secret mechanism; log identifiers and outcomes, not answers.

Source: [Mail model](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Domain/Model/Mail.php),
[spamshield configuration](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Configuration/TypoScript/Main/Configuration/12_Spamshield.typoscript).
