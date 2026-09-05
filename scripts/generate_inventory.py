#!/usr/bin/env python3
"""Regenerate provenance tables from actual skill metadata and the pinned vendor lock."""
import json
import re
from audit_skills import ROOT, SKILLS_DIR, discover_source_info, parse_frontmatter, split_frontmatter


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
    vendor_count = sum(o != 'webconsulting' for _, _, o, _ in skills)
    readme = ROOT / "README.md"
    text = readme.read_text()
    start = text.index("| Skill | What it does | Owner |")
    end = text.index("## Credits", start)
    table = "| Skill | What it does | Owner |\n|---|---|---|\n"
    table += "\n".join(f"| `{n}` | {d[:115]}{'…' if len(d) > 115 else ''} | {o} |" for n, d, o, _ in skills)
    table += "\n\n### Upstream repositories\n\n" + "\n".join(f"- {s}" for s in sorted({s for _, _, o, s in skills if s and o != 'webconsulting'})) + "\n\n"
    text = text[:start] + table + text[end:]
    text = re.sub(r"\b\d+ skills, plus an always-on", f"{total} skills, plus an always-on", text)
    text = re.sub(r"\*\*\d+ `typo3-\*` skills and \d+ existing\s+supporting skills\*\*",
                  f"**{typo3_count} `typo3-*` skills and {total - typo3_count} existing supporting skills**", text)
    text = re.sub(r"\*\*\d+ explicitly selected Netresearch repositories\*\*",
                  f"**{len(lock['skills'])} explicitly selected Netresearch repositories**", text)
    text = re.sub(r"\d+ of the \d+ are not authored by webconsulting",
                  f"{vendor_count} of the {total} are not authored by webconsulting", text)
    readme.write_text(text)
    agents = ROOT / "AGENTS.md"
    text = re.sub(r"\*\*\d+ skills\*\*", f"**{total} skills**", agents.read_text())
    # Keep curated routing prose; refresh only machine-sourced vendor rows.
    for name, desc, owner, _ in skills:
        if owner == 'Netresearch':
            text = re.sub(rf"^\| `{re.escape(name)}` \|.*$", lambda _: f"| `{name}` | **Netresearch** (vendored) | {desc[:145]}… |", text, flags=re.M)
    marker = "## Imported Netresearch catalog"
    if marker in text:
        start = text.index(marker); end = text.index("## Session profiles", start)
        text = text[:start] + text[end:]
    local_marker = '## Additional collection skills'
    if local_marker in text:
        start = text.index(local_marker); end = text.index('## Session profiles', start)
        text = text[:start] + text[end:]
    already = set(re.findall(r"^\| `([a-z0-9-]+)` \|", text, re.M))
    extra = [(n, d) for n, d, o, _ in skills if o == "Netresearch" and n not in already]
    section = (marker + "\n\nImported on demand, not sequential upgrade phases. The local `typo3-upgrade-run` owns the\n"
               "site graph; upstream project-upgrade and effort skills supply bounded advice only.\n"
               "Only the 16 explicitly approved Netresearch repositories are synchronized.\n"
               "Unrelated marketplace skills are outside this collection.\n"
               "TYPO3 skills do not handle explicitly unrelated React/Vue/Svelte/WordPress/etc. tasks.\n"
               "`catalog/routing-policy.json` names on-demand companions: the local upgrade and\n"
               "accessibility owners load those references only for a bounded need, or the user\n"
               "can request them by name. Both eval graders use these same boundaries.\n\n"
               "| Skill | Owner | What it does |\n|---|---|---|\n")
    section += "\n".join(f"| `{n}` | **Netresearch** (vendored) | {d[:130]}… |" for n, d in extra) + "\n\n"
    additional = [(n, d, o) for n, d, o, _ in skills if n not in already and o != 'Netresearch']
    section += local_marker + '\n\n| Skill | Owner | What it does |\n|---|---|---|\n'
    section += '\n'.join(f'| `{n}` | {o} | {d[:130]}… |' for n, d, o in additional) + '\n\n'
    text = text.replace("## Session profiles", section + "## Session profiles")
    suites = [json.loads((SKILLS_DIR / n / 'evals/evals.json').read_text()) for n, _, o, _ in skills if o == 'webconsulting']
    reviewed = sum(any(c.get('status') == 'reviewed' for c in s['evals']) for s in suites)
    proposed = sum(any(c.get('status') == 'proposed' for c in s['evals']) for s in suites)
    text = re.sub(r'Current: .*?signature\.', f'Current: {len(suites)}/{len(suites)} owned skills have suites, '
                  f'{reviewed}/{len(suites)} have human-reviewed coverage, and {proposed} suites include proposed cases awaiting signature.', text, flags=re.S)
    agents.write_text(text)
    vendor = ROOT / "VENDORED.md"
    text = vendor.read_text()
    start = text.index("| Skill | Upstream | Source | Commit | Synced |")
    end = text.index("## Attribution", start)
    retained = [line for line in text[start:end].splitlines() if line.startswith("| `") and "| Netresearch |" not in line]
    rows = [f"| `{s['name']}` | Netresearch | {s['repository']} | `{s['commit']}` | {lock['checked_at'][:10]} |" for s in lock["skills"]]
    table = "| Skill | Upstream | Source | Commit | Synced |\n|---|---|---|---|---|\n" + "\n".join(sorted(retained + rows))
    table += f"\n\n{len(retained) + len(rows)} vendored skills · {total - len(retained) - len(rows)} webconsulting skills · {total} total.\n\n"
    vendor.write_text(text[:start] + table + text[end:])
    print(f"Refreshed README/AGENTS/VENDORED inventories: {total} skills, {len(rows)} pinned Netresearch skills.")


if __name__ == "__main__":
    main()
