# Rector Coverage by TYPO3 Version

Rector's `ssch/typo3-rector` package ships per-version rule sets. These rules auto-fix mechanical migrations (deprecated method calls, renamed classes, attribute syntax). Use this table to apply a Rector-coverage discount in Phase 5.

## v14 (target = TYPO3 v14.0–v14.3)

- 47 v14-specific rules
  - 46 under `TYPO314/v0/`
  - 1 under `TYPO314/v2/`
- High-coverage areas: Fluid 5 typing, HashService, TSFE removal, TCA sweep, magic finders
- Auto-fix discount: **× 0.80–0.85** of hand-coded migration time

## v13 (target = TYPO3 v13.0–v13.4)

- ~30 v13-specific rules
- High-coverage areas: Doctrine DBAL 4, Symfony 7 DI, attribute migration
- Auto-fix discount: **× 0.85**

## v12 (target = TYPO3 v12.0–v12.4)

- ~20 v12-specific rules
- High-coverage areas: PHP 8.1 syntax, deprecated TSFE methods
- Auto-fix discount: **× 0.90**

## v11 → v12 historical

- Fewer rules; mostly DI changes
- Auto-fix discount: **× 0.95**

## How to apply

After computing `extension_hours = baseline × (Π multipliers)`, multiply by the Rector discount above.

```
final_hours_for_extension = baseline × multipliers × rector_discount × calibration
```

## How to detect Rector applicability

```bash
# Is Rector configured?
ls rector.php rector-config.php Build/rector* 2>/dev/null

# Which TYPO3 rule sets are imported?
grep -E "TYPO312|TYPO313|TYPO314" rector.php Build/rector*

# Run a dry-run to count fixes
vendor/bin/rector process --dry-run --output-format=json | jq '.totals.changed_files'
```

If Rector isn't configured yet, the discount above assumes you'll set it up — adding `+1 h` to project ops overhead for the initial Rector config.

## Caveats

- Rector reduces **mechanical** edits, not testing. Verification time stays the same.
- Some rules are version-pinned to specific TYPO3 minor versions; check the package changelog.
- For highly customised extensions, Rector coverage can drop below the table value because triggers don't all match cleanly.
