# P10 — Conditional feature parity (iterations in loop 100)

Track `invariance`. Solr, Visual Editor, CKEditor RTE.

Full procedures in `references/feature-upgrades.md`. Run a procedure only when that feature is
installed and its dependency, code, configuration, schema, or runtime path changed in this upgrade.
An installed-but-unaffected feature receives a targeted smoke check, not a separate improvement
programme or loop.

Re-shoot affected pages plus seeded sentinels in `default` state after the bounded pass. Any
rendering change needs an approval per difference class or it is a `regression`.

| Subject | Run when | Exit |
|---|---|---|
| Solr | EXT:solr/server/config/indexing path changed | supported server, reindex and affected search paths verified |
| Visual Editor | installed and integration code/config changed | inline editing verified, frontend rendering unchanged |
| CKEditor RTE | preset, package or rendered markup changed | preset loads and affected authoring/rendering behavior is preserved |

Security headers are not introduced here. Adding them before invariance closes guarantees an HTTP
difference. Preserve the existing header set in Contract A; introduce or strengthen headers in
Contract B loop 530 with intent authorization and observed-result acceptance.

## Blocking
Loosening global `minimum-stability` to install a single package — use a per-package stability flag.
A rendering change absorbed without an approval.
