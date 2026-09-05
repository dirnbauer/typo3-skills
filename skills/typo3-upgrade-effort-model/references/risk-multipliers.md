# Risk Multipliers

Per-version per-factor multipliers applied to baseline extension estimates.

Multipliers are **multiplicative** — if 3 of them apply to one extension, multiply the baseline by all three.

## v14 (target = TYPO3 v14.0–v14.3)

| Factor | Trigger detection | Multiplier | Why |
|--------|-------------------|-----------|-----|
| Fluid 5 strict VH typing | grep custom VHs without typed args / `render(): string` | × 1.2 | Every custom VH needs typed args + return; LenientArgumentProcessor deprecated. Breaking [#108148](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-108148-Fluid50.html) |
| `Extbase HashService` removal | grep `HashService` callers | × 1.1 | Replace + HMAC rotation. Umbrella issue #105377 |
| `TypoScriptFrontendController` class removal | grep `$GLOBALS['TSFE']` | × 1.3 | Refactor to `$request` attributes. Breaking [#107831](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-107831-RemovedTypoScriptFrontendController.html) |
| Magic Extbase repo finders | `->findBy*` / `->findOneBy*` / `->countBy*` call sites (see the Phase 4 grep) | × 1.1 | Mostly mechanical via Rector. Extbase `Repository::__call` is removed in v14.0 (deprecated since v12). Counts ONLY for true `__call` magic finder *calls*. A self-defined `findBy*` repository method using `createQuery()` is not affected, do not apply |
| Core asset concat/compression removal | grep `config.concatenateCss` / `concatenateJs` | × 1.05–1.2 | Vite/webpack integration if no build tool yet (× 1.2). If a build tool (Vite/webpack) is already present, this is a config migration only (× 1.05). Breaking [#108055](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-108055-RemovedFrontendAssetConcatenationAndCompression.html) |
| TCA sweep | grep `list_type` / `is_static` / `eval=year` | × 1.1 | Per-extension breaking change discovery |
| EXT:form 10 hook removals | check for form-framework hooks | × 1.05–1.2 | Only if project uses form framework |
| `ext_tables.php` deprecation | grep presence of file | × 1.05 | Split into Configuration/Backend/Modules.php, Routes.php, TCA overrides. Deprecation [#109438](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.3/Deprecation-109438-ExtTablesPhpInExtensions.html) |
| CKEditor 5 v47 dark/light default-on | uses RTE / editor styles | × 1.05 | RTE styles need `prefers-color-scheme` tokens. Breaking [#106964](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-106964-MakeCkeditorContextAwareByDefault.html) |

## v13 (target = TYPO3 v13.0–v13.4)

| Factor | Multiplier | Why |
|--------|-----------|-----|
| Doctrine DBAL 4.x | × 1.1 | Some query API changes |
| PHP 8.2 minimum | × 1.05 | Drop pre-8.2 syntax |
| Symfony 7 | × 1.05 | DI changes if using Symfony bundle features |

## v12 (target = TYPO3 v12.0–v12.4)

| Factor | Multiplier | Why |
|--------|-----------|-----|
| New Site Module / Sets ⇒ later | × 1.1 | Reorganise TypoScript into Sets if migrating to v13/v14 same cycle |
| ContentBlocks (opt-in v12+) | (opt-in) | Voluntary modernisation; not forced |

## v11 → v12 historical

Less impactful per breaking-count metric; mostly mechanical via Rector.

## Calibration vs the model

This list grows from each TYPO3 release. The factors are objective (a multiplier applies if the trigger condition matches, regardless of team). Whether your team takes 4 h or 8 h per extension AT the same factor count is **calibration** — not a multiplier — and belongs in your team-specific overlay skill.

## Rector coverage adjustment

After all factor multipliers are applied, multiply by Rector coverage discount:

| Target | Rector v14 rules | Auto-fix discount |
|--------|------------------|-------------------|
| v14 | 47 (46 in `TYPO314/v0/`, 1 in `v2/`) | × 0.80–0.85 |
| v13 | ~30 | × 0.85 |
| v12 | ~20 | × 0.90 |

Rector reduces hand-coded migration but doesn't replace verification — the discount accounts for the time saved on mechanical edits, not on testing.
