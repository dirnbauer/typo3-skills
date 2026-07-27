#!/usr/bin/env bash
#
# The gate. One command, every check, correct thresholds.
#
# This exists because validating a change used to mean remembering seven commands with seven
# different flag sets. Nobody does that reliably. Over one working session three regressions
# were introduced *while fixing regressions* and survived until a manual sweep happened to
# catch them: two descriptions cross-referenced into a collision, a rule violated one commit
# after it was written, and a stemmer inconsistent with itself.
#
# A check that does not run cannot fail.
#
# Thresholds below are RATCHETS set at measured values, not aspirations. A third colliding
# pair or a reviewed trigger case that stops passing is a build failure, not a slow slide.
#
# Usage:
#   ./scripts/check.sh            everything
#   ./scripts/check.sh --fast     skip the harness test suite (for a pre-push hook)
#   ./scripts/check.sh --quiet    only failures and the summary

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAST=0
QUIET=0
for arg in "$@"; do
    case "$arg" in
        --fast)  FAST=1 ;;
        --quiet) QUIET=1 ;;
        -h|--help)
            sed -n '3,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0 ;;
        *) echo "unknown flag: $arg" >&2; exit 2 ;;
    esac
done

PASSED=0
FAILED=0
FAILED_NAMES=()

say()  { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }
ok()   { PASSED=$((PASSED + 1)); say "  ✓ $1"; }
bad()  { FAILED=$((FAILED + 1)); FAILED_NAMES+=("$1"); printf '  ✗ %s\n' "$1"; }

run() {
    local name="$1"; shift
    local out
    if out=$("$@" 2>&1); then
        ok "$name"
    else
        bad "$name"
        printf '%s\n' "$out" | tail -n 12 | sed 's/^/      /'
    fi
}

say "Checking $ROOT"
say ""

# --- the collection itself -------------------------------------------------------------
run "frontmatter, naming, size limits" \
    python3 scripts/audit_skills.py

run "directives and progressive disclosure (S6, S7)" \
    python3 scripts/validate_structure.py

run "eval structure and coverage (S4, S5)" \
    python3 scripts/validate_evals.py --min-cases 6

# Reviewed trigger cases are at 100%; anything less is a regression, not a starting point.
# Proposed cases ratchet too — they are resolved before they are committed, so a drop means a
# description regressed, not that a batch is still in progress. A known_limitation case that
# starts passing also fails here, so an xfail annotation cannot outlive the problem it names.
run "trigger evals actually pass (S2, S4)" \
    python3 scripts/run_evals.py --grader lexical --fail-under 1.0 --fail-under-proposed 1.0

# Budget 3, and every pair is between vendored skills whose descriptions we cannot edit:
#   0.296  web-design-guidelines <-> web-platform-design   (Vercel / ehmo)
#   0.170  typo3-conformance <-> typo3-extension-upgrade   (both Netresearch)
#   0.133  postgres-best-practices <-> web-design-guidelines (Supabase / Vercel)
# Raised from 1 to 3 when the general-web skills were brought back from the archived
# repository. This is a deliberate, recorded loosening, not drift: the first pair are
# genuinely adjacent skills — one is web design and accessibility guidance, the other
# platform and WCAG patterns — and vendoring means the only honest fixes are to drop one
# skill or to edit upstream text, neither of which we will do silently. If a *webconsulting*
# skill ever appears in this list, that one is ours and must be reworded rather than
# absorbed by the budget. Leaving slack in a ratchet is how a budget quietly becomes a target.
run "trigger collisions within budget (S3)" \
    python3 scripts/trigger_collisions.py --threshold 0.13 --fail-over 3

run "vendored skills unmodified" \
    python3 scripts/check_attribution_guardrails.py

# --- the harness -----------------------------------------------------------------------
if [ "$FAST" -eq 1 ]; then
    say "  · harness suite skipped (--fast)"
else
    HARNESS="skills/typo3-upgrade-run/scripts"
    if [ ! -d "$HARNESS/node_modules" ]; then
        say "  · harness suite skipped (no node_modules — run: cd $HARNESS && npm ci)"
    else
        run "harness unit and e2e suite" \
            bash -c "cd '$HARNESS' && npm test --silent"
    fi
fi

say ""
if [ "$FAILED" -eq 0 ]; then
    say "$PASSED check(s) passed."
    exit 0
fi

printf '\n%d passed, %d FAILED: %s\n' "$PASSED" "$FAILED" "${FAILED_NAMES[*]}" >&2
exit 1
