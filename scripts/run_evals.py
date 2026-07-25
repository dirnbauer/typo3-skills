#!/usr/bin/env python3
"""Run the trigger evals and report real pass rates.

Two graders, because they answer different questions:

  --grader lexical   Offline, deterministic, no API, no cost. Ranks every skill description
                     against the prompt using the same IDF-weighted scoring as
                     trigger_collisions.py, then checks whether the expected skill wins.
                     This is a ROUTER PROXY, not a model test. It cannot tell you what an
                     agent will do. It CAN tell you that a description contains none of the
                     vocabulary a user would actually type - which is the failure mode the
                     source material says dominates.

  --grader claude    Real measurement. Asks the `claude` CLI headlessly which skill it would
                     load given the description list, and grades the answer. Requires a
                     working CLI login; fails loudly rather than silently degrading.

S9 says run trials and read the distribution, so --trials reports pass@k (did it ever?) and
pass^k (did it every time?). The lexical grader is deterministic, so trials are pinned to 1
for it - reporting five identical runs as a distribution would be theatre.

Usage:
    python3 scripts/run_evals.py --grader lexical
    python3 scripts/run_evals.py --grader lexical --only-reviewed
    python3 scripts/run_evals.py --grader claude --trials 3 --skill typo3-upgrade-run
"""

from __future__ import annotations

import argparse
import json
import math
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "skills"
VENDORED = ROOT / "VENDORED.md"

STOP = {
    "use", "when", "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with",
    "this", "that", "it", "its", "is", "are", "be", "as", "by", "from", "at", "into",
    "also", "including", "such", "user", "users", "asks", "ask", "wants", "want", "need",
    "needs", "triggers", "trigger", "skill", "using", "used", "via", "any", "all", "how",
    "what", "which", "who", "can", "may", "should", "must", "will", "do", "does", "not",
    "no", "yes", "new", "more", "most", "than", "then", "if", "about", "before", "after",
    "my", "our", "we", "you", "your", "me", "i", "please", "help", "make", "sure", "so",
}


def read_frontmatter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="ignore")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    out, key = {}, None
    for line in m.group(1).split("\n"):
        km = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if km and not line.startswith(" "):
            key = km.group(1)
            val = km.group(2).strip()
            if val in (">-", "|", ">", "|-"):
                out[key] = ""
                out["__f" + key] = True
            else:
                out[key] = val.strip('"').strip("'")
        elif key and out.get("__f" + key):
            out[key] = (out[key] + " " + line.strip()).strip()
    return {k: v for k, v in out.items() if not k.startswith("__f")}


def stem(word: str) -> str:
    """Light suffix stripping, Porter-style but deliberately small.

    Without it, "migration" and "migrations" are different tokens, and a description saying
    "PHP migrations" scores zero against a user typing "the automated migration". That is a
    property of the instrument, not of the description.

    Every branch funnels through one exit so the normalisation is applied uniformly. An
    earlier version returned early from the plural branches, which left "upgrades" -> upgrade
    while "upgrade" -> upgrad, and cost eight points of pass rate: a stemmer that is
    inconsistent with itself is worse than none.
    """
    if len(word) <= 3 or any(c.isdigit() for c in word):
        return word

    base = word
    if word.endswith("ies") and len(word) > 4:
        base = word[:-3] + "y"
    elif word.endswith("sses") or word.endswith(("ches", "shes", "xes", "zes")):
        base = word[:-2]
    elif word.endswith("es") and len(word) > 4:
        base = word[:-1]
    elif word.endswith("s") and not word.endswith(("ss", "us", "is")):
        base = word[:-1]
    else:
        for suffix in ("ing", "ed"):
            if word.endswith(suffix) and len(word) - len(suffix) >= 3:
                base = word[: -len(suffix)]
                # "runn" -> "run"
                if len(base) > 3 and base[-1] == base[-2] and base[-1] not in "aeiousl":
                    base = base[:-1]
                break

    # A trailing-'e' step was tried and removed. It unified "removed"/"remove" but
    # over-stemmed discriminative terms ("upgrade" -> "upgrad"), and measured worse on both
    # reviewed and draft cases. Known limitation: -ed forms do not meet their -e base.
    return base


def terms(text: str) -> Counter:
    words = re.findall(r"[a-z0-9][a-z0-9._-]*", text.lower())
    return Counter(
        stem(w.strip("._-")) for w in words if w not in STOP and len(w) > 2
    )


def load_corpus() -> dict[str, str]:
    corpus = {}
    for d in sorted(SKILLS.iterdir()):
        md = d / "SKILL.md"
        if md.is_file():
            desc = read_frontmatter(md).get("description", "")
            if desc:
                # The name is a trigger signal too - the collision analyser could not see
                # this, and it was the biggest finding. Here it costs one string join.
                corpus[d.name] = f"{d.name.replace('-', ' ')} {desc}"
    return corpus


# BM25 parameters. k1 saturates term frequency; b controls length normalisation.
# These are the standard values and are deliberately not tuned - tuning the grader to make
# our own descriptions score better is the exact failure this whole exercise is about.
BM25_K1 = 1.2
BM25_B = 0.75


def build_index(corpus: dict[str, str]) -> dict:
    """BM25 index.

    The first version of this scored set-intersection over sqrt(len(description)), which
    was wrong twice: it ignored term frequency, and it over-penalised long descriptions so
    badly that a thorough description lost to a terse one on its own subject matter. That
    is a defect in the instrument, not in the descriptions - and it would have been read as
    "our descriptions are bad" if left in place.
    """
    docs = {name: terms(text) for name, text in corpus.items()}
    n = len(docs)
    df = Counter()
    for tf in docs.values():
        for w in tf:
            df[w] += 1
    idf = {
        w: math.log(1 + (n - d + 0.5) / (d + 0.5))
        for w, d in df.items()
    }
    lengths = {name: sum(tf.values()) for name, tf in docs.items()}
    avgdl = (sum(lengths.values()) / n) if n else 0.0
    return {"docs": docs, "idf": idf, "lengths": lengths, "avgdl": avgdl}


def rank_skills(prompt: str, corpus: dict[str, str], index: dict) -> list[tuple[str, float]]:
    query = terms(prompt)
    docs, idf, lengths, avgdl = index["docs"], index["idf"], index["lengths"], index["avgdl"]
    scores = []
    for name, tf in docs.items():
        dl = lengths[name]
        norm = BM25_K1 * (1 - BM25_B + BM25_B * (dl / avgdl if avgdl else 1.0))
        s = 0.0
        for w in query:
            f = tf.get(w, 0)
            if not f:
                continue
            s += idf.get(w, 0.0) * (f * (BM25_K1 + 1)) / (f + norm)
        scores.append((name, round(s, 4)))
    return sorted(scores, key=lambda x: -x[1])


def grade_lexical(case: dict, skill: str, corpus, index, top_k: int) -> dict:
    ranked = rank_skills(case["prompt"], corpus, index)
    top = [n for n, _ in ranked[:top_k]]
    best, best_score = ranked[0]
    kind = case["kind"]

    if kind == "trigger-positive":
        ok = skill in top
        why = f"expected {skill}; top{top_k}={top}"
    elif kind == "trigger-negative":
        expected = case.get("expect_skill")
        if expected:
            rank_self = next(i for i, (n, _) in enumerate(ranked) if n == skill)
            rank_exp = next((i for i, (n, _) in enumerate(ranked) if n == expected), 999)
            ok = rank_exp < rank_self
            why = f"{expected} at #{rank_exp + 1}, {skill} at #{rank_self + 1}"
        else:
            ok = skill not in top[:1] and best_score > 0
            why = f"{skill} must not rank #1; #1 is {best} ({best_score})"
    else:
        return {"result": "skipped", "why": "behaviour case needs a model grader"}

    return {"result": "pass" if ok else "fail", "why": why, "top": ranked[:3]}


CLAUDE_TEMPLATE = """You are the skill router for an agent. Below is the catalogue of available skills.

{catalogue}

A user sends this message:
<user_message>
{prompt}
</user_message>

Which ONE skill should load? Reply with the skill name exactly as listed, or the single word
NONE if no skill applies. Reply with nothing else."""


def grade_claude(case: dict, skill: str, corpus: dict[str, str], timeout: int) -> dict:
    catalogue = "\n".join(f"- {n}: {d[:300]}" for n, d in sorted(corpus.items()))
    prompt = CLAUDE_TEMPLATE.format(catalogue=catalogue, prompt=case["prompt"])
    try:
        proc = subprocess.run(
            ["claude", "-p", prompt, "--output-format", "text"],
            capture_output=True, text=True, timeout=timeout,
        )
    except FileNotFoundError:
        return {"result": "error", "why": "claude CLI not found"}
    except subprocess.TimeoutExpired:
        return {"result": "error", "why": f"claude timed out after {timeout}s"}

    out = (proc.stdout or proc.stderr or "").strip()
    if proc.returncode != 0 or "authenticate" in out.lower() or "api error" in out.lower():
        return {"result": "error", "why": f"claude unusable: {out.splitlines()[0][:120] if out else 'no output'}"}

    answer = out.splitlines()[-1].strip().strip(".`\"' ") if out else ""
    kind = case["kind"]
    if kind == "trigger-positive":
        ok = answer == skill
    elif kind == "trigger-negative":
        expected = case.get("expect_skill")
        ok = (answer == expected) if expected else (answer.upper() == "NONE" or answer != skill)
    else:
        return {"result": "skipped", "why": "behaviour grading not implemented"}
    return {"result": "pass" if ok else "fail", "why": f"answered {answer!r}", "answer": answer}


def vendored() -> set[str]:
    if not VENDORED.is_file():
        return set()
    return set(re.findall(r"^\|\s*`([a-z0-9-]+)`\s*\|", VENDORED.read_text(encoding="utf-8"), re.M))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--grader", choices=["lexical", "claude"], default="lexical")
    ap.add_argument("--trials", type=int, default=1)
    ap.add_argument("--top-k", type=int, default=1)
    ap.add_argument("--skill", help="run one skill only")
    ap.add_argument("--only-reviewed", action="store_true")
    ap.add_argument("--timeout", type=int, default=120)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--fail-under", type=float, help="exit 1 if reviewed pass rate is below this (0-1)")
    args = ap.parse_args()

    corpus = load_corpus()
    index = build_index(corpus)
    skip = vendored()
    trials = 1 if args.grader == "lexical" else max(1, args.trials)

    results = []
    for d in sorted(SKILLS.iterdir()):
        name = d.name
        if name in skip or (args.skill and name != args.skill):
            continue
        suite_path = d / "evals" / "evals.json"
        if not suite_path.is_file():
            continue
        try:
            suite = json.loads(suite_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if not isinstance(suite, dict):
            continue

        for case in suite.get("evals", []):
            if case.get("kind") not in ("trigger-positive", "trigger-negative"):
                continue
            if args.only_reviewed and case.get("status") != "reviewed":
                continue
            runs = []
            for _ in range(trials):
                if args.grader == "lexical":
                    runs.append(grade_lexical(case, name, corpus, index, args.top_k))
                else:
                    runs.append(grade_claude(case, name, corpus, args.timeout))
            passes = sum(1 for r in runs if r["result"] == "pass")
            results.append({
                "skill": name, "id": case["id"], "kind": case["kind"],
                "status": case.get("status"),
                "pass_at_k": passes > 0, "pass_pow_k": passes == len(runs),
                "passes": passes, "trials": len(runs),
                "why": runs[0].get("why"), "result": runs[0]["result"],
            })

    def rate(rows, key="pass_pow_k"):
        rows = [r for r in rows if r["result"] != "error"]
        return (sum(1 for r in rows if r[key]) / len(rows)) if rows else 0.0

    reviewed = [r for r in results if r["status"] == "reviewed"]
    drafts = [r for r in results if r["status"] == "draft"]
    errors = [r for r in results if r["result"] == "error"]

    summary = {
        "grader": args.grader, "trials": trials,
        "cases": len(results), "reviewed": len(reviewed), "drafts": len(drafts),
        "errors": len(errors),
        "reviewed_pass_rate": round(rate(reviewed), 3),
        "draft_pass_rate": round(rate(drafts), 3),
        "overall_pass_rate": round(rate(results), 3),
    }

    if args.json:
        print(json.dumps({"summary": summary, "results": results}, indent=2))
    else:
        print(f"grader={args.grader} trials={trials}  {len(results)} trigger case(s)\n")
        if errors:
            print(f"  {len(errors)} case(s) could not be graded: {errors[0]['why']}\n")
        for group, rows in (("reviewed", reviewed), ("draft", drafts)):
            if not rows:
                continue
            failed = [r for r in rows if not r["pass_pow_k"] and r["result"] != "error"]
            print(f"  {group:8s} {len(rows) - len(failed)}/{len(rows)} pass  ({rate(rows):.0%})")
            for r in failed[:12]:
                print(f"      FAIL {r['id']}")
                print(f"           {r['why']}")
            if len(failed) > 12:
                print(f"      … and {len(failed) - 12} more")
            print()
        print(f"  reviewed pass rate : {summary['reviewed_pass_rate']:.0%}")
        print(f"  draft pass rate    : {summary['draft_pass_rate']:.0%}")
        if args.grader == "lexical":
            print("\n  NOTE: the lexical grader is a router proxy, not a model test. It shows whether a")
            print("  description carries the vocabulary a user would type. Use --grader claude for real")
            print("  routing behaviour.")

    if args.fail_under is not None and summary["reviewed_pass_rate"] < args.fail_under:
        print(f"\nFAIL: reviewed pass rate {summary['reviewed_pass_rate']:.0%} "
              f"below {args.fail_under:.0%}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
