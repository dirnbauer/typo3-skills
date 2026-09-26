# Collection fact review — 2026-09-26

## Scope and limits

This review concerns the **60 existing skills in `dirnbauer/typo3-skills`**, starting at
`c8c508f0485829eb94610933a4b6c9cc9952ce50`. It does not concern the archived
`webconsulting-skills` collection or authorize new skills. Companion-source refreshes and
Powermail work are recorded separately in the change set.

**This is not a certificate that every fact is correct.** Every entrypoint was included in
the structural/path/high-risk-claim scan. Manual reading and primary-source checks went deeper
for the APIs, versions, permissions and security claims identified below. Not every paragraph,
reference, code example or external URL was independently verified; no application was installed
to exercise every example. A successful structural check cannot establish factual correctness,
accessibility conformance, legal compliance, or safe behavior by a model.

Read `AGENTS.md`, `SKILL-SPEC.md` and `VENDORED.md` as the governing contracts. Vendored text is
immutable: corrections belong in the mandatory `references/webconsulting-additions.md` overlay.
Upstream policy (for example a preferred build stack) must not be presented as a Core requirement.

## What was checked

- Enumerated all 60 `skills/*/SKILL.md` files and inspected their line counts, headings,
  descriptions, local Markdown links and high-risk version/security/requirement language.
- Read the relevant existing Netresearch/Supabase integration overlays. Their safety and routing
  boundaries matter as much as the upstream entrypoint; upstream instructions alone are not the
  collection's behavior contract.
- A filesystem-based Markdown-link scan of **686 Markdown files** under `skills/` found no
  missing ordinary relative Markdown links in the 60 entrypoints. It produced 28 candidates in
  the wider tree, mostly illustrative project paths, code incorrectly recognized as links and
  client-installation paths. These are candidates, not 28 confirmed broken resources. The scan
  does not validate fragment IDs, plain-text/backtick paths, remote URLs or dynamically generated files.
- Compared selected claims with official TYPO3 14.3 documentation, Core source, PHP documentation,
  Apache documentation, the EXT:solr matrix, W3C and Austrian RIS. Sources are attached to findings.
- Checked the live records-list-types `composer.json` through GitHub's API. A cached web result
  showed older constraints; it was rejected in favor of the commit-pinned live source.
- Read the collection's eval/collision code to distinguish actual enforcement from prose claims.
  This review itself did not run application integration tests or isolated model behavior trials.

The comparison read of the archived repository's blanket PHP compatibility table is deliberately
excluded: that table does not exist in the selected repository. Here PHP 8.4 is an explicit project
policy, not a claimed TYPO3 Core minimum. Core v14's PHP 8.2 floor is supported by the
[official v14 release announcement](https://news.typo3.com/article/typo3-v14-lts-the-next-generation).
Do not use unversioned `main` documentation as evidence for v14 when `main` already describes v15.

## Confirmed findings and remediation targets

Locations below identify the **reviewed baseline**; line numbers may move as the fixes land.
“Patch observed” means a documentation correction was seen in the working tree, not that an
installed application has passed a runtime test. Recheck the final diff and gates before merging.

| ID | Baseline location | Finding and required correction | Integration state at review handoff |
|---|---|---|---|
| F01 | `typo3-typoscript-ref/SKILL.md:40` | “Site Sets mandatory” overstates Core requirements. TYPO3 14.3 still supports `sys_template` and mixed precedence. State the collection's preference separately. | Corrective overlay observed. |
| F02 | `typo3-ckeditor5/SKILL.md:29` | The quick reference uses a `SYS.ckeditor5.plugins` registry. Official custom-plugin wiring uses `Configuration/JavaScriptModules.php` plus RTE YAML `editor.config.importModules`. Provide the supported example in the overlay. | Corrective overlay observed. |
| F03 | `typo3-extension-upgrade/SKILL.md:32,51` | A missing class in a `use` declaration, typed property or ordinary signature does not necessarily fail during suite loading. Distinguish declaration/name resolution from inheritance, interface/trait resolution and actual runtime use. Keep the migration scan, remove the universal failure claim. | Corrective overlay observed. |
| F04 | `typo3-records-list-types/SKILL.md:14` | `TYPO3 v14.0+ / PHP 8.3+` is stale for current upstream HEAD. Commit `9a07a5ceca3b5c8ab3166debb762d96d1d03adcf` requires Core `^14.3.7` and PHP `^8.4`. State a dated/pinned package baseline and verify the installed release. | Owned-file correction implemented; project runtime checks remain pending. |
| F05 | `typo3-solr/SKILL.md:329` | “v14-compatible EXT:tika ... not yet available” contradicts the current official matrix, which lists EXT:tika 14.0 for TYPO3 14.3. Resolve exact package and Tika-server requirements together. | Owned-file correction implemented; project runtime checks remain pending. |
| F06 | `typo3-solr/SKILL.md:150,195` | The DDEV recipe mixes a 9.10.1 image example with a v14 configset without proving the pairing; the production example exposes port 8983 on all interfaces without an authentication/network boundary. Require a supported matrix tuple and internal-only access or an explicit reviewed exposure policy. | Owned-file correction implemented; project runtime checks remain pending. |
| F07 | `typo3-security/SKILL.md:206` | Apache `LocationMatch` is not valid in `.htaccess`; copying the advertised context can cause a server error. Put it in server/vhost configuration. | Patch observed. |
| F08 | `typo3-security/SKILL.md:418,424,434` | Standalone example controller reads an undeclared `$this->request`; the frontend sample writes the reserved `__trustedProperties` field manually and implies `f:form` supplies CSRF protection. Pass a request explicitly, keep generated property mapping separate from CSRF, and name the anonymous-user `dummyToken` limitation. | Patch observed. |
| F09 | `typo3-security/SKILL.md`, Directory Permissions | Giving the web-server identity ownership of the entire code tree and recursively assigning directory modes to files is not least-privilege hardening. Scope writable runtime paths and distinguish directory/file permissions. | Patch observed; deployment-specific ownership remains a runtime decision. |
| F10 | `legal-impressum/SKILL.md:48,51` | The table says Stammkapital/Grundkapital is always required, while its own later table calls capital optional. Austrian UGB §14(2) sets requirements **if capital details are stated**, not an unconditional publication duty. Correct the table and keep legal/entity-specific review explicit. | Owned-file correction implemented; project runtime checks remain pending. |
| F11 | `web-platform-design/SKILL.md:106,124` | The focus-area rule is SC 2.4.13 **AAA**. SC 2.4.11/2.4.12 concern focus not being obscured. Distinguish a stronger design preference from WCAG AA's minimum requirements in a new owned overlay. | Owned corrective overlay implemented; vendored bytes preserved. |
| F12 | `postgres-best-practices/references/webconsulting-additions.md:40` | It says the collision analyzer skips vendored skills. `trigger_collisions.py` reads every entrypoint; `run_evals.py` skips vendored **suites**. Correct the enforcement description. | Owned-overlay correction implemented. |

### Evidence for confirmed findings

- **F01:** [TYPO3 14.3 site settings and precedence](https://docs.typo3.org/m/typo3/reference-coreapi/14.3/en-us/ApiOverview/SiteHandling/SiteSettings.html)
  describes the retained `sys_template` layer and mixed setups.
- **F02:** [TYPO3 14.3 CKEditor configuration examples](https://docs.typo3.org/c/typo3/cms-rte-ckeditor/14.3/en-us/Configuration/Examples.html)
  gives the custom-plugin import-map and YAML integration.
- **F03:** [PHP importing rules](https://www.php.net/manual/en/language.namespaces.importing.php)
  and [type declarations](https://www.php.net/manual/en/language.types.declarations.php).
  A local PHP 8.1.34 probe declaring an absent imported class as a property and method
  parameter/return type printed `declared without loading missing class` and exited 0.
  This is a language-semantics counterexample, not a TYPO3 14 runtime test.
- **F04:** [Commit-pinned records-list-types metadata](https://github.com/dirnbauer/typo3-records-list-types/blob/9a07a5ceca3b5c8ab3166debb762d96d1d03adcf/composer.json).
  Read via `gh api repos/dirnbauer/typo3-records-list-types/commits/main` and the contents API,
  both successful. Current-branch metadata is not a retroactive claim about older releases.
- **F05–F06:** [Official EXT:solr version matrix](https://docs.typo3.org/p/apache-solr-for-typo3/solr/main/en-us/Appendix/VersionMatrix.html),
  rendered September 16, 2026, names the TYPO3 14.3 / EXT:solr 14.0 / EXT:tika 14.0 / Solr 10.0.0
  recommended tuple; its footnote directs readers to `composer info:solr-versions` for the full
  supported set. A recommendation is not proof that every other server version is unsupported.
- **F07:** [Apache `LocationMatch` directive contexts](https://httpd.apache.org/docs/2.4/mod/core.html#locationmatch).
- **F08:** [TYPO3 14.3 form protection](https://docs.typo3.org/m/typo3/reference-coreapi/14.3/en-us/ApiOverview/FormProtection/Index.html)
  states the authenticated-user requirement; [Fluid form documentation](https://docs.typo3.org/other/typo3/view-helper-reference/main/en-us/Global/Form/Index.html)
  explains generated HMAC-protected mapping fields. The undefined property is directly observable in
  the baseline class, which neither declares it nor extends a request-owning controller.
- **F09:** The baseline shell recipe itself changes the full code tree to the web-server owner,
  then gives files under runtime directories executable/setgid modes; no command was executed.
- **F10:** [Austrian UGB §14, current RIS text](https://ris.bka.gv.at/eli/drgbl/1897/219/P14/NOR40263725).
  This corrects one claim; it is not a legal opinion that all remaining Impressum templates comply.
- **F11:** [W3C SC 2.4.13 Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance)
  and [WCAG 2.2 criteria](https://www.w3.org/TR/WCAG22/).
- **F12:** Local `scripts/run_evals.py` (`vendored()` and suite loop) versus
  `scripts/trigger_collisions.py` (all-directory description inventory).

### Follow-up fixes from independent recheck

The same capital-disclosure overstatement appeared in `legal-impressum/SKILL-GERMANY.md`.
[§ 5(1) Nr. 1 DDG](https://www.gesetze-im-internet.de/ddg/__5.html) makes it conditional;
Nr. 6 also requires the Wirtschafts-Identifikationsnummer when possessed. The table and
optional-capital templates are corrected, with a separate proposed behavior case. This
does not certify the remainder of the German legal guide.

Current `typo3-records-list-types` accessibility language was also qualified: implemented
keyboard and ARIA patterns do not establish full WCAG conformance without the installed
version's audit evidence. The correction has a proposed behavior case.

Netresearch's refreshed extension-upgrade clean-install command ends with `echo`, so the
printed prior status and the final shell status differ. The owned overlay now requires
capturing the actual resolution/install/test status and inspecting or recoverably moving
the reproducible vendor directory before replacing it.

## Coverage ledger — every existing skill

**S** = included in whole-collection structural/path/high-risk-language scan.
**M** = additional manual entrypoint/overlay review (sometimes a targeted section, not every reference).
**P** = selected primary-source or executable claim check. None means “all facts verified”.
An entry without a confirmed finding still has the stated evidence gap.

| Skill | Coverage | Result / remaining verification |
|---|---|---|
| architecture-decision-records | S, M | Workflow and evidence boundaries read; ADR-validator runtime behavior not independently retested here. |
| enterprise-readiness | S, M | Approval overlay contains upstream auto-merge/install scope; badge/security levels and all CI scripts need project-specific verification. |
| legal-impressum | S, M, P | F10; other laws, company forms, penalties and publication exceptions remain legal-review work. |
| php-modernization | S, M | PHP target and analysis-policy overlay read; every tool option, feature and reference was not executed. |
| postgres-best-practices | S, M, P | F12; database plans, index benefit and locking behavior must be measured on the target database. |
| security-audit | S, M | Read-only assessment boundary checked; scanners and all OWASP/CWE/CVE assertions not independently replayed. |
| security-incident-reporting | S, M | Examples and current-standard references scanned; example incident metrics are not real evidence. |
| thermo-nuclear-code-quality-review | S | Review-only scope present in routing; no isolated model trial of the strict review prompt. |
| typo3-a11y | S, M | Local audit/pattern routing overlay read; upstream prescriptive patterns do not certify WCAG conformance. |
| typo3-accessibility | S, M | Manual-versus-automated conformance limitation present; examples still need keyboard, screen-reader and rendered-state checks. |
| typo3-backend-rights | S, M | Targeted permission/cutover guardrail scan; not executed against a real non-admin role or installation. |
| typo3-batch | S, M | Targeted migration/authorization scan; no batch transformation or rollback fixture executed. |
| typo3-ckeditor5 | S, M, P | F02; exact installed CKEditor version and round-trip behavior remain runtime checks. |
| typo3-conformance | S, M | Read Composer/Classic exception overlay; generic scoring is policy, not independent proof of compatibility. |
| typo3-content-blocks | S, M | Read modeling and rich-text handoff; every generated TCA/schema/ViewHelper example still needs an installed CB2 fixture. |
| typo3-core-contributions | S, M | Publication boundary remains authoritative over upstream Gerrit workflow; current Core-main requirements need a pinned checkout. |
| typo3-datahandler | S, M | Explicit no-general-transaction-contract caveat present; record/cache/workspace effects need functional tests. |
| typo3-ddev | S, M | Overlay already blocks demo credentials/URLs/destructive cleanup on customer sites; no provisioning executed. |
| typo3-design-system-page | S, M | Targeted site identity/content authorization scan; PDF rendering and TYPO3 integration not exercised. |
| typo3-docs | S, M | Official-docs precedence and source-extraction workflow read; renderer/template compatibility not tested here. |
| typo3-extension-upgrade | S, M, P | F03; installed-target testing and fixed-point overlay reviewed; no customer extension migration run. |
| typo3-fractor | S, M | Dry-run/fixed-point scope read; exact rule class/CLI availability must match the installed Fractor release. |
| typo3-icon14 | S, M | Targeted registration/style assertions scanned; all icon classes and source SVG rules not independently verified. |
| typo3-idea-extension-blog | S, M | Targeted secrets/publication scope scan; build and blog workflow not executed. |
| typo3-initial-release | S, M | Targeted release metadata/authorization scan; TER/Tailor publishing contract still needs release-tool verification. |
| typo3-news-tags | S, M | Targeted corpus/destructive-operation scan; tag scoring, localization and DataHandler behavior not run on records. |
| typo3-playwright | S, M | Browser-fixture isolation and evidence limits read; complete browser/journey execution not performed by this audit. |
| typo3-powermail | S | Detailed source/conditions refresh belongs to the separate Powermail work in this change set; not independently certified here. |
| typo3-project-upgrade | S, M | Overlay already rejects blanket template deletion and processed-file cleanup; installed-site migration still untested. |
| typo3-records-list-types | S, M, P | F04; accessibility and experimental workspace claims require installed-version evidence, not metadata alone. |
| typo3-rector | S, M | Read configuration and bounded passes; example classes and current rule sets require actual tool execution. |
| typo3-scheduler-jobs | S, M | Manual/automatic execution separation read; task classes, field migration and cadence need installation-specific checks. |
| typo3-security | S, M, P | F07–F09; no broad declaration that all security examples or deployment contexts are safe. |
| typo3-seo | S, M, P | News sitemap provider existence confirmed in official EXT:news docs; URL enhancers/meta/canonical examples still need rendered-page checks. |
| typo3-shadcn-content-elements | S, M | Targeted data/style/secrets scan; Desiderio schema, fixtures and component output not executed. |
| typo3-simplify | S, M | Targeted v14/compatibility scan; immutable upstream text retained, no code simplification trial. |
| typo3-site-conformance | S, M | Read site-vs-extension scope and bundled checker contract; checker not run on deployment infrastructure here. |
| typo3-solr | S, M, P | F05–F06; exact Docker/Java/configset/Tika combination remains a runtime compatibility gate. |
| typo3-structured-data | S, M | Visible-content parity and no-rich-results-guarantee language read; all consumer policies/types not reverified. |
| typo3-testing | S, M | Exit codes, own-extension PHPStan policy and runtime proof boundaries read; no complete project CI matrix executed here. |
| typo3-translations | S, M, P | Selected LanguageService named-argument ICU dispatch matches 14.3 source; all XLIFF/domain cases not rendered. |
| typo3-typoscript-ref | S, M, P | F01; lookup recipes and full migration reference catalog not executed. |
| typo3-upgrade-baseline | S, M | Immutable source/instrument distinction read; deterministic capture not independently rerun in this audit. |
| typo3-upgrade-closure | S, M | Evidence-owner boundaries inspected; certificate semantics require harness and application evidence, not prose. |
| typo3-upgrade-effort-model | S, M | Calibration-free estimates are heuristics; counts/multipliers must be dated and not offered as guarantees. |
| typo3-upgrade-intake | S, M | Read identity/read-only/approval evidence requirements; no live/local project identity audit executed. |
| typo3-upgrade-migration | S, M | Read bounded node mutation and rollback requirements; no schema/data migration executed. |
| typo3-upgrade-retrospective | S, M | Evidence-versus-inference boundary inspected; historical fleet claims were not independently reconstructed. |
| typo3-upgrade-run | S | Harness/controller entrypoint scanned; complete harness review/test results belong to the main change-set verification, not this audit. |
| typo3-v14-reference | S, M, P | Core v14 PHP floor and ModifyCacheLifetimeForPageEvent methods checked; every API/example not independently exercised. |
| typo3-visual-editor | S, M | Template/record identity and legacy-renderer boundaries read; actual permission/drag-and-drop/rich-text journeys untested. |
| typo3-vite | S, M | Existing overlay already rejects broad host/CORS allowlists and clarifies Vite is not required by Core; builds not run. |
| typo3-wcag22-aa-agentic | S, M | Targeted automated/manual/legal boundary scan; no whole-site scan or signed legal statement. |
| typo3-webcomponents | S, M | Backend/frontend infrastructure separation read; individual module imports and widget runtime not executed. |
| typo3-webmcp | S, M | Targeted experimental-browser/security boundary scan; API support and tool behavior require a live browser-specific check. |
| typo3-workspaces | S | Workspace/file limitations included in risk scan; publishing/overlay/FAL behavior not exercised. |
| web-design-guidelines | S | External-guideline loading scope scanned; external guideline body and all generated review behavior not verified. |
| web-platform-design | S, M, P | F11; 1,462-line vendored entrypoint is exempt from owned-file size rule, not proof of every browser/PWA claim. |
| webconsulting-branding | S, M | Targeted brand/accessibility policy scan; client-specific color contrast and rendered layouts remain measured checks. |
| webconsulting-create-documentation | S, M | Targeted generated-media/tooling scan; generated screenshots must not be represented as captured product evidence. |

## Outstanding verification policy

Do not rename this ledger “all facts verified” after structural tests pass. Before using a
time-sensitive example, capture the selected dependency/version/source revision and validate the
actual installation. Before release, keep source provenance and overlay integrity checks green,
run the collection and harness gates, and report missing runtime/behavior coverage separately.
Signed human eval coverage remains distinct from generated/proposed cases. Legal and accessibility
claims require their own scope and human review; neither package resolution nor a text scan replaces it.
