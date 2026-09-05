# TYPO3/PHP Version Compatibility Matrix

## TYPO3/PHP Support Matrix

**Reference for all upgrade estimations.** The PHP ranges are what an estimate
needs at hand; the support *phase* is not restated here beyond active-vs-ELTS,
because that moves without any release touching this file. Canonical owner of
both: the [TYPO3 roadmap](https://typo3.com/typo3-cms/development-roadmap/roadmap)
— re-read it when a new LTS appears, and correct this table in the same pass.

| TYPO3 Version | Min PHP | Max PHP | Supported PHP Versions | Phase |
|---------------|---------|---------|------------------------|-------|
| 10.4 LTS | 7.2 | 7.4 | 7.2, 7.3, 7.4 | ELTS only |
| 11.5 LTS | 7.4 | 8.3 | 7.4, 8.0, 8.1, 8.2, 8.3 | ELTS only |
| 12.4 LTS | 8.1 | 8.4 | 8.1, 8.2, 8.3, 8.4 | ELTS only |
| 13.4 LTS | 8.2 | 8.5 | 8.2, 8.3, 8.4, 8.5 | Active |
| **14.3 LTS** | 8.2 | 8.5 | 8.2, 8.3, 8.4, 8.5 | Active — current target (released 2026-04-21) |

Two consequences for an estimate, both easy to get wrong:

- **12.4 is behind the ELTS wall.** Since the 2026-06-15 security release its
  fixed versions ship only through the paid ELTS repository and are absent from
  public Packagist, so a `^12.4` leg in CI resolves to nothing once Composer
  refuses advisory-flagged packages. A v12 project is therefore not "still
  supported, upgrade when convenient" — its clock has run out, and that belongs
  in the timeline argument, not only in the hour count.
- **13.4 and 14.3 share their PHP range.** The upgrade can be done without
  moving PHP, which is what makes the ordering rule below cheap on this path.

## Recommended PHP Target Versions

**By Upgrade Path:**

| Upgrade Path | Recommended PHP | Rationale |
|--------------|-----------------|-----------|
| 10.4 → 11.5 | **8.3** | Highest version supported by 11.5, good long-term support |
| 11.5 → 12.4 | **8.4** | Highest version supported by 12.4, best performance |
| 12.4 → 13.4 | **8.4** | Already supported in 12.4, smooth transition |
| 13.4 → 14.3 | **8.4** | Supported by both, so PHP need not move with TYPO3; take 8.5 as a separate step afterwards |

## PHP Version Upgrade Strategy

1. Upgrade PHP to highest version compatible with **current** TYPO3
2. Test thoroughly on current TYPO3 version
3. Fix all PHP compatibility issues (primarily undefined array keys for PHP 8.1+)
4. THEN upgrade TYPO3 version
5. This isolates "Is this PHP or TYPO3?" debugging

## Version-Specific Breaking Changes

### TYPO3 10 → 11

- **PHP**: 7.4 (min) → 8.0/8.1 recommended
- **Major Changes**: Backend routing, DataHandler changes, Fluid changes
- **Extension Impact**: Medium (most extensions compatible)

### TYPO3 11 → 12

- **PHP**: 8.1 (min) → 8.2/8.3 recommended
- **Major Changes**: Asset handling, Configuration API, PSR-14 events
- **Extension Impact**: Medium-High (more breaking changes)

### TYPO3 12 → 13

- **PHP**: 8.2 (min) → 8.4 recommended
- **Major Changes**: File structure (LocalConfiguration.php → settings.php), command names (typo3cms → typo3)
- **Extension Impact**: High (structural changes affect all projects)

### TYPO3 13 → 14

- **PHP**: 8.2 (min), unchanged from 13.4 — the upgrade does not require moving PHP
- **Major Changes**: the largest breaking-change cycle in years, all landed in
  14.0 — `TypoScriptFrontendController` removed, Fluid 5 strict ViewHelper
  typing, frontend asset concat/compression removed, `HashService` removed,
  Extbase magic finders removed, `ext_tables.php` deprecated
- **Extension Impact**: High — see `references/risk-multipliers.md` for the
  per-factor multipliers; this is the path the model's baselines are built for

### Skip-Version (v9 → 12)

- **PHP**: 7.2/7.4 → 8.1+ (major jump)
- **Cumulative Changes**: All v10, v11, v12 breaking changes apply
- **Extension Impact**: High (cumulative), but single effort vs 3 separate upgrades
- **Timeline**: Comparable to a single upgrade (~6 months), as observed on a real skip-version project
