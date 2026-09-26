#!/bin/bash
# verify-review-requirements.sh - Verify PR review requirements meet badge level
# Usage: ./verify-review-requirements.sh [--level passing|silver|gold] [--owner owner] [--repo repo] [--branch branch]
# OpenSSF Badge Criteria: two_person_review (Gold), code_review (Silver)
set -euo pipefail

LEVEL="silver"
OWNER=""
REPO=""
BRANCH="main"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --level)
            LEVEL="$2"
            shift 2
            ;;
        --owner)
            OWNER="$2"
            shift 2
            ;;
        --repo)
            REPO="$2"
            shift 2
            ;;
        --branch)
            BRANCH="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

echo "=== PR Review Requirements Verification ==="
echo "Badge Level: $LEVEL"
echo ""

# Determine required reviewers based on level
case "$LEVEL" in
    passing)
        REQUIRED_REVIEWERS=0
        ;;
    silver)
        REQUIRED_REVIEWERS=1
        ;;
    gold)
        # two_person_review needs one review by a person other than the author;
        # a second required approval adds nothing the criterion asks for.
        REQUIRED_REVIEWERS=1
        ;;
    *)
        echo "Error: Invalid level. Use passing, silver, or gold."
        exit 1
        ;;
esac

echo "Required reviewers for $LEVEL level: $REQUIRED_REVIEWERS"
echo ""

# Try to detect owner/repo from git remote
if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
    REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
    if [ -n "$REMOTE_URL" ]; then
        # Extract owner/repo from various URL formats
        if [[ "$REMOTE_URL" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
            OWNER="${BASH_REMATCH[1]}"
            REPO="${BASH_REMATCH[2]}"
        fi
    fi
fi

if [ -z "$OWNER" ] || [ -z "$REPO" ]; then
    echo "Error: Could not determine repository. Use --owner and --repo flags."
    exit 1
fi

echo "Repository: $OWNER/$REPO"
echo "Branch: $BRANCH"
echo ""

# Check if gh CLI is available
if ! command -v gh >/dev/null 2>&1; then
    echo "Error: GitHub CLI (gh) is required but not installed."
    echo "Install from: https://cli.github.com/"
    exit 1
fi

# Check authentication
if ! gh auth status >/dev/null 2>&1; then
    echo "Error: GitHub CLI is not authenticated."
    echo "Run: gh auth login"
    exit 1
fi

# Fetch branch protection settings
echo "Fetching branch protection settings..."
echo ""

# Branch protection comes from two sources that no single endpoint merges:
# classic protection and rulesets. On an error gh prints the error body to
# stdout, so a read counts only when gh exits 0.
PROT_ERR=$(mktemp)
if ! PROTECTION=$(gh api "repos/$OWNER/$REPO/branches/$BRANCH/protection" 2>"$PROT_ERR"); then
    PROTECTION="{}"
    # "Branch not protected" means there is none; any other error means it
    # could not be read (a caller without admin rights gets "Not Found").
    if ! grep -q "Branch not protected" "$PROT_ERR"; then
        echo "✗ Classic branch protection of $BRANCH could not be read: $(head -1 "$PROT_ERR")"
        echo "  Reading it needs admin rights on the repository, and the repository and branch must exist;"
        echo "  without it the assessment would be incomplete."
        rm -f "$PROT_ERR"
        exit 2
    fi
fi
rm -f "$PROT_ERR"
if ! RULES=$(gh api --paginate "repos/$OWNER/$REPO/rules/branches/$BRANCH?per_page=100" 2>/dev/null | jq -s 'add // []'); then
    echo "✗ Rulesets for $BRANCH could not be read; without them the assessment would be incomplete."
    exit 2
fi
PR_RULES=$(echo "$RULES" | jq '[.[] | select(.type == "pull_request") | .parameters]')

if [ "$REQUIRED_REVIEWERS" -gt 0 ] && [ "$PROTECTION" = "{}" ] && [ "$(echo "$PR_RULES" | jq 'length')" = "0" ]; then
    echo "✗ No review requirement configured for $BRANCH (neither classic branch protection nor a ruleset)"
    echo ""
    echo "Configure a required approving review in a ruleset (Settings > Rules > Rulesets) or in classic"
    echo "branch protection; see the github-project skill for the API calls."
    exit 1
fi

# Extract review requirements: the stricter value of the two sources wins.
ACTUAL_REVIEWERS=$(jq -n --argjson p "$PROTECTION" --argjson r "$PR_RULES" \
    '[($p.required_pull_request_reviews.required_approving_review_count // 0), ($r[].required_approving_review_count // 0)] | max')
DISMISS_STALE=$(jq -n --argjson p "$PROTECTION" --argjson r "$PR_RULES" \
    '($p.required_pull_request_reviews.dismiss_stale_reviews // false) or any($r[]; .dismiss_stale_reviews_on_push == true)')
REQUIRE_CODEOWNERS=$(jq -n --argjson p "$PROTECTION" --argjson r "$PR_RULES" \
    '($p.required_pull_request_reviews.require_code_owner_reviews // false) or any($r[]; .require_code_owner_review == true)')

# A ruleset's bypass actors do not need the required approvals; the rules
# endpoint names the ruleset but not its bypass list, so read each one.
BYPASS_NOTES=()
for RID in $(echo "$RULES" | jq -r '.[] | select(.type == "pull_request") | .ruleset_id' | sort -u); do
    if COUNT=$(gh api "repos/$OWNER/$REPO/rulesets/$RID" --jq '.bypass_actors | length' 2>/dev/null); then
        if [ "$COUNT" -gt 0 ]; then
            BYPASS_NOTES+=("⚠ Ruleset $RID lets $COUNT actor(s) bypass it; the required approvals do not bind them")
        fi
    else
        BYPASS_NOTES+=("⚠ Bypass actors of ruleset $RID could not be read; the required approvals may not bind everyone")
    fi
done

echo "=== Current Settings ==="
echo "Required approving reviews: $ACTUAL_REVIEWERS"
echo "Dismiss stale reviews: $DISMISS_STALE"
echo "Require code owner reviews: $REQUIRE_CODEOWNERS"
echo ""

# Check required status checks
STATUS_CHECKS=$(jq -n --argjson p "$PROTECTION" --argjson r "$RULES" \
    '([$p.required_status_checks.contexts[]?] + [$r[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]) | unique | length')
echo "Required status checks: $STATUS_CHECKS"

# Check enforce admins
ENFORCE_ADMINS=$(echo "$PROTECTION" | jq -r '.enforce_admins.enabled // false')
echo "Enforce for admins: $ENFORCE_ADMINS"

for NOTE in "${BYPASS_NOTES[@]}"; do
    echo "$NOTE"
done
echo ""
echo "=== Assessment ==="
echo ""

PASSED=true

# Check reviewer count
if [ "$ACTUAL_REVIEWERS" -ge "$REQUIRED_REVIEWERS" ]; then
    echo "✓ Branch protection requires $ACTUAL_REVIEWERS approving review(s)"
else
    echo "✗ Insufficient reviewers: $ACTUAL_REVIEWERS < $REQUIRED_REVIEWERS required"
    PASSED=false
fi

# Additional checks for Silver/Gold
if [ "$LEVEL" = "silver" ] || [ "$LEVEL" = "gold" ]; then
    if [ "$DISMISS_STALE" = "true" ]; then
        echo "✓ Stale reviews dismissed on new commits"
    else
        echo "⚠ Recommend: Enable 'Dismiss stale reviews'"
    fi

    if [ "$STATUS_CHECKS" -gt 0 ]; then
        echo "✓ Status checks required ($STATUS_CHECKS checks)"
    else
        echo "⚠ Recommend: Add required status checks"
    fi
fi

# Additional checks for Gold
if [ "$LEVEL" = "gold" ]; then
    if [ "$REQUIRE_CODEOWNERS" = "true" ]; then
        echo "✓ Code owner reviews required"
    else
        echo "⚠ Recommend: Enable code owner reviews"
    fi

    if [ "$ENFORCE_ADMINS" = "true" ]; then
        echo "✓ Rules enforced for administrators"
    else
        echo "⚠ Recommend: Enable 'Do not allow bypassing'"
    fi
fi

echo ""
if [ "$PASSED" = true ]; then
    echo "Branch protection settings for $LEVEL level: sufficient."
    if [ "${#BYPASS_NOTES[@]}" -gt 0 ]; then
        echo "Except for the ruleset bypass actors listed above: they can merge without the required approvals."
    fi
    echo "This does not show two_person_review is Met: bot approvals satisfy a required review count."
    echo "Count approvals by humans other than the author (badge-submission-api.md, Solo Maintainer Justification Patterns)."
    exit 0
else
    echo "Branch protection settings for $LEVEL level: insufficient."
    echo ""
    echo "Configure a required approving review in a ruleset (Settings > Rules > Rulesets) or in classic"
    echo "branch protection; see the github-project skill for the API calls."
    exit 1
fi
