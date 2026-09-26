# Common recipe routing

- Conditional recipients: [PSR-14/routing guide](06-psr-14-events.md).
- Conditional fields, checkbox groups, thresholds and wizard pages:
  [condition recipes](../SKILL-EXAMPLES.md).
- Upload optimization: [condition AJAX integration](../SKILL-CONDITIONS.md#exclude-uploads-from-condition-ajax).
- Templates: [root-path overrides](07-email-templates.md).
- Cross-field equality: [server validation](05-custom-validators.md).
- CRM: [finisher boundary](04-custom-finishers.md).

Do not use `manipulateVariablesInPowermailAllMarker` to pretend to create persistent fields.
That configuration modifies output variables. Provision real fields through the backend or
DataHandler, then validate their values separately.

Source: [output marker configuration](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Configuration/TypoScript/Main/Configuration/22_ManipulateVariablesInPowermailAllMarker.typoscript).
