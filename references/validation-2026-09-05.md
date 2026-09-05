# Installation and independent behavior validation

Checked 2026-09-05. This report separates software/fixture checks from customer upgrade success.
No customer project was upgraded, restored, deployed or closed during these trials.

Client follow-up later on the same day: Cursor's seven missing additions and the local ChatGPT
plugin installation were completed. See the [current client verification](chatgpt-cursor-installation.md).
The original client observations below remain a historical record, not the current install status.

## Delivered

- Installed the seven missing complete Codex bundles: `typo3-a11y`, `typo3-ckeditor5`,
  `typo3-playwright`, `typo3-project-upgrade`, `typo3-site-conformance`,
  `typo3-typoscript-ref`, `typo3-upgrade-effort-model`. All 59 bundles match this collection,
  including upstream licences and webconsulting overlays. Thank you to Netresearch for the
  upstream TYPO3 skills; their original files and attribution remain intact.
- New runs seal small/large/huge windows of **8/24/48 elapsed hours**, with **2/6/12 hours**
  reserved for closure. The corresponding mutation cutoffs are T+6/18/36 hours. Resuming does
  not reset elapsed time. Existing unmarked seals retain the older 8/12/14-hour policy.
  These are admission caps, not demonstrated completion times or increased retry budgets.
- Restored the native Gemini extension manifest generator. Added client-selective installation,
  conflict preservation, complete-directory linking and project context paths. Existing local
  edits, foreign links, dangling context links and edited Cursor rules are not erased.
- Fixed two graph defects exposed by independent trials: a successful terminal cannot hide a
  blocked/unfinished activated branch, and a repair cannot start when every successful route
  already exceeds the remaining recovery budget. Graph integrity is explicitly not closure.
- Added proposed behavior evals and a [12-case human review queue](human-review-queue-2026-09.md).
  No human signature was fabricated or carried across changed assertions.

## Executed verification

| Check | Command / actual result |
|---|---|
| Repository gates | `./scripts/check.sh` — exit 0, 8/8 groups |
| Harness regression suite | `npm test --silent` in `skills/typo3-upgrade-run/scripts` — exit 0, 293 tests passed, 0 failed/skipped |
| Installer and quality-tool tests | `python3 -m unittest discover -s scripts/tests -v` — exit 0, 20 tests passed |
| Generated client files | `./install.sh --generate-only` and `python3 scripts/generate_gemini_manifest.py --check` — exit 0 |
| Native Gemini package validation | Gemini CLI 0.32.1's installed `handleValidate({path: collectionRoot})` — exit 0 |
| Native Gemini skill loading | Its installed `loadSkillsFromDir(collectionRoot + '/skills')` — exit 0, all 59 discovered |
| Normal Gemini CLI invocation | `gemini extensions validate <collectionRoot>` — exit 41, authentication required; no authenticated session is claimed |
| Installed Codex contents | Source-to-installed byte comparison — exit 0, 59 bundles / 1,087 files, no missing or differing files (runtime caches excluded) |
| Eval bookkeeping | `python3 scripts/validate_evals.py --min-cases 6` — exit 0; 379 owned cases: 52 reviewed, 314 proposed, 13 drafts |

The native Gemini validation/loading checks invoke the installed product code without network,
authentication or model work. They verify packaging and discovery, not a full agent session.
See the official [Gemini skill discovery](https://geminicli.com/docs/cli/using-agent-skills/)
and [extension reference](https://geminicli.com/docs/extensions/reference/).

The advisory skill-doctor run records 720 diagnostics, predominantly schema translation work
(`native-schema-check-required`: 695); zero unresolved owned-source findings remain. This is not
a claim that all proposed evals have executed or that the collection is error-free.

## Actual agent trials

Independent evaluators received realistic requests and minimal raw synthetic fixtures, not the
intended bug or desired verdict. The skill-creator's independent-testing guidance informed this
method. No real CMS, customer account or production service was needed.

| Trial | Observed behavior and limit |
|---|---|
| Interrupted mutation | Preserved partial-data evidence, reconciled the interrupted operation, verified rollback under its lock and left the migration blocked. A passing independent inspector originally hid the blockage. After the fix, status is blocked and migration admission exits 4. |
| Retry exhaustion | Preserved three check starts and two consumed retry traversals. The controller originally advertised another repair. After the fix, the repair is waiting and direct admission exits 4 before any new attempt. |
| Stale closure proof | `graph-validate` and `validate-run` exit 3 for changed bound evidence; `closure-check` exits 3 for absent closure proof. The agent refused a completed-upgrade handover and did not repair hashes or invent a baseline. |
| Browser consequences | Real Playwright execution against loopback fixtures: 2 executed, 2 failed, 0 skipped/retries, process exit 1. It caught the second AJAX interaction failing after DOM replacement and an editor save losing content on reopen. These are successful failure-detection trials, not passing journeys or real TYPO3 editor certification. |

Post-fix preservation verifiers both exit 0: zero new attempts/stateful operations, unchanged data,
budgets and node histories, and preserved original journal prefixes. Both used the same frozen
52-file harness manifest, SHA-256 `f5139b875e518e01babd9583ec6816744717a486b79d127d327b967e848a9cd4`.
The first historical trials did not share one pinned build; that provenance limitation is recorded,
not backfilled. Browser evidence verification exits 0 for all 26 manifest entries and server cleanup.
Playwright 1.62.0 / Chromium 151.0.7922.34 / Node 26.5.0 were used for the browser fixture.

Raw commands, traces, screenshots, fixtures and preservation reports are retained locally in the
private, git-ignored `.validation/2026-09-05/` directory. Original absolute paths inside the reports
refer to `/tmp/typo3-skill-trials.X8ufvc`; the retained copies are byte-identical, not rewritten reports.

| Retained artifact | SHA-256 |
|---|---|
| `run-a/post-fix-result.md` | `9ee1eed7b81b4bd838339d82c4a3226fa6d147d45c09bcd42dfd1cd08fe993b5` |
| `run-b/post-fix-result.md` | `2bb564cde74a8010833bc45f8db6e53699f1c49f68ed018c8696181aa236ec21` |
| `run-c/result.md` | `2ea4d11b79e75198d17eb891a45474a2dc10fd75d4c75bb47ebc085518422522` |
| `browser/artifacts/first-run/sha256-manifest.json` | `30b628ff7869d21a51eb02136a86b7d6f0049bf52d4fe93bbfb6f92afb0db999` |

## Still open — not covered by these results

1. **Measured whole-upgrade performance.** Read-only inspection found paired pre-upgrade Git
   anchors and database/media archives for FMW, OEII and Saferinternet, dated 28 July / 9–10 August.
   The inspected archives match their historical SHA-256 manifests. They have not been restored
   or benchmarked here. Exact disposable-clone/dataset approval was requested and remains pending.
   Recover recorded code/config overlays, verify isolated outbound-safe restore, then measure all
   intake sizing dimensions. Route count alone does not establish a small/large/huge tier; these
   candidate projects are not yet a proven three-tier benchmark set.
2. **Client activation.** Codex has 59/59 matching bundles; start a fresh turn/session for discovery.
   Cursor has 52/59 locally, with the same seven additions missing; its installation decision is
   pending. Gemini packaging is maintained, but a full authenticated session remains untested.
   No unsupported claims are made about every client's UI or model behavior.
3. **ChatGPT distribution.** Standalone skills are supported in ChatGPT desktop, but its skill picker
   has not been inspected. Copying Codex/Cursor folders does not prove ChatGPT availability.
   This collection has not been packaged/published as a ChatGPT plugin for web/mobile delivery.
   See OpenAI's [Build skills documentation](https://learn.chatgpt.com/docs/build-skills).
4. **Human review.** Review exact proposed assertions, beginning with the linked queue. Passing
   infrastructure tests and synthetic agent trials do not grant human-reviewed coverage.
5. **Customer closure reconciliation.** Earlier open/blocked or missing records remain separate.
   Fresh readiness tests cannot recreate an unavailable original baseline or retroactively prove
   upgrade parity. Reconcile each actual site with authentic evidence and explicit acceptance.
