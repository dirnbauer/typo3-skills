# Known problems

Faults met on real v12/v13 → 14.3 runs, listed **symptom first**, because that is how you meet them.
Each one cost time to diagnose once; none should cost it twice.

None of these is a reason to skip a diagnosis. Confirm the cause before applying the fix — a
matching symptom with a different cause is exactly how a wrong fix gets applied confidently.

The [TYPO3 14 fix pack](typo3-14-fix-pack.md) turns the entries fleet sites keep meeting into a
checklist with detection, fix, proof and approval, applied proactively at the nodes it names.

## Contents

- [Frontend 500 with an SQL syntax error](#frontend-500-with-an-sql-syntax-error)
- [Frontend 500: "Field 'x' doesn't have a default value"](#frontend-500-field-x-doesnt-have-a-default-value)
- [Pages return 200 but log a PHP warning](#pages-return-200-but-log-a-php-warning)
- [Composer refuses every version of the target](#composer-refuses-every-version-of-the-target)
- [Composer cannot resolve the target at all](#composer-cannot-resolve-the-target-at-all)
- [A required package no longer exists](#a-required-package-no-longer-exists)
- [The `<html>` language attributes are wrong, missing or contradictory](#the-html-language-attributes-are-wrong-missing-or-contradictory)
- [Forms lose their styling: inputs collapse to browser-default width](#forms-lose-their-styling-inputs-collapse-to-browser-default-width)
- [Content tables lose their padding and the page gets shorter](#content-tables-lose-their-padding-and-the-page-gets-shorter)
- [TypoScript silently stops loading after the v14 rung, or every page answers 500](#typoscript-silently-stops-loading-after-the-v14-rung-or-every-page-answers-500)
- [Image optimisation configured, nothing got smaller](#image-optimisation-configured-nothing-got-smaller)
- [A correct HTML fix silently moves the layout](#a-correct-html-fix-silently-moves-the-layout)
- [Shared links show no preview image](#shared-links-show-no-preview-image)
- [Editors lose their modules, or gain all of them](#editors-lose-their-modules-or-gain-all-of-them)
- [Every CLI command dies in alias-loader-include.php](#every-cli-command-dies-in-alias-loader-includephp)
- [extension:setup fails inside a sitepackage's ext_localconf.php](#extensionsetup-fails-inside-a-sitepackages-ext_localconfphp)
- [Generated code can require another bounded Rector pass](#generated-code-can-require-another-bounded-rector-pass)
- [Fractor cannot find the generated extension registry](#fractor-cannot-find-the-generated-extension-registry)
- [Composer metadata says compatible, runtime still breaks](#composer-metadata-says-compatible-runtime-still-breaks)
- [Static analysis says addTCAcolumns expects exactly 2 arguments](#static-analysis-says-addtcacolumns-expects-exactly-2-arguments)
- [A local ext_emconf.php reports an undefined $_EXTKEY](#a-local-ext_emconfphp-reports-an-undefined-_extkey)
- [A read-only command dirtied config/system/settings.php](#a-read-only-command-dirtied-configsystemsettingsphp)
- [A powermail form loses its styling or layout after the 13.4 rung](#a-powermail-form-loses-its-styling-or-layout-after-the-134-rung)
- [Every page's og:image reads "Oops, an error occurred!" after Fractor](#every-pages-ogimage-reads-oops-an-error-occurred-after-fractor)
- [RTE content renders as escaped tags after the v14 rung](#rte-content-renders-as-escaped-tags-after-the-v14-rung)
- [A list renders empty after the v14 rung, or a site-package class is fatal](#a-list-renders-empty-after-the-v14-rung-or-a-site-package-class-is-fatal)
- [Relative asset URLs load a 404 page under a trailing slash](#relative-asset-urls-load-a-404-page-under-a-trailing-slash)
- [An external-link page loses its URL when it is restored](#an-external-link-page-loses-its-url-when-it-is-restored)
- [Sitemap index child URLs change after the v14 rung](#sitemap-index-child-urls-change-after-the-v14-rung)
- [Processed images change name or lose 1 px after the v14 rung](#processed-images-change-name-or-lose-1-px-after-the-v14-rung)
- [Stored rich text gains `data-list-item-id` on every list item](#stored-rich-text-gains-data-list-item-id-on-every-list-item)
- [Editors with Redirects rights see no Redirects module](#editors-with-redirects-rights-see-no-redirects-module)
- [A backend module is gone for admins, or fails on a protected method](#a-backend-module-is-gone-for-admins-or-fails-on-a-protected-method)
- [Vite 8 fails on Sass imports or rewrites the CSS](#vite-8-fails-on-sass-imports-or-rewrites-the-css)
- [A spam test submission is rejected without any message](#a-spam-test-submission-is-rejected-without-any-message)
- [Logging in as admin or opening the Install Tool changes tracked files](#logging-in-as-admin-or-opening-the-install-tool-changes-tracked-files)

---

## Frontend 500 with an SQL syntax error

**Symptom.** The update installs cleanly, the backend works, the frontend returns 500. The log shows
`SyntaxErrorException … check the manual that corresponds to your MariaDB server version`, usually
near a `VARCHAR(…)` fragment.

**Cause.** The database engine is below the floor of the Doctrine DBAL shipped with the target. DBAL
4 (TYPO3 13.4+) has no platform class below **MariaDB 10.4.3**, so it emits DDL the server cannot
parse. Nothing announces a version problem.

**Fix.** Migrate the engine — see P01. Snapshot and dump first, then
`ddev debug migrate-database mariadb:10.11`, then verify row counts.

**Check the hosting at intake.** Staging and live often run the same old engine, and a local
migration does not change that: the site fails there in the same way. Read the server version from
the header of the dataset dump and compare it with the target floor (13.4/14.3: MariaDB 10.4.3,
MySQL 8.0.17) before any migration work:

```bash
gzip -dc .typo3-update/dataset/<date>/db.sql.gz | head -8   # -- Server version 10.3.39-MariaDB-…
```

A hosting upgrade needs lead time, so a floor miss is an intake blocker for the user and a deployment
prerequisite in the handover, never a footnote. `deploy-staging.mjs` refuses such a staging platform
with exit code 6.

---

## Frontend 500: "Field 'x' doesn't have a default value"

**Symptom.** After the engine migration most pages 500 with
`NotNullConstraintViolationException … Field 'metaphonedata' doesn't have a default value`.

**Cause.** A leftover column from a feature the newer TYPO3 removed. `index_fulltext.metaphonedata`
comes from v12's indexed_search; **TYPO3 13.0 removed metaphone search** (breaking change #102900),
so v13 stopped writing the column while the `NOT NULL`-without-default definition survived in the
database. A lenient MariaDB (10.2 and older defaults) accepted the omitted value; **`STRICT_TRANS_TABLES`,
the default on 10.11, rejects it.** So the engine migration does not cause this — it exposes it.

**Fix.** Drop the obsolete column. TYPO3's own schema analyser will not: it classifies such columns
as *prefix* candidates (rename to `zzz_deleted_…`), which keeps `NOT NULL` and therefore keeps
failing. Check the row count first — `index_*` tables are regenerable search-index data, so dropping
costs a reindex and nothing else.

```bash
ddev snapshot --name pre-drop-<column>
ddev mysql -N -e "SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema=DATABASE() AND column_name='<column>';"
ddev mysql -e "ALTER TABLE <table> DROP COLUMN <column>;"
```

**Generalise it.** Any column a removed feature left behind will do the same the moment SQL mode
tightens. When one appears, search `information_schema.columns` for other `NOT NULL` columns with a
NULL default in tables the current code no longer writes.

---

## Pages return 200 but log a PHP warning

**Symptom.** Every page renders, screenshots are pixel-identical, and each request writes
`PHP Warning: Undefined property: TYPO3\CMS\Frontend\Controller\TypoScriptFrontendController::$id`
to the log and `sys_log`.

**Cause.** TypoScript still reads `tsfe:` through `getData`, e.g. `uid.data = tsfe:id`. The
`TypoScriptFrontendController` properties were removed in v13; the accessor resolves to nothing and
warns. **On v14 this becomes fatal** — the class is gone.

**Fix.** `page:uid` reads the current page record and is the direct replacement:

```typoscript
uid.data = page:uid    # was tsfe:id
```

Verify the accessor exists in the *installed* `ContentObjectRenderer` before using it rather than
trusting any list, including this one.

**Why it matters more than it looks.** Nothing visible is wrong, so a visual loop passes and a
status-code check passes. Only the log knows. This is the case the final smoke test exists for —
see `harness-contract.md`.

---

## Composer refuses every version of the target

**Symptom.** `composer update` reports, for every patch level:
`found typo3/cms-core[v13.4.x] but these were not loaded, because they are affected by security
advisories`.

**Do not diagnose from that sentence.** It proves that the active Composer policy rejected some
candidates; it does not prove every target patch is vulnerable, that the repository metadata is
current, or that security is the reason no safe candidate resolves. A real run incorrectly turned
this solver prose into a TYPO3 security blocker; the independently executed audit later reported
zero advisories and the supported target patch installed normally.

Collect the evidence in the application container:

```bash
ddev composer audit --locked --format=json
ddev composer show --all typo3/cms-core
ddev composer why-not typo3/cms-core "^14.3"
ddev composer config --list --source
```

Then verify the candidate against the official TYPO3 release notes and linked security advisory.
A confirmed blocker names the advisory ID, package, affected constraint, installed/candidate
version, policy source and command exit code. `composer audit` describes the lock; `why-not` and
`show --all` explain candidate resolution. Keep those questions separate.

**Fix the constraint, policy provenance or stale metadata—not the safety control.** Keep the root
requirement at `^14.3` and let the lock record the tested patch. Never add an advisory ignore, turn
off `policy.advisories.block`, set `COMPOSER_NO_BLOCKING`, or use `--no-blocking` merely to make the
solver move. When the evidence confirms an affected release, move to the first supported fixed
patch; when it does not, retract the security claim and continue diagnosing the actual constraint.

---

## Composer cannot resolve the target at all

**Symptom.** A conflict trail ending in `don't install nikic/php-parser vX` or a similar shared
low-level library, with no obvious connection to TYPO3.

**Cause.** Old development tooling. `ssch/typo3-rector` v2 and `a9f/typo3-fractor` v0.4 pin older
`php-parser` releases that the target's toolchain conflicts with.

**Fix.** Raise the dev tooling first — Rector `^3`, Fractor `^1.0`, PHPStan `^2` — then resolve the
core. The upgrade needs current versions of those tools anyway.

---

## A required package no longer exists

**Symptom.** `composer update` cannot find a `typo3/cms-*` package at the target version.

**Cause.** The package was merged into another. `typo3/cms-recordlist` was merged into
`typo3/cms-backend` in v13, and `typo3/cms-setup` was merged into `typo3/cms-backend` for v14.3.
Neither exists at the later target as a separate package.

**Fix.** Remove the obsolete package from `require` and ensure `typo3/cms-backend` is present through
the project's core dependency strategy. Check the target release notes and Composer metadata for
other merged packages before assuming this is the only one.

---

## The `<html>` language attributes are wrong, missing or contradictory

**This is the first thing to check on the opening tag, and the most common thing to get wrong.**
Three separate faults hide here, and an upgrade surfaces all three at once.

**Symptom A — missing.** axe reports `html-has-lang` on every page although the site configuration
declares a language. Cause: `config.doctype` is an XHTML variant, which emits `xml:lang` and no
`lang`. Screen readers keyed to `lang` get nothing.

**Symptom B — changed by the upgrade.** Every page differs at the `<html>` tag after the v14 rung:
`xml:lang="de"` became `xml:lang="de-DE"`. Cause: v14 emits the **full locale** from the site
language configuration where v13 emitted the short code. Nothing is broken — but it is a change on
every page, so it needs classifying rather than waving through.

**Symptom C — contradictory.** The tag carries two different values, e.g.
`<html xml:lang="de-DE" lang="de">`. This is usually self-inflicted: somebody added
`config.htmlTag.attributes.lang` to fix Symptom A while the doctype kept deriving `xml:lang` from
the locale. **Two disagreeing language declarations are worse than one missing one** — consumers
pick different attributes, and now they disagree about the page.

### Getting it right

1. **One source of truth: the site language configuration.** `locale`, `hreflang` and
   `iso-639-1` in `config/sites/<id>/config.yaml` are what TYPO3 derives the tag from. Fix the value
   there rather than overriding the rendered output.
2. **Choose the region deliberately.** `de-AT`, `de-DE` and `de-CH` are different languages to a
   search engine, a screen reader's pronunciation and a date or currency formatter. An Austrian
   organisation's site set to `de_DE.UTF-8` is *wrong* — and it stays invisible on v13, which emits
   only `de`, until v14 prints the region on every page. **When the upgrade surfaces a locale, check
   that the locale is actually correct** instead of just accepting the new string.
3. **Do not hardcode `lang` alongside a doctype that emits it.** Use
   `config.htmlTag.attributes.lang` only while the doctype cannot produce `lang` at all — an XHTML
   doctype — and make its value **identical** to the locale-derived `xml:lang`. Remove the override
   in the same commit that migrates the doctype to HTML5.
4. **Verify the rendered tag, not the configuration.** One `curl` settles it:

   ```bash
   curl -s https://site.ddev.site/ | grep -oE '<html[^>]*>'
   ```

   Expect exactly one language value, in BCP 47 form (`de-AT`), matching the site's `hreflang`.

5. **Multi-language sites: check every language**, not just the default. A fallback language
   frequently inherits the default's locale and then announces the wrong one.
---

## Forms lose their styling: inputs collapse to browser-default width

**Symptom.** After the v14 rung every EXT:form form renders with narrow, unstyled inputs and a
tighter vertical rhythm. The page height shrinks, so the visual gate reports a difference, but
nothing 500s and no error is logged. On a screenshot it reads as "the form got smaller".

**Cause.** **v14 ships Bootstrap-5 EXT:form templates.** The markup changed shape:

| | v12 / v13 | v14 |
|---|---|---|
| wrapper | `<div class="form-group">` | `<div class="form-element form-element-<type> mb-3">` |
| inner wrapper | `<div class="input">` | *removed* |
| select | `class="form-control"` | `class="form-select"` |

Any site CSS written against `.form-group` or `.input` — which is most sitepackages of that
generation — stops matching. The rules are not overridden, they are **dead**, so inputs fall back
to the browser default width and to whatever generic `#content input` rule the stylesheet has.

**Confirm it before fixing it.** The markup is the evidence:

```bash
curl -s https://site.ddev.site/<form-page> | grep -oE 'class="(form-element[^"]*|form-control|form-select)"' | sort | uniq -c
grep -rnE '\.form-group|div\.input' packages/*/Resources/Public/css/
```

**Fix — pick one deliberately, they are different contracts.**

- *Contract A, invariance.* Teach the existing rules the new wrapper: `.form-group X, .form-element X`.
  Restores the previous rendering exactly. Correct when the run must prove nothing changed.
- *Contract B, elevation.* Ship a small self-contained stylesheet for the new markup and let the
  form look like a form. Usually the better answer: the old rendering is typically 10px Verdana
  inputs with a background-colour-only focus cue, which fails WCAG 2.4.7 anyway. Define `.mb-3`
  yourself if the site ships no Bootstrap — the templates emit it and nothing defines it.

Whichever you choose, **check the submit button separately**. Legacy stylesheets frequently carry
`.actions button { background-color: … !important }`, which silently beats a new rule. `.actions`
is only emitted by EXT:form, so dropping the `!important` is safe and better than answering it
with another `!important`.

**Why it matters more than it looks.** Contact and registration forms are the site's conversion
path. This is a rendering regression on exactly the pages that earn money, and it is invisible to
every check except a visual one — the HTTP status is 200 and the DOM still contains every field.

---

## Content tables lose their padding and the page gets shorter

**Symptom.** Pages containing an RTE table render with the cell padding, background and row
spacing gone. The page is measurably shorter — around 117px on a ten-row table — so the visual
gate flags it. No error, no warning, HTTP 200, every word still present.

**Cause.** v14's `fluid_styled_content` **no longer sets the `contenttable` class** on RTE
tables. The `fixAttrib.class` configuration was dropped from Core's `lib.parseFunc_RTE`
entirely, so `<table class="contenttable">` became a bare `<table>` and every `.contenttable`
rule in the site's stylesheet stopped matching.

Sitepackages of this generation frequently make it worse by clearing the allowed class *list*
and relying on the Core default to supply the class:

```typoscript
lib.parseFunc_RTE.externalBlocks.table.stdWrap.HTMLparser.tags.table.fixAttrib.class.list >
```

That line reads as "keep an author's class if there is one" — and silently means "no class at
all" once the default is gone.

**Confirm it in the captured DOM**, before and after, rather than in the browser:

```bash
grep -o '<table[^>]*>' <before>/dom/<page>.html
grep -o '<table[^>]*>' <after>/dom/<page>.html
```

**Fix.** Restore the default explicitly — it is one line, and it keeps the markup identical:

```typoscript
lib.parseFunc_RTE.externalBlocks.table.stdWrap.HTMLparser.tags.table.fixAttrib.class.default = contenttable
```

**Generalise it.** This and the EXT:form regression above are the same failure: **v14 stopped
emitting a class the site's CSS depends on.** When a visual finding shows a height change with
no colour change and no error, diff the *class attributes* of the captured DOM before assuming
a styling bug. Grep the stylesheet for class names Core used to supply — `contenttable`,
`form-group`, `csc-*`, `bodytext` — and check each is still emitted.

---

## TypoScript silently stops loading after the v14 rung, or every page answers 500

**Symptom.** After the 14.x rung, configuration that used to apply is simply gone. A menu renders
unstyled, a plugin loses its settings, a whole library of TypoScript behaves as if it was never
written. **Nothing is logged** — no error, no warning, no deprecation entry. Status codes stay
200 and the page renders, just wrong. The exception is an include that carried the `PAGE` object
itself: then 14.3 logs an error and answers 500 "No page configured for type=0"
(`PrepareTypoScriptFrontendRendering`), which looks like a different problem.

**Cause.** `<INCLUDE_TYPOSCRIPT: ...>` was **removed in v14** (deprecated in #105171, removed
with #105377). It was replaced by `@import` back in v9, but the old construct kept working for
five majors, so plenty of projects never migrated.

What makes this dangerous is the failure mode. The v14 tokenizer still recognises the line and
then deliberately discards it:

```php
} elseif (str_starts_with($this->currentLineString, '<INCLUDE_TYPOSCRIPT:')) {
    // @todo: Do nothing. This creates an InvalidLine in LossyTokenizer.
}
```

The include is not an error — it is a no-op. Everything it would have pulled in never loads.

**Fractor covers this — for files.** Do not skip the tool on hearsay: `a9f/typo3-fractor` ships
`MigrateIncludeTypoScriptSyntaxFractor` in the TYPO3v13 set, and it handles every form. Verified
against the installed version:

```diff
-<INCLUDE_TYPOSCRIPT: source="FILE:EXT:my_ext/Configuration/TypoScript/menu.typoscript">
-<INCLUDE_TYPOSCRIPT: source="DIR:EXT:my_ext/Configuration/TypoScript/" extensions="txt">
-<INCLUDE_TYPOSCRIPT: source="FILE:fileadmin/templates/legacy.txt">
+@import 'EXT:my_ext/Configuration/TypoScript/menu.typoscript'
+@import 'EXT:my_ext/Configuration/TypoScript/*.txt'
+@import 'fileadmin/templates/legacy.txt'
```

**Only for the files it processes.** On one fleet site Fractor's `UP_TO_TYPO3_14` set rewrote the
`.typoscript` files and left a static template's `setup.txt` and `constants.txt` untouched. 14.3's
`SysTemplateTreeBuilder` still loads `.typoscript`, `.ts` and `.txt` static-template files, so both
loaded while their fourteen include lines vanished: no `PAGE` object, HTTP 500 "No page configured for
type=0" on every page, although 13.4 had rendered. Convert the includes to `@import` (the fix) and
`git mv` the files to `.typoscript` (same load position; Fractor processes them next time). The grep
below matches every file extension: treat any hit as a hard gate before the 14 rung.

**The gap is the database, and it is the common case.** Fractor is a file processor: it walks the
paths given to `withPaths()`. On sites of this generation the includes overwhelmingly live in
**`sys_template.config` / `constants`**, edited through the backend and never present on disk.
Fractor cannot see them, reports nothing, and the run looks clean.

**Find them everywhere before trusting a green Fractor run:**

```bash
ddev mysql -N -e "
SELECT 'sys_template.config' AS loc, uid, LEFT(title,30) FROM sys_template
  WHERE deleted=0 AND config LIKE '%INCLUDE_TYPOSCRIPT%'
UNION ALL SELECT 'sys_template.constants', uid, LEFT(title,30) FROM sys_template
  WHERE deleted=0 AND constants LIKE '%INCLUDE_TYPOSCRIPT%'
UNION ALL SELECT 'pages.TSconfig', uid, LEFT(title,30) FROM pages
  WHERE deleted=0 AND TSconfig LIKE '%INCLUDE_TYPOSCRIPT%'
UNION ALL SELECT 'be_groups.TSconfig', uid, LEFT(title,30) FROM be_groups
  WHERE deleted=0 AND TSconfig LIKE '%INCLUDE_TYPOSCRIPT%';"

grep -rn 'INCLUDE_TYPOSCRIPT' packages/ config/ fileadmin/
```

Convert the database hits by hand — same syntax Fractor produces — and re-run both checks until
each returns nothing. A hand conversion in the DDEV database does not reach production: ship it
as a sitepackage upgrade wizard that changes only the exact pre-migration record and does nothing
on an already migrated or later edited one, and list it in the handover. A deploy step that
throws on any unexpected state blocks every future deploy after the next backend edit.

**Two details that bite during the conversion.**

- A `DIR:` include with `extensions="txt"` becomes a glob (`.../*.txt`), and **`@import` sorts its
  matches**, so files that relied on the old traversal order can end up applied in a different
  sequence. Where order matters, list the files explicitly instead of globbing.
- `INCLUDE_TYPOSCRIPT` accepted a `condition` attribute (#16525). `@import` has no equivalent —
  wrap the import in a normal TypoScript condition block instead.

**Verify by behaviour, not by grep.** The whole point is that the construct fails silently, so
prove the configuration still arrives:

```bash
ddev typo3 typoscript:show config.doctype        # or any key the include was responsible for
```

Because it is invisible to logs, this belongs in the invariance comparison as well: a DOM or
visual diff on pages that share a template is often the only signal that an include stopped
loading.

---

## Image optimisation configured, nothing got smaller

**Symptom.** A format and a quality are configured on an image, the page still ships the same
bytes, and the rendered `<img src>` still points at a `.jpg`. No error, no warning, nothing in
any log. The audit keeps reporting the same oversized image.

**Two causes, and they stack — check both, because fixing one alone still changes nothing.**

**Cause 1 — the property is `ext`, not `fileExtension`.**

```typoscript
file.ext = avif             # correct
file.fileExtension = avif   # silently ignored
```

`ContentObjectRenderer` reads the TypoScript key **`ext`** and maps it to the processor's
internal `fileExtension`. Writing `fileExtension` in TypoScript is not a syntax error and not a
deprecation — it is simply never read. The image is emitted as JPEG and the only symptom is that
nothing improved, which reads as "AVIF didn't help here" rather than "the setting did nothing".

**Cause 2 — a source already at the target size is passed through untouched.**

If the file is *already* exactly the requested dimensions, TYPO3 concludes there is no resize to
perform and hands the original straight through. It is never re-encoded, so the configured
quality never applies and a 250 KB upload stays a 250 KB download. Force it through the
processor:

```typoscript
file.width = 742
file.height = 362
file.ext = avif
file.params = -quality 82 -strip     # `params` is what forces the re-encode
```

**Confirm from the rendered markup, not the configuration.** The path tells you which of the two
you are looking at:

```bash
curl -s https://site.ddev.site/<page> | grep -oE '<img[^>]*>' | head
```

`/fileadmin/…​.jpg` — never processed (cause 2, or cause 1, or both).
`/fileadmin/_processed_/…​.jpg` — processed but still JPEG (cause 1).
`/fileadmin/_processed_/…​.avif` — working.

Full guidance in [`image-formats.md`](image-formats.md).

---

## A correct HTML fix silently moves the layout

**Symptom.** An accessibility or markup fix that is unambiguously correct — removing a redundant
wrapper, replacing a `<div>` with a `<nav>`, unnesting a list — and the visual gate lights up on
pages that should not have changed at all.

**Cause.** The old, wrong markup was **load-bearing for a CSS selector**. Descendant and child
combinators count elements, so removing one level silently stops a rule matching.

The case that produced this entry: a sidebar template wrapped its menu in a second, empty `<ul>`,
so `#sidebar > ul` contained a `<ul>` instead of `<li>` elements — axe's `list` rule, on every
page. Removing the wrapper is plainly the right fix. It would also have shifted **every top-level
link 8px to the left**, because the stylesheet carried:

```css
#sidebar ul ul a { padding: 0 0 0 8px; }
```

and that empty wrapper *was* the second `ul`. Every link happened to sit inside two lists, so
every link got the indent. Remove one level and only the submenu links keep it.

**Fix.** Change the selector in the same commit as the markup — here `#sidebar ul ul a` becomes
`#sidebar ul a`, which is exactly equivalent once the wrapper is gone.

**How to catch it.** Before touching the markup, grep the stylesheet for the element you are
about to remove a level of, and **measure**:

```js
[...document.querySelectorAll('#sidebar a')].map(a => {
  const r = a.getBoundingClientRect();
  return { t: a.innerText.trim(), x: Math.round(r.x), y: Math.round(r.y),
           pl: getComputedStyle(a).paddingLeft };
})
```

Run it before and after and diff. On the real fix: 13 links, **zero** position changes — which is
what let the change ship inside an invariance run instead of needing a new baseline.

**Generalise it.** "Structural fix" and "visually neutral" are not the same claim, and on a site
whose CSS was written against whatever markup happened to exist, they are frequently opposites.
Measure; do not reason about it.

---

## Shared links show no preview image

**Symptom.** The page has a valid `og:image`, the URL returns 200, the image opens fine in a
browser — and Facebook, LinkedIn, WhatsApp and Slack all render the link with no picture.

**Cause.** The image is **AVIF or WebP**. Social scrapers are not browsers: they are fetchers with
their own, much older image support, and most of them cannot decode AVIF at all. A modern-format
share card is invisible to exactly the audience it exists for.

This bites hardest right after an image-format migration, because the sweep that moved every
processed image to AVIF also moved the share cards, and nothing in the site itself looks wrong.

**Fix.** Pin the share card to **PNG or JPEG**, explicitly, and leave it pinned:

```typoscript
page.meta.og:image.cObject.file.format = png     # GIFBUILDER
# or, for a processed file:  file.ext = jpg
```

**The same applies to** `twitter:image`, favicons and `apple-touch-icon` (consumed by the OS, not
a browser), email templates, and anything destined for PDF or print. Browser support statistics
are irrelevant for all of them.

**Verify with a fetcher, not your browser.** Requesting the card with a normal browser proves
nothing, because your browser *can* decode AVIF:

```bash
curl -sI "$(curl -s https://site.ddev.site/ \
  | grep -oE '<meta property="og:image" content="[^"]*"' \
  | sed 's/.*content="//;s/"$//')" | grep -i content-type
```

Expect `image/png` or `image/jpeg`.

---

## Editors lose their modules, or gain all of them

**Symptom.** After the v14 rung, backend users see no modules, or see modules they should not.

**Cause.** v14 renamed the module parents — `web` → `content`, `file` → `media`,
`tools` → `admin`/`system`. Every `mod.web_layout.*`, `options.hideModules` and `be_groups` module
permission naming an old identifier silently stops applying.

**Fix.** Migrate page TSconfig, user TSconfig and `be_groups` module access to the new identifiers.

**Info is a parent now.** The core migration turns a stored `web_info` right into `content_status`, the
new parent, but grants none of its sub-modules. Editors keep an empty Status entry and lose the page and
translation overviews. With the owner's approval, grant `web_info_overview` and `web_info_translations`
through DataHandler (dry-run inside a rolled-back transaction, apply, re-apply as a no-op) and repeat it
after the upgrade wizards on staging and live: the right lives in the database, not in the code. Write
the grant tool so it bootstraps from the working directory (`require getcwd() . '/vendor/autoload.php'`),
not from `/var/www/html`, so the same file runs in DDEV and in a Deployer release.

**It is invisible to the invariance gate.** Nothing about it shows in the frontend, and a permission
model that quietly widened is a security regression a pixel comparison cannot see. Only the backend
sweep and a real permission review catch it.


---

## Every CLI command dies in alias-loader-include.php

**Symptom.** Immediately after the core jumps to 14.3, every `ddev typo3 …` call — even
`--version` — dies with
`Call to undefined method TYPO3\ClassAliasLoader\ClassAliasLoader::setCaseSensitiveClassLoading()`
in `vendor/typo3/alias-loader-include.php`.

**Cause.** That file is *generated*. TYPO3 14 requires `typo3/class-alias-loader` ^2, which dropped
the method, but the include still on disk was written by v1. The autoloader is loading stale
generated code, so nothing that boots PHP can run — including the commands you would use to fix it.

**Fix.**

```bash
ddev composer dump-autoload
```

**Generalise it.** After any major jump, a failure inside `vendor/composer/` or `vendor/typo3/`
generated files is a regeneration problem, not a code problem. Dump the autoloader before
diagnosing anything further — it is cheap and rules out the whole class.

---

## extension:setup fails inside a sitepackage's ext_localconf.php

**Symptom.** `extension:setup` aborts with
`Call to undefined method ExtensionManagementUtility::addPageTSConfig()` (or `addUserTSConfig()`),
pointing at a line in your own sitepackage.

**Cause.** Both methods were removed in v14 (#105377). The common sitepackage idiom is to
`file_get_contents()` a TSconfig file and hand it to those methods from `ext_localconf.php`.

**Fix.** Delete the calls and let TYPO3 load the files itself. `TsConfigTreeBuilder` picks up
`Configuration/page.tsconfig` and `Configuration/user.tsconfig` from every package root
automatically — note the path is the package root, not a `TsConfig/` subdirectory:

```bash
git mv Configuration/TsConfig/page.tsconfig Configuration/page.tsconfig
git mv Configuration/TsConfig/user.tsconfig Configuration/user.tsconfig
# then remove the file_get_contents + add*TSConfig block from ext_localconf.php
```

Verify the load path in the installed `TsConfigTreeBuilder` rather than trusting the filename — it
is the code that decides.

---

## Generated code can require another bounded Rector pass

**Symptom.** Rector applies successfully, then a dry run immediately proposes changes inside an
upgrade wizard or other file Rector just generated.

**Cause.** A rule can create code that exposes a later rule. On a real v14 run, generated
list-type-to-CType wizards still carried namespaces that the next pass migrated.

**Fix.** Dry run, review, apply once and dry run again, including generated code in the configured
paths. Zero remaining changes is the fixed-point proof, not permission for an unbounded loop. Return
remaining findings to the parent graph; another pass spends its shared attempt/time budget. Stop on
oscillation or two no-progress attempts. Standalone use permits at most three applied passes.
“The tool ran once” is not a clean result, but a residual diff is not authority to run forever.

---

## Fractor cannot find the generated extension registry

**Symptom.** Fractor fails during boot after Composer was recovered with plugins disabled. Project
code has not run yet; the error points at a missing generated TYPO3 extension registry or autoload
artifact.

**Cause.** `--no-plugins` can complete the lock/install operation without running the Composer plugin
that generates TYPO3's registry.

**Fix.** Run a normal, plugin-enabled reproducible `composer install` (and `composer dump-autoload`
where needed), then rerun Fractor. Never patch the missing file in `vendor/`; it is generated and the
next install would replace it.

---

## Composer metadata says compatible, runtime still breaks

**Symptom.** The dependency graph resolves on TYPO3 14, but a backend status provider, command or
frontend path fails with an incompatible method signature or a removed API.

**Cause.** Composer constraints describe what the maintainer claims is compatible. They do not type-
check inherited signatures or execute code paths. A package can also pin an upstream commit whose API
has moved while its own wrapper has not.

**Fix.** Lock the exact package/source commit, inspect the failing interface in installed code, patch
the smallest owned boundary through Composer with a removal condition, then prove the actual runtime
surface. Scanner and static analysis supplement that proof; neither replaces it.

---

## Static analysis says addTCAcolumns expects exactly 2 arguments

**Symptom.** TYPO3 14 boots, but PHPStan or the local-extension audit reports a three-argument call
to `ExtensionManagementUtility::addTCAcolumns()` in a TCA override.

**Cause.** Old sitepackages commonly passed a third positional flag. TYPO3 14's API accepts the
table and column array only. Rector/Fractor can miss this in local package override files, especially
when the call still parses and the affected backend path has not been opened.

**Fix.** Remove the obsolete third argument after checking that the first two arguments are the
intended table and column definition. Run `scripts/local-extension-audit.mjs` from P08 across the
whole `packages/` tree, then rerun static analysis and the backend sweep. Do not suppress the arity
error or limit the search to the package that happened to fail first.

---

## A local ext_emconf.php reports an undefined $_EXTKEY

**Symptom.** Static analysis or a direct include reports that `$_EXTKEY` is undefined in
`ext_emconf.php`, prompting a hardcoded `$EM_CONF['site_package']` workaround.

**Cause.** `$_EXTKEY` is supplied by the classic extension loader; it is not a generally defined PHP
variable. More importantly, TYPO3 14 project-local Composer packages do not need `ext_emconf.php`:
Composer metadata is the source of truth, and v15 no longer evaluates the file.

**Fix.** For packages local to `packages/`, remove `ext_emconf.php` and declare
`type: typo3-cms-extension` plus `extra.typo3/cms.extension-key` in `composer.json`. Retain the file
only for TER/Tailor publication or Classic mode; in that loader context keep `$EM_CONF[$_EXTKEY]`
and its TER-compatible file restrictions. Do not hardcode the key merely to silence analysis.

---

## A read-only command dirtied config/system/settings.php

**Symptom.** `git status` shows `config/system/settings.php` modified after intake, although only
inspection commands ran. The diff adds `EXTENSIONS` entries nobody configured.

**Cause.** typo3-console 8.x `cache:flush` and `extension:list` synchronise extension configuration:
they write every `ext_conf_template.txt` default that is missing from `EXTENSIONS` into
`settings.php`. Core's plain `typo3 list` does not.

**Fix.** Treat those commands as writes. Record `git status` and `git diff config/system/settings.php`
before and after them, and revert the drift (or record it as its own change) before sealing the
fingerprints. It is neither a project edit nor a migration result; never attribute it to either.

---

## A powermail form loses its styling or layout after the 13.4 rung

**Symptom.** After powermail 12 → 13 on the 13.4 rung, the `Basic.css` link disappears from every
page, or the form page changes: grid classes gone, labels, selects and buttons restyled, labels above
instead of beside the fields. Pages without a form stay identical, so an intermediate sample that never
draws the form page stays green ([intermediate loops](measurement-recipes.md#intermediate-loops-on-stateful-rungs)).

**Cause.** Four independent powermail 13 changes:

| powermail 13 | Effect on a 12.x site |
|---|---|
| `page.includeCSS.powermailBasicCss` moved from `BootstrapClassesAndLayout` into the new `Powermail_Styling` static template | a root template listing only the old template loses `Basic.css`; TYPO3 ignores the dead include silently |
| `BootstrapClassesAndLayout` removed | the site's `plugin.tx_powermail.settings.styles.bootstrap.*` constants lose their only reader |
| `Basic.css` styles the whole form (12.x: error list and progress bar only) | labels, selects, legends, buttons and spacing change |
| field partials render the label inside `<div class="{fieldWrappingClasses}">` | in a horizontal grid the label moves above the field |

**Fix (Contract A).**

1. `@import` the `Powermail_Styling` constants and setup from the site package, the setup before the
   site package's own includes, so the stylesheet keeps its place in `<head>`.
2. Set the same values as `plugin.tx_powermail.settings.styles.framework.*`, including the 12.x
   defaults the site relied on (`radioClasses`, `checkClasses`, `numberOfColumns`).
3. Ship 12.x `Basic.css` verbatim in the site package and point `plugin.tx_powermail.settings.BasicCss`
   at it; declare its new URL. Adopting 13's form design is a Contract B step with its own proof.
4. Override the partials of the field types in use (`plugin.tx_powermail.view.partialRootPaths`), with
   only the label moved back. Record the field types left on 13's markup.

---

## Every page's og:image reads "Oops, an error occurred!" after Fractor

**Symptom.** After the mechanical pass every page renders
`<meta property="og:image" content="Oops, an error occurred! …">`; the baseline had no og:image tag.

**Cause.** `path:` getData is gone in v14, and Fractor's `MigrateTypoScriptGetDataPathFractor` rewrites
`data = path:…` to `asset:…`. A fallback with a malformed path (`path:EXT:site_package//Resources/…`,
note the double slash) resolved to nothing on 12.4 and 13.4, so no tag rendered; `asset:` throws on it.

**Fix.** Resolve the target of every `path:` → `asset:` hunk in the Fractor diff. Remove a path that
never resolved (Contract A keeps "no tag"); correcting it adds an og:image the baseline never had, an
owner decision for Contract B. A working `asset:` reference appends a cache-busting version query:
declare it ([rule 30.8](../rules/30-finding-classification.md#308-declared-changes-are-rules-not-edits)).

---

## RTE content renders as escaped tags after the v14 rung

**Symptom.** After the 14.3 rung rich text shows its tags as text on nearly every content page (one
site: 230 of 231 DOM records and 243 of 360 screenshots differed). Nothing is logged.

**Cause.** 14.0 removed fluid_styled_content's parseFunc (Breaking-107438). A site override that
*extended* it now defines it alone: `lib.parseFunc_RTE.allowTags := addToList(object,param,embed,iframe)`
extended 13.4's `allowTags = *` and on 14.3 is a four-tag allow list, so every other tag is escaped.

**Fix.** Keep fluid_styled_content 13.4's `Helper/ParseFunc.typoscript` verbatim in the site package,
its constants inlined with their 13.4 values, and `@import` it first, where fsc's static template
loaded it. Flag the pattern at the mechanical node, before the 14 rung:

```bash
grep -rnE 'allowTags *:= *addToList|styles\.content\.links\.|lib\.parseFunc' packages/ config/
ddev mysql -N -e "SELECT uid, title FROM sys_template WHERE deleted=0
  AND (config LIKE '%parseFunc%' OR constants LIKE '%styles.content.links%');"
```

See also [content tables lose their padding](#content-tables-lose-their-padding-and-the-page-gets-shorter).

---

## A list renders empty after the v14 rung, or a site-package class is fatal

**Symptom.** A plugin list renders empty with HTTP 200 and no message, or every page using a
site-package class dies with `Non-readonly class … cannot extend readonly class …`.

**Cause.** Site-package PHP written against the old core class shapes. On one site a crop helper
`extends HtmlCropper` and was created with `makeInstance()`. On 14.3 the parent is `readonly`, its
constructor requires a `LoggerInterface` (`makeInstance()` outside DI passes none), and
`TYPO3\CMS\Core\Html\TextCropper` moved to `TYPO3\CMS\Core\Text\TextCropper`. The content object's
`ProductionExceptionHandler` swallowed the constructor error: the news list rendered nothing.

**Fix.** Make the subclass `final readonly class`, construct it with a logger from `LogManager`, update
moved namespaces. At the 14 rung, check site-package PHP against the target vendor: every `use` and
`::class` target exists, `readonly`/`final` parents, constructor arity of `makeInstance()` targets
(for example PHPStan level 0 with the target vendor; see [TYPO3 14 readiness checks](typo3-14-readiness-checks.md)).
After every smoke run read the frontend log; a swallowed content-object exception never changes the
status code:

```bash
grep -n 'ProductionExceptionHandler' var/log/typo3_*.log
```

---

## Relative asset URLs load a 404 page under a trailing slash

**Symptom.** After the v14 rung the powermail captcha image is broken on `/contact/` but not on
`/contact`, so the form cannot be solved. Where the captcha is a declared randomized region, the
self-test fails with `randomized region failed integrity: … (image-not-loaded)` on that page.

**Cause.** 14.0 no longer prefixes relative content links (Breaking-108114). 12.4 and 13.4 turned
`src="typo3temp/assets/…/Captcha….png"` into `/typo3temp/…` in the global `absRefPrefix`
post-processing; 14 leaves it relative, and the browser resolves it against the page path and loads the
site's soft-404 HTML.

**Fix.** Emit an absolute path where the URL is built: in the ViewHelper, or meanwhile in a
site-package template override that `f:replace`s the leading `typo3temp/` with `/typo3temp/`. Then
search the target capture for every other relative asset URL; each hit is a regression, also where it
works by accident (no trailing slash):

```bash
grep -rhoE '(src|href)="(typo3temp|fileadmin|typo3conf|_assets)/[^"]*' <after>/dom/ | sort | uniq -c
```

---

## An external-link page loses its URL when it is restored

**Symptom.** After the 14.3 rung a deleted or hidden page of type External URL (doktype 3) has an
empty `link`; restored from the recycler or unhidden, it points nowhere. `upgrade:list` never offered
`pageDoktypeLinkMigration` although `pages.url` held a value.

**Cause.** The wizard migrates `pages.url` to `pages.link`, but its `updateNecessary()` count and its
select keep the QueryBuilder default restrictions: deleted and hidden pages are neither counted nor
migrated. The later schema `*.prefix` step moves `pages.url` to `zzz_deleted_url`.

**Fix.** Before the 14.3 schema cleanup, list the rows the wizard skips and decide each one in the
ledger: migrate it with a reviewed update, or keep `zzz_deleted_url` (never drop it while such rows
exist) and name the pages in the handover.

```bash
ddev mysql -N -e "SELECT uid, deleted, hidden, url FROM pages WHERE doktype = 3 AND url <> '';"
```

---

## Sitemap index child URLs change after the v14 rung

**Symptom.** `/sitemap.xml` links its children as `?tx_seo[sitemap]=pages&cHash=…` instead of
`?sitemap=pages&cHash=…`, and the 12.4 child URLs now answer with the sitemap index, not a `urlset`.

**Cause.** v14's `XmlSitemapRenderer` reads the sitemap name from `tx_seo[sitemap]`; the cHash
follows the new parameter.

**Fix.** Core-mandated; keeping the 12.4 parameter would need a core patch. Declare exactly the
child-URL parameter and its cHash under an approval
([rule 30.8](../rules/30-finding-classification.md#308-declared-changes-are-rules-not-edits)) and keep the
content compared: index `lastmod` values and every child `(loc, lastmod)` pair stay identical. When the
sitemaps are not in the URL manifest, both belong to the route evidence of the `http-dom` closure check.

---

## Processed images change name or lose 1 px after the v14 rung

**Symptom.** After the 14.3 rung some gallery images are 1 px smaller in one dimension, or keep their
size and appear under new `_processed_` names with slightly different pixels. DOM differences stay in
those `src`, `width` and `height` values, pixel differences inside the images.

**Cause.** Processed files are re-rendered from the same originals:

- `ImageProcessingInstructions` rounds scaled sizes with `round()` where 13.4 used `ceil()`: ±1 px.
- The stored processing configuration carries `maxHeight` `0` instead of `""`, so its hash and the file
  name change. Files that came with the live dataset are re-rendered by the local processor, and
  fractional crop offsets are now rounded.

**Fix.** Prove per image that source file, crop area and size are unchanged apart from the rounding.
Then declare the affected pages under an owner approval: a `whole_document` rule scoped by `url` also
declares their screenshots (pins before harness PR #10 cannot declare screenshots; see
[harness pins](fleet-profile.md#harness-pins-across-a-fleet)). `og:image` and `twitter:image` appear in no
screenshot: the HTTP stage accepts such a processed-file rename only when the capture recorded
identical bytes or identical PNG pixels for both images (`metaImages` digests; the report lists
`metaImageRenames`). Anything else stays a difference.

---

## Stored rich text gains `data-list-item-id` on every list item

**Symptom.** On 14.3.7 a backend save of a rich-text field with a list stores
`data-list-item-id="<random>"` on every `<li>`. TYPO3 12 never stored it; the
[RTE round trip](measurement-recipes.md#rte-round-trip-proof) shows every list record changed.

**Cause.** CKEditor 47's `getData()` adds the id, and 14.3.7's `ckeditor5.js` calls
`updateSourceElement()` without `skipListItemIds`. An `HTMLparser_db` rule cannot remove it:
`TS_transform_db` never applies `HTMLparser_db` tag rules inside `<ul>`/`<ol>`.

**Fix.** Strip it in the exit parser of a site preset that imports the core preset, registered under the
preset name in use (a site with its own preset adds the `processing` block there):

```yaml
# EXT:site_package/Configuration/RTE/Default.yaml
imports:
  - { resource: 'EXT:rte_ckeditor/Configuration/RTE/Default.yaml' }
processing:
  exitHTMLparser_db:
    keepNonMatchedTags: true     # every other tag stays exactly as it is
    tags:
      li:
        fixAttrib:
          data-list-item-id:
            unset: true
```

```php
// EXT:site_package/ext_localconf.php
$GLOBALS['TYPO3_CONF_VARS']['RTE']['Presets']['default'] = 'EXT:site_package/Configuration/RTE/Default.yaml';
```

Prove it: 0 stored ids, a second save changes nothing. Drop the rule once the core saves with
`skipListItemIds`.

---

## Editors with Redirects rights see no Redirects module

**Symptom.** A group holds `redirects` in `groupMods` and `sys_redirect` table rights, yet its editors
find no Redirects entry in the module menu; the module opens only by URL.

**Cause.** v14 nests Redirects under Link Management (`link_management`, parent `site`), and the menu
shows a module only under a parent the group may use.

**Fix.** Grant `link_management` together with `redirects`, additively and idempotently:

```sql
UPDATE be_groups SET groupMods = CONCAT_WS(',', NULLIF(groupMods, ''), 'link_management')
 WHERE uid = <group> AND NOT FIND_IN_SET('link_management', COALESCE(groupMods, ''));
```

Prove it as a real non-admin: Link Management in the menu, its overview offers Redirects, a DDEV-only
redirect is created, followed, disabled and deleted. Non-admins see only redirects whose source host
belongs to one of their sites, so records for the live host stay invisible on DDEV; check those as admin.

---

## A backend module is gone for admins, or fails on a protected method

**Symptom.** After the v14 rung an extension module that worked on 12.4 is missing from the admin's
menu, or opens with `Call to protected method …` or a `TypeError` from a core doc-header listener. Only
the full admin module sweep finds it; editor journeys never open it.

**Cause.** Two defects in one vendor monitoring module, on its latest stable release:

- It registers `'access' => 'user,group'`, a TYPO3 11 value. 12.4's `ModuleProvider::accessGranted()` let
  admins in; 14.3 decides through access gates (`admin`, `user`, `systemMaintainer`) and denies an
  unknown value to everyone, admins included.
- Its controller calls a method the extension's v14 API made protected and request-bound, and that
  method unsets `$GLOBALS['TYPO3_REQUEST']`, which later backend listeners need.

**Fix.** Keep the package; repair the boundary with a site-package `BeforeModuleCreationEvent`
listener (autoconfigured through the site package's `Configuration/Services.yaml`):

```php
use TYPO3\CMS\Backend\Module\BeforeModuleCreationEvent;
use TYPO3\CMS\Core\Attribute\AsEventListener;

#[AsEventListener('site-package/restore-module-access')]
final readonly class RestoreModuleAccess
{
    public function __invoke(BeforeModuleCreationEvent $event): void
    {
        if ($event->getIdentifier() === '<module>' && $event->getConfigurationValue('access') === 'user,group') {
            $event->setConfigurationValue('access', 'user'); // admins always, editors by group grant: the 12.4 result
        }
    }
}
```

In the same listener, point the module's `controllerActions` at a public site-package subclass of the
vendor controller that calls the method with the request (a bound closure) and restores
`$GLOBALS['TYPO3_REQUEST']` in a `finally` block. Prove access per user (admin yes, non-admins only
through a group), the rendered module and zero new log lines. Remove both once the vendor fixes them.

**The same package rewrites `config/system/settings.php`.** It reads its extension configuration on every
module open and on every monitoring eID request. When `settings.php` holds no entry for it, TYPO3 syncs the
extension settings into the file, the same fixed point Admin Tools writes. Inside a closure epoch this
dirties the tracked worktree at every admin sweep, so back the file up before the first admin step and
restore it after each one (never with Git when it carries an approved local change). On a server that
deploys `settings.php` from Git (a Deployer 8 project that does not share it), the first monitoring
request after every deploy rewrites the release, or fails where the file is read-only. Before the first
staging deploy, let the owner trigger the sync once on a clean checkout, review the diff and commit it.

---

## Vite 8 fails on Sass imports or rewrites the CSS

**Symptom.** After Vite 5 → 8 the build fails on Sass imports written relative to the project root, or
the CSS bundle differs from Vite 5's: `translate3d()` becomes `translate()`, gradient and position
values are rewritten, `/*! license */` comments vanish. Hashed asset file names change.

**Cause.** Vite 8 bundles with Rolldown, accepts only Sass's modern API, and minifies CSS with
Lightning CSS against a newer default target.

**Fix (Contract A).** Keep Vite 5's CSS output:

```js
export default defineConfig({
  css: { preprocessorOptions: { scss: { loadPaths: [import.meta.dirname] } } }, // `sass` likewise
  build: { cssMinify: 'esbuild', cssTarget: ['chrome87', 'edge88', 'firefox78', 'safari14'] },
  esbuild: { legalComments: 'inline' },
});
```

Prove equivalence by parsing both bundles into (at-rule context, selector, property, value) tuples in
cascade order and comparing them; with esbuild minification a fleet trial differed in whitespace only.
Declare the renamed asset files under an approval.

---

## A spam test submission is rejected without any message

**Symptom.** A honeypot or spam journey submits, gets `303` back to the empty form and finds no error
text. A check waiting for a "spam" message fails; a check on the status code passes for the wrong reason.

**Cause.** powermail's spamshield redirects a submission it judges as spam back to the form without an
error (observed on a powermail 14.0 fork).

**Fix.** Assert the rejection facts: the site answered the POST, no thank-you page followed, and no new
`tx_powermail_domain_model_mail` row, Mailpit message or upload appeared
([proof scripts](measurement-recipes.md#proof-scripts-journeys-sweeps-and-row-diffs)).

---

## Logging in as admin or opening the Install Tool changes tracked files

**Symptom.** After an admin journey `git status` shows `public/.htaccess` modified, an untracked
`public/_assets_install/`, or `config/system/settings.php` without `EXTENSIONS` entries of packages
that are no longer installed.

**Cause.** Side effects of the admin session, not migration results. Opening the Install Tool modules
rewrites `public/.htaccess`, can rewrite `config/system/settings.php` and publishes
`public/_assets_install/`. An admin login runs the extension-configuration sync, which removes every
setting no installed package declares from `settings.php`.

**Fix.** Record `git status --short` and `git diff --stat` before and after every admin journey. Revert
`.htaccess` and delete `_assets_install/`. The `settings.php` cleanup is what TYPO3 will also write on
staging and live: trigger it on purpose (one admin login after the last package removal) and commit it
as its own change before `closure-start`, because a commit after it makes the epoch stale
([epoch order](closure-currentness.md#epoch-order-what-makes-a-new-epoch-stale)). Commit nothing else the
journey wrote. See also [a read-only command dirtied settings.php](#a-read-only-command-dirtied-configsystemsettingsphp).
