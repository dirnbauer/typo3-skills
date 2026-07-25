#!/usr/bin/env bash
#
# Install an opt-in pre-push hook that runs ./scripts/check.sh --fast.
#
# Opt-in on purpose: silently installing hooks into someone's clone is its own kind of rude,
# and a hook nobody chose is a hook they will disable at the first inconvenient moment.
#
#   ./scripts/install-hooks.sh            install
#   ./scripts/install-hooks.sh --remove   uninstall

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK="$ROOT/.git/hooks/pre-push"

if [ "${1:-}" = "--remove" ]; then
    if [ -f "$HOOK" ] && grep -q "check.sh --fast" "$HOOK"; then
        rm "$HOOK"
        echo "removed $HOOK"
    else
        echo "no hook of ours installed at $HOOK"
    fi
    exit 0
fi

if [ -f "$HOOK" ] && ! grep -q "check.sh --fast" "$HOOK"; then
    echo "refusing to overwrite an existing pre-push hook at $HOOK" >&2
    echo "inspect it, then move it aside if you want ours." >&2
    exit 1
fi

cat > "$HOOK" <<'EOF'
#!/usr/bin/env bash
# Installed by scripts/install-hooks.sh
# --fast skips the harness suite; CI runs the full set.
exec "$(git rev-parse --show-toplevel)/scripts/check.sh" --fast
EOF
chmod +x "$HOOK"

echo "installed $HOOK"
echo "it runs: ./scripts/check.sh --fast"
echo "bypass once with: git push --no-verify"
