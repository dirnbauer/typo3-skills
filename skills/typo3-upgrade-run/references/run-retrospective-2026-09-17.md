# Follow-up delta — 2026-09-17

This supplements the [six-week review](run-retrospective-2026-09-16.md), not a second fleet audit.
Rechecked the same seven local repositories, all local refs since September 16, selected current
files, and the now-readable **Audit RTE content elements** task. No fetch, customer write, DDEV
operation, deployment, provider call, commit or push was performed. No new complete-upgrade timing
series was found; the 8/24/48-hour admission limits and three-state matrix stay unchanged.

## New evidence available

The seven checked-out HEADs remain those recorded on September 16. The newer Saferinternet mail/DOI
commits on other refs were already covered. Watchlist has additional **uncommitted** RTE configuration
and audit-report work; it must not be presented as committed, deployed or fully backend-verified.

Internal evidence, relative to `watchlist-internet`:

- `reports/rte-content-blocks-20260916/README.md`, field inventory and content-block inventory;
- the working-tree diff for `packages/theme/ContentBlocks/ContentElements/text_icon/config.yaml`,
  `Configuration/RTE/Basic.yaml` and affected field definitions;
- installed Core 14.3.7 `Classes/Configuration/Richtext.php` and Content Blocks 2.4.9
  `Classes/FieldType/TextareaFieldType.php` for actual preset precedence and field options;
- task `01a0ab25-1ea3-77d0-bb19-a4fbbe70cd0c`, **Audit RTE content elements**: ~25m recorded repair
  turn, with subsequent sign-in still needed. This is not a whole-upgrade benchmark.

The report records an audit of 30 blocks and 109 field/type combinations. One migrated field had
354 populated HTML values but no rich editor. It describes preset-specific loss of headings, code
and wrappers, 13 passing configuration tests, unchanged database snapshots and frontend checks.
Those test results are historical report evidence, **not rerun in this skills task**. Actual
authenticated backend verification remains explicitly pending. A separate list of 66 legacy embed
records needs content review; enabling RTE does not safely migrate arbitrary embedded HTML.

## Problem → control

| Gap | Correction | Owner / evidence |
|---|---|---|
| Reused `bodytext` looked correct publicly but lacked the editor | Explicit per-type rich-text configuration while preserving the existing column | Content Blocks example + field inventory |
| Global preset appeared correct while field overrides selected another | Inspect compiled TCA, `columnsOverrides`, field-specific TSconfig and actual merged preset | Content Blocks / CKEditor owned overlay |
| Green frontend proof missed formatting loss on the next save | Representative stored-markup fixture through editor, server processing and frontend; retain sanitization | Existing `backend-editor` assertions, no new graph node |
| Standalone editor and parser checks left real backend dialogs untested | Separate configuration/parser, authenticated backend and frontend proof; no closure with pending login | Closure / Playwright proposed behavior cases |
| Prior generic publication approval did not constrain owner/host | Apply the user's explicit destination policy before any authorized push | Offline Git URL preflight + separate transport/authority review |

The exact allowed GitLab host is supported by the configured remotes in this collection and all
seven projects: `gitlab.webconsulting.at`. The collection also has
`https://github.com/dirnbauer/typo3-skills.git`. Merely being configured is not push permission.
The [push policy](push-policy.md) restricts every destination and refuses unverified aliases/rewrites;
its helper verifies Git-resolved URLs only, not network transport or user authorization.

## Implementation boundary

The user's follow-up also requires official TYPO3 tools before custom code and widely used
extensions for gaps. [Native-tool selection](native-tools-first.md) records inspected Core commands,
their side-effect/exit-code traps and dated Packagist adoption/compatibility. The dependency strategy
now checks Core replacements before forks; P08 evaluates Core form transfer before a custom wizard;
DDEV sync must justify any functionality Core/DDEV cannot provide. This is reuse within existing
nodes, not installation of every candidate. Existing environment-loader and Deployer package
distinctions were verified again against current package metadata.

Updates stay in owned instructions, a new conditional field reference, proposed evals and a tested
read-only push-destination helper. The Netresearch CKEditor source remains byte-identical; only the
webconsulting overlay changes, with thanks/attribution preserved. No new global state, parent loop,
mandatory per-record browser test or extra deadline is introduced. Customer closure reconciliation,
backend sign-in, legacy-content review and actual overnight performance validation remain separate.

## Collection validation

- `./scripts/check.sh`: **8 gates passed**, exit 0, in an isolated copy of the current working tree.
- Harness: **317 tests / 53 suites**, zero failures or skips, including 12 new push-target tests.
  The new test first failed on the missing helper, then passed after implementation. Tests exercise
  refusal paths without contacting a remote; no Git push command was executed.
- `./install.sh --generate-only`: exit 0. Generated catalogs/client files match the source after
  merging only the six changed skill line counts; unrelated icon work remains preserved.
- Skill-creator `quick_validate.py`, structure/eval checks, attribution guardrails and
  `git diff --check`: exit 0. Eleven new behavior cases are **proposed**, not human-reviewed passes
  or completed agent trials. Vendored upstream files and credits remain intact.
- The destination helper passes for both collection remotes while explicitly reporting that it
  does not grant push permission or verify transport overrides. No repository commit/push or client
  bundle installation was performed; the existing direct Codex updater link points at this source.
