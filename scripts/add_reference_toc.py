#!/usr/bin/env python3
"""Insert a `## Contents` list into owned skill markdown that is long enough to need one.

Anthropic's skill authoring guidance asks for a table of contents on any reference file over
100 lines, so an agent that previews only the head of a file still sees its full scope.
`validate_structure.py` enforces the threshold; this script does the mechanical part.

Vendored skills are skipped: their files stay byte-identical to upstream.

Usage:
    python3 scripts/add_reference_toc.py            list files that need a contents list
    python3 scripts/add_reference_toc.py --write    insert it
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_structure import ROOT, has_toc, outside_fences, owned_markdown, vendored  # noqa: E402

THRESHOLD = 100


def anchor(heading: str, seen: dict[str, int]) -> str:
    """GitHub-style heading anchor, with -1, -2 suffixes for repeats."""
    text = re.sub(r"`|\*\*|\*|_", "", heading).strip().lower()
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    slug = re.sub(r"[^\w\- ]", "", text).replace(" ", "-")
    count = seen.get(slug, 0)
    seen[slug] = count + 1
    return slug if count == 0 else f"{slug}-{count}"


def contents(lines: list[str]) -> list[str]:
    headings = [(no, line) for no, line in outside_fences(lines) if re.match(r"^#{2,3} ", line)]
    # A file split out of a larger SKILL.md often repeats its title as the only `##` heading.
    level = "## " if sum(line.startswith("## ") for _, line in headings) >= 2 else "### "
    seen: dict[str, int] = {}
    items = []
    for _, line in headings:
        title = line[3:].strip() if line.startswith("## ") else line[4:].strip()
        slug = anchor(title, seen)
        if line.startswith(level):
            items.append(f"- [{re.sub(r'[`*]', '', title)}](#{slug})")
    return items


def insert(lines: list[str]) -> list[str] | None:
    items = contents(lines)
    if len(items) < 2:
        return None
    block = ["## Contents", "", *items, ""]
    body = list(outside_fences(lines))
    first_h2 = next((no for no, line in body if line.startswith("## ")), None)
    h1 = next((no for no, line in body if line.startswith("# ")), None)
    if first_h2 is not None and first_h2 <= 40:
        at = first_h2 - 1
    elif h1 is not None:
        at = h1 + 1 if h1 < len(lines) and lines[h1].strip() else h1
        block = ["", *block]
    else:
        at = 0
    return lines[:at] + block + lines[at:]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    skip = vendored()
    pending = 0
    for ref in owned_markdown(skip):
        lines = ref.read_text(encoding="utf-8").split("\n")
        if len(lines) <= THRESHOLD or has_toc(lines):
            continue
        updated = insert(lines)
        rel = ref.relative_to(ROOT)
        if updated is None:
            print(f"  needs manual navigation (fewer than two headings): {rel}")
            pending += 1
            continue
        if args.write:
            ref.write_text("\n".join(updated), encoding="utf-8")
            print(f"  added contents: {rel}")
        else:
            print(f"  missing contents: {rel}")
            pending += 1
    return 1 if pending else 0


if __name__ == "__main__":
    raise SystemExit(main())
