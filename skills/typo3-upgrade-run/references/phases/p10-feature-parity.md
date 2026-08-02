# P10 — Feature parity (loops 200–220)

Track `invariance`. Solr, Visual Editor, CKEditor RTE.

Full procedures in `references/feature-upgrades.md`.

Each is a declared-change loop: re-shoot the affected sample pages after the block, and any rendering
change needs an approval per difference class or it is a `regression`.

| Loop | Scope | Exit |
|---|---|---|
| 200 | Solr | matrix-supported server, full reindex, Info module active, frontend search verified including empty and paginated results |
| 210 | Visual Editor | inline editing verified, frontend rendering unchanged |
| 220 | CKEditor RTE | preset loads with language and abbreviation controls; `abbr[title]` and `span[lang]` styled in `contentsCss` and the frontend, language spans left undecorated |

Security headers are not introduced here. Adding them before invariance closes guarantees an HTTP
difference. Preserve the existing header set in Contract A; introduce or strengthen headers in
Contract B loop 530 with intent authorization and observed-result acceptance.

## Blocking
Loosening global `minimum-stability` to install a single package — use a per-package stability flag.
A rendering change absorbed without an approval.
