# Feature contracts learned from the August–September 2026 updates

Use this at intake and when a dependency, integration or rendering change touches a listed feature.
The [seven-project review](run-retrospective-2026-09-16.md) supplies observations, not universal fixes.
Inspect the project's actual implementation before selecting assertions. Reuse its existing tests.

## One graph, feature-dependent evidence

Record applicability for `mail`, `newsletter`, `captcha`, `tracking`, `backend`, `cache`, `routes`
and `content`. These are inventory categories, **not eight browser states or eight new phases**.
Backend and public routes apply to every whole-site run. Other categories need a present/absent
decision with inventory evidence. Content applies to persisted-data migrations or an authorized
refresh; it does not authorize a new import. Never install an absent feature to satisfy a check.

Close `intake-join` with the [feature evidence plan](feature-evidence.md). Assign each applicable
journey to an existing closure check. Reuse one fixture/report across several assertions. A
successful homepage, provider HTTP 200 or aggregate test count cannot stand in for a missing journey.

Intermediate work runs only affected contracts, critical representatives and the same seeded sample.
After a fix, return to the graph's affected proof/recovery node. Do not reopen unrelated data
migrations, repeat the baseline, multiply specialist retries or run full proof after each fix.
Final proof still covers the sealed requirements, both final passes, and mandatory Lighthouse/axe.
Keep at most three global visual states; additional states stay inside one representative journey.

## Mail, newsletter and CAPTCHA — `interactions`

- Trace each entry point to its actual handler, persistence, finishers, recipient policy, transport
  and user-visible result. A checkout, footer form and standalone signup may use different services.
  Share logic where appropriate; prove each distinct entry point, language and configuration.
- Assert configured sender and envelope behavior plus visitor Reply-To. Preserve the intended
  recipient policy: admin-only is valid when requested; customer mail is required only when promised.
  Use the [TYPO3 email finisher contract](https://docs.typo3.org/c/typo3/cms-form/14.3/en-us/I/Concepts/Finishers/ReadyToUseFinishers/EmailFinisher/Index.html),
  not a copied customer address or a visitor-controlled From header.
- Separate record saved, message rendered, local transport accepted, provider accepted, recipient
  delivered, and newsletter confirmed. Report only the observed stage. An order must not be repeated
  merely because a notification failed; retain it and expose an accurate partial-success message.
- For newsletters, cover new, already subscribed, other-list, pending and blocklisted contacts,
  repeated submissions, missing configuration, timeout and provider rejection. Do not silently
  clear a blocklist, activate an unconfirmed contact or classify every HTTP 400 as “already exists”.
  Interpret the installed SDK's actual contract; a successful response can have an empty body.
- When using DOI, validate the configured provider template's active/DOI status and native
  confirmation link, not merely its generic preview. A create-contact call is not DOI. See the
  [Brevo DOI endpoint](https://developers.brevo.com/reference/create-doi-contact). Do not copy fleet
  template/list IDs. Any real delivery test needs separate consent and a reachable test mailbox;
  never click the confirmation link for the recipient or retry a known hard bounce.
- Match CAPTCHA widget, submitted field, configured version and verification payload. Prove missing,
  expired, invalid and valid responses through the real local handler with intercepted external
  verification. Display a useful form-level error, retain entered values and preserve spam checks.
  Do not remove CAPTCHA to turn a submission green.
- Keep credentials in their already-approved origin. Missing runtime injection or a provider IP
  restriction is a configuration/coverage finding, not permission to copy production secrets locally.
  Local Mailpit and mocked provider responses do not certify production delivery.

## Tracking, CSP and context — `interactions` / `backend-editor`

- Inventory real context names, configured site/host predicates, tracker identity and opt-out/consent
  policy. Do not assume `Production/Live` equals `Production`, or enable tracking on staging.
- Render production-context fixtures locally with fake/non-secret integration settings. Intercept
  every external request. Prove the expected page-view count, correct destination identity,
  reject/opt-out behavior, and no tracking in excluded contexts. Test the transport actually used,
  including image fallback where applicable; a script tag alone proves nothing.
- Inspect effective response policies from application and web server separately. Frontend header
  work must preserve TYPO3's backend policy/nonces and usable image selection/upload, RTE dialogs and
  preview. Diagnose violations and correct the scoped integration; **do not copy a blanket backend
  CSP disablement as an upgrade recipe**. An inherited disablement is an explicit security finding.
- Use [TYPO3's scoped CSP API](https://docs.typo3.org/m/typo3/reference-coreapi/14.3/en-us/ApiOverview/ContentSecurityPolicy/Index.html)
  and the [tracker's documented directives](https://matomo.org/faq/general/faq_20904/). A header's
  presence is not proof that its policy both protects and permits the application. HSTS belongs at
  the verified TLS endpoint; local proof does not establish proxy/live header behavior.

## Patch updates and real editor compatibility — `backend-editor`

- After a Core or extension patch update, recheck used custom subclasses, constructors, DI aliases,
  link-handler class names and direct factory/preview-builder calls against the installed source.
  A patch-level version change can expose an extension's dependency on internal APIs.
- Prefer a compatible upstream release. If a scoped Composer patch/fork is necessary, pin package
  and patch hashes, test a clean install, fail on context drift, and name the removal condition.
  Never leave an unrecorded `vendor/` edit or weaken a security update to hide incompatibility.
- Open the actual authenticated page/layout module, not only login. Use the intended editor role:
  insert page/record/file links, select/upload an authorized local image fixture, save/reopen, and
  check hidden-content preview while the public context remains denied. Test each custom preview
  family (Record API, FlexForm, raw data) with an existing representative record.
- For migrated HTML fields or changed RTE presets, use the
  [rich-text round-trip contract](../../typo3-content-blocks/references/rich-text-roundtrip.md).
  Inventory all affected field/type combinations cheaply, then test one representative per distinct
  preset/processing/rendering contract. Preserve formatting across save/load; plain text and raw
  HTML remain deliberate field choices. No extra global state or full-record browser sweep.
- For an already-v14 maintenance request, repair/test the affected extension and integrations.
  Do not run the v12→v13 ladder again or retrofit old closure labels. A new current baseline can
  prove a patch transition, never the missing original v12→v14 invariance.

## Cached behavior and responsive inputs — `runtime` / `interactions`

- Warm a representative page, change an authorized disposable record through the supported API,
  then verify affected list/detail/homepage and pagination output updates. Restore the fixture.
  Keep editorial selection rules and deterministic ordering unchanged; newest is not synonymous
  with selected/featured. Verify local purge-request construction without calling a real CDN.
- Separate page/data caches, compiled DI, OPcache and external CDN state. Do not add broad purges
  as a substitute for identifying the missing invalidation. Local checks cannot certify CDN POPs.
- Test AJAX controls again after replacement. For touch-sensitive code, add one desktop-width
  touch-capable context plus resize across the actual breakpoint; viewport width alone does not
  prove pointer capability. Use these on affected components, not every URL.
- Preserve search counts, tie ordering and editorial date semantics. Import/reindex timestamps or
  a navigation save must not silently replace a deliberate publication/update date.

## Routes and persisted content — `http-dom`, `redirects`, `schema`

- Inventory all sites/languages, subsite templates, historic short links, numeric aliases, download
  and record-detail URLs. Check redirect status, chain, final destination, query/fragment semantics
  and absence of loops. Retired conversion endpoints need an explicit policy, not hidden log filtering.
- Keep a route if either baseline or target serves it. A target 404 is a finding, not a reason to
  remove that URL from coverage. Non-HTML resources remain HTTP evidence; capture pixels only where
  applicable. Record invalid seed exclusions before sealing, never retroactively to get green.
- Preserve stable UIDs/slugs, translations, FAL/IRRE relations, historical orders and workflow state
  during import or migration. Compare inventories plus representative content hashes, not only row
  totals. Use a scoped mapping/upsert and fixed-point proof; never blindly replace the target DB or
  replay a broad redesign wizard to repair one feature.
- Keep image aspect ratios, original SVG quality, font faces and editorial crop choices in their
  affected template proof. Do not infer a universal crop/rotation correction from one document.

## Remote consequences stay in handover

Read [deployment handover](deployment-handover.md) for archive contents, runtime selection,
post-cutover cache/DI verification and persisted hotfixes. This upgrade graph does not deploy,
write to providers, send real mail, clear CDN caches or fetch live datasets.
