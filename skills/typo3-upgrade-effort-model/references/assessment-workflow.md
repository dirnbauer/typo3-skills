# 7-Phase Assessment Workflow

Generic command-level workflow for producing an upgrade estimate. Independent of the specific project, agency, or LTS pair.

## Phase 1 — Project Discovery

```bash
# Current TYPO3 + PHP versions
composer show typo3/cms-core | grep versions
php --version

# Extension inventory — full installed set, every vendor (classify in Phase 2)
composer show --installed --format json | jq -r '.installed[].name' | sort
# extensions only (by package type), any vendor:
jq -r '(.packages[]?, .["packages-dev"][]?) | select(.type == "typo3-cms-extension") | .name' composer.lock | sort

# Build tooling
ls -la package.json vite.config.* webpack.config.* gulpfile.* 2>/dev/null

# Site config presence
find config/sites -name config.yaml 2>/dev/null
ls Configuration/Sets 2>/dev/null
```

Output: a table of `extension → current version → category` for every extension.

**Enumerate the full installed set from `composer.lock` (or `composer show --installed`) — never a hand-supplied or ticket-supplied extension list.** A scope list from the request routinely omits extensions (transitive dependencies, sitepackage requirements, starter packages). Every missed extension is either silent effort or a silent compatibility blocker. Cross-check the count against the lockfile before moving on.

## Phase 2 — Extension Classification

For each extension from Phase 1, assign a category from `extension-classification.md`:

- TYPO3 Core
- Public third-party (active)
- Public third-party (stale)
- Customer-specific custom
- Heavily customised

Add organisation-specific buckets via a thin overlay skill if needed (e.g. *internal vendor extensions, customer-prefixed extensions*).

## Phase 3 — Compatibility Matrix

Cross-reference each non-core extension against the target TYPO3/PHP versions using `references/version-compatibility.md`:

```bash
for ext in $(composer show --installed --format json | jq -r '.installed[] | select(.name | test("typo3/|<vendor>/")) | .name'); do
  echo "$ext: $(composer info "$ext" --available --format json 2>/dev/null | jq -r '.versions[]' | head -5)"
done
```

Output: per-extension flag (`v14-ready` / `v14-via-fork` / `replace` / `stale-no-replacement`).

**Before flagging an extension as `needs-update`, read the currently-installed version's own `typo3/cms-core` constraint.** A recent release may already declare the target major (an installed `^12 || ^13 || ^14` constraint is already target-ready, no bump needed). Check tags AND dev-branches on Packagist, using lowercase vendor/package names (an uppercase name 404s): `repo.packagist.org/p2/<vendor>/<pkg>.json` and `repo.packagist.org/p2/<vendor>/<pkg>~dev.json`. A dependency with neither a tag nor a dev-branch supporting the target major is a genuine blocker, not a bump. If the project owns a custom extension that depends on it, that custom extension is blocked too.

## Phase 4 — Custom Code Analysis

Scan custom code for breaking-change triggers. Each trigger maps to a multiplier in `risk-multipliers.md`:

```bash
# v14 triggers
grep -rln "HashService" Classes/ Configuration/
grep -rln "\$GLOBALS\['TSFE'\]" Classes/
grep -E -rln "->(findBy|findOneBy|countBy)[[:upper:]]" Classes/
find . -name "ext_tables.php" -not -path "./.Build/*"
grep -rln "config\.concatenateCss\|config\.concatenateJs" Configuration/TypoScript/
grep -rln "list_type\|is_static\|eval=.*year" Configuration/TCA/
```

Output: counts per trigger across the codebase.

**The greps yield trigger *candidates*, not confirmed multipliers. Verify the semantics before applying a multiplier in Phase 5.** A `->findBy*()`/`->findOneBy*()`/`->countBy*()` call is a magic finder only when it resolves through Extbase's `Repository::__call` (removed in v14.0). The same call may instead target a `findBy*` method explicitly defined on the repository (using `createQuery()`), which is a regular method and is unaffected, so confirm the target repository does not define the method before counting it. A `concatenate*` match alongside an already-present build tool (Vite/webpack) is a config migration, not a tooling introduction. Open each hit and confirm it is the construct the multiplier targets; drop the false positives.

## Phase 5 — Risk Level Calculation

For each extension:

1. Look up baseline (per-version table in SKILL.md).
2. Apply multipliers from `risk-multipliers.md` for each trigger that hit in Phase 4.
3. Apply Rector coverage discount for the target version.
4. Sum across all extensions.

```
extension_hours = baseline × (Π multipliers) × rector_discount
project_hours = Σ extension_hours × calibration_factor + ops_overhead
```

## Phase 6 — Work Estimation

Break the project total into phases:

| Phase | Typical share |
|-------|---------------|
| Setup (composer, PHP, dev env) | 5–10 % |
| Per-extension migration | 60–70 % |
| Custom code refactor | 15–20 % |
| Testing (regression + new) | 10–15 % |
| Documentation + handover | 5 % |

## Phase 7 — Timeline Recommendation

Decide skip-version vs incremental:

- **Skip-version (e.g. v11 → v13)** is faster if Rector covers the gap. Best when on a major-only LTS rotation.
- **Incremental (v11 → v12 → v13)** is safer for projects with deep customisation, weak test coverage, or recent customer pain.

Apply validation gates between phases:

```
lint → unit-test → functional-test → smoke-test → user acceptance
```

## Output Format

The estimate report (per `references/report-template.md` if you supply one in your overlay skill) should include:

- Project meta: customer, current/target version, deadline
- Per-extension table with hours and risk class
- Project-level total with calibration factor explained
- Risk register: top 3 unknowns
- Phased timeline with validation gates

A team-specific overlay skill can extend this with case-study comparisons and historical-accuracy callouts.
