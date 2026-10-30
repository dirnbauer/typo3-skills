# T3 Ops update assistant

T3 Ops provides a common assistant for **minor updates** and **major upgrades**.
It owns project selection, permissions, reviewed settings, the request identity
and the user-facing progress. It does not replace the native `t3u` graph.

## Choose the correct execution path

- **Minor:** security and bug fixes within the installed TYPO3 release line,
  for example 13.4.x → 13.4.y. T3 Ops may queue several projects; each gets its
  own immutable execution snapshot, GitLab run, verification and failure result.
  Extension updates respect the project's Composer constraints. Use the shared
  executor and the separate staging/production release gates. Do not invoke the
  full major graph for a routine patch.
- **Major:** 12.4 → 13.4 → 14.3, or 13.4 → 14.3, including every installed
  extension. Use this skill with the ordinary full graph and the approved VPS
  DDEV runtime. A hosted *patch* graph qualified for a narrow 14.3 patch range
  is not evidence that it supports cross-LTS migration.

## Consume a saved major work order

1. Read the exported plan and its project id, repository, branch, source version,
   target family, extension list and open decisions. Treat these as claims to
   verify against the selected repository and runtime. Never paste secrets into
   the work order or return them in a progress report.
2. Run read-only native intake. Bind the actual source SHA, dated database and
   fileadmin evidence, ownership, restore proof and runtime capacity to the native
   session. Reconcile source drift before admission. The dashboard's last imported
   version or a saved plan alone does not prove the source or dataset.
3. Reuse authorization already given in the current project session. Collect only
   genuinely unresolved dataset, scope, extension-removal and budget decisions
   together; do not ask again for routine work already authorized. Approval of
   developing T3 Ops itself is not approval to migrate an arbitrary customer site.
4. Use the normal graph's P00 intake, sealed Baseline A, intermediate migration
   rungs and closure. The native graph alone chooses nodes, retries, resource
   locks, outcomes and completion. Keep the runner/controller credentials outside
   the application DDEV environment.
5. Report a plain-language state with evidence: **Plan ready**, **Intake needs a
   decision**, **Migrating**, **Verification needs attention**, or **Ready for
   release review**. Name the blocker, its effect and up to three concrete next
   actions. A work order, submitted job, pipeline success or partial report is
   never a completed upgrade.
6. Hand back the native run/session identity, source and candidate SHA, target
   core and extension decisions, report location, remaining blockers and closure
   acceptance. Keep staging and production deployment as separately authorized
   actions. Never turn an imported status string into deployment eligibility.

The current T3 Ops assistant saves and exports the major work order. Its hosted
major dispatch is not enabled. Start the existing skill in the project's Codex
chat using that work order; do not claim that clicking **Create upgrade plan**
started a migration. A future automatic bridge must prove the complete native
workflow before changing this user-facing promise.

## Link-check evidence during upgrades

T3 Ops integrates TYPO3 Linkvalidator instead of maintaining another content
database or crawler. It checks configured fields, sites and languages. Its record
link resolver must use the original source page, site, language, link-handler
identifier and resolved detail page. Two uses of `news` may need different detail
pages; matching table/uid or an HTTP 200 alone is insufficient route parity.

Preserve the link-check coverage and outstanding findings in intake and closure.
Distinguish pre-existing broken links from migration regressions. A failed,
missing or stale scan is not a clean site. Email/phone syntax checks do not prove
delivery/reachability. Batch content repair is separate editorial work through
TYPO3 DataHandler, with preview, conflict detection, per-record receipts and a
fresh scan; never silently rewrite links to make Contract A pass.
