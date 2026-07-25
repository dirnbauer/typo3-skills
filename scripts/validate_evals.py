#!/usr/bin/env python3
"""Validate skill eval suites and report honest coverage.

Enforces SKILL-SPEC.md S4 and S5:
  - every non-vendored skill ships skills/<name>/evals/evals.json
  - suites carry trigger-positive AND trigger-negative cases
  - generated cases are drafts and do NOT count as coverage until reviewed

The reviewed/total split is the point. A suite of 20 machine-generated prompts is a suite
of 20 machine-generated prompts; counting it as coverage is how a repository convinces
itself it is tested.

Usage:
    python3 scripts/validate_evals.py [--min-cases 6] [--require-reviewed] [--json]
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

KINDS = {"trigger-positive", "trigger-negative", "behaviour"}
STATUSES = {"draft", "reviewed"}
SKILL_TYPES = {"capability", "preference"}


def vendored_skills() -> set[str]:
    """Vendored skills are upstream artefacts; the spec does not bind them."""
    if not VENDORED.is_file():
        return set()
    text = VENDORED.read_text(encoding="utf-8")
    return set(re.findall(r"^\|\s*`([a-z0-9-]+)`\s*\|", text, re.M))


def load_suite(path: Path) -> tuple[dict | None, list[str]]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), []
    except FileNotFoundError:
        return None, ["no evals/evals.json"]
    except json.JSONDecodeError as exc:
        return None, [f"evals.json is not valid JSON: {exc}"]


def validate_suite(name: str, suite: dict, min_cases: int) -> tuple[list[str], dict]:
    errors: list[str] = []
    counts = {k: 0 for k in KINDS}
    reviewed = {k: 0 for k in KINDS}

    if suite.get("skill_name") != name:
        errors.append(f"skill_name is {suite.get('skill_name')!r}, expected {name!r}")

    st = suite.get("skill_type")
    if st not in SKILL_TYPES:
        errors.append(f"skill_type must be one of {sorted(SKILL_TYPES)}, got {st!r}")

    cases = suite.get("evals")
    if not isinstance(cases, list) or not cases:
        errors.append("evals must be a non-empty array")
        return errors, {"total": 0, "reviewed": 0, "by_kind": counts, "reviewed_by_kind": reviewed}

    seen_ids = set()
    for i, c in enumerate(cases):
        where = c.get("id") or f"evals[{i}]"
        if not isinstance(c, dict):
            errors.append(f"{where}: not an object")
            continue
        if not c.get("id"):
            errors.append(f"evals[{i}]: missing id")
        elif c["id"] in seen_ids:
            errors.append(f"{where}: duplicate id")
        else:
            seen_ids.add(c["id"])

        kind = c.get("kind")
        if kind not in KINDS:
            errors.append(f"{where}: kind must be one of {sorted(KINDS)}, got {kind!r}")
            continue
        counts[kind] += 1

        status = c.get("status")
        if status not in STATUSES:
            errors.append(f"{where}: status must be one of {sorted(STATUSES)}, got {status!r}")
        elif status == "reviewed":
            if not c.get("reviewed_by"):
                errors.append(f"{where}: status reviewed requires reviewed_by")
            else:
                reviewed[kind] += 1

        if not c.get("prompt"):
            errors.append(f"{where}: missing prompt")

        if kind == "trigger-negative":
            # A negative case is only meaningful if it names what SHOULD happen instead.
            if not c.get("expect_skill") and not c.get("expect_no_skill"):
                errors.append(f"{where}: trigger-negative needs expect_skill or expect_no_skill")
            if c.get("expect_skill") == name:
                errors.append(f"{where}: trigger-negative cannot expect its own skill")
        elif kind == "trigger-positive":
            if c.get("expect_skill") not in (None, name):
                errors.append(f"{where}: trigger-positive must expect {name!r}")
        elif kind == "behaviour":
            if not c.get("assertions"):
                errors.append(f"{where}: behaviour case needs assertions")

    total = sum(counts.values())
    if total < min_cases:
        errors.append(f"only {total} case(s); minimum is {min_cases}")
    if counts["trigger-positive"] == 0:
        errors.append("no trigger-positive cases")
    if counts["trigger-negative"] == 0:
        errors.append("no trigger-negative cases (a skill that fires on everything is broken)")

    return errors, {
        "total": total,
        "reviewed": sum(reviewed.values()),
        "by_kind": counts,
        "reviewed_by_kind": reviewed,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--min-cases", type=int, default=6)
    ap.add_argument("--require-reviewed", action="store_true",
                    help="fail when a suite has zero reviewed cases")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    vendored = vendored_skills()
    report = {"skills": [], "summary": {}}
    failures = 0

    for skill_dir in sorted(SKILLS.iterdir()):
        if not (skill_dir / "SKILL.md").is_file():
            continue
        name = skill_dir.name
        entry = {"skill": name, "vendored": name in vendored}

        if name in vendored:
            entry["status"] = "exempt"
            report["skills"].append(entry)
            continue

        suite, errors = load_suite(skill_dir / "evals" / "evals.json")
        if suite is None:
            entry.update(status="missing", errors=errors, total=0, reviewed=0)
            failures += 1
            report["skills"].append(entry)
            continue

        errs, stats = validate_suite(name, suite, args.min_cases)
        if args.require_reviewed and stats["reviewed"] == 0:
            errs.append("no reviewed cases (generated drafts do not count as coverage)")
        entry.update(status="ok" if not errs else "invalid", errors=errs, **stats)
        if errs:
            failures += 1
        report["skills"].append(entry)

    owned = [s for s in report["skills"] if not s["vendored"]]
    with_suite = [s for s in owned if s.get("total", 0) > 0]
    with_reviewed = [s for s in owned if s.get("reviewed", 0) > 0]
    report["summary"] = {
        "skills_total": len(report["skills"]),
        "vendored_exempt": len(report["skills"]) - len(owned),
        "owned": len(owned),
        "with_evals": len(with_suite),
        "with_reviewed_evals": len(with_reviewed),
        "cases_total": sum(s.get("total", 0) for s in owned),
        "cases_reviewed": sum(s.get("reviewed", 0) for s in owned),
        "invalid_or_missing": failures,
    }

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        s = report["summary"]
        print(f"{s['owned']} owned skills ({s['vendored_exempt']} vendored, exempt)\n")
        for e in report["skills"]:
            if e["vendored"]:
                continue
            if e["status"] == "ok":
                print(f"  ok       {e['skill']:34s} {e['total']:3d} cases, {e['reviewed']:3d} reviewed")
            elif e["status"] == "missing":
                print(f"  MISSING  {e['skill']:34s} no evals/evals.json")
            else:
                print(f"  INVALID  {e['skill']:34s} {e['total']:3d} cases")
                for err in e["errors"][:4]:
                    print(f"           - {err}")
        print()
        print(f"  suites present : {s['with_evals']}/{s['owned']}")
        print(f"  human-reviewed : {s['with_reviewed_evals']}/{s['owned']}  "
              f"({s['cases_reviewed']}/{s['cases_total']} cases)")
        if failures:
            print(f"\n  {failures} skill(s) missing or invalid", file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
