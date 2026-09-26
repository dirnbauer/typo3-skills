# Double opt-in

Enable only when requested, with a configured sender-email field and authorized test mailbox.

```typoscript
plugin.tx_powermail.settings.setup.main.optin = 1
plugin.tx_powermail.settings.setup.optin {
    subject = TEXT
    subject.value = Please confirm your enquiry
    overwrite.senderEmail = TEXT
    overwrite.senderEmail.value = website@example.org
}
```

Inspect effective FlexForm/TypoScript settings and test initial submission, email link,
invalid/reused link behavior and final recipient delivery. The controller gates normal send
and persistence through opt-in/hash logic; finishers must check `isFormSubmitted()` instead
of assuming initial submission is final. Opt-in is not a blanket legal-compliance guarantee.

Sources: [opt-in settings](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Configuration/TypoScript/Main/Configuration/07_DoubleOptin.typoscript),
[FormController](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Controller/FormController.php).
