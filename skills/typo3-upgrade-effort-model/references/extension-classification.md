# Extension Classification

Generic classification system for TYPO3 extensions. Applies to any TYPO3 project regardless of organisation.

For team-specific overlays (internal vendor patterns, customer-extension naming, contributor-discount factors), maintain a thin internal classification skill that imports this one.

## Classification Rules

### 1. TYPO3 Core Extensions

```yaml
Pattern: typo3/cms-*
Risk: LOW
Estimation: 0 hours (handled by core)
```

### 2. Public Third-Party (active)

```yaml
Pattern: TER + Packagist; ships a release matching target TYPO3 version
Risk: LOW
Estimation: 0-4 hours (composer bump + smoke test)
Examples: friendsoftypo3/headless, georgringer/news (when v14-ready)
```

### 3. Public Third-Party (stale)

```yaml
Pattern: TER + Packagist; no release for target TYPO3 version
Risk: MEDIUM
Estimation: 4-12 hours
Options:
  - fork + patch + send PR upstream (preferred)
  - fork + maintain locally (acceptable)
  - replace with alternative (highest effort, may invalidate timeline)
```

### 4. Customer-Specific Custom

```yaml
Pattern: project-scoped extensions you own
Risk: MEDIUM
Estimation: 8-24 hours per extension
Drivers:
  - business logic complexity
  - hook/event subscriber count
  - TCA depth
  - test coverage at start
```

### 5. Heavily Customised

```yaml
Pattern: Custom + complex business logic, integration extensions, multi-instance reuse
Risk: HIGH
Estimation: 24-60 hours per extension
Drivers (any one elevates to HIGH):
  - direct $GLOBALS['TSFE'] dependence (v14 multiplier × 1.3)
  - heavy custom Fluid ViewHelpers (v14 Fluid 5 strict typing × 1.2)
  - HashService callers (× 1.1)
  - bespoke asset pipeline tied to core concat (× 1.2)
```

## Risk Level Calculation

For each extension:

1. Start with base classification risk (LOW / MEDIUM / HIGH).
2. Apply per-multiplier hits when target is the relevant version (see `risk-multipliers.md`).
3. Sum hours; cap at HIGH bucket maximum if total would exceed it without justification.

## Project-Level Aggregation

```
total_hours = sum(extension_hours) × calibration_factor + ops_overhead
```

Where:

- `extension_hours` = baseline × all applicable multipliers
- `calibration_factor` = your team's historical multiplier (typically 0.6–1.4)
- `ops_overhead` = post-upgrade wizards, deployment, communication (project-level, see SKILL.md baseline table)

Calibration belongs in your team-specific skill, not here.
