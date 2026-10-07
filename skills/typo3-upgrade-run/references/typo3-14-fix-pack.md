# TYPO3 14 fix pack

Fifteen problems of the move to TYPO3 14: fourteen that earlier fleet sites met, diagnosed and
solved, and one Core change of 14.3.6 that silently changes what translated pages show. Sites of one
generation repeat them, and each one found late cost a diagnosis round in every node it reached.
Apply the pack **proactively**: run the detections at the node the table names, apply every hit
before that node's first proof loop, and record per item what applied. The background and the
longer recipes stay in [known problems](known-problems.md); this file is the checklist.

A detection hit is the reason to apply a fix, not the diagnosis of a symptom nobody has seen. A
symptom whose detection does not match goes to the node's recovery route, never into a blind patch.
No hit means "checked, not present": keep the output, so no later node checks again.

## Contents

- [Where each item applies](#where-each-item-applies)
- [The probe and the evidence](#the-probe-and-the-evidence)
- [1. Legacy backend rewrite in .htaccess](#1-legacy-backend-rewrite-in-htaccess)
- [2. INCLUDE_TYPOSCRIPT is dropped](#2-include_typoscript-is-dropped)
- [3. fluid_styled_content parseFunc is gone](#3-fluid_styled_content-parsefunc-is-gone)
- [4. Relative typo3temp links](#4-relative-typo3temp-links)
- [5. Core compress and concatenate keys](#5-core-compress-and-concatenate-keys)
- [6. CKEditor 47 list-item ids](#6-ckeditor-47-list-item-ids)
- [7. Backend modules refused to admins](#7-backend-modules-refused-to-admins)
- [8. Renamed modules and editor rights](#8-renamed-modules-and-editor-rights)
- [9. Dev-server render before Baseline A](#9-dev-server-render-before-baseline-a)
- [10. Vite 5 to 8 rewrites the CSS](#10-vite-5-to-8-rewrites-the-css)
- [11. Composer aborts at the 14 rung](#11-composer-aborts-at-the-14-rung)
- [12. powermail 12 to 13 with Bootstrap 3 forms](#12-powermail-12-to-13-with-bootstrap-3-forms)
- [13. typo3-console 9 schema keywords](#13-typo3-console-9-schema-keywords)
- [14. Caches on NullBackend in DDEV](#14-caches-on-nullbackend-in-ddev)
- [15. Extbase follows fallbackType (14.3.6)](#15-extbase-follows-fallbacktype-1436)

## Where each item applies

`rung-14` is the backstop: it runs the probe again before its first proof loop and applies every
item still open. Items marked for an earlier node are cheaper there.

| # | Item | Detect | Apply | Owner approval |
|---|---|---|---|---|
| 1 | Legacy backend rewrite | intake | `rung-14` | local: no; the shared file on staging/live: yes, at the first 14.3 deploy |
| 2 | `INCLUDE_TYPOSCRIPT` | intake, `mechanical-migration` | `manual-migration`, at the latest `rung-14` | no |
| 3 | parseFunc | intake, `mechanical-migration` | copy while 13.4 is installed, import by `rung-14` | no |
| 4 | Relative `typo3temp/` links | intake, first 14.3 capture | `rung-14` | only to fix a link that was already relative on the old site |
| 5 | Compress/concatenate keys | intake, Fractor diff | remove in `rung-14`, never on 13.4 | yes: the split bundle is a declared change |
| 6 | CKEditor 47 list-item ids | intake | `rung-14`; proof in `rte-visual-editor` | no |
| 7 | Modules refused to admins | intake | `rung-14` | no |
| 8 | Renamed modules vs. rights | intake, after the 14.3 wizards | `rung-14` | yes: restoring a right the wizard dropped |
| 9 | Dev-server render | intake | before `deterministic-baseline` | no; record it as an environment decision |
| 10 | Vite 5 → 8 output | intake | `vite-assets` | yes: renamed asset files are declared |
| 11 | Composer abort | first 14.3 update | `rung-14` | no |
| 12 | powermail 12 → 13 | intake | the rung that installs powermail 13 | yes: the `Basic.css` URL is declared |
| 13 | typo3-console keywords | intake | schema steps of `rung-13`/`rung-14` | destructive objects: one by one |
| 14 | NullBackend caches | intake | the node that runs a cache journey | no |
| 15 | Extbase follows `fallbackType` | intake, before Baseline A is sealed | proof in `rung-14`; the chosen option before `rung-14` closes | yes: every option, and what it means for future content |

Ask every approval in the [intake question round](overnight-controller.md#batch-the-owner-decisions),
with the exact form of the change, so no node waits for an answer.

## The probe and the evidence

One read-only probe collects every detection into one artifact. Run it at intake and at the start of
`rung-14`; its rerun after the fixes is the proof for the grep-detectable items. The
[readiness checks](typo3-14-readiness-checks.md) stay the gate for items 2–4.

```bash
#!/usr/bin/env bash
# TYPO3 14 fix-pack probe, read-only. From the project root on the host:
#   bash fix-pack-probe.sh https://acme.ddev.site public > .typo3-update/nodes/<node>/fix-pack-probe.txt 2>&1
set -u
BASE="${1:?base URL}"; DOCROOT="${2:-public}"
h() { printf '\n### %s\n' "$*"; }
x() { echo "[exit $?]"; }
q() { ddev mysql -N -e "$1" 2>&1; x; }
v() { echo "$1: $(ddev composer show "$1" 2>&1 | grep -E '^versions' || echo 'not installed')"; }

h "1 backend rewrite: a hit names the removed typo3/index.php"
grep -nE 'RewriteRule +\^typo3/.*typo3/index\.php' "$DOCROOT/.htaccess"; x
ls -la "$DOCROOT/typo3/" 2>&1; grep -n 'install-deprecated-typo3-index-php' composer.json; x
grep -n 'webserver_type' .ddev/config.yaml; grep -n 'shared_files' deploy.php 2>&1
h "2 INCLUDE_TYPOSCRIPT in files and database"
grep -rln 'INCLUDE_TYPOSCRIPT' packages/ config/; x
q "SELECT 'sys_template', uid FROM sys_template WHERE deleted=0 AND CONCAT_WS(' ', config, constants) LIKE '%INCLUDE_TYPOSCRIPT%'
   UNION ALL SELECT 'pages', uid FROM pages WHERE deleted=0 AND TSconfig LIKE '%INCLUDE_TYPOSCRIPT%'
   UNION ALL SELECT 'be_groups', uid FROM be_groups WHERE deleted=0 AND TSconfig LIKE '%INCLUDE_TYPOSCRIPT%'"
h "3 parseFunc overrides; fsc Helper/ParseFunc.typoscript exists only up to 13.4"
grep -rnE 'allowTags *:= *addToList|lib\.parseFunc|styles\.content\.links\.' packages/ config/; x
q "SELECT uid FROM sys_template WHERE deleted=0 AND (config LIKE '%parseFunc%' OR constants LIKE '%styles.content.links%')"
ls vendor/typo3/cms-fluid-styled-content/Configuration/TypoScript/Helper/ 2>&1
h "4 relative resource links in templates; powermail captcha fields"
grep -rnE '(src|href)="(typo3temp|fileadmin|typo3conf|_assets)/' packages/*/Resources/Private/; x
q "SELECT COUNT(*) FROM tx_powermail_domain_model_field WHERE deleted=0 AND type='captcha'"
h "5 compress/concatenate keys"
grep -rnE '(compress|concatenate)(Css|Js) *=' packages/ config/; x
q "SELECT uid FROM sys_template WHERE deleted=0 AND config REGEXP '(compress|concatenate)(Css|Js)'"
h "6 lists in rich text, stored list-item ids (expect 0), site presets"
q "SELECT SUM(bodytext LIKE '%<li%'), SUM(bodytext LIKE '%data-list-item-id%') FROM tt_content WHERE deleted=0"
grep -rn "\['RTE'\]\['Presets'\]" packages/*/ext_localconf.php; x
h "7 modules registered with the TYPO3 11 access value"
grep -rnE "'access' *=> *'user,group'" vendor/*/*/Configuration/Backend/Modules.php packages/*/Configuration/Backend/Modules.php 2>/dev/null; x
h "8 module grants (intake: web_info, site_redirects; after the 14.3 wizards: see item 8)"
q "SELECT uid, title, groupMods FROM be_groups WHERE deleted=0"
h "9 dev-server render: expect 0"
curl -sk "$BASE/" | grep -cE '/@vite/client|:5173/'
grep -rn 'useDevServer' config/system/ 2>&1; grep -n 'TYPO3_CONTEXT' .ddev/config*.yaml
h "10 Vite toolchain"
grep -nE '"(vite|vite-plugin-typo3|esbuild|sass|sass-embedded)"' package.json 2>&1; ls vite.config.* 2>&1
v praetorius/vite-asset-collector
h "11-13 versions: class-alias-loader, powermail, typo3-console"
v typo3/class-alias-loader; v in2code/powermail; v helhum/typo3-console
q "SELECT COUNT(*) FROM tx_powermail_domain_model_form WHERE deleted=0"
grep -rn 'tx_powermail.settings.styles' packages/ config/; x
h "14 caches on NullBackend"
grep -n 'NullBackend' config/system/additional.php; x
h "15 site languages (no fallbackType = strict), plugins in content, news per language"
for f in config/sites/*/config.yaml; do echo "== $f"; grep -nE '^\s*(-\s*)?(languageId|enabled|fallbackType|fallbacks):' "$f"; done
q "SELECT CType, COUNT(*) FROM tt_content WHERE deleted=0 GROUP BY CType"
q "SELECT list_type, COUNT(*) FROM tt_content WHERE deleted=0 AND list_type <> '' GROUP BY list_type"
q "SELECT sys_language_uid, COUNT(*), SUM(l10n_parent > 0) FROM tx_news_domain_model_news
   WHERE deleted=0 AND hidden=0 AND t3ver_wsid=0 GROUP BY sys_language_uid"
```

A missing table or package prints its error into the artifact; that is an answer, not a failure.
The node's evidence carries one table for the pack, so a reviewer reads it at a glance:

```markdown
## TYPO3 14 fix pack
Probe: nodes/rung-14/fix-pack-probe.txt (sha256:…) · after the fixes: nodes/rung-14/fix-pack-probe-after.txt (sha256:…)

| # | Detected | Applied | Proof | Approval |
|---|---|---|---|---|
| 1 | legacy rule in public/.htaccess, stale public/typo3/index.php | commit 1a2b3c4 | login form at /typo3/ | handover: shared .htaccess |
| 2 | not present | — | probe | — |
| 5 | concatenateJs in the site package | commit 5d6e7f8 | DOM diff limited to the bundle tags | APR-004 |
```

The items are the known content of the rung's one cause, the 14.3 move, not new causes: commit each
item on its own so one can be reverted alone. The `*-recovery` change budget does not apply to the
rung; a fix that grows past the item's description is a finding for `rung14-recovery`.

## 1. Legacy backend rewrite in .htaccess

- **Symptom.** A fresh 14.3 checkout or a Deployer release cannot reach the backend: `/typo3/`
  answers 404, or 500 from a rewrite loop. DDEV looks fine, because a stale, git-ignored
  `public/typo3/index.php` from an earlier Composer install still answers.
- **Cause.** 13.0 deprecated the entry script `typo3/index.php` (#87889), and 14.0 removed it
  (Breaking-105377). The v12/v13 rule still rewrites `/typo3/*` to it.
- **Detect.** Probe item 1. 14.3 creates nothing below `public/typo3/`; anything there is stale
  (`git check-ignore -v` shows why `git status` hides it). Under nginx the same target sits in the
  `try_files` of `location /typo3/`.
- **Fix.** Replace the block with the one of the 14.3 template
  (`vendor/typo3/cms-install/Resources/Private/FolderStructureTemplateFiles/root-htaccess`) and keep
  every project-specific rule:

  ```apache
  # If the file/symlink/directory does not exist but is below /typo3/, redirect to the main TYPO3 entry point.
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteRule ^typo3/(.*)$ %{ENV:CWD}index.php [QSA,L]
  ```

  Delete the stale `public/typo3/*.php` files and remove
  `extra.typo3/cms.install-deprecated-typo3-index-php` from `composer.json` if it is set.
- **Proof.** With the stale files gone, `curl -skL https://acme.ddev.site/typo3/ | grep -c
  'id="typo3-login-form"'` prints 1 and the backend journeys log in. A DDEV project on `nginx-fpm`
  never reads `.htaccess`: prove the rule on Apache (`apache-fpm`) or name it unproven in the handover.
- **Approval.** None locally. When the deploy recipe lists `public/.htaccess` in `shared_files`
  (Deployer 7's default, common in project recipes), a release does not ship the fixed file: the
  handover names the shared file on staging and live, and its update belongs to the first TYPO3 14
  deploy and that deploy's own authorization ([deployment handover](deployment-handover.md)).

## 2. INCLUDE_TYPOSCRIPT is dropped

- **Symptom.** After the 14.3 rung every page answers 500 "No page configured for type=0", or
  configuration silently stops applying. Nothing is logged.
- **Cause.** Breaking-105377: the tokenizer discards the line. Fractor converts the files its
  processor reads, skips `.txt` static templates and never sees database TypoScript.
- **Detect.** Probe item 2 and the readiness `includes` check with `--db-export`
  (`ts-include-typoscript`, `ts-import-loads-nothing`).
- **Fix.** `@import` at the same position; `git mv` the `.txt` files to `.typoscript`; database rows
  through a site-package upgrade wizard that changes only the exact pre-migration record. `DIR:`
  globs sort their matches, and a `condition=` becomes a TypoScript condition block
  ([details](known-problems.md#typoscript-silently-stops-loading-after-the-v14-rung-or-every-page-answers-500)).
- **Proof.** The `includes` check reports 0 errors, and every site root answers 200 on 14.3.
- **Approval.** None.

## 3. fluid_styled_content parseFunc is gone

- **Symptom.** After the 14.3 rung rich text shows its tags as text on nearly every content page.
  Nothing is logged.
- **Cause.** Breaking-107438 removed fluid_styled_content's parseFunc. A site override that extended
  it (`lib.parseFunc_RTE.allowTags := addToList(…)`) now defines it alone: a short allow list that
  escapes every other tag.
- **Detect.** Probe item 3 and the readiness `parsefunc` check (`parsefunc-allowtags`,
  `parsefunc-override`, `parsefunc-links-constant`).
- **Fix.** While 13.4 is installed (the 14.3 vendor no longer ships the file), copy
  `vendor/typo3/cms-fluid-styled-content/Configuration/TypoScript/Helper/ParseFunc.typoscript`
  verbatim into the site package, inline its two constants (`styles.content.links.keep`,
  `styles.content.links.extTarget`) with their 13.4 values, and `@import` it first, where
  fluid_styled_content's `setup.typoscript` imported it. The copy changes nothing on 13.4, so
  `manual-migration` can take it.
- **Proof.** The first 14.3 capture shows the RTE pages' DOM equal to Baseline A, with no escaped
  markup (`&lt;p&gt;`) that Baseline A lacks.
- **Approval.** None.

## 4. Relative typo3temp links

- **Symptom.** After the 14.3 rung the powermail captcha image is broken on `/contact/` but not on
  `/contact`. A captcha declared as a randomized region fails the self-test with `image-not-loaded`.
- **Cause.** Breaking-108114: 14.0 no longer prefixes relative resource links, so
  `src="typo3temp/…"` resolves against the page path and loads the soft-404 page.
- **Detect.** Probe item 4; after the first 14.3 capture, the readiness `relative-links` check with
  `--dom-dir` and `--baseline-dom-dir` (`relative-asset-dom`).
- **Fix.** Emit an absolute path where the URL is built. For the captcha: override
  `Partials/Form/Field/Captcha.html` through `plugin.tx_powermail.view.partialRootPaths` so that the
  rendered `src="typo3temp/…"` becomes `src="/typo3temp/…"` (for example with `f:replace` on the
  ViewHelper output). The lasting fix belongs in the ViewHelper of a maintained fork.
- **Proof.** `curl -sk https://acme.ddev.site/contact/ | grep -oiE 'src="[^"]*captcha[^"]*"'` starts
  with `/typo3temp/`, that URL answers `image/png`, and `relative-links` reports 0 errors.
- **Approval.** None to restore the 13.4 URL form. Fixing a link that was already relative in
  Baseline A is a visible change and needs a declared change.

## 5. Core compress and concatenate keys

- **Symptom.** On 13.4, right after Fractor's TYPO3 14 set, every page's `<head>` changes: merged
  CSS/JS bundles split into their source files, although 13.4 still honours the keys.
- **Cause.** Breaking-108055 removed `config.compressCss`, `config.concatenateCss`,
  `config.compressJs` and `config.concatenateJs` in 14.0. Fractor removes them as soon as its TYPO3
  14 set runs, which on the 13.4 rung is too early.
- **Detect.** Probe item 5, and the Fractor dry-run diff of `mechanical-migration` (hunks removing
  those keys).
- **Fix.** Keep the keys through the 13.4 rung: revert that hunk (or skip that rule) in
  `mechanical-migration`, so the 13.4 loop stays comparable with Baseline A. Remove them in
  `rung-14`, where they do nothing any more. A later Vite bundle in `vite-assets` is its own change.
- **Proof.** The 13.4 loop shows an unchanged `<head>`; on 14.3 the DOM difference is limited to the
  former bundle tags, now the same files individually in their include order.
- **Approval.** Yes: the split bundle is one declared-change class
  ([rule 30.8](../rules/30-finding-classification.md#308-declared-changes-are-rules-not-edits)).

## 6. CKEditor 47 list-item ids

- **Symptom.** On 14.3 every backend save of a rich-text list stores `data-list-item-id="…"` on each
  `<li>`; the RTE round trip shows every list record changed.
- **Cause.** CKEditor 47 (TYPO3 14.3) adds the id in `getData()`, and an `HTMLparser_db` tag rule
  cannot remove it inside lists.
- **Detect.** Probe item 6: rich text with lists, stored ids (0 before the rung), the site presets
  and the preset name in use. Other rich-text tables (news bodies) count as well.
- **Fix.** A site preset that imports `EXT:rte_ckeditor/Configuration/RTE/Default.yaml` and sets
  `processing.exitHTMLparser_db` to `keepNonMatchedTags: true` with
  `tags.li.fixAttrib.data-list-item-id.unset: true`, registered in the site package's
  `ext_localconf.php` as `$GLOBALS['TYPO3_CONF_VARS']['RTE']['Presets']['default']` (or under the
  preset name in use; a site with its own preset adds the block there). The complete YAML is in
  [known problems](known-problems.md#stored-rich-text-gains-data-list-item-id-on-every-list-item).
- **Proof.** The [RTE round trip](measurement-recipes.md#rte-round-trip-proof): save, reopen, save;
  0 stored ids, and the second save changes nothing.
- **Approval.** None.

## 7. Backend modules refused to admins

- **Symptom.** After the 14.3 rung an extension module (seen: a monitoring client) is gone for
  everyone, admins included; only a full admin module sweep notices.
- **Cause.** It registers `'access' => 'user,group'`, a TYPO3 11 value. 14.3 decides through access
  gates (`admin`, `user`, `systemMaintainer`) and refuses an unknown value to everyone.
- **Detect.** Probe item 7; then, at the first 14.3 smoke run, a module sweep as admin **and** as a
  non-admin editor. A module defect found in the final proof costs a closure epoch
  ([epoch order](closure-currentness.md#epoch-order-what-makes-a-new-epoch-stale)).
- **Fix.** A site-package `BeforeModuleCreationEvent` listener that sets `access` to `user` for
  exactly that module when it reads `user,group`: admins always, editors through a group grant, the
  12.4 result. The [listener](known-problems.md#a-backend-module-is-gone-for-admins-or-fails-on-a-protected-method)
  also covers a controller that calls a method the v14 API made protected.
- **Proof.** The admin opens the module; an editor only through a group grant; the sweep covers
  every module with zero new log lines.
- **Approval.** None: the listener restores the pre-upgrade access result.

## 8. Renamed modules and editor rights

- **Symptom.** After the 14.3 wizards editors lose the Info module, or hold Redirects rights and find
  no Redirects entry in the menu. The frontend shows nothing.
- **Cause.** The 14.3 wizard `userPermissionsForRenamedModulesMigration` renames `web_info` →
  `content_status` and `site_redirects` → `redirects` (adding `link_management`). `content_status`
  appears only with a granted sub-module, and the wizard grants neither `web_info_overview` nor
  `web_info_translations`. A `redirects` grant added later without its parent `link_management`
  stays out of the menu.
- **Detect.** At intake, note the groups that hold `web_info` or `site_redirects` (probe item 8).
  After the wizards:

  ```bash
  ddev mysql -e "SELECT uid, title FROM be_groups WHERE deleted = 0
      AND FIND_IN_SET('content_status', groupMods)
      AND NOT FIND_IN_SET('web_info_overview', groupMods)
      AND NOT FIND_IN_SET('web_info_translations', groupMods);
    SELECT uid, title FROM be_groups WHERE deleted = 0
      AND FIND_IN_SET('redirects', groupMods) AND NOT FIND_IN_SET('link_management', groupMods);"
  ```

  Check `be_users.userMods` the same way.
- **Fix.** After the owner's approval, add exactly the missing identifiers, additively and
  idempotently, one statement per identifier and group:

  ```sql
  UPDATE be_groups SET groupMods = CONCAT_WS(',', NULLIF(groupMods, ''), 'web_info_overview')
   WHERE uid = <group> AND NOT FIND_IN_SET('web_info_overview', COALESCE(groupMods, ''));
  ```

- **Proof.** As a non-admin of each affected group: the Info module offers Overview and
  Translations, and Link Management offers Redirects ([Redirects](known-problems.md#editors-with-redirects-rights-see-no-redirects-module));
  `scripts/backend-permissions-audit.mjs` reports no lost module.
- **Approval.** Yes: restoring a right changes what editors may do. Ask at intake whether the run
  may restore exactly the modules the wizards drop.

## 9. Dev-server render before Baseline A

- **Symptom.** Baseline A screenshots are unstyled: the pages load `/@vite/client` and their entry
  points from a Vite dev server that is not running. A sealed baseline cannot be repaired, so the
  whole run is lost.
- **Cause.** `vite_asset_collector`'s `useDevServer = auto` follows the Development context, and
  DDEV clones of this fleet run `Development/*` because their base variants depend on it
  ([fleet profile](fleet-profile.md#environment)).
- **Detect.** Probe item 9 before the self-test: the curl prints 0 on the homepage and on one URL per
  template cluster; the production build output and its manifest exist.
- **Fix.** Build the production assets as the deploy recipe does, from the same commit, and force
  manifest mode for DDEV only: `useDevServer => '0'` with the complete key set
  ([manifest mode](../../typo3-vite/references/vite-configuration.md#manifest-mode-no-dev-server)),
  then flush the caches. Record it in the intake evidence as an environment decision, like the
  application context; it is not a site change.
- **Proof.** The seeded diagnostic capture shows styled pages and no dev-server client before the
  exhaustive double capture starts. Before `seal-baseline`,
  `grep -rlE '/@vite/client|:5173/' .typo3-update/baseline/A-original/dom | wc -l` prints 0. A hit
  leaves the baseline unsealed: the node returns `harness-error`, `harness-recovery` settles the render
  environment with an ADR, and the baseline is captured again.
- **Approval.** None.

## 10. Vite 5 to 8 rewrites the CSS

- **Symptom.** After Vite 5 → 8 in `vite-assets`, Sass imports from `node_modules/…` fail, or the
  CSS differs: Lightning CSS (Vite 8's default CSS minifier) rewrites values, and a comma-list
  transition such as `transition: all, ease, .25s` collapses to `transition: all`. Screenshots never
  show that one, because captures switch transitions off; only a CSS comparison does.
- **Cause.** Vite 8 bundles with Rolldown, minifies CSS with Lightning CSS against a newer default
  target and accepts only Sass's modern API.
- **Detect.** Probe item 10: the versions of `vite`, `vite-plugin-typo3`, `sass` and
  `praetorius/vite-asset-collector`, and the config file name.
- **Fix.** The [Vite 8 configuration](known-problems.md#vite-8-fails-on-sass-imports-or-rewrites-the-css):
  `build.cssMinify: 'esbuild'` with `esbuild` as a devDependency, Vite 5's browser targets in
  `build.cssTarget`, Sass `loadPaths` at the project root for `node_modules/…` imports
  (`['.']` when Vite runs there) and `esbuild.legalComments: 'inline'`. Rename `vite.config.js` to
  `vite.config.mjs` to end the ESM config warning. `vite-plugin-typo3` 3 writes manifest keys with
  the package's vendor path and `vite_asset_collector` 1.18 looks those up first: update both together.
- **Proof.** Both bundles parsed into (at-rule, selector, property, value) tuples compare equal;
  `scripts/vite-production-check.mjs` exits 0; the node's invariance loop is green.
- **Approval.** Yes: the renamed hashed asset files are a declared change. A CSS value the tuple
  comparison finds changed is a defect to restore, not a class to declare.

## 11. Composer aborts at the 14 rung

- **Symptom.** The first `ddev composer update` of `rung-14` aborts right after
  `typo3/class-alias-loader` updated itself; afterwards CLI calls may die in
  `vendor/typo3/alias-loader-include.php`.
- **Cause.** TYPO3 14 requires class-alias-loader 2. Composer replaces the plugin it is running
  with, and the generated include on disk still comes from version 1.
- **Detect.** The update's exit code and last lines; probe items 11–13 show class-alias-loader 1
  before the rung.
- **Fix.** Do not change constraints or repeat the update: `ddev composer install` completes from the
  lock just written, then `ddev composer dump-autoload`
  ([stale include](known-problems.md#every-cli-command-dies-in-alias-loader-includephp)). Never
  `--no-plugins` ([extension registry](known-problems.md#fractor-cannot-find-the-generated-extension-registry)).
- **Proof.** `ddev composer install` exits 0, `ddev typo3 --version` reports 14.3.x, and
  `ddev composer show typo3/cms-core` matches the lock.
- **Approval.** None.

## 12. powermail 12 to 13 with Bootstrap 3 forms

- **Symptom.** After powermail 13 (on the fleet: with the 13.4 rung) `Basic.css` disappears or the
  form page changes: grid classes gone, labels, selects and buttons restyled, labels above instead of
  beside the fields. Pages without a form stay identical.
- **Cause.** Four powermail 13 changes: `BootstrapClassesAndLayout` is gone and `Basic.css` moved to
  `Powermail_Styling`, `styles.bootstrap.*` constants lose their reader, `Basic.css` styles the whole
  form, and field partials wrap the label ([details](known-problems.md#a-powermail-form-loses-its-styling-or-layout-after-the-134-rung)).
- **Detect.** Probe items 11–13 (powermail version, forms, Bootstrap constants); force-include one
  page per form in the rung's intermediate capture ([force-include](measurement-recipes.md#intermediate-loops-on-stateful-rungs)).
- **Fix.** Import the `Powermail_Styling` constants and setup before the site package's own
  includes; set every `plugin.tx_powermail.settings.styles.framework.*` key, including the 12.x
  defaults the site relied on; ship 12.6's `Basic.css` from the site package through
  `plugin.tx_powermail.settings.BasicCss`; override the partials of the field types in use with the
  label back in its 12.x place.
- **Proof.** The form pages equal Baseline A in DOM and pixels apart from the declared `Basic.css`
  URL, and one Mailpit submission passes.
- **Approval.** Yes: the new `Basic.css` URL is a declared change. Adopting powermail 13's form
  design is Contract B.

## 13. typo3-console 9 schema keywords

- **Symptom.** A schema step with `database:updateschema` fails with "Invalid schema update type"
  (seen: `'*.remove'`), and the rung waits for a diagnosis.
- **Cause.** typo3-console 9 knows only `field.add`, `field.change`, `field.prefix`, `field.drop`,
  `table.add`, `table.change`, `table.prefix` and `table.drop`, wildcards over them, and the groups
  `safe` and `destructive`. There is no `remove` type.
- **Detect.** Probe items 11–13 (installed console version). Use the command only where the project
  already requires `helhum/typo3-console` ([constraints](typo3-14-constraints.md#commands-that-are-core-and-one-that-is-not)).
- **Fix.** `'*.add,*.change'` for the safe pass; list the destructive candidates with
  `'field.prefix,field.drop,table.prefix,table.drop' --dry-run -v`; prefix and drop only exact,
  approved objects, never through a wildcard ([database integrity](database-integrity.md)).
- **Proof.** A dry run after the step lists nothing for the applied types, and the backend database
  analyzer agrees.
- **Approval.** Destructive objects: one by one ([rule 40](../rules/40-approval-matrix.md#401-the-matrix), rows 15 and 16).

## 14. Caches on NullBackend in DDEV

- **Symptom.** A cache journey (a save clears the page cache, cache tags) finds no cache entry at
  all, so its assertion can neither pass nor fail honestly.
- **Cause.** The project's DDEV `additional.php` sets every cache to `NullBackend`.
- **Detect.** Probe item 14.
- **Fix.** For the journey only, switch the `pages` cache to `FileBackend` with its options cleared,
  then restore `additional.php` byte-identically and commit nothing
  ([cache tags](measurement-recipes.md#proof-scripts-journeys-sweeps-and-row-diffs)):

  ```php
  $GLOBALS['TYPO3_CONF_VARS']['SYS']['caching']['cacheConfigurations']['pages']['backend'] = \TYPO3\CMS\Core\Cache\Backend\FileBackend::class;
  $GLOBALS['TYPO3_CONF_VARS']['SYS']['caching']['cacheConfigurations']['pages']['options'] = [];
  ```

- **Proof.** A positive control first (the page's cache entry exists after one request), then the
  journey's assertion; `shasum -a 256 config/system/additional.php` equals the value recorded before.
- **Approval.** None.

## 15. Extbase follows fallbackType (14.3.6)

- **Symptom.** After `rung-14`, or a patch update from 14.3.0–14.3.5, a translated language
  changes without a log line: detail URLs of untranslated news answer 404 where Baseline A rendered
  the default-language text, translated news lose category labels, tags and related news, a
  powermail form is missing, a selected-news list is shorter. Lists of the same plugin keep their
  counts.
- **Cause.** Important-88886, released with 14.3.6: Extbase takes the overlay type from the site
  language. On `strict`, and on a language without `fallbackType`, identity lookups, relations and
  queries without the language restriction return only records that exist in that language
  ([v14 reference](../../typo3-v14-reference/references/13-v14-only-changes-manual-not-handled-by-rector.md#extbase-follows-fallbacktype-v1436)).
- **Detect.** At intake, probe item 15. The item applies when a non-default language is `strict`
  or has no `fallbackType`, and an Extbase plugin with translatable records sits in `tt_content`:
  EXT:news, blog, powermail, tt_address or the site package's own `list_type`/CType plugins. Then,
  before Baseline A is sealed, add to the golden paths (`discover-urls --golden-file`): every
  translated list page of those plugins, with its pagination pages, and per language a sample of
  detail URLs of translated **and** untranslated records (the language menu of a default-language
  detail page names them). At `rung-14` the readiness check `extbase-language` reports the same.
- **Fix.** None by default. At intake the owner chooses, for today's content and for future
  content (an untranslated new record never appears on that language):
  1. translate the records, with their categories, tags and related records;
  2. a site-package listener that restores the 13.4 result for identity lookups and relations of
     the named extensions, lists unchanged (the
     [listener](../../typo3-v14-reference/references/13-v14-only-changes-manual-not-handled-by-rector.md#extbase-follows-fallbacktype-v1436));
  3. `fallbackType: fallback` for that language, which makes page content fall back as well.

  Apply none of them without the approval, and never change `fallbackType` silently.
- **Proof.** Required whenever the item applies: the `extbase-records-per-language` journey
  ([feature contracts](fleet-regression-contracts.md#routes-and-persisted-content--http-dom-redirects-schema)).
  Per translated list URL the item count, and the category and tag labels per item, from Baseline
  A's sealed DOM and from the target capture ([recipe](measurement-recipes.md#count-list-records-per-language));
  the HTTP status of every detail URL from both HTTP records. Equal counts and statuses pass. A
  difference is a finding until the owner decides: with the listener the counts equal Baseline A;
  translations or `fallback` make it a declared change shown before and after. A URL that Baseline A
  lacks is a coverage gap: name it, and explain the target from the visible records per language.
- **Approval.** Yes, for each option. A `fallbackType` change is a declared change with before/after
  evidence of every affected page, content fallback included, and the approval names the
  consequence for future content.
