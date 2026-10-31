#!/usr/bin/env python3
"""Regenerate provenance tables from actual skill metadata and the pinned vendor lock."""
import json
import re
from audit_skills import ROOT, SKILLS_DIR, discover_source_info, parse_frontmatter, split_frontmatter


def summary(text, limit):
    """Shorten at a word boundary so generated rows never end mid-word."""
    if len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:.—-") + "…"


def main():
    lock = json.loads((ROOT / "vendor-lock.json").read_text())
    skills = []
    for file in sorted(SKILLS_DIR.glob("*/SKILL.md")):
        text = file.read_text()
        fm = parse_frontmatter(split_frontmatter(text)[0])
        owner, source, _ = discover_source_info(file.parent.name, text)
        description = str(fm.get("description", "")).replace("|", "/").replace("\n", " ")
        skills.append((file.parent.name, description, owner, source))
    total = len(skills)
    typo3_count = sum(n.startswith('typo3-') for n, _, _, _ in skills)
    vendor_text = (ROOT / "VENDORED.md").read_text()
    vendored_names = set(re.findall(r"^\|\s*`([a-z0-9-]+)`\s*\|", vendor_text, re.M))
    vendor_count = len(vendored_names)
    readme = ROOT / "README.md"
    text = readme.read_text()
    start = text.index("| Skill | What it does | Owner |")
    end = text.index("## Credits", start)
    table = "| Skill | What it does | Owner |\n|---|---|---|\n"
    table += "\n".join(f"| `{n}` | {summary(d, 115)} | {o} |" for n, d, o, _ in skills)
    table += "\n\n### Upstream repositories\n\n" + "\n".join(f"- {s}" for s in sorted({s for _, _, o, s in skills if s and o != 'webconsulting'})) + "\n\n"
    text = text[:start] + table + text[end:]
    text = re.sub(r"\b\d+ skills, plus an always-on", f"{total} skills, plus an always-on", text)
    text = re.sub(r"\*\*\d+ `typo3-\*` skills and \d+ existing\s+supporting skills\*\*",
                  f"**{typo3_count} `typo3-*` skills and {total - typo3_count} existing supporting skills**", text)
    text = re.sub(r"\*\*\d+ explicitly selected Netresearch repositories\*\*",
                  f"**{len(lock['skills'])} explicitly selected Netresearch repositories**", text)
    text = re.sub(r"\d+ of the \d+ are(?: not authored by webconsulting and are )?vendored",
                  f"{vendor_count} of the {total} are vendored", text)
    readme.write_text(text)
    agents = ROOT / "AGENTS.md"
    text = re.sub(r"\*\*\d+ skills\*\*", f"**{total} skills**", agents.read_text())
    # Curated routing prose stays; only machine-sourced vendor rows are refreshed.
    for name, desc, owner, _ in skills:
        if owner == 'Netresearch':
            row = f"| `{name}` | **Netresearch** (vendored) | {summary(desc, 115)} |"
            text = re.sub(rf"^\| `{re.escape(name)}` \|.*$", lambda _: row, text, flags=re.M)
    marker = "### Not yet routed"
    if marker in text:
        start = text.index(marker); end = text.index("## Session profiles", start)
        text = text[:start] + text[end:]
    already = set(re.findall(r"^\| `([a-z0-9-]+)` \|", text, re.M))
    unrouted = [(n, d, o) for n, d, o, _ in skills if n not in already]
    if unrouted:
        section = (marker + "\n\nAdded since the catalogue was last curated. Move each row into its area.\n\n"
                   "| Skill | Owner | Use it for |\n|---|---|---|\n")
        section += "\n".join(f"| `{n}` | {o} | {summary(d, 115)} |" for n, d, o in unrouted) + "\n\n"
        text = text.replace("## Session profiles", section + "## Session profiles", 1)
    suites = [json.loads((SKILLS_DIR / n / 'evals/evals.json').read_text())
              for n, _, _, _ in skills if n not in vendored_names]
    reviewed = sum(any(c.get('status') == 'reviewed' for c in s['evals']) for s in suites)
    proposed = sum(any(c.get('status') == 'proposed' for c in s['evals']) for s in suites)
    text = re.sub(r'Current: .*?signature\.', f'Current: {len(suites)}/{len(suites)} collection-maintained skills have suites, '
                  f'{reviewed}/{len(suites)} have human-reviewed coverage, and {proposed} suites include proposed cases awaiting signature.', text, flags=re.S)
    agents.write_text(text)
    vendor = ROOT / "VENDORED.md"
    text = vendor.read_text()
    start = text.index("| Skill | Upstream | Source | Commit | Synced |")
    end = text.index("## Attribution", start)
    retained = [line for line in text[start:end].splitlines() if line.startswith("| `") and "| Netresearch |" not in line]
    rows = [f"| `{s['name']}` | Netresearch | {s['repository']} | `{s['commit']}` | {lock['checked_at'][:10]} |" for s in lock["skills"]]
    table = "| Skill | Upstream | Source | Commit | Synced |\n|---|---|---|---|---|\n" + "\n".join(sorted(retained + rows))
    vendored_total = len(retained) + len(rows)
    table += f"\n\n{vendored_total} vendored skills · {total - vendored_total} collection-maintained skills · {total} total.\n\n"
    vendor.write_text(text[:start] + table + text[end:])
    print(f"Refreshed README/AGENTS/VENDORED inventories: {total} skills, {len(rows)} pinned Netresearch skills.")


if __name__ == "__main__":
    main()
