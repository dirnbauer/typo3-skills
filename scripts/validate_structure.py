#!/usr/bin/env python3
"""Enforce SKILL-SPEC.md S6 and S7 — directives and progressive disclosure.

S6: write directives, not hedged suggestions. Soft phrasing is discarded under pressure.
S7: SKILL.md stays under 500 lines; any other owned markdown file over 100 lines carries a table
    of contents, and only SKILL.md carries skill frontmatter.

These two rules existed as prose before this script did, and prose rules do not hold. A
sweep found four owned references over 300 lines with no navigation, which is precisely the
failure the rules describe: a reference nobody can navigate gets loaded whole, and loading
everything defeats progressive disclosure.

Vendored skills are exempt — they are upstream artefacts kept byte-identical.

Usage:
    python3 scripts/validate_structure.py [--max-skill-lines 500] [--max-ref-lines 100] [--json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"
VENDORED = ROOT / "VENDORED.md"

HEDGE = re.compile(
    r"\b(is recommended|it is advisable|you may want to|consider using|"
    r"generally recommended|should probably|it might be (a )?good|"
    r"we suggest|perhaps use|could be worth)\b",
    re.I,
)

TOC_MARKERS = ("## contents", "table of contents", "## toc", "## index")


def vendored() -> set[str]:
    if not VENDORED.is_file():
        return set()
    return set(re.findall(r"^\|\s*`([a-z0-9-]+)`\s*\|", VENDORED.read_text(encoding="utf-8"), re.M))


def outside_fences(lines: list[str]):
    """Yield (line_no, text) for lines outside code fences.

    Without this, a bash comment like `# DDEV` reads as a heading and every shell snippet
    pollutes the structure check.
    """
    fence = False
    for i, line in enumerate(lines, 1):
        if line.lstrip().startswith("```"):
            fence = not fence
            continue
        if not fence:
            yield i, line


def owned_markdown(skip: set[str]):
    """Every markdown file an owned skill ships besides SKILL.md.

    Run-directory and project templates are copied into projects as they are, so their
    frontmatter and length belong to the template, not to the skill's navigation.
    """
    for path in sorted(SKILLS.glob("*/**/*.md")):
        rel = path.relative_to(SKILLS).parts
        if rel[0] in skip or path.name == "SKILL.md":
            continue
        if any(part in ("templates", "node_modules", "evals") for part in rel[1:-1]):
            continue
        yield path


def has_toc(lines: list[str]) -> bool:
    head = "\n".join(lines[:60]).lower()
    return any(m in head for m in TOC_MARKERS)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--max-skill-lines", type=int, default=500)
    ap.add_argument("--max-ref-lines", type=int, default=100)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    skip = vendored()
    findings: list[dict] = []
    checked = {"skills": 0, "references": 0}

    for skill_md in sorted(SKILLS.glob("*/SKILL.md")):
        name = skill_md.parts[-2]
        if name in skip:
            continue
        checked["skills"] += 1
        lines = skill_md.read_text(encoding="utf-8", errors="ignore").split("\n")

        if len(lines) > args.max_skill_lines:
            findings.append({
                "rule": "S7", "skill": name, "file": str(skill_md.relative_to(ROOT)),
                "detail": f"SKILL.md is {len(lines)} lines, over {args.max_skill_lines}; move detail into references/",
            })

        for no, line in outside_fences(lines):
            if HEDGE.search(line):
                findings.append({
                    "rule": "S6", "skill": name, "file": f"{skill_md.relative_to(ROOT)}:{no}",
                    "detail": f"hedged phrasing: {line.strip()[:80]}",
                })

    for ref in owned_markdown(skip):
        name = ref.relative_to(SKILLS).parts[0]
        checked["references"] += 1
        text = ref.read_text(encoding="utf-8", errors="ignore")
        lines = text.split("\n")
        if len(lines) > args.max_ref_lines and not has_toc(lines):
            findings.append({
                "rule": "S7", "skill": name, "file": str(ref.relative_to(ROOT)),
                "detail": f"{len(lines)} lines with no table of contents",
            })
        # A `name:` frontmatter block makes a sub-guide look like a second skill to loaders
        # and readers; only SKILL.md is a skill.
        front = re.match(r"---\n(.*?)\n---\n", text, re.S)
        if front and re.search(r"^name:", front.group(1), re.M):
            findings.append({
                "rule": "S7", "skill": name, "file": str(ref.relative_to(ROOT)),
                "detail": "skill-style frontmatter outside SKILL.md; state the parent skill in the body",
            })

    if args.json:
        print(json.dumps({"checked": checked, "findings": findings}, indent=2))
    else:
        print(f"{checked['skills']} owned skill(s), {checked['references']} reference(s) checked\n")
        if not findings:
            print("  no findings")
        for f in findings:
            print(f"  {f['rule']}  {f['file']}")
            print(f"      {f['detail']}")
        print(f"\n  {len(findings)} finding(s)")

    if findings:
        print(f"\nFAIL: {len(findings)} structure finding(s)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
