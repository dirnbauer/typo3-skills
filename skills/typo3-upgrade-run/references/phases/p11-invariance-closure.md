# P11 — Invariance closure (loop 300)

Track `invariance`. The loop the whole skill exists for.

## Preconditions
Loop 100 green with every applicable stateful fixed point and feature check recorded. The renderer
fingerprint is unchanged. The immutable source content fingerprint still matches the Baseline A
seal, and the active target content epoch matches its reviewed transition ledger.

## Allowed
**Repair only.** No new features, no improvements, no "while I am here".

## Steps
1. After the last approved stateful migration reaches a fixed point, complete
   `config/content-transition.example.json` and run `t3u content-fingerprint --write-target
   --transition <ledger>`. The source fingerprint is never overwritten; the command requires a
   recorded snapshot, successful argv and the schema/reference/row-count reconciliation checks.
2. Re-run stage 1 (HTTP and metadata) across all URLs.
3. Re-run stage 2 (normalised DOM) across all URLs.
4. Re-shoot stage 3 on the sealed tiered visual set with the identical viewport matrix and the three
   authoritative states: `default`, `keyboard-focus`, `nav-open`.
5. Compare all three stages and gate once with `compare-all` against `A-original`.
6. For every difference: identify the cause, fix it, re-shoot the affected pages. One cause per
   iteration.
7. Finish with one full pass, then the idempotence re-run.

## Reading the stages
The stage that caught a difference already narrows the cause — this is what turns a long pixel hunt
into a short fix:

| HTTP | DOM | Pixels | Look at |
|---|---|---|---|
| differs | differs | differs | routing, redirects, site configuration |
| same | differs | differs | Fluid, TypoScript, extension markup |
| same | same | differs | CSS, Vite assets, fonts, image processing |

## Exit
0 open `regression` findings · 0 `declared-change` without an approval · 0 `harness-noise` ·
HTTP/DOM coverage equals every discovered URL · visual coverage equals the sealed tiered set across
all three states · idempotence re-run diff count 0.

## Blocking
Re-baselining. Threshold changes. Sample reduction. Excluding a page. None of these is grantable —
see `rules/20-baseline-integrity.md`.

Budgets here are larger than elsewhere (8 iterations, 240 minutes) because this loop legitimately has
more to do. They are still budgets: exceeding one needs an approval, and aborting is a correct
outcome.
