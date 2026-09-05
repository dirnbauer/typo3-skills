---
name: typo3-upgrade-effort-model
description: "Use when estimating effort for TYPO3 LTS major version upgrades (current target: v14.3 LTS, released 2026-04-21). Provides risk multipliers for v14 breaking changes (fact catalog owned by typo3-conformance's v14-deprecations.md), per-extension baselines, version-compatibility matrix, Rector coverage adjustments, 7-phase assessment workflow. Calibration-free; pair with your historical data for tuned estimates."
metadata:
  version: "1.4.1"
---

# TYPO3 Upgrade Effort Model

Generic effort estimation model for TYPO3 LTS major version upgrades. Captures *what* makes an upgrade hard (per-version breaking-change deltas, Rector coverage, ecosystem readiness); your team's historical data captures *how fast* you handle each unit.

> Calibration is intentionally external. The model gives per-extension hour ranges; you supply the multiplier from your own projects.

## When to Use

- TYPO3 upgrade estimation: *"v13 → v14.3 LTS effort?"*
- Extension compatibility: *"Which extensions need updates for v14?"*
- Skip-version vs incremental decisions

## v14.3 LTS Headline

The largest breaking-change cycle in years — **98 breaking + 31 deprecation entries**, all in v14.0. Sprint 14.0–14.2 are unsupported.

Most impactful v14 multipliers (full table in `references/risk-multipliers.md`):

| Factor | Multiplier |
|--------|-----------|
| `TypoScriptFrontendController` removal ([#107831](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-107831-RemovedTypoScriptFrontendController.html)) | × 1.3 |
| Fluid 5 strict VH typing ([#108148](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-108148-Fluid50.html)) | × 1.2 |
| Core asset concat/compression removal ([#108055](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Breaking-108055-RemovedFrontendAssetConcatenationAndCompression.html)) | × 1.2 |
| HashService removal, magic finders | × 1.1 each |
| TCA sweep / EXT:form / `ext_tables.php` deprecation | × 1.05–1.2 |

**Rector:** 47 v14 rules; discount × 0.80–0.85 vs hand-coded.
**Post-upgrade:** +0.5–1 h for [#109585](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.3/Important-109585-SerializedCredentialDataInBeUsersDatabaseTable.html) wizard if project transited through v14.2.

## Baselines (before calibration)

| Path | Own ext (with Rector) | Stale third-party | Project ops |
|------|----------------------|-------------------|-------------|
| v13 → v14.3 | 4–8 h | +2–4 h | +0.5–1 h |
| v12 → v13.4 | 3–6 h | +2–3 h | +0.5 h |
| v11 → v12.4 | 4–7 h | +3–5 h | +1 h |
| v10 → v11.5 | 5–8 h | +4–6 h | +1 h |

Multiply by team calibration factor (typically 0.6–1.4).

## 7-Phase Assessment Workflow

1. **Discovery** — versions, extension inventory, build tooling
2. **Classification** — see `references/extension-classification.md`
3. **Compatibility matrix** — see `references/version-compatibility.md`
4. **Custom code analysis** — grep triggers, see `references/assessment-workflow.md`
5. **Risk calculation** — compound multipliers from `references/risk-multipliers.md`
6. **Work estimation** — `extension_hours = baseline × Π(multipliers) × rector_discount × calibration`
7. **Timeline** — phased approach with validation gates

## Companion Skills

- `typo3-conformance-skill` — quality scoring (feeds risk multiplier)
- `typo3-testing-skill` — coverage assessment
- `typo3-extension-upgrade-skill` — performs the upgrade
- `typo3-project-upgrade-skill` — deployed-project upgrade

For Netresearch-internal calibration with historical project data, see `coding-ai/typo3-upgrade-estimator-skill` (consumes this model).

## References

- `references/risk-multipliers.md` — full per-version table
- `references/version-compatibility.md` — TYPO3 ↔ PHP matrix
- `references/extension-classification.md` — categories and risk
- `references/assessment-workflow.md` — command-level workflow
- `references/rector-coverage.md` — Rector counts and discounts
- `references/flux-to-content-blocks-migration.md` — Flux/VHS → Content Blocks + b13/container (cost block for Flux-based projects)
- `references/relaunch-vs-portation.md` — relaunch vs. portation; estimate by work-package
- `references/upgrade-patterns.md` — case study: georgringer/news v11→v12 upgrade patterns
