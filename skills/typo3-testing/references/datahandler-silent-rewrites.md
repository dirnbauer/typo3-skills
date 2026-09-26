# What the DataHandler does not enforce, and what it rewrites in silence

> **Source**: netresearch/t3x-nr-llm [PR 957](https://github.com/netresearch/t3x-nr-llm/pull/957) and [PR 958](https://github.com/netresearch/t3x-nr-llm/pull/958) — agent tools that create records through the DataHandler (2026-09). Line numbers: cms-core / cms-backend 14.3.7 unless stated.

For anyone testing code that writes through `DataHandler` without FormEngine in front of it: agent tools, importers, API endpoints, CLI commands. `process_datamap()` reports no error for any row below. A test that only asserts "no error log entry" or "a uid came back" passes while the stored record differs from the request. Each row names what to assert instead.

## Rules only FormEngine applies

| Behaviour | Core location | Test that pins it |
|---|---|---|
| Page TSconfig `TCEFORM.<table>.<col>.keepItems` / `removeItems` / `disabled` / `config.readOnly` / `label` are applied by the backend form only. The DataHandler stores a removed item, a disabled column or a read-only column anyway. | cms-backend `AbstractItemProvider::removeItemsByKeepItemsPageTsConfig()` / `removeItemsByRemoveItemsPageTsConfig()`; `SingleFieldContainer` (`disabled`, any truthy value, line 87); `FormEngineUtility::$allowOverrideMatrix` (`config.*`); `TcaColumnsProcessFieldLabels` (`label`) | Pre-check: resolve the page's TSconfig for the target pid and refuse the value the form would not offer. One data-provider row per rule, each asserting the refusal names the rule. |
| `TCEFORM.<table>.<col>.types.<type>.` overrides are merged over the column rule for that record type. | cms-backend `PageTsConfigMerged` lines 50-52 | Same pre-check with the record type resolved first; one case where only the type rule forbids the value. |
| `keepItems` / `removeItems` exist for select-like fields only (select, language, category, country, select tree), not for `radio` or `check`. `config.readOnly` applies only to types that list it in `$allowOverrideMatrix`; `radio` has no entry there. | `TcaSelectItems`, `TcaLanguage`, `TcaCategory`, `TcaCountry`, `TcaSelectTreeItems` call the two methods; `$allowOverrideMatrix` lines 50-69 | A radio column with `removeItems` set is **not** refused — pin the negative case too, or the pre-check over-refuses. |

## Values dropped without a word

| Behaviour | Core location | Test that pins it |
|---|---|---|
| A column with `exclude` set is skipped unless the user holds `non_exclude_fields` for `<table>:<col>`. `exclude` is truthy (`(bool)`), not `=== true`: `'1'` and `1` count. | `DataHandler::fillInFieldArray()` line 1121 → `AbstractFieldType::supportsAccessControl()` lines 56-59 | Non-admin without the grant writes the column → read-back shows the default; with the grant → the value. |
| A `select` value failing `authMode` is removed; if every value fails, the column is not written. Applies to every select with `authMode`, not only `CType`. | `DataHandler::checkValueForGroupFolderSelect()` lines 2259-2269 | Editor without `explicit_allowdeny` for the value → read-back shows the default. |
| `eval=md5` drops a value that is not 32 characters (the column is not written). | `checkValue_input_Eval()` lines 2821-2825 | Write 31 characters → read-back unchanged. |
| input `min`: a shorter value is replaced by `''`. text `min`: the same, unless the column is RTE. | `checkValueForInput()` lines 1495-1499; `checkValueForText()` lines 1444-1448 | Write `min - 1` characters → read-back `''`. |

## Values rewritten on store

| Behaviour | Core location | Test that pins it |
|---|---|---|
| `number` with `format=decimal` is stored as `number_format($value, 2)`. The `range` check runs on that rounded value with `ceil()` / `floor()` and clamps to the bound, stored as a float (`10.0`, not `'10.00'`). | `checkValueForNumber()` lines 1542-1578 | Write `1.239` → `'1.24'`; write above `upper` → the bound. Compare numerically. |
| input `max` truncates (`mb_substr`). | `checkValueForInput()` lines 1491-1493 | Write `max + 1` characters → read-back is cut. |
| Transforming `eval` tokens: `trim`, `upper`, `lower`, `nospace`, `alpha`, `num`, `alphanum`, `alphanum_x`, `is_in`, `domainname` (IDN → punycode) and any registered `formevals` class. `unique` / `uniqueInPid` append a suffix. Unknown tokens are ignored. `year` is cast to int on 13.4 (13.4.21 line 2834) but is no longer a token on 14.3. | `checkValue_input_Eval()` lines 2815-2883; `checkValueForInput()` lines 1511-1518 (`getUnique()`) | One case per token the target table uses; for `unique`, a second record with the same value reads back changed. |
| `color` with an alpha pair (`#rrggbbaa`) is cut to 7 characters unless `opacity` is set. | `checkValueForColor()` lines 1596-1597 | Write `#11223344` → `#112233`. |
| RTE columns pass through `RteHtmlParser::transformTextForPersistence()`, which re-joins blocks with `LF`. | `checkValueForText()` lines 1467-1472; `RteHtmlParser` (`implode(LF, …)`) | Compare by presence of the expected text/tags, not byte equality. |

## Defaults and record types

| Behaviour | Core location | Test that pins it |
|---|---|---|
| `TCAdefaults` for a new record: user TSconfig is loaded first, then page TSconfig of the target pid is merged over it (`array_merge`), and both win over the TCA `default`. | `DataHandler::setDefaultsFromUserTS()` lines 541-561, `applyDefaultsForFieldArray()` lines 609-614, `newFieldArray()` line 8240 | Page and user TSconfig set different defaults → read-back shows the page value. |
| A type value with no `types` entry is read as type `'0'` (or `'1'` when `'0'` does not exist), never as the type column's TCA `default`. | cms-backend `BackendUtility::getTCAtypeValue()` lines 723-730 | Write an undeclared type (or let `TCAdefaults` supply one) → assert which `showitem` / `columnsOverrides` applied. |
| Core plugins `indexed_search` (14.3.7), `felogin` and `form` (checked on 14.3.2) register in the `forms` item group, not `plugins`. `indexed_search`'s `pi2` passes no FlexForm, so its CType gets a copy of `types['header']`. | `ExtensionUtility::registerPlugin(…, 'forms', …)` in each `Configuration/TCA/Overrides/tt_content.php`; `ExtensionManagementUtility::addPlugin()` | A "plugins only" filter by item group misses them; assert on the CType list you expect, not on the group. |

## The read-back pattern

After `process_datamap()`, re-read every column the code wrote, plus `pid`, `hidden`, the language column and the record-type column, and compare with the request (numerically for decimals, by presence for RTE). When a column differs, delete the new record through the DataHandler (`cmd` `delete`) and report the column; if that delete fails, say so — the record may be reachable. Name two causes in the message: a missing grant (`non_exclude_fields`, `authMode`) **and** "rewritten by TYPO3" (eval, `max`, `min`, decimals, colour). A message that names only permissions sends the user to the wrong setting.

Pin the pattern with a DataHandler hook fixture that rewrites one column (`processDatamap_postProcessFieldArray`), and assert the record is gone and the column is named.

See also `backend-user-access-testing.md` for making a non-admin editor genuinely pass the page checks first.
