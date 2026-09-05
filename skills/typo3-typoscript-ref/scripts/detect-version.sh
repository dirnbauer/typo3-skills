#!/usr/bin/env bash
set -euo pipefail

# Detect TYPO3 major version from composer.json or composer.lock
# Usage: detect-version.sh [--path <dir>]
# Output: major version number (e.g., "13") or "main" if not found

SEARCH_DIR="${PWD}"
FALLBACK="main"

require_arg() {
    if [[ -z "${2:-}" ]] || [[ "${2:-}" == --* ]]; then
        echo "Error: $1 requires a value" >&2
        exit 1
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --path)
            require_arg "$1" "${2:-}"
            SEARCH_DIR="${2}"
            shift 2
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# Search for composer files up to 5 levels up
find_composer_file() {
    local dir="$1"
    local filename="$2"
    local level=0

    while [[ "$level" -le 5 ]]; do
        if [[ -f "${dir}/${filename}" ]]; then
            echo "${dir}/${filename}"
            return 0
        fi
        local parent
        parent="$(dirname "$dir")"
        if [[ "$parent" == "$dir" ]]; then
            break
        fi
        dir="$parent"
        level=$((level + 1))
    done

    return 1
}

# Extract version from composer.lock (exact installed version)
extract_from_lock() {
    local lockfile="$1"
    LOCKFILE="$lockfile" python3 -c "
import json, os, sys
try:
    data = json.load(open(os.environ['LOCKFILE']))
    for pkg in data.get('packages', []) + data.get('packages-dev', []):
        if pkg['name'] == 'typo3/cms-core':
            print(pkg['version'])
            sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

# Extract version from composer.json (requirement constraint)
extract_from_json() {
    local jsonfile="$1"
    JSONFILE="$jsonfile" python3 -c "
import json, os, sys
try:
    data = json.load(open(os.environ['JSONFILE']))
    for section in ['require', 'require-dev']:
        version = data.get(section, {}).get('typo3/cms-core', '')
        if version:
            print(version)
            sys.exit(0)
    sys.exit(1)
except Exception:
    sys.exit(1)
" 2>/dev/null
}

# Parse version string to major version number
# Examples: "v12.4.42" -> "12", "13.4.2" -> "13", "^13.4" -> "13",
#           "~12.4" -> "12", "dev-main" -> "main", ">=12.4,<13" -> "12"
parse_major_version() {
    local version_string="$1"

    if [[ "$version_string" == *"dev-main"* ]] || [[ "$version_string" == *"dev-master"* ]]; then
        echo "$FALLBACK"
        return 0
    fi

    local major
    major=$(echo "$version_string" | sed -E 's/^[^0-9]*//' | grep -oE '^[0-9]+' || true)

    if [[ -n "$major" ]]; then
        echo "$major"
        return 0
    fi

    echo "$FALLBACK"
}

# Main logic
version_string=""

# Try composer.lock first (has exact versions)
lockfile=""
if lockfile=$(find_composer_file "$SEARCH_DIR" "composer.lock"); then
    version_string=$(extract_from_lock "$lockfile") || true
fi

# Fallback to composer.json
if [[ -z "$version_string" ]]; then
    jsonfile=""
    if jsonfile=$(find_composer_file "$SEARCH_DIR" "composer.json"); then
        version_string=$(extract_from_json "$jsonfile") || true
    fi
fi

# Parse and output
if [[ -n "$version_string" ]]; then
    parse_major_version "$version_string"
else
    echo "$FALLBACK"
fi
