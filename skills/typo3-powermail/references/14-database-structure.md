# Records and schema

Use these relation owners; read installed TCA and generated schema for exact columns/types:

| Record | Relation |
|---|---|
| `tx_powermail_domain_model_form` | `pages` → Page |
| `tx_powermail_domain_model_page` | `form` → Form; `fields` → Field |
| `tx_powermail_domain_model_field` | `page` → Page |
| `tx_powermail_domain_model_mail` | `form` → Form; `answers` → Answer |
| `tx_powermail_domain_model_answer` | `mail` → Mail; `field` → Field |
| `tx_powermailcond_domain_model_conditioncontainer` | `form` → Form; `conditions` → Condition |
| `tx_powermailcond_domain_model_condition` | `conditioncontainer`; `rules` → Rule; `target_field` is UID or fieldset string |
| `tx_powermailcond_domain_model_rule` | `conditions`; `start_field`; `equal_field` |

Do not equate IRRE child counts with a manually maintained SQL counter. Use DataHandler parent
relation lists so it resolves NEW identifiers and foreign fields. Do not derive child IDs by
arithmetic from LAST_INSERT_ID or find newly created records by a nonunique title.
Use [the pure condition datamap](../examples/ConditionDataMap.php) after validating existing UIDs.

Powermail uses `l10n_parent`; the inspected conditions TCA uses `l18n_parent`.
Do not apply a generic 'standard columns on every table' template or add workspace fields by hand.

Sources: [Powermail TCA](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Configuration/TCA),
[Powermail SQL](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/ext_tables.sql),
[conditions TCA](https://github.com/dirnbauer/powermail_cond/tree/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Configuration/TCA).
