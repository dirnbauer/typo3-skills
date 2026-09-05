# Conformance checker

`check.py` scores a TYPO3 site/project repository against the **gold-standard
conformance ruleset** — the deduped 76-rule catalogue in `rules.json`.

```bash
python3 check.py /path/to/target-repo     # only pyyaml is required
```

Exit code is `0` iff **no repo-scope rule fails**. The gold template is kept at
**100 %**.

## Scope model

Every rule carries a `scope`:

- **`repo`** (72 rules) — statically checkable against the repository tree. The
  gold template must pass all of them; these form the scored denominator.
- **`advisory`** (4 rules) — architectural / estate / runtime / shared-image
  properties that a single template repository cannot assert. They are reported
  with a by-design note and excluded from the score:

  | code | why it is advisory |
  |------|--------------------|
  | `DRO-019` | three-repo split is a *site* layout; the template is deliberately one repo |
  | `DEPLOY-001` | the template colocates `ci/` to demonstrate it; sites split it out |
  | `DRO-017` | the php-fpm status endpoint lives in the shared `t3re` image, not here |
  | `DRO-018` | uptime monitoring is registered per deployed site |

## Scoring

`error` = 10 pts, `warning` = 5, `info` = 1. The denominator is the sum of
applicable (repo-scope) weights; the score is
`round(100 × (max − penalty) / max)`. Bands: ≥90 green, 70–89 yellow, <50 red.

## Refinements vs. the published grep-checks

The published catalogue expresses several checks as one-line greps that are
imprecise. `check.py` implements their **intent**; each refinement is
deliberate and documented here:

- **`STRUCT-002` / `CI-IMG-004` / `SC-006`** — flag a committed secret by
  *value shape*: any `*password` / `*secret` / `encryptionKey` /
  `installToolPassword` / `*token` key whose value is a non-empty string literal
  (**either** quote style) rather than an environment reference. A non-hex key
  and a double-quoted `installToolPassword` are caught; mere key names like
  `passwordHashing` are not.
- **`CI-IMG-005` / `DRO-012` / `SEC-005`** — also scan `additional.php`: the
  dev-only switches (`displayErrors=1`, `debug=true`, `devIPmask='*'`) must stay
  behind the `isDevelopment()` guard. A constant-true guard (`if (true)`) or an
  ungated assignment fails.
- **`SC-007`** — a Concourse task `image_resource` counts as pinned only when the
  digest is **effective** — in the `repository` ref **or** a native
  `version: { digest: sha256:… }` field — **or** the tag is explicit and
  non-floating. A `@sha256` digest in a *comment* beside `tag: latest` does NOT
  count (comments are stripped before the check). Output `resources:` (push
  targets such as `app-image:latest`) are out of scope.
- **`DRO-016`** — an on-disk `FileWriter` is the violation; a `FileWriter`
  pointed at a `php://stderr`/`php://stdout` stream is container-native and
  passes.
- **`CI-IMG-003` / `DRO-009`** — image references are resolved through
  `.env.dist` before the pin check, so `${APP_IMAGE}` / `${T3RE_IMAGE_VERSION}`
  are evaluated, not treated as literal text.

## Service classification

One-shot / idle runners (`app`, `setup`, `backup`) are exempt from the
healthcheck/restart rules (`DRO-001/003`); `backup` is still a *long-running*
service for the resource-limit rule (`CI-IMG-007`). Everything else is
`persistent`.

## A heuristic, not a security control

`check.py` is a **static structural heuristic**, not a security boundary. A
100 % score is *necessary, not sufficient* — it proves the gold-standard
*structure* is present, not that a repository is secure. It is deliberately
hardened against the obvious evasions (a git-tracked `.env`, double-quoted or
non-hex committed secrets, a constant-true dev guard, supply-chain keywords that
live only in comments), and the CI gate installs `git` so the committed-secret
rules enforce there. Known limits that a determined author can still slip past —
do not rely on the gate alone:

- **CI supply chain** (`SC-001/002/003/004`) requires the keyword on the
  *comment-stripped* pipeline text **and** within the parsed job graph
  (`pipeline_doc["jobs"]`), so a step that lives only in an unreferenced anchor
  no longer passes; `SC-011` parses the graph fully. Residual: it does not
  deep-walk `plan → task → run`, so a keyword wired into a job but in a step that
  never executes is not distinguished — narrowed, not closed.
- **Service classification** (`DRO-001/002/003`) exempts the names
  `app/setup/backup`, but only when they are *not* declared long-running: a
  service with a `restart` policy is treated as persistent regardless of name, so
  a daemon cannot dodge the healthcheck/restart rules by being named `app`.
  Residual: a restart-less daemon given one of those names still escapes — a
  degenerate config. Narrowed, not closed.
- **External-catalogue parity** is asserted against a pinned mirror
  (`CATALOGUE_SNAPSHOT` date + `CATALOGUE_SHA256` drift guard in `gen_rules.py`),
  not enforced by re-fetching the OAuth-gated source page (see below).

These limits are documented inline above; the heuristic is a structural gate,
not a security boundary.

## Regenerating the ruleset

`rules.json` is produced by `gen_rules.py`, which **embeds** the 76-rule
catalogue inline as a pinned mirror of the published ruleset. Edit the catalogue
in `gen_rules.py` and regenerate `rules.json`. (`typo3-14-gold` and
`typo3-project-standard` track the same ruleset.) When the edit intentionally
tracks a new revision of the published page, bump `CATALOGUE_SNAPSHOT` and set
`CATALOGUE_SHA256` to the value the script prints — `gen_rules.py` warns if the
inline catalogue drifts from the pinned hash, catching an accidental edit.

```bash
python3 gen_rules.py
```
