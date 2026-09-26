# PSR-14 event selection

Inspect the installed event class **and its dispatch site** before coding. A class name alone
does not prove available getters, mutability, ordering or whether the event fires once per
mail type/recipient. List available events with:

```bash
rg --files vendor/in2code/powermail/Classes/Events
rg -n 'dispatch\(|new .*Event' vendor/in2code/powermail/Classes
```

| Need | Verified entry point | Constraint |
|---|---|---|
| Cross-field validation | `CustomValidatorEvent` | Mail plus custom validator |
| Storage decision | `CheckIfMailIsAllowedToSaveEvent` | `setSavingOfMailAllowed(false)`; not a global privacy solution |
| Receiver address array | `ReceiverMailReceiverPropertiesServiceSetReceiverEmailsEvent` | Inspect exposed service; do not invent `getMail()` |
| Message before send | `SendMailServicePrepareAndSendEvent` | Message is already prepared; inspect which event changes are read afterward |

For simple recipient routing prefer a bounded TypoScript CASE, not a submitted email address:

```typoscript
plugin.tx_powermail.settings.setup.receiver.overwrite.email = CASE
plugin.tx_powermail.settings.setup.receiver.overwrite.email {
    key.data = GP:tx_powermail_pi1|field|department
    support = TEXT
    support.value = support@example.org
    sales = TEXT
    sales.value = sales@example.org
    default = TEXT
    default.value = forms@example.org
}
```

Adapt to the installed marker/cObject context and prove each allowlisted route in a mail sink.
Never use a visitor-provided URL/address as an unconstrained forwarding destination.

Sources: [event classes](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Events),
[receiver configuration](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Configuration/TypoScript/Main/Configuration/03_MailReceiver.typoscript),
[send pipeline](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Domain/Service/Mail/SendMailService.php).
