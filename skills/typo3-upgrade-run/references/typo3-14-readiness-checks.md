# TYPO3 14 readiness checks

`scripts/typo3-14-readiness.mjs` finds five breakers that every tool of the mechanical pass misses.
Rector reads PHP code, Fractor reads the files its processors accept, the extension scanner matches
Core API calls — none of them reads `.txt` TypoScript, database TypoScript, class names inside strings,
or the rendered page. Each check below comes from a real 13 → 14.3 run where the site broke while the
tools were green.

The script is evidence, not a fixer: it changes no project file. It copies its two PHP helpers into
`.typo3-update/tools/` (as the extension scanner adapter does) so a container command can reach them.

## Contents

- [When to run](#when-to-run)
- [Commands](#commands)
- [What each check reports](#what-each-check-reports)
- [Reading the report](#reading-the-report)
- [Exit codes](#exit-codes)
- [Limits](#limits)

## When to run

| Node | Run | Why there |
|---|---|---|
| `mechanical-migration` | `--checks includes,relative-links,parsefunc` plus `--db-export`, after the second Rector/Fractor pass | File and database findings are known before any 14 code is installed; they are code work for `manual-migration` |
| `rung-14` | all five checks with `--php "ddev exec php"` and a fresh `--db-export`, after Composer, wizards and the DI rebuild, **before the first 14.3 smoke run** | `class-refs` and `php-classes` judge against the installed code, so only the installed 14.3 core gives the 14 answer |
| first 14.3 capture (rung-14 evidence loop, then `http-dom-proof`) | `--checks relative-links --dom-dir … --baseline-dom-dir …` | Relative links built at runtime exist only in the rendered page |

Run it again after every fix in the same node; the report is the node's evidence. A node is done with
zero `error` findings and every `warning` either fixed or explained in the evidence. Use `--strict`
when the done condition demands zero warnings.

On the mechanical-migration node the installed core is usually 13.4: a `class-refs` or `php-classes`
run there finds what was removed up to 13 (the `RecordLinkHandler` case), not what 14 removed.

## Commands

Export the database TypoScript and TSconfig as JSON Lines — one `{table, uid, field, value}` row per
line. `-r` keeps backslashes and newlines intact; `JSON_OBJECT` escapes them:

```bash
ddev mysql -N -B -r -e "
SELECT JSON_OBJECT('table','sys_template','uid',uid,'field','config','value',config)
  FROM sys_template WHERE deleted=0 AND config <> ''
UNION ALL SELECT JSON_OBJECT('table','sys_template','uid',uid,'field','constants','value',constants)
  FROM sys_template WHERE deleted=0 AND constants <> ''
UNION ALL SELECT JSON_OBJECT('table','pages','uid',uid,'field','TSconfig','value',TSconfig)
  FROM pages WHERE deleted=0 AND TSconfig <> ''
UNION ALL SELECT JSON_OBJECT('table','be_users','uid',uid,'field','TSconfig','value',TSconfig)
  FROM be_users WHERE deleted=0 AND TSconfig <> ''
UNION ALL SELECT JSON_OBJECT('table','be_groups','uid',uid,'field','TSconfig','value',TSconfig)
  FROM be_groups WHERE deleted=0 AND TSconfig <> ''" > .typo3-update/nodes/rung-14/db-typoscript.jsonl
```

`--db-export` also accepts a JSON array of rows or `{"rows": [...]}`; `pid` and `title` are optional
and a `null` value is skipped. A malformed row fails the run (exit 2) instead of being ignored.

Run every check against the project's own PHP, from the project root on the host:

```bash
H=/path/to/typo3-upgrade-run/scripts
node "$H/typo3-14-readiness.mjs" --project-root "$PWD" --php "ddev exec php" \
  --db-export .typo3-update/nodes/rung-14/db-typoscript.jsonl \
  --report .typo3-update/nodes/rung-14/typo3-14-readiness.json
```

File checks only, without PHP (the mechanical-migration run):

```bash
node "$H/typo3-14-readiness.mjs" --checks includes,relative-links,parsefunc \
  --db-export .typo3-update/nodes/mechanical-migration/db-typoscript.jsonl --json
```

The rendered page after a 14.3 capture. `--dom-dir` takes `captures/<label>` or its `dom/`; the sibling
`http/` records supply each page URL. `--baseline-dom-dir` takes Baseline A:

```bash
node "$H/typo3-14-readiness.mjs" --checks relative-links \
  --dom-dir .typo3-update/captures/after \
  --baseline-dom-dir .typo3-update/baseline/A-original \
  --report .typo3-update/nodes/http-dom-proof/relative-links.json
```

Other options: `--package-dir DIR` (repeatable) replaces package discovery; `--asset-prefix media/`
adds a relative resource prefix; `--autoload` and `--tools-dir` are relative to the project root.
Packages are discovered from Composer `path` repositories, `packages/*` and `typo3conf/ext/*` that do
not resolve into `vendor/`; site TypoScript, TSconfig and YAML come from `config/` (and classic
`typo3conf/sites/`), class names also from `config/system/settings.php` and `additional.php`.

## What each check reports

**includes** — `<INCLUDE_TYPOSCRIPT:` was removed in 14.0 (Breaking-105377) and the tokenizer drops the
line without a log entry. Fractor's TypoScript processor reads `.typoscript`, `.tsconfig` and `.ts` by
default, so the construct survives in `.txt` static templates, which 14's static-template loader still
reads. `@import` loads only `*.typoscript` (TSconfig: also `*.tsconfig`). See
[known problems](known-problems.md#typoscript-silently-stops-loading-after-the-v14-rung).

| Rule | Severity | Meaning |
|---|---|---|
| `ts-include-typoscript` | error | An include line in a file, a database row or a PHP string (`addTypoScriptSetup()` still exists). `detail.suggestion` holds the `@import` lines for the same position, `detail.renames` the renames they need |
| `ts-import-loads-nothing` | error | An `@import` that loads no file on 14.3. `detail.reason`: `suffix` (.txt/.ts), `missing`, `unknown-extension`, `unquoted`, `pattern`, `invalid-path` |
| `ts-txt-file` | warning | TypoScript in a `.txt` file: loadable only as a registered static template, invisible to Fractor. `ext_typoscript_*.txt` is never loaded at all |

Include targets inside the project (`fileadmin/…`) are read and checked too, so a database template's
`FILE:fileadmin/…` file is not a blind spot. Resolution mirrors `TreeFromLineStreamBuilder::processAtImport()`
of 14.3: wildcards in the file name only, one `*`, relative `./` paths against the importing file.

**relative-links** — 14.0 removed the response-wide rewrite of relative resource links
(Breaking-108114). `src="typo3temp/…"` resolves against the page URL; below `/page/` the browser gets
the soft-404 HTML — a captcha image that never loads.

| Rule | Severity | Meaning |
|---|---|---|
| `relative-asset-dom` | error | A relative `src`, `href`, `srcset` candidate, `data-src`, `poster` or CSS `url()` to `_assets/`, `typo3temp/`, `typo3conf/`, `typo3/sysext/`, `fileadmin/`, `uploads/` or an `additionalAbsRefPrefixDirectories` entry in the captured DOM. One finding per distinct reference with `occurrences`, `pages` and `resolvesTo` |
| `relative-asset-dom` | warning | The same, but `detail.status` is `base-href` (a root `<base href>` rescues it) or `pre-existing` (already relative in the baseline capture, so not a 14 regression) |
| `relative-asset-template` | warning | A literal relative link in a Fluid template or a TypoScript value. ViewHelper arguments such as `<f:image src="fileadmin/…">` are file paths and stay silent |

`detail.rewrittenBy13` says whether 13 rewrote that form at all: only double-quoted values starting
with one of 13's prefixes were. A `false` regression may predate the upgrade; the baseline settles it,
and fixing a pre-existing one is a visible change under Contract A that needs a declared change.

**class-refs** — class names in TypoScript, TSconfig, YAML (including form definitions), XML
(FlexForms), PHP configuration strings (`Configuration/**/*.php`, `ext_localconf.php`, `ext_tables.php`,
system settings) and the database export, verified by the project autoloader through
`class-exists-check.php`.

| Rule | Severity | Meaning |
|---|---|---|
| `class-ref-missing` | error | No class, interface, trait or enum of that name. `detail.suggestions` lists classes with the same short name under the same vendor root |
| `class-ref-unloadable` | error | The class exists but PHP cannot load it; the message is PHP's own |
| `class-ref-alias` | warning | Resolves only through a class alias, or only in a different letter case |

A name is three or more backslash-separated segments, each starting upper-case; namespace prefixes
(`Vendor\Ext\` in Services.yaml) and registered PSR-4 namespaces (Fluid ViewHelper namespaces) pass.

**parsefunc** — 14.0 removed fluid_styled_content's parseFunc (Breaking-107438). TSconfig, including
`RTE.default.proc.allowTags`, is not checked: that is RTE processing, not parseFunc.

| Rule | Severity | Meaning |
|---|---|---|
| `parsefunc-allowtags` | warning | `allowTags :=` — `addToList(…)` on 14 yields only the listed tags and escapes every other RTE tag |
| `parsefunc-override` | warning | Assignments to `lib.parseFunc` / `lib.parseFunc_RTE`, one finding per file and root with all lines |
| `parsefunc-links-constant` | warning | `styles.content.links.*` constants that nothing reads any more |

Fix: keep fluid_styled_content 13.4's `Helper/ParseFunc.typoscript` in the site package (constants
inlined) and import it first, or rebuild the override against 14's core parseFunc; compare RTE output.

**php-classes** — `site-package-class-check.php` reads every PHP file of the local packages with PHP's
tokenizer (no loading) and reports declarations, imports, `extends`/`implements`, traits, attributes,
`::class`, static access, `new X(…)` and `makeInstance(X::class, …)` with argument counts.
`class-exists-check.php --describe` then reflects the targets and loads each local class declaration,
so PHP itself reports incompatible signatures. Tests, documentation and build directories are skipped.

| Rule | Severity | Meaning |
|---|---|---|
| `php-missing-class` | error | An imported or referenced class does not exist (`Html\TextCropper` → `Text\TextCropper` appears in `detail.suggestions`). A warning when every use is guarded by `class_exists()` and similar |
| `php-unloadable-class` | error | A class (local or referenced) PHP refuses to load: signature, abstract method, parent |
| `php-extends-final` | error | The parent is final in the installed code |
| `php-readonly-mismatch` | error | The parent is readonly and the child is not, or the reverse (PHP 8.2+) |
| `php-constructor-arity` | error | `new X(…)` passes fewer arguments than the installed constructor requires |
| `php-constructor-arity` | warning | The same through `makeInstance()`, unless the class shows public-service evidence (`detail.publicService`: `#[Autoconfigure(public: true)]`, a public-making interface such as `SingletonInterface`, or `public: true` in its package's Services.yaml). For a class that is not a public service, makeInstance calls `new`; the content-object exception handler swallows the ArgumentCountError and the element renders empty |
| `php-class-alias` | warning | Resolves only through an alias or in a different letter case |
| `php-class-not-autoloadable` | warning | Declared in the package, not found by the autoloader (PSR-4 mapping) |
| `php-parse-error` | error | The file does not parse with the project PHP |

## Reading the report

```json
{
  "schema": "typo3-upgrade-run/typo3-14-readiness@1",
  "checks": { "includes": { "status": "findings", "errors": 2, "warnings": 1 }, "parsefunc": { "status": "skipped" } },
  "counts": { "errors": 2, "warnings": 1 },
  "findings": [{
    "check": "includes", "rule": "ts-include-typoscript", "severity": "error",
    "file": "db:sys_template:12:config", "line": 3,
    "message": "<INCLUDE_TYPOSCRIPT: …> is dropped by TYPO3 14 …",
    "fix": "Replace the line at the same position with: @import 'EXT:site/…' …",
    "detail": { "origin": "db", "suggestion": ["@import 'EXT:site/Configuration/TypoScript/page.typoscript'"] }
  }],
  "verdict": "findings", "exitCode": 1
}
```

- `file` is relative to the project root; `db:<table>:<uid>:<field>` names an exported row, and `line`
  counts inside its value. A finding from a database row needs an upgrade wizard, not a local edit.
- `status` per check is `pass`, `warnings`, `findings` or `skipped`; a `note` names what was only
  partly checked (no `--dom-dir`, unresolvable imports, packages PHP could not read).
- `scanned` counts what was read: packages, TypoScript files (`followedIncludes` pulled in by an
  include), database rows, templates, DOM snapshots, PHP files, class names and probe restarts.
- Findings are sorted by check, file and line, so two runs over the same input produce the same report.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | No error. Warnings are listed; with `--strict` they fail too |
| 1 | Findings: fix the site, then run again |
| 2 | Harness error: bad flag, malformed `--db-export`, a helper returned no JSON |
| 4 | Precondition: missing project or capture directory, nothing to scan, PHP command not found, autoloader missing or broken (`composer install` / `dump-autoload` first) |

## Limits

- Only literal names and links. A class name or URL built at runtime is invisible to the source scan;
  the DOM capture covers URLs, nothing covers computed class names.
- `--db-export` is JSON, not an SQL dump. Rows outside the five fields are scanned as TypoScript.
- Public-service detection reads what reflection can see without booting TYPO3, so makeInstance
  arity stays a warning. Confirm a reported class against the compiled container before dismissing it.
- The probe loads class declarations, which runs any top-level code in those files; it defines
  `TYPO3` and `TYPO3_MODE` so `defined('TYPO3') or die();` guards pass. Run it on the project's code
  only. A file that ends the process is reported as unloadable and the probe restarts without it.
- PHP sees what its command sees: a package symlinked from outside the DDEV mount is listed in the
  `php-classes` note and not checked.
- `.ts` and `.txt` files count as TypoScript only below TypoScript or TSconfig directories (or as
  `setup`/`constants` static templates); a `.ts` file that reads as TypeScript is skipped.
- Type hints, `instanceof` and `catch` clauses are not resolved; their imports are.
