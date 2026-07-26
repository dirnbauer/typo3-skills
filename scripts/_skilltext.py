"""Shared text handling for the skill-analysis scripts.

`trigger_collisions.py` and `run_evals.py` both read frontmatter and tokenise descriptions.
They had separate copies, and drifted: one gained stemming and the other did not, so the two
instruments disagreed about whether "migrations" and "migration" were the same word. Two
tools measuring the same corpus differently is worse than one tool, because the
disagreement is invisible in their output.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

# Deliberately small. Over-stripping hides real overlap between descriptions.
STOP = {
    "use", "when", "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "with",
    "this", "that", "it", "its", "is", "are", "be", "as", "by", "from", "at", "into",
    "also", "including", "includes", "such", "user", "users", "asks", "ask", "wants",
    "want", "need", "needs", "triggers", "trigger", "skill", "using", "used", "via",
    "any", "all", "other", "others", "etc", "how", "what", "which", "who", "can", "may",
    "should", "must", "will", "do", "does", "not", "no", "yes", "new", "old", "more",
    "most", "less", "than", "then", "if", "about", "before", "after", "during", "across",
    "between", "over", "under", "up", "down", "out", "off", "per", "each", "every",
    "both", "either", "neither", "my", "our", "we", "you", "your", "me", "i", "please",
    "help", "make", "sure", "so", "one", "many", "same", "says", "say", "large", "covers",
    "cover", "apply", "applies", "run", "runs",
}


def read_frontmatter(path: Path) -> dict:
    """Minimal YAML frontmatter reader, folded-scalar aware."""
    text = path.read_text(encoding="utf-8", errors="ignore")
    m = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not m:
        return {}
    out: dict[str, str] = {}
    folded: set[str] = set()
    key = None
    for line in m.group(1).split("\n"):
        km = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if km and not line.startswith(" "):
            key = km.group(1)
            val = km.group(2).strip()
            if val in (">-", "|", ">", "|-"):
                out[key] = ""
                folded.add(key)
            else:
                out[key] = val.strip('"').strip("'")
        elif key and key in folded:
            out[key] = (out[key] + " " + line.strip()).strip()
    return out


def stem(word: str) -> str:
    """Light suffix stripping, Porter-style but deliberately small.

    Without it, "migration" and "migrations" are different tokens, and a description saying
    "PHP migrations" scores zero against a user typing "the automated migration".

    Every branch funnels through one exit so the rule is applied uniformly. An earlier
    version returned early from the plural branches, leaving "upgrades" -> upgrade while
    "upgrade" -> upgrad; a stemmer inconsistent with itself is worse than none.

    A blanket trailing-'e' step was tried and dropped: it over-stemmed discriminative terms
    and measured worse. The -ize family is handled explicitly instead, because it is regular
    and common here (localize, modernize, optimize) and because the generic rules got it
    wrong in both directions: "localizes" matched the "zes" branch meant for buzz/buzzes and
    lost two characters, while "localize" kept its 'e'. A description saying "localizes"
    therefore scored zero against a user typing "localize".
    """
    if len(word) <= 3 or any(c.isdigit() for c in word):
        return word

    # -ize/-izes/-ized/-izing all collapse to -iz. Checked before the general rules, which
    # split this family three ways.
    for suffix in ("izing", "ized", "izes", "ize"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            return word[: -len(suffix)] + "iz"

    base = word
    if word.endswith("ies") and len(word) > 4:
        base = word[:-3] + "y"
    elif word.endswith("sses") or word.endswith(("ches", "shes", "xes", "zzes")):
        base = word[:-2]
    elif word.endswith("es") and len(word) > 4:
        base = word[:-1]
    elif word.endswith("s") and not word.endswith(("ss", "us", "is")):
        base = word[:-1]
    else:
        for suffix in ("ing", "ed"):
            if word.endswith(suffix) and len(word) - len(suffix) >= 3:
                base = word[: -len(suffix)]
                if len(base) > 3 and base[-1] == base[-2] and base[-1] not in "aeiousl":
                    base = base[:-1]  # "runn" -> "run"
                break
    return base


def terms(text: str) -> Counter:
    words = re.findall(r"[a-z0-9][a-z0-9._-]*", text.lower())
    return Counter(
        stem(w.strip("._-")) for w in words if w not in STOP and len(w) > 2
    )
