# webconsulting additions — `postgres-best-practices`

> **Overlay.** The vendored `SKILL.md` and its references are upstream Supabase content, kept
> byte-identical. This file is webconsulting's addition and changes nothing above it.

## Where this skill stops, in a TYPO3 collection

Upstream this is a general Postgres skill. Here it sits in a collection where most database-shaped
questions are *not* Postgres tuning questions, so the boundary matters more than it would elsewhere:

| The question is really about | Use | Not this skill, because |
|---|---|---|
| Writing records with relations, localisation, workspaces | `typo3-datahandler` | Correct TYPO3 writes go through DataHandler; raw SQL bypasses referential integrity, the reference index and versioning |
| Which database engine DDEV runs, switching engine, importing dumps | `typo3-ddev` | Container and service configuration, not query behaviour |
| Query building inside extension code | `typo3-conformance`, `typo3-v14-reference` | TYPO3 has its own QueryBuilder and restriction API; hand-written SQL is a conformance and security finding |
| SQL injection review of PHP code | `security-audit` | An application-security question that happens to involve SQL |
| Schema changes for TYPO3 tables | `typo3-upgrade-run` (during a run) or TCA + `Configuration/` | TYPO3 owns its schema through TCA and `ext_tables.sql`; direct DDL drifts from what the schema analyser expects |

This skill applies when the question is genuinely about **the database under the site**: index
selection and query plans, lock and transaction behaviour, batch write and upsert strategy,
partitioning, connection limits and pooling, `EXPLAIN ANALYZE`, vacuum and bloat, JSONB indexing.

## TYPO3-specific caveats

- **Do not add indexes to Core tables by hand.** TYPO3's schema analyser compares the live schema
  against what TCA and `ext_tables.sql` declare, and will offer to drop anything it does not know
  about. Declare the index in `ext_tables.sql` so it survives the next schema comparison.
- **Diagnose before indexing.** The upstream guidance to read the plan first matters doubly here:
  a slow TYPO3 query is often an N+1 from Extbase lazy loading, a missing `sys_refindex` update, or
  a cache table that outgrew its cleanup task — none of which an index fixes.
- **Long transactions and DataHandler do not mix.** Bulk operations that hold one transaction open
  block vacuum and other writers; batch them, and prefer the DataHandler's own bulk paths.
- **Postgres is a supported TYPO3 engine, not the common one.** MariaDB/MySQL is what most
  deployments and most extensions are tested against, so verify extension compatibility before
  recommending a migration to Postgres — case sensitivity and identifier quoting are the usual
  places where extension SQL breaks.

## Why this skill ships no eval suite

Vendored skills are exempt from the eval requirement (`SKILL-SPEC.md` S4), and the eval runner and
collision analyser both skip them. A suite here would be a file no tool reads — which S13 ("a rule
enforced by nothing is not a rule") specifically warns against. The routing risk this skill carries
is real, so it is handled where an agent will actually encounter it: the boundary table above. If
this skill is ever un-vendored and maintained here, it needs a real suite at that point.
