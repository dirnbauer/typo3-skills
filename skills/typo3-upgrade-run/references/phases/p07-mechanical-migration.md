# P07 — Mechanical migration (iterations in loop 100)

Track `invariance`. Rector and Fractor.

## Preconditions
The correct rung reached; the P06 fixed point is recorded where it applied.

## Steps
1. Configure TYPO3 Rector for the actual source-to-v14 path. One parent iteration performs dry-run →
   **read the diff** → bounded apply → report remaining findings and stop.
2. In a following parent iteration when applicable, Fractor performs dry-run → reviewed bounded
   apply → reports remaining findings and stops.
3. Run code style and syntax checks immediately after each tool, not once at the end — a style pass
   over a broken transformation just hides it.
4. **Never accept a bulk transformation blindly.** Split ambiguous DBAL, Extbase, TCA, Fluid or
   dependency changes into independently verifiable units.

## Fixed point without a nested loop
A later parent iteration runs the dry check again. Remaining work is evidence for that iteration,
not permission for Rector or Fractor to repeat autonomously inside it.

## Exit
Final dry checks empty for each applicable tool; lint and code style clean.

## Blocking
A bulk transformation accepted without reading the diff. An iteration over the change budget — split
it instead.
