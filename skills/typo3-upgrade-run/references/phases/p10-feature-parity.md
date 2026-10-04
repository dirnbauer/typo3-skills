# P10 — Conditional feature parity (iterations in loop 100)

Track `invariance`. Redirects, Solr, Visual Editor, CKEditor RTE.

The `vite-assets` frontend-modernization branch also applies whenever installed Vite, Bootstrap 5
or used build dependencies are behind the [latest eligible stable releases](../latest-version-policy.md),
and always for a Bootstrap 3/4 site, which migrates to the latest 5.x. Do not classify
old-but-working assets as unaffected to skip required updates. Use the owned Vite overlay and record
target versions or accepted blocker exceptions in this node's evidence. Run `vite-assets` after the
other P10 nodes: a full loop proves the upgrade invariant before the first Bootstrap change, and the
migration, its before/after review and the owner's acceptance finish before the migration cutoff
([procedure](../bootstrap-5-migration.md)).

Full procedures in `references/feature-upgrades.md`. Run a procedure only when that feature is
installed and its dependency, code, configuration, schema, or runtime path changed in this upgrade.
An installed-but-unaffected feature receives a targeted smoke check, not a separate improvement
programme or loop.

Re-shoot affected pages plus seeded sentinels in `default` state after the bounded pass. Any
rendering change needs an approval per difference class or it is a `regression`.

| Subject | Run when | Exit |
|---|---|---|
| Redirects | package was absent, newly set up, or its module/permissions changed | package and schema active; integrity clean; trusted non-admin can manage and exercise a local redirect |
| Solr | EXT:solr/server/config/indexing path changed | supported server, reindex and affected search paths verified |
| Visual Editor | installed and integration code/config changed | inline editing verified, frontend rendering unchanged |
| CKEditor RTE | preset, package or rendered markup changed | preset loads and affected authoring/rendering behavior is preserved |

Security headers are not introduced here. Adding them before invariance closes guarantees an HTTP
difference. Preserve the existing header set in Contract A; introduce or strengthen headers in
Contract B loop 530 with intent authorization and observed-result acceptance.

## Blocking
Loosening global `minimum-stability` to install a single package — use a per-package stability flag.
A rendering change absorbed without an approval.
