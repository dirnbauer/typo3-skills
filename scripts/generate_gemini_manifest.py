#!/usr/bin/env python3
"""Generate a native Gemini extension manifest; skills are discovered in skills/*.

Schema: https://geminicli.com/docs/extensions/reference/ (checked 2026-09-05).
Triggers remain in SKILL.md frontmatter, not a nonstandard manifest skills array.
"""
import argparse
import json
from pathlib import Path

from audit_skills import parse_frontmatter, split_frontmatter

ROOT = Path(__file__).resolve().parents[1]
VERSION = "1.0.0"


def manifest(root):
    skills = sorted((root / "skills").glob("*/SKILL.md"))
    if not skills:
        raise ValueError("No skills/*/SKILL.md files found")
    for file in skills:
        metadata = parse_frontmatter(split_frontmatter(file.read_text())[0])
        if metadata.get("name") != file.parent.name or not metadata.get("description"):
            raise ValueError(f"Invalid skill identity/description: {file.relative_to(root)}")
    for context in ("GEMINI.md", "AGENTS.md"):
        if not (root / context).is_file():
            raise ValueError(f"Missing extension context: {context}")
    return {
        "name": "typo3-skills",
        "version": VERSION,
        "description": f"{len(skills)} TYPO3 and supporting skills maintained by webconsulting.at; upstream credits and licences preserved.",
        "contextFileName": "GEMINI.md",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--check", action="store_true", help="Fail on missing/stale output without writing")
    args = parser.parse_args()
    try:
        output = json.dumps(manifest(args.root), indent=2, ensure_ascii=False) + "\n"
        target = args.root / "gemini-extension.json"
        if args.check:
            if not target.is_file() or target.read_text() != output:
                raise ValueError("gemini-extension.json is missing/stale; run ./install.sh --generate-only")
        else:
            target.write_text(output)
        print("Gemini extension manifest: " + ("current" if args.check else "generated"))
        return 0
    except (ValueError, OSError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
