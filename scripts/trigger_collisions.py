#!/usr/bin/env python3
"""Find skills whose trigger descriptions overlap enough to mis-fire.

A skill's description is its activation trigger: it is the only text the agent sees for
every skill at every turn. When two descriptions share too much vocabulary, the agent has
no reliable basis for choosing, and the wrong skill loads. That failure is invisible in
normal use - the agent still answers, just from the wrong playbook.

This computes a weighted Jaccard overlap over the distinctive terms of each description
and reports pairs above a threshold, so the overlap can be designed away in the wording
or pinned down with negative trigger evals.

Usage:
    python3 scripts/trigger_collisions.py [--threshold 0.18] [--json] [--fail-over N]
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"

# Words that carry no routing signal. Deliberately small: over-stripping hides real overlap.
from _skilltext import STOP, read_frontmatter, stem, terms  # noqa: F401


def idf(corpus: dict[str, Counter]) -> dict[str, float]:
    n = len(corpus)
    df = Counter()
    for c in corpus.values():
        for w in c:
            df[w] += 1
    return {w: math.log(n / (1 + d)) + 1.0 for w, d in df.items()}


def weighted_overlap(a: Counter, b: Counter, weights: dict[str, float]) -> tuple[float, list[str]]:
    """Weighted Jaccard: shared distinctive vocabulary over total distinctive vocabulary."""
    shared = set(a) & set(b)
    union = set(a) | set(b)
    if not union:
        return 0.0, []
    num = sum(weights.get(w, 1.0) for w in shared)
    den = sum(weights.get(w, 1.0) for w in union)
    ranked = sorted(shared, key=lambda w: -weights.get(w, 1.0))
    return num / den, ranked[:8]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--threshold", type=float, default=0.18)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--fail-over", type=int, default=None,
                    help="exit 1 when more than N pairs exceed the threshold")
    args = ap.parse_args()

    descriptions = {}
    for skill_dir in sorted(SKILLS.iterdir()):
        skill_md = skill_dir / "SKILL.md"
        if not skill_md.is_file():
            continue
        fm = read_frontmatter(skill_md)
        desc = fm.get("description", "")
        if desc:
            descriptions[skill_dir.name] = desc

    corpus = {name: terms(d) for name, d in descriptions.items()}
    weights = idf(corpus)

    pairs = []
    names = sorted(corpus)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            score, shared = weighted_overlap(corpus[a], corpus[b], weights)
            if score >= args.threshold:
                pairs.append({"a": a, "b": b, "overlap": round(score, 3), "shared": shared})
    pairs.sort(key=lambda p: -p["overlap"])

    if args.json:
        print(json.dumps({"skills": len(corpus), "threshold": args.threshold, "pairs": pairs}, indent=2))
    else:
        print(f"{len(corpus)} skills, {len(pairs)} pair(s) at or above overlap {args.threshold}\n")
        for p in pairs:
            print(f"  {p['overlap']:.3f}  {p['a']}  <->  {p['b']}")
            print(f"         shared: {', '.join(p['shared'])}")
        if not pairs:
            print("  no collisions")

    if args.fail_over is not None and len(pairs) > args.fail_over:
        print(f"\nFAIL: {len(pairs)} colliding pair(s) exceeds the allowed {args.fail_over}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
