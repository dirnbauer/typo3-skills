#!/usr/bin/env bash
set -euo pipefail

# All-in-one lookup script for TYPO3 TypoScript reference.
# Primary interface for Claude to query TypoScript docs, recipes,
# deprecations, checklists, lint rules, and debugging info.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
REPO_DIR="$(dirname "$(dirname "$SKILL_DIR")")"
CACHE_DIR="${REPO_DIR}/cache"
REFS_DIR="${SKILL_DIR}/references"

# Defaults
VERSION=""
WITH_FLUID=false
REVIEW=false
MODE="keyword"
RECIPE_NAME=""
CHECKLIST_TYPE=""
DEBUG_MSG=""
KEYWORDS=()

usage() {
    cat <<'EOF'
Usage: lookup.sh [keywords...] [options]

TYPO3 TypoScript Reference Lookup — all-in-one documentation query tool.

Modes:
  lookup.sh "stdWrap wrap"              Search for keywords in the topic index
  lookup.sh --recipe <name>             Output a recipe file
  lookup.sh --deprecations              List deprecations for the detected version
  lookup.sh --checklist <type>          Output review checklist (typoscript|tsconfig|fluid)
  lookup.sh --lint-rules                Show active lint rules for the current project
  lookup.sh --debug "error message"     Search debugging guide for matching error
  lookup.sh --update                    Fetch/update docs for the current version
  lookup.sh --help                      Show this help

Options:
  --version <ver>     Override TYPO3 major version (default: auto-detect)
  --with-fluid        Also search Fluid docs for matching topics
  --review            Append deprecation/migration notes if available

Examples:
  lookup.sh "TEXT" --version 13
  lookup.sh "stdWrap wrap" --version 13 --review
  lookup.sh --recipe page-setup
  lookup.sh --deprecations --version 12
  lookup.sh --checklist typoscript
  lookup.sh --lint-rules
  lookup.sh --debug "The page is not configured"
  lookup.sh --update
EOF
}

# --- Argument parsing ---

require_arg() {
    if [[ -z "${2:-}" ]] || [[ "${2:-}" == --* ]]; then
        echo "Error: $1 requires a value" >&2
        exit 1
    fi
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)
            require_arg "$1" "${2:-}"
            VERSION="${2}"
            shift 2
            ;;
        --with-fluid)
            WITH_FLUID=true
            shift
            ;;
        --review)
            REVIEW=true
            shift
            ;;
        --recipe)
            require_arg "$1" "${2:-}"
            MODE="recipe"
            RECIPE_NAME="${2}"
            shift 2
            ;;
        --deprecations)
            MODE="deprecations"
            shift
            ;;
        --checklist)
            require_arg "$1" "${2:-}"
            MODE="checklist"
            CHECKLIST_TYPE="${2}"
            shift 2
            ;;
        --lint-rules)
            MODE="lint-rules"
            shift
            ;;
        --debug)
            require_arg "$1" "${2:-}"
            MODE="debug"
            DEBUG_MSG="${2}"
            shift 2
            ;;
        --update)
            MODE="update"
            shift
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        -*)
            echo "Unknown option: $1" >&2
            echo "Run with --help for usage." >&2
            exit 1
            ;;
        *)
            KEYWORDS+=("$1")
            shift
            ;;
    esac
done

# --- Pre-flight checks ---

if ! command -v python3 &>/dev/null; then
    echo "Error: 'python3' is required but not found." >&2
    exit 1
fi

# --- Helper functions ---

# Detect TYPO3 version (uses detect-version.sh or --version flag)
validate_version() {
    local v="$1"
    if [[ ! "$v" =~ ^[a-zA-Z0-9._-]+$ ]]; then
        echo "Error: invalid version string: ${v}" >&2
        exit 1
    fi
}

resolve_version() {
    if [[ -n "$VERSION" ]]; then
        validate_version "$VERSION"
        echo "$VERSION"
        return
    fi

    local detected
    detected=$("${SCRIPT_DIR}/detect-version.sh" 2>/dev/null) || detected="main"
    echo "$detected"
}

# Map TYPO3 major version to docs version for a given source
# Usage: map_version <major_version> <source>
map_version() {
    local major="$1"
    local source="${2:-typoscript}"

    _REFS_DIR="$REFS_DIR" _VERSION="$major" _SOURCE="$source" python3 -c "
import json, os, sys
data = json.load(open(os.path.join(os.environ['_REFS_DIR'], 'version-map.json')))
typo3_map = data.get('typo3_to_docs', {})
version = os.environ['_VERSION']
source = os.environ['_SOURCE']

if version in typo3_map and source in typo3_map[version]:
    print(typo3_map[version][source])
    sys.exit(0)

# Fallback: use as-is
print(data.get('fallback_version', 'main'))
" 2>/dev/null
}

# Check if cache exists for a given docs version and source
check_cache() {
    local docs_version="$1"
    local source="${2:-typoscript}"
    local cache_path="${CACHE_DIR}/${docs_version}/${source}"

    if [[ ! -d "$cache_path" ]]; then
        echo "Cache not found: ${cache_path}" >&2
        echo "Run 'lookup.sh --update' to fetch documentation." >&2
        return 1
    fi
    return 0
}

# Resolve a topic-index path to an actual cache file path.
# The topic-index uses human-readable paths (e.g., content-objects/text.md)
# while the cache uses lowercased directory names from the RST source
# (e.g., contentobjects/text.md). This function tries multiple variants.
resolve_cache_path() {
    local cache_base="$1"
    local index_path="$2"

    # Direct match
    if [[ -f "${cache_base}/${index_path}" ]]; then
        echo "${cache_base}/${index_path}"
        return 0
    fi

    # Try removing hyphens from directory names
    local no_hyphens
    no_hyphens="${index_path//-/}"
    if [[ -f "${cache_base}/${no_hyphens}" ]]; then
        echo "${cache_base}/${no_hyphens}"
        return 0
    fi

    # Try mapping known path prefixes
    local mapped_path="$index_path"
    mapped_path="${mapped_path/content-objects\//contentobjects/}"
    mapped_path="${mapped_path/data-processors\//dataprocessing/}"
    mapped_path="${mapped_path/frontend\//toplevelobjects/}"
    mapped_path="${mapped_path/backend\/page-tsconfig\//pagetsconfig/}"
    mapped_path="${mapped_path/backend\/user-tsconfig\//usertsconfig/}"
    mapped_path="${mapped_path/about\//}"

    if [[ -f "${cache_base}/${mapped_path}" ]]; then
        echo "${cache_base}/${mapped_path}"
        return 0
    fi

    # Try removing all hyphens from the mapped path too
    local mapped_no_hyphens
    mapped_no_hyphens="${mapped_path//-/}"
    if [[ -f "${cache_base}/${mapped_no_hyphens}" ]]; then
        echo "${cache_base}/${mapped_no_hyphens}"
        return 0
    fi

    # Last resort: search for a file with the same basename
    local basename_file
    basename_file=$(basename "$index_path")
    local found
    found=$(find "$cache_base" -name "$basename_file" -type f 2>/dev/null | head -1)
    if [[ -n "$found" ]]; then
        echo "$found"
        return 0
    fi

    return 1
}

# --- Mode: Keyword Lookup ---

mode_keyword() {
    if [[ ${#KEYWORDS[@]} -eq 0 ]]; then
        echo "Error: no search keywords provided." >&2
        echo "Usage: lookup.sh \"keyword\" [--version <ver>]" >&2
        exit 1
    fi

    local major
    major=$(resolve_version)
    echo "TYPO3 version: ${major}" >&2

    local docs_version
    docs_version=$(map_version "$major" "typoscript")
    echo "Docs version: ${docs_version}" >&2

    # Cache path uses major version (matching fetch-docs.sh output)
    local ts_cache="${CACHE_DIR}/${major}/typoscript"
    if ! check_cache "$major" "typoscript"; then
        # Fallback: try docs_version path (legacy cache layout)
        ts_cache="${CACHE_DIR}/${docs_version}/typoscript"
        if ! check_cache "$docs_version" "typoscript"; then
            exit 1
        fi
    fi

    local topic_index="${REFS_DIR}/topic-index.md"
    if [[ ! -f "$topic_index" ]]; then
        echo "Error: topic-index.md not found at ${topic_index}" >&2
        exit 1
    fi

    # Search topic-index.md for matching keywords
    local matched_files=()
    local search_term

    for search_term in "${KEYWORDS[@]}"; do
        while IFS= read -r line; do
            # Extract the file path from pipe-delimited table rows
            # Format: | keyword1, keyword2 | path/to/file.md |
            local file_path
            file_path=$(echo "$line" | sed -E 's/^[[:space:]]*\|[[:space:]]*[^|]+\|[[:space:]]*//' | sed -E 's/[[:space:]]*\|[[:space:]]*$//')

            if [[ -n "$file_path" ]] && [[ "$file_path" != "File" ]]; then
                # Avoid duplicates
                local already_added=false
                for existing in "${matched_files[@]+"${matched_files[@]}"}"; do
                    if [[ "$existing" == "$file_path" ]]; then
                        already_added=true
                        break
                    fi
                done
                if [[ "$already_added" == false ]]; then
                    matched_files+=("$file_path")
                fi
            fi
        done < <(grep -iF "$search_term" "$topic_index" | grep '|' || true)
    done

    local found_any=false

    # Output matched files from topic index
    if [[ ${#matched_files[@]} -gt 0 ]]; then
        for rel_file in "${matched_files[@]}"; do
            local resolved_path
            if resolved_path=$(resolve_cache_path "$ts_cache" "$rel_file"); then
                local display_name
                display_name="${resolved_path#"${ts_cache}/"}"
                echo "--- ${display_name} ---"
                cat "$resolved_path"
                echo ""
                found_any=true
            else
                echo "Warning: referenced file not found for index entry: ${rel_file}" >&2
            fi
        done
    fi

    # Fallback: grep across all cached .md files if no topic-index match
    if [[ "$found_any" == false ]]; then
        echo "No topic-index match. Searching cache files..." >&2
        local seen_files=()
        for search_term in "${KEYWORDS[@]}"; do
            local grep_results
            grep_results=$(grep -rilF "$search_term" "$ts_cache" 2>/dev/null || true)
            if [[ -n "$grep_results" ]]; then
                while IFS= read -r match_file; do
                    # Deduplicate across keywords
                    local already_seen=false
                    for seen in "${seen_files[@]+"${seen_files[@]}"}"; do
                        if [[ "$seen" == "$match_file" ]]; then
                            already_seen=true
                            break
                        fi
                    done
                    if [[ "$already_seen" == true ]]; then
                        continue
                    fi
                    seen_files+=("$match_file")
                    local rel
                    rel="${match_file#"${ts_cache}/"}"
                    echo "--- ${rel} (grep match) ---"
                    cat "$match_file"
                    echo ""
                    found_any=true
                done <<< "$grep_results"
            fi
        done
    fi

    # Search Fluid docs if requested
    if [[ "$WITH_FLUID" == true ]]; then
        local fluid_version
        fluid_version=$(map_version "$major" "fluid")
        # Cache path uses major version (matching fetch-docs.sh output)
        local fluid_cache="${CACHE_DIR}/${major}/fluid"
        if [[ ! -d "$fluid_cache" ]]; then
            # Fallback: try docs_version path (legacy cache layout)
            fluid_cache="${CACHE_DIR}/${fluid_version}/fluid"
        fi

        if [[ -d "$fluid_cache" ]]; then
            echo "--- Fluid docs (${fluid_version}) ---" >&2
            local seen_fluid=()
            for search_term in "${KEYWORDS[@]}"; do
                local fluid_results
                fluid_results=$(grep -rilF "$search_term" "$fluid_cache" 2>/dev/null || true)
                if [[ -n "$fluid_results" ]]; then
                    while IFS= read -r match_file; do
                        # Deduplicate across keywords
                        local already_seen=false
                        for seen in "${seen_fluid[@]+"${seen_fluid[@]}"}"; do
                            if [[ "$seen" == "$match_file" ]]; then
                                already_seen=true
                                break
                            fi
                        done
                        if [[ "$already_seen" == true ]]; then
                            continue
                        fi
                        seen_fluid+=("$match_file")
                        local rel
                        rel="${match_file#"${fluid_cache}/"}"
                        echo "--- fluid/${rel} ---"
                        cat "$match_file"
                        echo ""
                    done <<< "$fluid_results"
                fi
            done
        else
            echo "Fluid cache not available at ${fluid_cache}" >&2
        fi
    fi

    # Append deprecation/migration notes if --review
    if [[ "$REVIEW" == true ]]; then
        local deprecations_file="${REFS_DIR}/review/deprecations.md"
        if [[ -f "$deprecations_file" ]]; then
            echo ""
            echo "=== Deprecation / Migration Notes ==="
            for search_term in "${KEYWORDS[@]}"; do
                grep -iF -A 5 "$search_term" "$deprecations_file" 2>/dev/null || true
            done
        else
            echo "Note: deprecations.md not yet available at ${deprecations_file}" >&2
        fi
    fi

    if [[ "$found_any" == false ]]; then
        echo "No results found for: ${KEYWORDS[*]}" >&2
        exit 1
    fi
}

# --- Mode: Recipe ---

mode_recipe() {
    if [[ ! "$RECIPE_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        echo "Error: invalid recipe name: ${RECIPE_NAME}" >&2
        echo "Recipe names may only contain letters, digits, hyphens, and underscores." >&2
        exit 1
    fi

    local recipe_dir="${REFS_DIR}/recipes"
    local recipe_file="${recipe_dir}/${RECIPE_NAME}.md"

    if [[ -f "$recipe_file" ]]; then
        cat "$recipe_file"
    else
        echo "Recipe not found: ${RECIPE_NAME}" >&2
        echo "" >&2
        if [[ -d "$recipe_dir" ]]; then
            local recipes
            recipes=$(find "$recipe_dir" -name '*.md' -type f 2>/dev/null || true)
            if [[ -n "$recipes" ]]; then
                echo "Available recipes:" >&2
                while IFS= read -r f; do
                    local name
                    name=$(basename "$f" .md)
                    echo "  - ${name}" >&2
                done <<< "$recipes"
            else
                echo "No recipes available yet." >&2
            fi
        else
            echo "Recipes directory does not exist yet." >&2
        fi
        exit 1
    fi
}

# --- Mode: Deprecations ---

mode_deprecations() {
    local deprecations_file="${REFS_DIR}/review/deprecations.md"

    if [[ ! -f "$deprecations_file" ]]; then
        echo "Deprecations file not yet available at ${deprecations_file}" >&2
        echo "This file will be created in a future task." >&2
        exit 1
    fi

    if [[ -n "$VERSION" ]]; then
        validate_version "$VERSION"
        # Filter to the version's section
        # Sections are expected as ## v12, ## v13, etc.
        local section_found=false
        local in_section=false
        while IFS= read -r line; do
            if [[ "$line" =~ ^##[[:space:]] ]]; then
                if echo "$line" | grep -qi "v${VERSION}\|version ${VERSION}\|${VERSION}\."; then
                    in_section=true
                    section_found=true
                    echo "$line"
                else
                    if [[ "$in_section" == true ]]; then
                        break
                    fi
                fi
            elif [[ "$in_section" == true ]]; then
                echo "$line"
            fi
        done < "$deprecations_file"

        if [[ "$section_found" == false ]]; then
            echo "No deprecations section found for version ${VERSION}." >&2
            echo "Showing full file:" >&2
            cat "$deprecations_file"
        fi
    else
        cat "$deprecations_file"
    fi
}

# --- Mode: Checklist ---

mode_checklist() {
    local checklist_file="${REFS_DIR}/review/review-checklist.md"

    if [[ ! -f "$checklist_file" ]]; then
        echo "Review checklist not yet available at ${checklist_file}" >&2
        echo "This file will be created in a future task." >&2
        exit 1
    fi

    case "$CHECKLIST_TYPE" in
        typoscript|tsconfig|fluid)
            ;;
        *)
            echo "Error: checklist type must be one of: typoscript, tsconfig, fluid" >&2
            exit 1
            ;;
    esac

    # Extract the matching section (case-insensitive heading match)
    local in_section=false
    local section_found=false
    while IFS= read -r line; do
        if [[ "$line" =~ ^##[[:space:]] ]]; then
            if echo "$line" | grep -qi "$CHECKLIST_TYPE"; then
                in_section=true
                section_found=true
                echo "$line"
            else
                if [[ "$in_section" == true ]]; then
                    break
                fi
            fi
        elif [[ "$in_section" == true ]]; then
            echo "$line"
        fi
    done < "$checklist_file"

    if [[ "$section_found" == false ]]; then
        echo "No section found for '${CHECKLIST_TYPE}' in review checklist." >&2
        echo "Showing full file:" >&2
        cat "$checklist_file"
    fi
}

# --- Mode: Lint Rules ---

mode_lint_rules() {
    local linting_ref="${REFS_DIR}/review/linting.md"

    # Search for project lint config
    local config_file=""
    local search_dir="${PWD}"
    local level=0

    while [[ "$level" -le 5 ]]; do
        for name in ".typoscript-lint.yml" "typoscript-lint.yml" "tslint.yml"; do
            if [[ -f "${search_dir}/${name}" ]]; then
                config_file="${search_dir}/${name}"
                break 2
            fi
        done
        local parent
        parent="$(dirname "$search_dir")"
        if [[ "$parent" == "$search_dir" ]]; then
            break
        fi
        search_dir="$parent"
        level=$((level + 1))
    done

    if [[ -n "$config_file" ]]; then
        echo "Found lint config: ${config_file}"
        echo ""

        # Parse YAML with Python to extract sniff configuration
        _CONFIG_FILE="$config_file" python3 -c "
import os, sys
config_file = os.environ['_CONFIG_FILE']
try:
    import yaml
except ImportError:
    # Fallback: simple text-based parsing
    print('(yaml module not available, showing raw config)')
    with open(config_file) as f:
        print(f.read())
    sys.exit(0)

with open(config_file) as f:
    config = yaml.safe_load(f)

sniffs = config.get('sniffs', []) if config else []
if not sniffs:
    print('No sniff configuration found in config file.')
    sys.exit(0)

print('Active lint rules from project config:')
print('| Rule | Status |')
print('|------|--------|')

if isinstance(sniffs, list):
    for sniff in sniffs:
        if isinstance(sniff, dict):
            name = sniff.get('class', 'unknown')
            disabled = sniff.get('disabled', False)
            status = 'disabled' if disabled else 'active'
            print(f'| {name} | {status} |')
elif isinstance(sniffs, dict):
    for sniff_name, sniff_config in sorted(sniffs.items()):
        if isinstance(sniff_config, dict):
            disabled = sniff_config.get('disabled', False)
            status = 'disabled' if disabled else 'active'
        else:
            status = 'active'
        print(f'| {sniff_name} | {status} |')
" 2>/dev/null || echo "Error parsing lint config." >&2

    # No project lint config found
    else
        echo "No project lint config found (.typoscript-lint.yml, typoscript-lint.yml, tslint.yml)."
        echo ""
    fi

    # Show default rules from linting reference
    if [[ -f "$linting_ref" ]]; then
        echo ""
        echo "=== Default Lint Rules Reference ==="
        cat "$linting_ref"
    else
        echo "Linting reference not yet available at ${linting_ref}" >&2
    fi
}

# --- Mode: Debug ---

mode_debug() {
    local debug_file="${REFS_DIR}/debugging.md"

    if [[ ! -f "$debug_file" ]]; then
        echo "Debugging guide not yet available at ${debug_file}" >&2
        echo "This file will be created in a future task." >&2
        echo "" >&2
        echo "General advice: Check the TYPO3 System Log (Admin Tools > Log)" >&2
        exit 1
    fi

    # Search for matching error (case-insensitive), output the section
    local found=false
    local in_section=false

    while IFS= read -r line; do
        # Detect section headers (## or ###)
        if [[ "$line" =~ ^##[#]?[[:space:]] ]]; then
            if [[ "$in_section" == true ]]; then
                # End of previous matching section
                echo ""
            fi
            if echo "$line" | grep -qiF "$DEBUG_MSG"; then
                in_section=true
                found=true
                echo "$line"
            else
                in_section=false
            fi
        elif [[ "$in_section" == true ]]; then
            echo "$line"
        fi
    done < "$debug_file"

    # Also try grep-based search in case the error text is in the body
    if [[ "$found" == false ]]; then
        local grep_match
        grep_match=$(grep -inF "$DEBUG_MSG" "$debug_file" 2>/dev/null || true)
        if [[ -n "$grep_match" ]]; then
            echo "Matching lines in debugging.md:"
            echo "$grep_match"
            found=true
        fi
    fi

    if [[ "$found" == false ]]; then
        echo "No matching error found for: ${DEBUG_MSG}"
        echo ""
        echo "Suggestions:"
        echo "  - Check the TYPO3 System Log (Admin Tools > Log)"
        echo "  - Check the webserver error log"
        echo "  - Enable debug output in Site Configuration or TypoScript (DEV ONLY — never in production):"
        echo "    config.contentObjectExceptionHandler = 0"
        echo "    (Remove before deploying to production!)"
    fi
}

# --- Mode: Update ---

mode_update() {
    local major
    major=$(resolve_version)
    echo "Updating docs for TYPO3 version: ${major}" >&2

    local sources=("typoscript" "fluid" "viewhelpers" "coreapi")

    for source in "${sources[@]}"; do
        echo "" >&2
        echo "=== Fetching ${source} ===" >&2
        "${SCRIPT_DIR}/fetch-docs.sh" --version "$major" --source "$source" --annotate 2>&1 || {
            echo "Warning: failed to fetch ${source} docs." >&2
        }
    done

    echo "" >&2
    echo "Update complete." >&2
}

# --- Main dispatch ---

case "$MODE" in
    keyword)
        mode_keyword
        ;;
    recipe)
        mode_recipe
        ;;
    deprecations)
        mode_deprecations
        ;;
    checklist)
        mode_checklist
        ;;
    lint-rules)
        mode_lint_rules
        ;;
    debug)
        mode_debug
        ;;
    update)
        mode_update
        ;;
    *)
        echo "Unknown mode: ${MODE}" >&2
        exit 1
        ;;
esac
