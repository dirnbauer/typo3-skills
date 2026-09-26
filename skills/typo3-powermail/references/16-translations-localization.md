# Localization

Translate through TYPO3's editor/DataHandler workflow, then inspect the actual IRRE child
mappings; do not promise every child is automatically localized under every TCA configuration.

Keep markers and stored select/check/radio values stable; translate labels:

```text
# English option
Other|other
# German option (in the translated field)
Sonstiges|other
```

Enter the relevant option line without these explanatory comments in the editor.
Compare conditions with `other`, not the translated label. Test initial, prefilled,
matching and nonmatching choices in each language, including page targets and mandatory errors.
The inspected conditions TCA uses `l18n_parent`; Powermail uses `l10n_parent`.
Resolve references through installed models/TCA instead of inserting translation rows manually.

Sources: [field TCA](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Configuration/TCA/tx_powermail_domain_model_field.php),
[option parsing](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Domain/Model/Field.php),
[conditions TCA](https://github.com/dirnbauer/powermail_cond/tree/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Configuration/TCA).
