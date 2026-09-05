#!/usr/bin/env python3
"""Package/install the collection as a skills-only ChatGPT desktop plugin.

Only version-controlled, allowlisted collection files are packaged. Local run
evidence, .env files, caches and external symlinks must never enter the plugin.
No workspace/public publication, MCP connection or authentication is performed.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

# Running from an extracted, hash-verified ZIP must not add __pycache__ to its inputs.
sys.dont_write_bytecode = True
from audit_skills import parse_frontmatter, split_frontmatter

ROOT = Path(__file__).resolve().parents[1]
NAME = "typo3-skills"
MANIFEST = ".codex-plugin/plugin.json"
RECEIPT = ".typo3-skills-bundle.json"
PREFIXES = ("skills/", "rules/", "references/", "catalog/", "scripts/")
ROOT_FILES = {MANIFEST, "AGENTS.md", "README.md", "SKILL-SPEC.md", "VENDORED.md",
              "LICENSE", "LICENSE-MIT", "LICENSE-CC-BY-SA-4.0", "vendor-lock.json",
              "install.sh", ".sync-config.json", "evals-baseline.json", "GEMINI.md",
              "CLAUDE.md", "gemini-extension.json", ".windsurfrules"}
BLOCKED_PARTS = {".git", ".validation", ".typo3-update", "node_modules", "__pycache__", ".venv"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()


def plain_path(path):
    """Refuse symlink components, including a dangling final component."""
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError(f"Symlink preserved; choose a plain destination: {part}")


def source_bundle(root):
    root = root.resolve()
    exported = None
    if (root / RECEIPT).exists():
        # ZIP extractors on Windows/Python may drop executable bits; restore them
        # from the checked receipt while still requiring every byte to match.
        exported = verify_bundle(root, allow_mode_drift=True)["files"]
        files = list(exported)
    else:
        git_root = subprocess.check_output(["git", "-C", str(root), "rev-parse", "--show-toplevel"], text=True).strip()
        if Path(git_root).resolve() != root:
            raise ValueError("Run from this collection's Git root, not a nested untracked copy")
        files = subprocess.check_output(["git", "-C", str(root), "ls-files", "-z"], text=True).split("\0")
    selected = sorted({p for p in files if p and (p in ROOT_FILES or p.startswith(PREFIXES))} | {MANIFEST})
    payload = {}
    for relative in selected:
        parts = PurePosixPath(relative).parts
        basename = parts[-1]
        if ".." in parts or relative.startswith("/") or set(parts) & BLOCKED_PARTS:
            raise ValueError(f"Unsafe tracked package path: {relative}")
        if basename == ".env" or (basename.startswith(".env.") and basename != ".env.example"):
            raise ValueError(f"Credential file must not be packaged: {relative}")
        file = root / relative
        plain_path(file)
        if not file.is_file():
            raise ValueError(f"Missing/non-regular tracked package file: {relative}")
        mode = exported[relative]["mode"] if exported else (0o755 if file.stat().st_mode & 0o111 else 0o644)
        payload[relative] = (file.read_bytes(), mode)
    manifest = json.loads(payload[MANIFEST][0])
    if manifest.get("name") != NAME or manifest.get("skills") != "./skills/":
        raise ValueError("Invalid plugin name or skill discovery path")
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", manifest.get("version", "")):
        raise ValueError("Invalid plugin version")
    if set(manifest) & {"apps", "mcpServers", "hooks"}:
        raise ValueError("This installer only accepts the skills-only plugin")
    names = []
    for file in sorted((root / "skills").glob("*/SKILL.md")):
        relative = file.relative_to(root).as_posix()
        if relative not in payload:
            raise ValueError(f"Untracked skill would be missing; review and git add it first: {relative}")
        metadata = parse_frontmatter(split_frontmatter(payload[relative][0].decode())[0])
        if metadata.get("name") != file.parent.name or not metadata.get("description"):
            raise ValueError(f"Invalid skill identity: {relative}")
        names.append(file.parent.name)
    if not names:
        raise ValueError("No packaged skills")
    for required in ("AGENTS.md", "VENDORED.md", "LICENSE", "LICENSE-MIT", "LICENSE-CC-BY-SA-4.0", "vendor-lock.json"):
        if required not in payload:
            raise ValueError(f"Required collection context/attribution missing: {required}")
    return payload, names


def inventory(payload):
    return {name: {"sha256": digest(data), "mode": mode} for name, (data, mode) in sorted(payload.items())}


def verify_bundle(directory, allow_mode_drift=False):
    plain_path(directory)
    receipt_path = directory / RECEIPT
    plain_path(receipt_path)
    if not receipt_path.is_file():
        raise ValueError(f"Unmanaged plugin directory preserved: {directory}")
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("schema") != "typo3-skills/bundle@1" or not isinstance(receipt.get("files"), dict):
        raise ValueError("Invalid existing bundle receipt; files preserved")
    actual = {}
    for file in directory.rglob("*"):
        plain_path(file)
        if file.is_file() and file != receipt_path:
            actual[file.relative_to(directory).as_posix()] = {
                "sha256": digest(file.read_bytes()),
                "mode": 0o755 if file.stat().st_mode & 0o111 else 0o644,
            }
    if allow_mode_drift:
        matching = {p: f["sha256"] for p, f in actual.items()} == {p: f["sha256"] for p, f in receipt["files"].items()}
    else:
        matching = actual == receipt["files"]
    if not matching:
        raise ValueError(f"Local plugin edits/extras preserved; reconcile before updating: {directory}")
    return receipt


def write_bundle(payload, names, target, creator_scripts=None):
    plain_path(target)
    source_hash = digest(json_bytes(inventory(payload)))
    previous = verify_bundle(target) if target.exists() else None
    if previous and previous["source_sha256"] == source_hash:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f".{NAME}-stage-", dir=target.parent))
    try:
        for relative, (data, mode) in payload.items():
            file = stage / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(data)
            file.chmod(mode)
        if previous:
            helper = creator_scripts / "update_plugin_cachebuster.py" if creator_scripts else None
            if helper and helper.is_file():
                subprocess.run([sys.executable, str(helper), str(stage)], check=True)
            else:
                manifest = json.loads((stage / MANIFEST).read_text())
                stamp = datetime.now(timezone.utc).strftime("local-%Y%m%d-%H%M%S")
                manifest["version"] = manifest["version"].split("+")[0] + "+codex." + stamp
                (stage / MANIFEST).write_bytes(json_bytes(manifest))
        installed = dict(payload)
        installed[MANIFEST] = ((stage / MANIFEST).read_bytes(), payload[MANIFEST][1])
        receipt = {"schema": "typo3-skills/bundle@1", "source_sha256": source_hash,
                   "skills": names, "files": inventory(installed)}
        (stage / RECEIPT).write_bytes(json_bytes(receipt))
        verify_bundle(stage)
        if target.exists():
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
            backup = target.with_name(f".{NAME}-backup-{stamp}")
            target.rename(backup)
            print(f"Previous managed bundle retained at {backup}")
            try:
                stage.rename(target)
            except OSError:
                backup.rename(target)
                raise
        else:
            stage.rename(target)
        return True
    finally:
        if stage.exists():
            shutil.rmtree(stage)  # Only this invocation's mkdtemp staging directory.


def marketplace_plan(path):
    plain_path(path)
    entry = {"name": NAME, "source": {"source": "local", "path": f"./plugins/{NAME}"},
             "policy": {"installation": "AVAILABLE", "authentication": "ON_INSTALL"},
             "category": "Productivity"}
    payload = json.loads(path.read_text()) if path.exists() else {
        "name": "personal", "interface": {"displayName": "Personal"}, "plugins": []}
    if not isinstance(payload, dict) or not isinstance(payload.get("name"), str) or not re.fullmatch(r"[A-Za-z0-9_-]+", payload["name"]):
        raise ValueError("Invalid personal marketplace identifier; preserved")
    if not isinstance(payload.get("plugins"), list) or not all(isinstance(p, dict) for p in payload["plugins"]):
        raise ValueError("Invalid personal marketplace entries; preserved")
    existing = [p for p in payload["plugins"] if p.get("name") == NAME]
    if existing and (len(existing) != 1 or existing[0].get("source") != entry["source"]):
        raise ValueError("Existing typo3-skills marketplace source conflicts; preserved")
    if not existing:
        payload["plugins"].append(entry)
    return payload, not existing


def install_personal(payload, names, personal_root, prepare_only=False, creator_scripts=None):
    marketplace = personal_root / ".agents/plugins/marketplace.json"
    target = personal_root / "plugins" / NAME
    planned, add_entry = marketplace_plan(marketplace)
    native = shutil.which("codex")
    if not prepare_only and not native:
        raise ValueError("Codex CLI is required for native plugin installation; use --prepare-only for desktop UI installation")
    marketplace.parent.mkdir(parents=True, exist_ok=True)
    lock = marketplace.parent / f".{NAME}-install.lock"
    with lock.open("x"):
        pass
    try:
        write_bundle(payload, names, target, creator_scripts)
        planned, add_entry = marketplace_plan(marketplace)
        if add_entry:
            helper = creator_scripts / "create_basic_plugin.py" if creator_scripts else None
            if helper and helper.is_file():
                with tempfile.TemporaryDirectory(prefix="typo3-plugin-scaffold-") as temp:
                    subprocess.run([sys.executable, str(helper), NAME, "--path", temp,
                                    "--with-marketplace", "--marketplace-path", str(marketplace)], check=True)
            else:
                # Portable equivalent of the official initial scaffold. Existing entries/order are retained.
                with tempfile.NamedTemporaryFile(dir=marketplace.parent, delete=False) as handle:
                    staged = Path(handle.name)
                    handle.write(json_bytes(planned))
                try:
                    staged.replace(marketplace)
                finally:
                    staged.unlink(missing_ok=True)
        if prepare_only:
            print("Prepared, not activated. Restart ChatGPT desktop, open Plugins > Personal, and install TYPO3 Skills.")
        else:
            subprocess.run([native, "plugin", "add", f"{NAME}@{planned['name']}", "--json"], check=True)
            print("Native plugin installation completed. Start a fresh ChatGPT desktop conversation to discover the skills.")
        print(f"{len(names)} complete skills; marketplace: {marketplace}")
        return target, marketplace
    finally:
        lock.unlink()


def package_zip(payload, names, destination):
    plain_path(destination)
    if destination.exists():
        try:
            with zipfile.ZipFile(destination) as existing:
                receipt = json.loads(existing.read(f"{NAME}/{RECEIPT}"))
                if receipt.get("schema") != "typo3-skills/bundle@1":
                    raise ValueError("Not a managed package")
        except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
            raise ValueError(f"Unmanaged output file preserved: {destination}") from error
    destination.parent.mkdir(parents=True, exist_ok=True)
    receipt = {"schema": "typo3-skills/bundle@1", "source_sha256": digest(json_bytes(inventory(payload))),
               "skills": names, "files": inventory(payload)}
    contents = dict(payload)
    contents[RECEIPT] = (json_bytes(receipt), 0o644)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as handle:
        staged = Path(handle.name)
    try:
        with zipfile.ZipFile(staged, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for relative, (data, mode) in sorted(contents.items()):
                info = zipfile.ZipInfo(f"{NAME}/{relative}", (2026, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = (0o100000 | mode) << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
        staged.replace(destination)
    finally:
        staged.unlink(missing_ok=True)
    print(f"Packaged {len(names)} complete skills: {destination}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Validate package inputs without installing")
    mode.add_argument("--package-only", action="store_true", help="Build a ZIP, without client changes")
    mode.add_argument("--prepare-only", action="store_true", help="Prepare the personal source; leave native activation to the UI")
    parser.add_argument("--output", type=Path, help="ZIP output path with --package-only")
    args = parser.parse_args()
    if args.output and not args.package_only:
        parser.error("--output requires --package-only")
    try:
        payload, names = source_bundle(args.root)
        if args.check:
            print(f"ChatGPT plugin inputs valid: {len(names)} skills / {len(payload)} files")
        elif args.package_only:
            package_zip(payload, names, args.output or args.root / "dist/chatgpt/typo3-skills.zip")
        else:
            creator = Path.home() / ".codex/skills/.system/plugin-creator/scripts"
            install_personal(payload, names, Path.home(), args.prepare_only, creator)
        return 0
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print(f"ChatGPT plugin setup stopped: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
