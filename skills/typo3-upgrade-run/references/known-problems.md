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
- [axe reports html-has-lang on every page](#axe-reports-html-has-lang-on-every-page)
- [Editors lose their modules, or gain all of them](#editors-lose-their-modules-or-gain-all-of-them)

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

## axe reports html-has-lang on every page

**Symptom.** `html-has-lang` fails site-wide although the site configuration declares a language.

**Cause.** `config.doctype` is an XHTML variant, which emits `xml:lang` and no `lang`.

**Fix now, cheaply:** `config.htmlTag.attributes.lang = <code>`. Zero rendering change.
**Fix properly in P08:** migrate the doctype to HTML5, which makes the explicit attribute redundant.
Do not defer the cheap fix waiting for the doctype change.

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
