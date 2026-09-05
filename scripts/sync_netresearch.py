#!/usr/bin/env python3
"""Refresh the 16 approved Netresearch repositories, never plugin hooks or installers.

First clone the marketplace and its listed GitHub repositories to --cache. This script
is deliberately offline: review those checkouts, then use --write to import. Upstream
files stay byte-identical; local guidance and local evals are preserved separately.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "vendor-lock.json"
LOCAL = "references/webconsulting-additions.md"
UPSTREAM_REPOSITORIES = frozenset(
    f"netresearch/{name}-skill" for name in (
        "enterprise-readiness", "php-modernization", "security-audit",
        "typo3-a11y", "typo3-ckeditor5", "typo3-conformance",
        "typo3-core-contributions", "typo3-ddev", "typo3-docs",
        "typo3-extension-upgrade", "typo3-project-upgrade",
        "typo3-site-conformance", "typo3-testing", "typo3-typoscript-ref",
        "typo3-upgrade-effort-model", "typo3-vite",
    )
)


def in_scope(repository):
    return repository in UPSTREAM_REPOSITORIES


def git(directory, *args):
    return subprocess.check_output(["git", "-C", str(directory), *args], text=True).strip()


def inventory(cache):
    marketplace = cache / "marketplace"
    if git(marketplace, "status", "--porcelain"):
        raise ValueError('Dirty marketplace checkout; review before import')
    catalog = json.loads((marketplace / ".claude-plugin/marketplace.json").read_text())
    repositories = {p["source"]["repo"] for p in catalog["plugins"]}
    missing = UPSTREAM_REPOSITORIES - repositories
    if missing:
        raise ValueError(f"Approved repositories missing from marketplace: {sorted(missing)}")
    entries = []
    for repo in sorted(filter(in_scope, repositories)):
        if not re.fullmatch(r"netresearch/[a-z0-9-]+", repo):
            raise ValueError(f"Unexpected upstream: {repo}")
        checkout = cache / repo.split("/")[1]
        if git(checkout, "status", "--porcelain"):
            raise ValueError(f"Dirty upstream checkout: {checkout}")
        files = git(checkout, "ls-files").splitlines()
        licenses = [f for f in files if re.match(r"^(LICENSE|LICENCE|NOTICE|COPYING)([.-]|$)", f)]
        if not licenses:
            raise ValueError(f"No root licence in {repo}; review before import")
        skills = [f for f in files if re.fullmatch(r"skills/[a-z0-9-]+/SKILL.md", f)]
        if not skills:
            raise ValueError(f"No distributable skills in {repo}")
        for skill in skills:
            source_dir = str(Path(skill).parent)
            name = Path(source_dir).name
            copied = {f[len(source_dir) + 1:]: f for f in files if f.startswith(source_dir + "/")}
            for f in licenses:
                copied.setdefault(f, f)
            if LOCAL in copied:
                raise ValueError(f"Upstream collides with overlay for {name}")
            omitted = {}
            for target, source in list(copied.items()):
                src = checkout / source
                if src.is_symlink() and not src.exists():
                    if not re.match(r"^(LICENSE|CLAUDE|GEMINI)", Path(target).name):
                        raise ValueError(f"Broken upstream resource: {repo}:{source}")
                    omitted[target] = str(src.readlink())
                    del copied[target]
            for target, source in copied.items():
                if ".." in Path(target).parts or not (checkout / source).resolve().is_relative_to(checkout.resolve()):
                    raise ValueError(f"Unsafe vendor path {repo}:{source}")
                # Materialize in-repo symlinks (usually CLAUDE.md -> AGENTS.md) as
                # identical content; never retain links that can escape a skill bundle.
            entries.append({"name": name, "owner": "Netresearch", "repository": f"https://github.com/{repo}",
                            "commit": git(checkout, "rev-parse", "HEAD"), "source_path": source_dir,
                            "files": {target: hashlib.sha256((checkout / source).read_bytes()).hexdigest()
                                      for target, source in sorted(copied.items())},
                            "licenses": licenses, "omitted_broken_symlinks": omitted,
                            "_checkout": checkout, "_copied": copied})
    if len({e["name"] for e in entries}) != len(entries):
        raise ValueError("Duplicate skill names in marketplace")
    return {"schema": 1, "checked_at": datetime.now(timezone.utc).isoformat(),
            "marketplace": {"repository": "https://github.com/netresearch/claude-code-marketplace",
                            "commit": git(marketplace, "rev-parse", "HEAD"),
                            "catalog_plugins": len(catalog["plugins"]),
                            "selected_repositories": len(UPSTREAM_REPOSITORIES),
                            "scope": "TYPO3 skills and three existing supporting skills"},
            "skills": entries}


def preflight(data, previous):
    """Refuse conflicts before copying any file, not halfway through an import."""
    for item in data['skills']:
        destination = ROOT / 'skills' / item['name']
        if destination.is_symlink() or not destination.resolve().is_relative_to((ROOT / 'skills').resolve()):
            raise ValueError(f'Unsafe local skill destination: {destination}')
        if item['name'] not in previous and (destination / 'SKILL.md').exists():
            from audit_skills import discover_source_info
            owner, source, _ = discover_source_info(item['name'], (destination / 'SKILL.md').read_text())
            if owner != 'Netresearch' or source != item['repository']:
                raise ValueError(f'New upstream would overwrite a different local owner/source: {destination}')
        for relative in set(item['files']) | set(previous.get(item['name'], {}).get('files', {})) | {LOCAL}:
            target = destination / relative
            if Path(relative).is_absolute() or '..' in Path(relative).parts or target.is_symlink() or not target.resolve().is_relative_to(destination.resolve()):
                raise ValueError(f'Unsafe local vendor destination: {target}')
        for relative, expected in previous.get(item['name'], {}).get('files', {}).items():
            target = destination / relative
            if not target.is_file() or hashlib.sha256(target.read_bytes()).hexdigest() != expected:
                raise ValueError(f'Locally changed pinned file; preserve/reconcile before sync: {target}')
        suite = destination / 'evals/evals.json'
        if item['name'] not in previous and suite.exists() and 'evals/evals.json' in item['files']:
            local = json.loads(suite.read_text())
            archive = destination / 'evals/webconsulting-evals.json'
            if isinstance(local, dict) and 'skill_type' in local and archive.exists() and archive.read_bytes() != suite.read_bytes():
                raise ValueError(f'Conflicting local eval archive: {archive}')


def sync(data):
    old = json.loads(LOCK.read_text()) if LOCK.exists() else {"skills": []}
    previous = {s["name"]: s for s in old["skills"]}
    preflight(data, previous)
    for item in data["skills"]:
        destination = ROOT / "skills" / item["name"]
        # Only delete obsolete files previously recorded in our lock; first import keeps
        # legacy extras for review. Never delete local overlays or local evaluation cases.
        for relative in previous.get(item["name"], {}).get("files", {}):
            if relative not in item["files"]:
                target = destination / relative
                if target.is_file() and target.resolve().is_relative_to(destination.resolve()):
                    target.unlink()
                    print(f"Removed obsolete vendored file (recoverable in Git): {target.relative_to(ROOT)}")
        for target, source in item["_copied"].items():
            output = destination / target
            if target == "evals/evals.json" and output.exists() and item["name"] not in previous:
                local_suite = json.loads(output.read_text())
                if isinstance(local_suite, dict) and "skill_type" in local_suite:
                    saved = destination / "evals/webconsulting-evals.json"
                    if saved.exists() and saved.read_bytes() != output.read_bytes():
                        raise ValueError(f"Conflicting local eval archive: {saved}")
                    shutil.copy2(output, saved)
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(item["_checkout"] / source, output)
        overlay = destination / LOCAL
        overlay.parent.mkdir(parents=True, exist_ok=True)
        credits = (f"\n## Credits & Attribution\n\n"
                   f"This skill is based on the excellent work by **Netresearch DTT GmbH**.\n"
                   f"Original repository: {item['repository']}\n\n"
                   "Special thanks to Netresearch for publishing and maintaining these skills.\n"
                   "Copyright (c) Netresearch DTT GmbH; original licence files are preserved.\n"
                   "Adapted by webconsulting.at for this skill collection through this overlay only; "
                   "the upstream skill is unmodified.\n")
        body = overlay.read_text() if overlay.exists() else (
            f"# webconsulting integration: {item['name']}\n\n"
            "Load this skill only for its stated task; importing it does not authorize its "
            "installers, remote changes, deployments, auto-merge, or credential access.\n"
            "Project/user approval and this collection's safety rules remain authoritative.\n")
        if "## Credits & Attribution" not in body:
            overlay.write_text(body.rstrip() + "\n" + credits)
        item.pop("_checkout")
        item.pop("_copied")
    LOCK.write_text(json.dumps(data, indent=2) + "\n")
    config = {"description": "Offline, pinned Netresearch sync. Preserve byte-identical upstream files, licences and local attribution overlays. No plugin hooks are installed.",
              "lastSync": data["checked_at"], "marketplace": data["marketplace"],
              "skills": [{"name": s["name"], "source": s["repository"] + ".git", "commit": s["commit"],
                          "enabled": True, "path": "skills/" + s["name"]} for s in data["skills"]]}
    (ROOT / ".sync-config.json").write_text(json.dumps(config, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    data = inventory(args.cache.resolve())
    print(f"{data['marketplace']['selected_repositories']} approved repositories, {len(data['skills'])} skills; marketplace {data['marketplace']['commit']}")
    if args.write:
        sync(data)
    else:
        for s in data["skills"]:
            print(f"{s['name']}: {s['commit'][:12]} ({len(s['files'])} files)")


if __name__ == "__main__":
    main()
