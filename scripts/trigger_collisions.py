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
    ap.add_argument("--allowlist", type=Path, help="exact named overlaps with rationales and score ceilings")
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
    allowed = load_allowlist(args.allowlist) if args.allowlist else {}
    for p in pairs:
        entry = allowed.get(tuple(sorted((p['a'], p['b']))))
        p['acknowledged'] = bool(entry and p['overlap'] <= entry['max_overlap'])
        if entry:
            p['reason'] = entry['reason']
    unexpected = [p for p in pairs if not p['acknowledged']]

    if args.json:
        print(json.dumps({"skills": len(corpus), "threshold": args.threshold, "pairs": pairs, "unexpected": len(unexpected)}, indent=2))
    else:
        print(f"{len(corpus)} skills, {len(pairs)} pair(s) at or above overlap {args.threshold}\n")
        for p in pairs:
            print(f"  {p['overlap']:.3f}  {p['a']}  <->  {p['b']}")
            print(f"         shared: {', '.join(p['shared'])}")
            if p['acknowledged']:
                print(f"         recorded boundary: {p['reason']}")
        if not pairs:
            print("  no collisions")

    if args.fail_over is not None and len(unexpected) > args.fail_over:
        print(f"\nFAIL: {len(unexpected)} unacknowledged colliding pair(s) exceeds the allowed {args.fail_over}", file=sys.stderr)
        return 1
    return 0


def load_allowlist(file: Path) -> dict:
    entries = {}
    for item in json.loads(file.read_text())['pairs']:
        a, b = item.get('a', ''), item.get('b', '')
        key = tuple(sorted((a, b)))
        if (not all(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', n) for n in key)
            or a == b or key in entries or not item.get('reason')
            or not isinstance(item.get('max_overlap'), (int, float)) or not 0 < item['max_overlap'] < 1):
            raise ValueError('Collision exceptions need a unique exact pair, rationale and bounded overlap ceiling')
        entries[key] = item
    return entries


if __name__ == "__main__":
    raise SystemExit(main())
