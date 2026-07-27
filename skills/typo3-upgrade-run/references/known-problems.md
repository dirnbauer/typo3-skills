# Known problems

Faults met on real v12/v13 → 14.3 runs, listed **symptom first**, because that is how you meet them.
Each one cost time to diagnose once; none should cost it twice.

None of these is a reason to skip a diagnosis. Confirm the cause before applying the fix — a
matching symptom with a different cause is exactly how a wrong fix gets applied confidently.

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
- [Image optimisation configured, nothing got smaller](#image-optimisation-configured-nothing-got-smaller)
- [A correct HTML fix silently moves the layout](#a-correct-html-fix-silently-moves-the-layout)
- [Shared links show no preview image](#shared-links-show-no-preview-image)
- [Editors lose their modules, or gain all of them](#editors-lose-their-modules-or-gain-all-of-them)
- [Every CLI command dies in alias-loader-include.php](#every-cli-command-dies-in-alias-loader-includephp)
- [extension:setup fails inside a sitepackage's ext_localconf.php](#extensionsetup-fails-inside-a-sitepackages-ext_localconfphp)

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

**Carry it to the handover.** Production runs the same old engine. A local migration does not change
that, and the site will fail there in the same way. It belongs in the deployment notes as a
prerequisite, not a footnote.

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

**Cause.** Composer's audit is blocking known-vulnerable releases. This is correct behaviour and
should not be disabled — the resolver is trying to protect the site.

**Fix.** Let it resolve to the newest patch. If it cannot, something *else* is pinning the version
back; find that, do not add the advisories to an ignore list.

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
`typo3/cms-backend` in v13 and no longer exists.

**Fix.** Remove it from `require`. Check the version's release notes for others before assuming it is
the only one.

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
