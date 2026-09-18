# Seven-project upgrade follow-up — 2026-09-16

## Scope and evidence limits

Window: **2026-08-05 through 2026-09-16**, approximately six weeks. Read local Git refs, selected
patches/test definitions, current Composer locks, recorded run states, project reports and selected
Codex task records. Customer repositories were read-only: no DDEV start, import, migration, mail,
provider write, deployment or closure repair was performed. Dirty user work was preserved.

Resolved names: ÖIAT → `oiat`; Saferinternet → `saferinternet`; Scioflex → `scioflex-hydrogen`;
Gütezeichen → `guetezeichen-relaunch`; Österreich isst informiert → `oeii`; FMW → `fmw`;
Watchlist Internet → `watchlist-internet`. Other similarly named folders were not counted as sites.

Reproduction, from each selected project root:

```bash
git log --all --no-merges --since=2026-08-05T00:00:00+02:00 \
  --until=2026-09-17T00:00:00+02:00 --format='%h %cs %s'
git show <selected-commit> -- <relevant-source-or-test-path>
git status --short
```

Across these local refs: **572 distinct commits, 475 excluding merges**. These are activity counts,
not counts of bugs, completed upgrades or independently verified deployments. Cherry-picked logical
changes can have different IDs. Several original major upgrades precede the window; follow-up fixes,
maintenance patches and requested redesigns are not all upgrade regressions.

## Project observations

| Project / snapshot | What worked and what needed repair | Evidence and next proof gap |
|---|---|---|
| ÖIAT · `master` `e379482` · lock 14.3.6 · 17 non-merge commits | Multisite/staging review found subsite template, logo, locale and header differences. Later form fix separated configured sender from visitor Reply-To. Deployment work preserved the host's PHP handler. | `e5b99f5`, `5aef72f`, `021afef`, `d4d88d3`, `c02741e`. No run state in this checkout. A thank-you page is not inbox-delivery proof. |
| Saferinternet · `develop` `5abe45c8` · lock 14.3.7 · 222 | Repeatable content sync gained mappings/conflict handling and separate historical-order import. Real forms exposed CAPTCHA v1/v2 mismatch, missing runtime integration config and misleading success states. DOI template validation caught a failure missed by a generic email preview. Short links, backend constructors and post-release DI caches needed repairs. | `c41994df`, `40dfc5f1`, `a9888a46`, `28fbfecd`, `e24c15a6`, `9bc325b0`, `b4946689`, `b9bc1aab`. Some fixes are on other refs, not necessarily this HEAD. Last run: P10 open, updated Aug 10, no graph/closure. |
| Scioflex · `develop` `f37bb00` · lock 14.3.6 · 31 | Theme/content and imagery work is explicitly redesign, not unchanged appearance. Mail repair preserved admin-only notifications, corrected sender/transport routing, and kept DDEV mail local even in a production-context fixture. | `fc6d771`, `0f76dda`, `f37bb00`; `README.md` mail section and transport regression test. SMTP acceptance is distinguished from mailbox receipt. No run state. |
| Gütezeichen · `master` `b6fe9ded` · lock 14.3.5 · 34 | Tracking had been gated on the wrong production context; new CSP also blocked the old initialization/transport. A narrow, idempotent tracking migration and intercepted browser requests repaired it without replaying the larger content migration. | `4a9d3a0a`, `b6fe9ded`, `docs/matomo-tracking.md`, tracking/migration tests. Report records 24 browser checks across three engines, not rerun here. Last run: P11 open, updated July 29, no graph/closure. |
| Österreich isst informiert · `main` `0f4ece1d` · lock 14.3.6 · 66 | Native-JS behavior improved through actual journeys. Touch-capable desktop carousel behavior and provider success with an empty response body needed specific fixes. Most-read tracking gained focused behavior tests and data migration. September sync evidence remains separate from the August Git timeline. | `2702f569`, `0c9b61d9`, `bf6cfeb6`; `tests/visual-regression/features/`. Last run: P05 open, updated Aug 10, no graph/closure. See the Sep 5 review for sync/parity measurement limitations. |
| FMW · `master` `4b7abf4` · lock 14.3.5 · 38 | Backend preview and visual workflows found gaps beyond a homepage screenshot. URL discovery retains a route when either side serves it. HSTS moved to the TLS endpoint. A broad archive exclusion accidentally omitted deployment helpers and was corrected. | `cdd1a9e`, `0d7c73d`, `85eae8b`, `d6b7931`. Last run: P11 blocked, updated July 28, no graph/closure. Audit release contents instead of copying the narrower historical exclusion blindly. |
| Watchlist Internet · `master` `b8551188` · lock 14.3.7 · 67 | Real editor use caught an inline page-controller constructor mismatch after a patch update. A pinned Composer patch and regression test repaired it. Cache invalidation needed both TYPO3 dependency mapping and correct CDN purge URL construction. Preview cookie separation and editorial selection rules also mattered. | `118fcbaf`, `ea190dba`, `fe77dc25`, `3c1e609d`; patch/lock files, controller test, `reports/phishing-cache-invalidation-20260915.md`. No run state. |

Four recorded runs remain open/blocked; three selected checkouts have no state file. None contains
a current graph in that state file. This does **not** deny later implementation or deployment work;
it means these records cannot certify it. Do not fabricate missing pre-upgrade baselines or convert
old P05/P10/P11 labels to green. Use targeted current-readiness/closure reconciliation separately.

## New lessons versus the September 5 controls

| Problem / cause | Observed solution worth preserving | New control / existing owner |
|---|---|---|
| Form success described an unexecuted or failed downstream action | Trace recipients, persistence and transport; separate order success from notification failure | Named mail/DOI assertions under `component-sentinels` / `interactions`; local mocks remain explicitly local proof |
| Provider API and widget/template contracts were assumed | Verify CAPTCHA request version, DOI template validity and distinct subscriber states | Conditional integration cases; test the real local handler, not only a fake success response |
| Runtime context/CSP made analytics silently disappear | Local production-context fixtures, intercepted tracking, narrow configuration migration | Tracking assertions for configured contexts, consent/opt-out and actual transports; no extra global states |
| Green Composer resolution hid a backend patch incompatibility | Inspect installed constructor, pin Composer patch, exercise authenticated module | Dependency node → affected backend checks, including on v14 maintenance updates |
| Cache correctness was measured only while cold or after a broad flush | Preserve selection semantics; verify supported writes invalidate dependent output and build valid purge requests | Representative warm-cache journey, remote CDN verification deferred to authorized handover |
| Site/record URLs and old records fell outside screenshot samples | Include historical aliases and non-HTML routes; preserve identity and relation mappings | Route/content assertions, all-route HTTP/DOM, separate additive business-data import scope |
| Incremental refresh threatened independently edited target fields | Persist source/target bases, hash-bound preview, conflict-aware native writer and no-op replay | DDEV overlay adopts the pattern from Saferinternet, not its customer paths/table allowlist |
| Runtime/deploy artifacts differed from the checkout | Pin PHP for every task; verify release archive and post-cutover container/cache | Local recipe/archive audit plus explicit deployment handover; no new remote authority |
| Aggregate test totals hid missing feature assertions | One intake plan and final per-assertion results | New graph policy: intake seals the plan; closure checks its hashes, coverage, epoch and report binding |

Existing controls already covered isolated browser sessions, AJAX re-operation, deterministic
sampling, editor save/reopen, current-code closure, 3 global states, repeated Lighthouse, immutable
baselines and bounded retries. They are reused, not copied into more loops or sibling orchestrators.

## Do not generalize these workarounds

- Saferinternet `a66b2f00` removes backend CSP response headers during image-editing troubleshooting.
  Preserve this as a security exception requiring review, **not** the recommended fix. Future runs
  must diagnose scoped policies/nonces and retain backend protection while proving image dialogs.
- Direct mail routing in Scioflex solves one hosting/domain-routing problem; do not prescribe its
  provider, MX host, port, recipient or SPF configuration to other projects.
- Do not copy customer IDs, template IDs, table allowlists, credentials, host paths or broad SQL
  cleanup into a generic skill. Tracking repair must not rerun unrelated content redesigns.
- Header scores, mocked API success, a green screenshot or a deployed version string do not prove
  delivery, consent, editor behavior, unchanged content or full closure.

## Task evidence and timing limits

Selected task records supplement Git/report evidence:

- `01a0a39e-d7ab-72a2-b6fd-86179a174ae8`, **Fix Matomo stats regression**: local-fix turn ~14m;
  separately authorized deployment turn ~11m. The record distinguishes the permission boundary.
- `01a0a680-f9b2-7133-a2e5-1ef5241707d0`, **Fix TYPO3 login 500 error**: ~15m repair turn;
  final claims 16 assertions and a deployed archive. The source patch/test exists; no remote rerun here.
- `01a0a062-b66a-7a92-a940-ea4d4a315eac`, **Check footer contact form**: a later ~5m delivery turn
  claims live deployment but only thank-you/server-error verification; not inbox proof.
- Latest summaries for **Fix Broschürenservice email** and **Audit RTE content elements** had empty
  turn items in this read. Do not invent missing message details; use committed source and reports.

These individual task wall times include different work scopes. No complete, comparable
small/large/huge upgrade timing series was available. The 8/24/48-hour caps remain admission limits,
not a demonstrated 10× speedup. Feature-specific tests add bounded work; reuse of ready graph nodes,
existing fixtures and representative pages avoids multiplying the site-wide capture matrix.

## Implemented collection changes and remaining site work

- [Feature contracts](fleet-regression-contracts.md) define what to prove when a feature exists.
- [Feature evidence](feature-evidence.md) routes those assertions through existing graph nodes and
  thirteen closure checks; deterministic tests exercise missing/stale/duplicate/unbound evidence.
- Main/leaf/browser skills and owned Netresearch overlays route to the new controls. Vendored
  upstream bytes and attribution remain untouched. Thank you, Netresearch, for the foundation.
- New behavioral evals are **proposed**, not human-reviewed or evidence of model trials.

Remaining customer work: reconcile the seven old closure records; resolve the backend CSP
exception; verify provider delivery/CDN/host behavior only with separate authorization; review
new behavioral evals and measure representative full runs. This skill update does not perform or
certify those tasks.

## Collection validation

Checked in an isolated working-tree snapshot so the pre-existing icon-skill edits and generated
catalog changes were preserved. No client plugin was activated by this validation.

- `./scripts/check.sh`: all **8 gates passed**, exit 0, including **40 collection tooling tests**
  and the complete **305-test / 52-suite** harness run with no failures or skips.
- The harness total includes **12 new deterministic regressions** for feature applicability,
  assertion accounting, missing/changed inventory, stale epochs, artifact binding and legacy graphs.
- `./install.sh --generate-only`: exit 0; generated inventory/client files remain consistent.
  Only the seven changed owned-skill line counts needed catalog updates; existing edits survived.
- `git diff --check`: exit 0. Fourteen new behavioral cases are proposed; no new human signatures
  or model-trial passes are claimed. Real customer closures and speed benchmarks were not run.
