# ChatGPT and Cursor installation

The source collection remains 59 skills. ChatGPT distribution adds a package, not another
skill or a second upgrade orchestrator. Thank you to Netresearch DTT GmbH and the other
upstream authors: original skill files, licences, overlays and `vendor-lock.json` are retained.

## Verified on 2026-09-05

- Cursor installation exited 0; all 59 source skill directories are available and byte-matched.
- ChatGPT native installation exited 0. `codex plugin list --marketplace personal --json`
  reports `typo3-skills@personal` as both installed and enabled.
- The installed cache contains all **59 skills / 1,086 distributable skill files**, plus shared
  files: **1,155 packaged files**, with zero unexpected byte mismatches (native updates add a
  documented cachebuster to the local manifest version). The source tree additionally
  contained one generated private harness journal; it was deliberately excluded, not distributed.
- OpenAI's plugin-creator validator passed both the source and installed plugin, exit 0.
- Repository checks passed 8/8 groups, including 30 tooling tests and 293 harness tests.
- The portable ZIP was built. No public/workspace publication occurred. A real rendered ChatGPT
  skill-picker/session test remains separate: start a fresh desktop conversation to pick up the
  installed plugin. No customer upgrade, permission grant or real-site benchmark was performed.

## Install and update

From this collection's checkout:

```bash
./install.sh --user-only --client cursor
./install.sh --user-only --client chatgpt
```

The Cursor command links the complete bundles. The ChatGPT command prepares a self-contained
local plugin and installs it using `codex plugin add typo3-skills@<personal-marketplace-name>`.
The shared native CLI, Git and Python 3 are needed for installation from a checkout. An extracted
verified ZIP is also a valid source and does not need Git.

Without the native CLI, use `python3 scripts/chatgpt_plugin.py --prepare-only` and install from
**Plugins → Personal → TYPO3 Skills** in ChatGPT desktop. Prepared means available in a local
source, not installed or verified in the UI. Do not use `codex plugin marketplace add` for the
default personal marketplace: it is discovered automatically.

Rerunning is safe: unchanged source bundles are retained; updated managed bundles get the
documented cachebuster, a retained previous-bundle backup and native reinstall. Unknown plugin
directories, edited copies, symlinks and conflicting marketplace sources are refused. Other
marketplace entries, display labels, policies and ordering stay unchanged. No global config is
hand-edited; native installation owns its config/cache changes.

## Verify after installation

1. Check native installation with `codex plugin list --marketplace personal --json` (use the
   preserved marketplace name if yours differs).
2. Start a fresh ChatGPT desktop conversation. Open Plugins/Skills and select **TYPO3 Skills**.
3. Use its starter prompt or ask: “Read this plugin's AGENTS.md, list its 59 skill names, and
   identify the upgrade orchestration skill. Do not change any project.”
4. Confirm the requested skill reads its bundled references and any
   `references/webconsulting-additions.md` overlay. Root/overlay instructions remain part of
   the collection contract; packaging alone does not prove model compliance.

The plugin can also be visible in Codex because ChatGPT and Codex share this native plugin
framework. Do not duplicate a task or create a second upgrade graph just because both a direct
skill and a plugin-qualified skill appear. Installing the package does not test a real TYPO3
upgrade or grant access to the user's computer from a web/mobile chat.

## Distribution and provenance

`python3 scripts/chatgpt_plugin.py --package-only` produces a deterministic ZIP plus an embedded
per-file SHA-256 inventory. Only allowlisted Git-tracked collection files are included; local
customer run directories, credentials, caches and external links cannot be copied into it.
New skills must be reviewed and staged before packaging so they cannot silently disappear.

The package includes its public-facing manifest at `.codex-plugin/plugin.json`, full skill
directories, shared guardrails, source records and licences. No MCP server, connector, hook,
account registration, workspace publishing or public-directory submission is bundled.

The OpenAI plugin-creator scaffold and validator informed the manifest and personal-marketplace
format. Its helpers are used when installed; the portable fallback uses the documented same
initial schema/cachebuster conventions. The account-facing install is always the native CLI
or the user's desktop UI, never a fabricated `.chatgpt` directory.

Sources checked 2026-09-05: OpenAI's [skills documentation](https://learn.chatgpt.com/docs/build-skills),
[plugin packaging, marketplaces and local installation](https://developers.openai.com/plugins/build/plugins).
Local sources are distinct from workspace and public publication, whose availability varies
by surface. No public/web/mobile installation is claimed by this local installer.
