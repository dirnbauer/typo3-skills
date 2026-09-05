#!/usr/bin/env bash
set -euo pipefail

# Download TYPO3 documentation .rst files from GitHub, convert to Markdown
# via rst2md.py, and store in a local cache directory.
#
# Usage: fetch-docs.sh --version <version> [--source <source>] [--cache-dir <path>] [--annotate]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERSION_MAP="${SCRIPT_DIR}/../references/version-map.json"
ANNOTATIONS_FILE="${SCRIPT_DIR}/../references/annotations.json"
RST2MD="${SCRIPT_DIR}/rst2md.py"

VERSION=""
SOURCE="typoscript"
CACHE_DIR="${SCRIPT_DIR}/../../../cache"
ANNOTATE=false

# Validate that a flag has a non-empty, non-flag value
require_arg() {
    if [[ -z "${2:-}" ]] || [[ "${2:-}" == --* ]]; then
        echo "Error: $1 requires a value" >&2
        exit 1
    fi
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version)
            require_arg "$1" "${2:-}"
            VERSION="${2}"
            shift 2
            ;;
        --source)
            require_arg "$1" "${2:-}"
            SOURCE="${2}"
            shift 2
            ;;
        --cache-dir)
            require_arg "$1" "${2:-}"
            CACHE_DIR="${2}"
            shift 2
            ;;
        --annotate)
            ANNOTATE=true
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Usage: fetch-docs.sh --version <version> [--source <source>] [--cache-dir <path>] [--annotate]" >&2
            exit 1
            ;;
    esac
done

if [[ -z "$VERSION" ]]; then
    echo "Error: --version is required" >&2
    exit 1
fi

if [[ ! "$VERSION" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "Error: invalid version string: ${VERSION}" >&2
    exit 1
fi

if ! command -v gh &>/dev/null; then
    echo "Error: 'gh' (GitHub CLI) is required but not found." >&2
    echo "Install it: https://cli.github.com/" >&2
    exit 1
fi

# Validate source
case "$SOURCE" in
    typoscript|fluid|viewhelpers|coreapi) ;;
    *)
        echo "Error: --source must be one of: typoscript, fluid, viewhelpers, coreapi" >&2
        exit 1
        ;;
esac

# Resolve repo and branch from version-map.json
REPO=$(_VERSION_MAP="$VERSION_MAP" _SOURCE="$SOURCE" python3 -c "
import json, os, sys
data = json.load(open(os.environ['_VERSION_MAP']))
source = os.environ['_SOURCE']
repo = data.get('github_repos', {}).get(source, '')
if not repo:
    print(f'Error: no repo for source {source}', file=sys.stderr)
    sys.exit(1)
print(repo)
")

BRANCH=$(_VERSION_MAP="$VERSION_MAP" _VERSION="$VERSION" _SOURCE="$SOURCE" python3 -c "
import json, os, sys
data = json.load(open(os.environ['_VERSION_MAP']))
version = os.environ['_VERSION']
source = os.environ['_SOURCE']

# First check if it's a TYPO3 major version that needs mapping
typo3_map = data.get('typo3_to_docs', {})
if version in typo3_map and source in typo3_map[version]:
    print(typo3_map[version][source])
    sys.exit(0)

# Otherwise use as-is (it's already the branch/tag)
print(version)
")

echo "Fetching ${SOURCE} docs from ${REPO} @ ${BRANCH}"
echo "Cache directory: ${CACHE_DIR}"

OUTPUT_DIR="${CACHE_DIR}/${VERSION}/${SOURCE}"
mkdir -p "$OUTPUT_DIR"

# List all files in the Documentation/ directory via GitHub API
echo "Listing repository tree..."
TREE_JSON=$(gh api "repos/${REPO}/git/trees/${BRANCH}?recursive=1" --jq '.tree[] | select(.path | startswith("Documentation/")) | .path')

if [[ -z "$TREE_JSON" ]]; then
    echo "Error: no files found in Documentation/ directory" >&2
    exit 1
fi

# Source-specific path filter (only download files matching this prefix)
DOC_PATH_FILTER="Documentation/"
case "$SOURCE" in
    coreapi) DOC_PATH_FILTER="Documentation/ApiOverview/Fluid/" ;;
esac

# Filter to .rst files only, excluding non-content paths
RST_FILES=()
while IFS= read -r filepath; do
    # Only .rst files
    [[ "$filepath" != *.rst ]] && continue

    # Apply source-specific path filter
    [[ "$filepath" != "${DOC_PATH_FILTER}"* ]] && continue

    # Exclude non-content directories
    [[ "$filepath" == *"_includes/"* ]] && continue
    [[ "$filepath" == *"_snippets/"* ]] && continue
    [[ "$filepath" == *"CodeSnippets/"* ]] && continue
    [[ "$filepath" == *"Images/"* ]] && continue
    [[ "$filepath" == *"_ext/"* ]] && continue

    # Exclude meta files
    basename_file=$(basename "$filepath")
    case "$basename_file" in
        Sitemap.rst|genindex.rst|search.rst|Targets.rst|404.rst) continue ;;
    esac

    RST_FILES+=("$filepath")
done <<< "$TREE_JSON"

TOTAL=${#RST_FILES[@]}
echo "Found ${TOTAL} .rst files to convert"

if [[ "$TOTAL" -eq 0 ]]; then
    echo "No .rst files to process."
    exit 0
fi

# Convert a Documentation/ path to a cache path
# Documentation/ContentObjects/Text/Index.rst → contentobjects/text.md
# Documentation/Functions/Stdwrap.rst → functions/stdwrap.md
path_to_cache() {
    local src_path="$1"

    # Remove Documentation/ prefix
    local rel="${src_path#Documentation/}"

    # Replace Index.rst with directory-based name
    if [[ "$(basename "$rel")" == "Index.rst" ]]; then
        # Remove /Index.rst, use the last directory component as filename
        local dir_part
        dir_part="$(dirname "$rel")"

        # Top-level Index.rst → index.rst
        if [[ "$dir_part" == "." ]]; then
            rel="index.rst"
        else
            local parent_dir
            parent_dir="$(dirname "$dir_part")"
            local base_name
            base_name="$(basename "$dir_part")"

            if [[ "$parent_dir" == "." ]]; then
                rel="${base_name}.rst"
            else
                rel="${parent_dir}/${base_name}.rst"
            fi
        fi
    fi

    # Lowercase everything
    rel=$(echo "$rel" | tr '[:upper:]' '[:lower:]')

    # Change extension to .md
    rel="${rel%.rst}.md"

    echo "$rel"
}

# Download and convert a single file
# Returns 0 on success, 1 on failure
download_and_convert() {
    local src_path="$1"
    local cache_path="$2"
    local full_path="${OUTPUT_DIR}/${cache_path}"

    mkdir -p "$(dirname "$full_path")"

    # Download raw content via GitHub API, decode base64
    local content
    if ! content=$(gh api "repos/${REPO}/contents/${src_path}?ref=${BRANCH}" --jq '.content' 2>/dev/null); then
        return 1
    fi

    if [[ -z "$content" ]] || [[ "$content" == "null" ]]; then
        return 1
    fi

    # Decode base64 and convert via rst2md.py
    if ! echo "$content" | base64 -d | python3 "$RST2MD" > "$full_path" 2>/dev/null; then
        rm -f "$full_path"
        return 1
    fi

    # Check if output file is non-empty
    if [[ ! -s "$full_path" ]]; then
        rm -f "$full_path"
        return 1
    fi

    return 0
}

# Process files in batches of 5
BATCH_SIZE=5
SUCCESS=0
ERRORS=0
COUNT=0

for ((idx=0; idx < TOTAL; idx++)); do
    filepath="${RST_FILES[$idx]}"
    cache_path=$(path_to_cache "$filepath")
    COUNT=$((COUNT + 1))

    echo "[${COUNT}/${TOTAL}] Converting ${filepath}"

    download_and_convert "$filepath" "$cache_path" &
    PIDS[idx]=$!

    # Every BATCH_SIZE files, wait for the batch to complete
    if (( (idx + 1) % BATCH_SIZE == 0 )) || (( idx + 1 == TOTAL )); then
        # Wait for all background jobs in this batch
        batch_start=$(( idx - (idx % BATCH_SIZE) ))
        for ((j=batch_start; j <= idx; j++)); do
            if wait "${PIDS[$j]}" 2>/dev/null; then
                SUCCESS=$((SUCCESS + 1))
            else
                ERRORS=$((ERRORS + 1))
                echo "  Warning: failed to process ${RST_FILES[$j]}" >&2
            fi
        done
    fi
done

echo ""
echo "--- Summary ---"
echo "Downloaded ${SUCCESS} files, ${ERRORS} errors"
echo "Output directory: ${OUTPUT_DIR}"

# Apply annotations if requested
if [[ "$ANNOTATE" == true ]] && [[ -f "$ANNOTATIONS_FILE" ]]; then
    echo ""
    echo "Applying annotations..."

    _ANNOTATIONS_FILE="$ANNOTATIONS_FILE" _OUTPUT_DIR="$OUTPUT_DIR" _VERSION="$VERSION" python3 -c "
import json, os, re, sys

annotations_file = os.environ['_ANNOTATIONS_FILE']
output_dir = os.environ['_OUTPUT_DIR']
version = os.environ['_VERSION']

# Explicit mapping from annotation keys to actual cache file paths (relative to output_dir).
# Annotation keys use logical names with hyphens; cache paths use lowercased, hyphen-free names
# that match the RST directory structure after conversion.
PATH_MAP = {
    'content-objects/fluidtemplate': 'contentobjects/fluidtemplate.md',
    'content-objects/pageview':      'contentobjects/pageview.md',
    'content-objects/hmenu':         'contentobjects/hmenu.md',
    'content-objects/content':       'contentobjects/content.md',
    'content-objects/user':          'contentobjects/useranduserint.md',
    'content-objects/coa':           'contentobjects/coaandcoaint.md',
    'content-objects/records':       'contentobjects/records.md',
    'frontend/conditions':           'conditions.md',
    'frontend/config':               'toplevelobjects/config.md',
    'about/usage':                   'usingsetting/entering.md',
    'functions/stdwrap':             'functions/stdwrap.md',
    'functions/typolink':            'functions/typolink.md',
    'data-processors/database-query-processor': 'dataprocessing/databasequeryprocessor.md',
    'data-processors/menu-processor':           'dataprocessing/menuprocessor.md',
    'backend/page-tsconfig/tceform': 'pagetsconfig/tceform.md',
}

LEVEL_LABELS = {
    'required':    'REQUIRED',
    'deprecated':  'DEPRECATED',
    'recommended': 'RECOMMENDED',
    'tip':         'TIP',
}

with open(annotations_file) as f:
    all_annotations = json.load(f)

annotations = all_annotations.get(version, {})

# Fallback: if version is a docs branch name (e.g. main), try mapping
# to the TYPO3 major version by checking which major maps to this branch.
if not annotations:
    version_map_path = os.path.join(os.path.dirname(annotations_file), 'version-map.json')
    if os.path.isfile(version_map_path):
        with open(version_map_path) as vm:
            vmap = json.load(vm)
        for major, sources in vmap.get('typo3_to_docs', {}).items():
            if sources.get('typoscript') == version:
                annotations = all_annotations.get(major, {})
                if annotations:
                    break

if not annotations:
    print(f'No annotations found for version {version}')
    sys.exit(0)

count = 0
skipped = 0
for ann_key, ann in annotations.items():
    cache_rel = PATH_MAP.get(ann_key)
    if cache_rel is None:
        print(f'  Warning: no path mapping for annotation key \"{ann_key}\"', file=sys.stderr)
        skipped += 1
        continue

    md_file = os.path.join(output_dir, cache_rel)
    if not os.path.isfile(md_file):
        print(f'  Warning: cache file not found: {md_file}', file=sys.stderr)
        skipped += 1
        continue

    level = ann.get('level', 'tip')
    message = ann.get('message', '')
    if not message:
        skipped += 1
        continue

    label = LEVEL_LABELS.get(level, level.upper())
    blockquote_lines = [f'> **{label} (v{version}):** {message}']

    recipe = ann.get('recipe')
    migration = ann.get('migration')
    if recipe or migration:
        parts = []
        if recipe:
            parts.append(f'Recipe: {recipe}')
        if migration:
            parts.append(f'Migration: {migration}')
        blockquote_lines.append('> ' + ' | '.join(parts))

    blockquote = '\n'.join(blockquote_lines) + '\n\n'

    with open(md_file, 'r') as f:
        content = f.read()

    # Strip existing annotation (idempotency — only one annotation expected).
    # Match only our annotation format, not converted RST admonitions (> **Note:**).
    if re.match(r'> \*\*(REQUIRED|DEPRECATED|RECOMMENDED|TIP) \(v', content):
        lines_list = content.split('\n')
        idx = 0
        while idx < len(lines_list) and (lines_list[idx].startswith('> ') or lines_list[idx] == '>'):
            idx += 1
        while idx < len(lines_list) and lines_list[idx].strip() == '':
            idx += 1
        content = '\n'.join(lines_list[idx:])

    with open(md_file, 'w') as f:
        f.write(blockquote + content)

    count += 1

print(f'Applied {count} annotations ({skipped} skipped)')
"
fi

echo "Done."
