# Measurement recipes

Exact, reproducible commands per Contract B metric. Every one runs inside DDEV against the DDEV URL.
Targets live in `references/quality-bars.md`; thresholds in `config/thresholds.yml`. The last three
sections are proof recipes that Contract A nodes reuse: [intermediate loops on stateful
rungs](#intermediate-loops-on-stateful-rungs), [proof scripts](#proof-scripts-journeys-sweeps-and-row-diffs)
and the [RTE round trip](#rte-round-trip-proof).

Record each command and its exit code in `05-evidence.md` and `journal.jsonl`. A metric without a
recorded command is not evidence.

## Ground rules

- **Warm first, then measure.** Crawl the sample once and discard the result, so caches, processed
  images and lazy assets are in the same state for every run. A cold first request measures the
  cache, not the site.
- **Aggregate over runs.** Single Lighthouse runs are noisy. Use three runs per URL, take the
  **median**, and record min and max so the spread is visible.
- **Pin the browser.** The Lighthouse Chrome must be the version recorded in the environment
  fingerprint. A browser change between the before and after measurement makes the delta meaningless.
- **Never submit the site to a remote scanner.** Mozilla Observatory, Google Rich Results and
  PageSpeed Insights all require a public URL and would publish the customer's pre-launch state.
  Compute the equivalents offline and say so.

## Performance and Core Web Vitals

Run this only after Contract A closes, inside approved loop 500. The final-report set is fixed to
three URLs by the harness: homepage plus two seeded random non-home pages.

```bash
node scripts/t3u.mjs lighthouse \
  --label before \
  --runs 3 --form-factor mobile --budget .typo3-update/config/thresholds.yml \
  --loop 500
```

Mobile preset throttling is recorded in the report (`rttMs`, `throughputKbps`,
`cpuSlowdownMultiplier`) so a later reader can tell whether two runs are comparable.

CLS deserves a second measurement, because the Lighthouse run does not exercise lazy content the way
a real scroll does: walk the sample with a `LayoutShift` PerformanceObserver, forcing lazy content in,
and attribute each shift to its element.

INP has no lab equivalent. Time the five primary interactions — nav open, search submit, accordion,
form field focus, cookie dismiss — with `performance.measure`, report p95, and label it a **proxy**.

### Feeding results into the next agent iteration

Use `artifacts/report.lighthouse.before.json` and its `optimizationCandidates` and `agentBrief`; do
not copy an audit title from the terminal and work from memory. An exit 1 means the configured
quality bars produced measured improvement findings, not that the evidence run failed.

1. Select one measured opportunity/cause.
2. Add or update project regression tests **before** the site change.
3. Make the smallest change for that cause.
4. Run the project tests and Contract A checks.
5. Rerun Lighthouse unchanged with `--label after`; the seed selects the same three URLs and keeps
   both reports for the final comparison.
6. Keep the change only when tests pass and the target improves without a new A difference.
   Otherwise restore the loop snapshot and record the refuted hypothesis.

## SEO and structured data

Canonical, hreflang, titles, descriptions and `html lang` all come from the stage 1 HTTP/metadata
records that already exist — no new crawl needed. Compare against the bars rather than re-fetching.

JSON-LD: extract every `application/ld+json` block, parse it, and validate the types and required
properties against a **local copy** of the schema.org vocabulary. State explicitly in the report that
only syntax and vocabulary were checked, and that rich-result eligibility was not.

Sitemap health is a stage 1 sweep over every per-language sitemap: every entry 200, no redirects, no
`noindex`, no excluded doktypes.

## Accessibility

```bash
node scripts/t3u.mjs axe --run-dir .typo3-update --loop 520 --label before \
  --sample 12 --viewports desktop,tablet,mobile \
  --states default,nav-open,consent-modal-open
```

Record the axe-core version — rule sets change between releases, and a "new" violation is sometimes a
new rule rather than a new defect.

Reflow: capture at 320×256 and at 1280×1024 with a 4× zoom, and assert no horizontal scroll and no
content loss.

Focus-not-obscured: tab through the page, and for each focused element compare its bounding box
against every `position: fixed` or `sticky` element. Overlap is a finding.

Target size: measure every interactive element's rendered box; anything under 24×24 CSS px without a
documented exception is a finding.

Contrast: axe plus a computed-style sweep that also renders hover, focus and disabled states — axe
only sees what is on screen at scan time.

The manual criteria produce a **checklist with evidence slots**, not a verdict. A human fills the
verdict in; the skill supplies the evidence and says plainly which criteria automation cannot decide.

## Security

Header capture is a stage 1 sweep; compare the header set against the bars.

CSP violations: collect `SecurityPolicyViolationEvent` during a full sample walk **and** during the
backend module sweep. Backend violations are the ones most often missed, and CSP in the backend is
where a bad policy breaks editing rather than viewing.

Observatory-equivalent grade: score the captured header set offline using the documented rubric and
label the result as locally computed.

```bash
ddev composer audit --format=json
```

## Media and cache

Image inventory: for every image in the sample record intrinsic size, rendered CSS size, DPR, format
and transfer size. Oversizing is `intrinsic > 1.5 × rendered` at DPR 1.

AVIF support is a property of the installed processor, not a setting:

```bash
ddev exec convert -list format | grep -i avif
```

If the local processor supports AVIF but production's may not, that is a handover item, not a claim.

Page cache: request each cacheable sampled URL twice and compare. Measure the **hit rate**, not the
timing — local timing is not transferable.

## Code quality

```bash
ddev exec vendor/bin/phpstan analyse --level 9 --error-format=json
ddev exec vendor/bin/typo3 cache:flush && ddev exec vendor/bin/typo3 cache:warmup
# then walk the sample, run the module sweep, run due scheduler tasks
ddev exec cat var/log/typo3_deprecations*.log
```

The deprecation log is only meaningful for code paths actually exercised. **State which paths were
walked** — "clean deprecation log" after visiting three pages means very little.

## Intermediate loops on stateful rungs

`capture --scope intermediate` captures affected URLs, critical representatives and a seeded remainder
([sampling scope](harness-contract.md#sampling-scope-cheap-in-the-loops-exhaustive-at-the-end)). On
`rung-13`, `manual-migration` and `rung-14` three rules keep that sample honest.

**Force-include what the rung upgrades.** One site's loops drew 24 of 231 URLs three times and never
the only page with a powermail form; powermail 12 → 13 had broken it three ways, found only at full
scope ([powermail](known-problems.md#a-powermail-form-loses-its-styling-or-layout-after-the-134-rung)).
Before the rung, take every package whose major version it changes (from `extension-inventory`),
resolve one visible page per CType or plugin that package renders, and pass those URLs as `--affected`.
Keep the list under `nodes/<node>/`: `config/` is a guarded measurement input of a stateful node.

```bash
ddev mysql -N -e "SELECT c.CType, c.list_type, MIN(c.pid) FROM tt_content c
  JOIN pages p ON p.uid = c.pid AND p.deleted = 0 AND p.hidden = 0
  WHERE c.deleted = 0 AND c.hidden = 0 AND (c.CType LIKE '<ext>%' OR c.list_type LIKE '<ext>%')
  GROUP BY c.CType, c.list_type;"
t3u capture --loop <NNN> --label <label> --scope intermediate \
  --affected-file .typo3-update/nodes/<node>/affected.txt
```

**Count a difference before trusting the scope that found it.** A difference that only some captures
of one unchanged state show is a determinism fault, not a property of the intermediate sample. On one
site a rounded box's corner pixels differed by one colour level in 7 of 9 captures on 13.4 and in none
of 3 on 12.4, in intermediate and final scope alike: Chromium partial raster, fixed by
`--disable-partial-raster` from harness 22cb428 ([stabilisation](determinism-stabilization.md)). A pass
that rests on the one capture that happened to match is not a clean visual proof; a run pinned before
the fix needs a new run on a fixed pin for one.

**Seal an interim target content epoch after each stateful rung.** `compare-all` checks live inputs
against the active content epoch, and every rung changes `schemaHash`. When a stateful rung reaches its
fixed point, write the node's own `content-transition.json` (source Baseline A, the node's snapshot,
its ledgered commands) and seal it before the loop's `compare-all`:

```bash
t3u content-fingerprint --write-target --transition .typo3-update/nodes/<node>/content-transition.json
```

`target-content-epoch` (P11) then reconciles the ledger accumulated over all rungs against Baseline A.
A command run after an interim seal (a retried `extension:setup`, say) is proven by a
`t3u content-fingerprint --assert` against that seal, not by a later per-column diff.
A table the harness cannot read (a `ddev mysql` call that fails twice, or output beyond the 256 MiB
buffer) is reported `unavailable` with exit 2, not as drift: check DDEV and the machine load and
re-run. Only a table that still exists and reads differently is content drift.

## Proof scripts: journeys, sweeps and row diffs

The `interactions`, `backend-editor` and `runtime` checks are only as sound as their scripts. Each rule
comes from a fleet run:

- **Count only the site's own POSTs.** Analytics beacons are POSTs too (Matomo's `sendBeacon`, answered
  locally with 204). Filter on method and site host, and wait for the POST response *and* the
  navigation of a server-side submit before reading the page:

  ```js
  const sitePost = (r) => r.request().method() === 'POST' && new URL(r.url()).hostname === new URL(base).hostname;
  await Promise.all([page.waitForResponse(sitePost), page.waitForNavigation({ waitUntil: 'load' }), submit.click()]);
  ```

- **Assert rejection facts, not wording.** A honeypot check passes when the POST was answered, no
  thank-you page followed and no mail row, Mailpit message or upload appeared; a "spam" text is optional
  ([silent spam redirect](known-problems.md#a-spam-test-submission-is-rejected-without-any-message)).
- **Write only inside a snapshot.** Form submissions, uploads and editor saves write rows into
  fingerprinted tables: `ddev snapshot --name <n>`, run the journey, `ddev snapshot restore <n>`, delete
  the files it wrote (a DDEV snapshot holds the database only), then `t3u content-fingerprint --assert`.
- **Sweep before you write.** Run `t3u backend-sweep` before the first editor write inside that
  snapshot; after an upload the sweep is refused as content drift (`INVALID`).
- **Keep admin journeys local.** Reports → Status asks get.typo3.org for core releases: for the admin
  phase, point `$GLOBALS['TYPO3_CONF_VARS']['HTTP']['proxy']` at a closed local port in `additional.php`
  and restore the file byte-identically afterwards. Revert Install Tool side effects
  ([tracked files](known-problems.md#logging-in-as-admin-or-opening-the-install-tool-changes-tracked-files)).
- **Count cache tags the way the backend stores them.** Switch only the pages cache to `FileBackend` for
  the journey (`additional.php`, restored byte-identically) and mirror
  `FileBackend::findIdentifiersByTag()`: plain files only, `*.temp` files and expired entries skipped.
- **Diff rows by content.** Ignore bookkeeping columns every save rewrites (`tstamp`, `l10n_diffsource`,
  on `tt_content` `l18n_diffsource`, also on the saved record's translations). Compare values as exact
  text, `BINARY COALESCE(CAST(col AS CHAR), '<NULL>')`: `<=>` treats `''` and `0` as equal across a
  text → int retype and once hid a real change.
- **Leave no test accounts.** Delete DDEV-only test editors and admins, with their `sys_log` and
  `sys_history` rows, before any database leaves the machine.

## RTE round-trip proof

For `rte-visual-editor`: prove that a 14.3 backend save stores rich text as a 12.4 save did, and that a
second save changes nothing. Field inventory and fixture rules come from the
[rich-text round-trip contract](../../typo3-content-blocks/references/rich-text-roundtrip.md); this adds
the version comparison. The emulation below reproduced 15 of 15 real saves.

1. **Scope.** Record the RTE stack on both sides (`typo3/cms-rte-ckeditor` and the backend's
   `window.CKEDITOR_VERSION`), every preset source (`Configuration/RTE`, the `RTE` system
   configuration, `RTE.` page TSconfig in files and in `pages.TSconfig`), and every live rich-text value
   with markup, per table and field: news bodies count as much as `tt_content`.
2. **Sample.** Extract each value's markup features (tags, attributes, classes, link schemes, entities,
   CRLF). Take a greedy cover of all features plus seeded random records; record the seed.
3. **Real saves on 14.3**, inside a snapshot, as the DDEV-only non-admin editor. Per record: open it in
   FormEngine (the `/record/edit` frame), wait for that field's `.ck-editor__editable` `ckeditorInstance`,
   type one character and delete it so CKEditor serialises as on any edit
   (`editor.execute('insertText', {text: 'x'})`, `editor.execute('delete')`), save, read the stored
   value byte-exact (`TO_BASE64(<field>)`), then reopen, serialise, save and read again. Restore the
   snapshot and assert the content fingerprint.
4. **Emulate the 12.4 save without saving,** on another local site still on 12.4 with the same RTE
   stack and preset:
   - DB → RTE: `RteHtmlParser::transformTextForRichTextEditor()` with the field's
     `Richtext::getConfiguration()` `proc.` options, by CLI in that site's container;
   - in its backend CKEditor (any text record, never saved): `setData()`, type and delete a character,
     `getData()`;
   - RTE → DB: `Richtext::getConfiguration()` plus `RteHtmlParser::transformTextForPersistence()` by
     CLI, as `DataHandler::checkValueForText()` does.

   Mask links to records the host database lacks; they come out as `href=""`.
5. **Validate the emulation first:** the same pipeline on 14.3 must reproduce the real 14.3 saves
   (random list-item ids masked), and its persistence step alone the stored values, byte for byte.
6. **Classify every first-save difference** as *12.4 does the same* (`b`→`strong`, `em`→`i`, bare
   lines wrapped in `<p>`, `<br />`→`<br>`, whitespace, attribute order, `p.align-*`, `p@style` and
   `span@lang` dropped, empty inline elements removed, inline styles split at line breaks) or *a real
   change* (CKEditor 47's [`data-list-item-id`](known-problems.md#stored-rich-text-gains-data-list-item-id-on-every-list-item)).
   With no 12.4 host left, classify against those measured classes once the classifier reproduces the
   reference's proven round trips, and trace each remaining difference to code unchanged since 12.4
   (preset diff, `HtmlParser` and `RteHtmlParser` branches, the shipped CKEditor bundles).
7. **Report** second saves unchanged (N/N), stored list-item ids (0) and first saves identical,
   12.4-identical or other, each "other" traced. Saves also rewrite the diffsource column
   (`l18n_diffsource` on `tt_content`) of the record and its translations: bookkeeping, not rich text.
   Legacy markup that 12.4 and 14.3 both drop on a first save is a Contract B question for the owner.
