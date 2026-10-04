# Parallel execution without weaker proof

Read during intake scheduling and before running concurrent proof jobs. Apply this policy to a
newly initialized graph and pinned harness. Never rewrite an existing graph, self-test lock or
Baseline A to retrofit concurrency. Old graphs without `shared_proof_reads` retain exclusive freezes.

## Graph jobs and browser workers are different

`graph-next` and `graph-forecast` use the same resource-claim model. A new graph lets frozen readers
share `project-write`; a code/stateful mutation or an explicit exclusive claim excludes every reader.
`machine-load` is shared by normal nodes and exclusive for a `quiet: true` performance node.
The coordinator opens/closes nodes serially; their permitted work may overlap. Never race state
updates or merge verdicts from a worker's recollection. A concurrent transition refusal requires
re-reading state, not replaying the underlying migration.

The final quality branch is `axe-proof` plus `lighthouse-proof`, joined by `lighthouse-axe` for
compatibility. Both children are mandatory. Lighthouse waits for the other proof nodes and owns
the quiet lane. HTTP/DOM does not require a browser lock. Strict visual capture retains the exclusive
browser lane; existing source/target renderer assignment and ≤3 global states stay unchanged.

`component-sentinels` and `backend-operations` remain exclusive by default because real form/editor
journeys can modify canonical content. A browser context or separate login does **not** isolate
shared database records. Only tailor those nodes to shared reads before sealing when their write
fixtures have a separately approved, isolated application/database clone and cleanup proof.

## Dispatch what the graph offers

One fleet run took a day and a half for three hours of migration work, partly because nodes ran one
after another where `graph-next` offered them as one set. With delegation permission (asked in the
[intake question round](overnight-controller.md#batch-the-owner-decisions)), open every node of an
offered set and start all its workers at once, in the background. The controller still opens and
closes nodes one at a time; the resource claims, not caution, decide what overlaps. In the shipped
graph:

| Phase | Offered together | What keeps the rest apart |
|---|---|---|
| Intake | `project-identity`, `extension-inventory`, `backend-group-model-decision`, `dataset-freshness` and one browser node (`url-discovery`, then `structured-data-inventory`, then `webmcp-inventory`) | the browser nodes take `browser-proof` one at a time |
| Migration and P10 | one node at a time | every code or stateful node takes `project-write` exclusively ([P10 order](bootstrap-5-migration.md#sequence-inside-the-run)) |
| Final proof | `http-dom-proof` with `visual-proof`, then `http-dom-proof` with `axe-proof` | `component-sentinels` and `backend-operations` write canonical data; `lighthouse-proof` waits for every other proof and owns the quiet lane |

Reviews hold no lock: start the verifier as soon as the evidence exists, beside the next node. While
one node holds an exclusive lock, prepare the next brief instead of a second writer.

**Final proof in order.** One full capture first, then the comparisons concurrently:

1. Seal the target content epoch and run `closure-start`. Open `visual-proof` (it owns the browser
   lane) and run the one full capture there: `t3u capture --label after`. Nobody captures again.
2. When the capture index is complete, open `http-dom-proof` beside it; both nodes compare that
   capture against Baseline A ([one producer per output directory](#independent-implementation-preparation)).
3. When `visual-proof` closes, open `axe-proof`, a shared browser reader, beside the HTTP/DOM work.
4. `component-sentinels`, then `backend-operations`, each alone, with the test accounts prepared
   once ([test accounts](overnight-controller.md#prepare-test-accounts-once)).
5. `lighthouse-proof` last, on a quiet machine.

A backend or module defect belongs to the rung's early admin and editor sweep
([fix pack item 7](typo3-14-fix-pack.md#7-backend-modules-refused-to-admins)): a code fix after
`closure-start` makes the epoch stale ([epoch order](closure-currentness.md#epoch-order-what-makes-a-new-epoch-stale)).

## One machine budget

The harness shares a private per-user resource ledger across processes and projects. It defaults
to 12 browser slots and `min(8, max(1, host parallelism - 2))` CPU slots. Choose a lower measured
capacity with `T3U_BROWSER_SLOTS` / `T3U_CPU_SLOTS` before work; active jobs reject conflicting
capacity settings. These limits are ceilings, not a recommendation to occupy every slot.

- `axe --workers 4` is the default; 1–12 independent URL/viewport/state jobs are supported.
  Each gets a fresh browser context. Expected/completed/failed/skipped counts, stable findings,
  per-job elapsed time and capacity wait time are reported. No missing worker result can pass.
- Capture starts at most four Chromium processes at once, with stable worker indexing, and leases
  the worker count it runs with. Final and self-test capture keep the count licensed by the
  self-test and own the browser lane (`exclusiveBrowsers`): other browser work waits, because a
  competing renderer can flake a zero-pixel proof; CPU-only work continues beside it.
- Only page work holds browser slots: capture, `backend-sweep`, `smoke`, axe, Lighthouse,
  `resource-run --browsers` and the live-input preflight of comparison, sweep, axe and Lighthouse
  commands. `node-open`/`node-close`, `gate`, `closure-*`, `validate-run`, the fingerprints,
  `discover-urls` and `doctor` hold none (their Chromium version probe opens no page;
  `content-fingerprint` takes one CPU slot), so a state transition never waits for browsers.
- HTTP/DOM uses its existing bounded pool. Pixel comparison uses the CPU budget; native odiff
  stays preferred and the Pixelmatch fallback uses at most four persistent worker threads.
- Lighthouse reserves the entire cooperative machine budget. Keep its repeated measurements,
  pinned versions and budgets. Do not overlap it with builds, browser jobs or comparisons.

Wrap a project's **existing** foreground test/build command so it participates in the same budget:

```bash
# Example only: preserve the project's actual canonical command/configuration.
t3u resource-run --browsers 4 --timeout 1800 -- npm run test:e2e -- --workers=4
t3u axe --mode verify --loop 301-invariance-quality --workers 4
```

Reserve the actual worker demand; the wrapper does not rewrite a child command's worker setting.
`resource-run` uses no shell, installs nothing, retains the child exit code in its result, and
terminates a timed-out/interrupted foreground process group. It does not inspect/merge the child's
reports or certify test coverage. Nested harness reservations are refused instead of risking a
deadlock; do not wrap another resource-reserving `t3u` command. Run those commands as peers.

The budget is cooperative, not an OS/Docker scheduler: unwrapped commands and unrelated apps are
not controlled. Keep the host and application server quiet for Lighthouse. Never increase global
Docker CPU/RAM settings, provision remote runners, copy customer data, or create agents merely
because the graph exposes parallel work. Each needs its actual task authority.

Capacity waits are bounded (ten minutes maximum, shortened by the run deadline when available).
Dead process leases can be reclaimed; a stuck metadata lock fails closed and needs owner inspection.
Reclaiming a compute lease never reconciles a database action or releases its graph mutation lock.

### Load across projects

The cooperative budget cannot see other projects' DDEV stacks, builds or sessions. On one fleet machine
several DDEV stacks plus captures drove the 1-minute load average to ~80: a self-test failed on fetch
timeouts, and a video painted an empty first frame at ~75 that the immediate re-shoot did not repeat.

- Run one capture or self-test at a time per machine, across all projects. The machine-wide visual lock
  serialises screenshots only, not HTTP/DOM fetches, builds or DDEV stacks; stop the stacks of projects
  you are not measuring (`ddev stop <project>`).
- Before screenshots, `capture` waits while the 1-minute load average exceeds 2× the core count
  (`T3U_LOAD_FACTOR`), at most `T3U_LOAD_WAIT_MS` (600000) and never past the deadline. It never refuses:
  it captures anyway and records the load in the capture index (`machineLoad`); strict-zero comparison
  still judges the pixels.
- A capture whose video is still loading when the 5 s settle bound expires is re-shot once, then
  reported as a capture error, never as an empty frame.
- Check by hand before a self-test or a long proof:

```bash
python3 -c 'import os,sys; l=os.getloadavg()[0]; n=os.cpu_count(); print(f"load {l:.1f}, limit {2*n}"); sys.exit(l > 2*n)'
```

## Calibrate once, reuse the evidence

Use the existing intake pilot, not a new full-site benchmark programme. Try a small representative
matrix at 1/4/8 workers, and 12 only if throughput still improves. Record host and Docker CPU/RAM,
browser/tool versions, jobs/sec, errors, peak memory, server p95 response time, startup and lock wait.
Select the fastest stable setting with headroom; do not adapt final visual worker counts mid-proof.
Small/large/huge changes work volume and deadline, not the machine's physical capacity.

Record measured **elapsed** estimates at that setting in the forecast. `max_workers` (1–4) counts
graph owners, not Playwright processes. Do not multiply owner slots by browser workers or divide
every phase by N. Include actual capacity waits, both proof passes, quiet Lighthouse and rollback
reserve. All 8/24/48-hour limits remain caps, not target durations or guaranteed completion times.

## Independent implementation preparation

When parallel agent/worktree work is explicitly authorized, prepare frontend modernization,
Fluid/component replacements and test fixtures in isolated worktrees against sealed inputs.
Give each job file ownership and its own outputs. Do not share writable `vendor`, build output,
Composer lockfiles or a migrating database. A single integration owner applies the changes and
verifies the canonical checkout. Core rungs and persisted-data conversions retain dependency order;
a prepared patch is not a passed migration node. Freeze final proof only after integration.

Reuse already-installed pinned dependencies and existing immutable capture artifacts across report
consumers. Give each proof job a unique report destination. Use **one capture producer per output
directory**, then let HTTP/DOM and visual comparison consumers read its completed index; do not run
two partial `capture` commands into the same `--out` or race a consumer against unfinished files.
Keep independent verification passes independent. Do not reuse a navigation for axe and
pixel evidence until a separate equivalence test proves both contracts; that optimization is not
enabled here.

## Validation and sources

`npm test` exercises lock compatibility, legacy definitions, forecasts, failure accounting, machine
capacity across processes and byte-equivalent Pixelmatch results. `npm run test:browser` exercises
real local Chromium fixtures separately. Fixture timings are not customer-site speedup claims.
Validate a representative authorized project before changing an end-to-end ETA.

Use official [Playwright parallelism](https://playwright.dev/docs/test-parallel),
[sharding/report merging](https://playwright.dev/docs/test-sharding),
[worker authentication](https://playwright.dev/docs/auth#moderate-one-account-per-parallel-worker),
[Node worker threads](https://nodejs.org/api/worker_threads.html), and
[Lighthouse isolation guidance](https://github.com/GoogleChrome/lighthouse/blob/main/docs/variability.md).
Keep Netresearch's vendored skills unchanged; this scheduling policy is collection-owned.
