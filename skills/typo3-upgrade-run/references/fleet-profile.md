# Fleet profile — what is usually true of these projects

`known-problems.md` lists faults that are true of TYPO3 generally. This file is narrower: it is the
shape **this collection's own projects** keep turning out to have. A v12-era site built by one team
over a decade repeats itself, and the repetition is worth exploiting — most of the checks below take
seconds and each has cost hours at least once.

Read it at **P00**, before diagnosing anything. Confirm every item against the project in front of
you: this is a list of likely findings, not a description of any particular site. A pattern that
holds for four projects and not the fifth is still worth checking first — it is only harmful if it
is believed instead of verified.

No client names, hostnames, credentials or project identifiers belong in this file. Patterns, not
inventories.

## Environment

| Check | Why | Command |
|---|---|---|
| **Database engine version** | DDEV configs written years ago pin MariaDB 10.2, six years below the DBAL 4 floor. This is the single most common blocker, and it surfaces as an SQL *syntax* error after everything else has gone well. | `ddev describe` |
| **`TYPO3_CONTEXT` in `.ddev/config.yaml`** | Usually `Development/Docker`, and the site's `baseVariants` are frequently keyed to that exact string — so switching to `Production` makes the local site unresolvable rather than production-like. Check the site YAML before changing the context. | `grep TYPO3_CONTEXT .ddev/config.yaml` |
| **PHP version** | Often trails the target by two minors. Move it with the ladder, never ahead of the installed core. | `ddev describe` |

## Repository

| Check | Why |
|---|---|
| **A `sync-live-dev.sh`-style script** | These carry a **production database password in plaintext and are committed**. Grep the worktree *and* the history at P01, and put rotation in the handover — deleting the line does not undo the disclosure. The script is also the only sanctioned way to obtain a dump: the skill never connects to production itself, so the user runs it. |
| **Root package named `webconsulting/base`** | It is the project itself, not a dependency. `composer why <pkg>` naming it means "the root requires this", and a dev requirement needs `composer remove --dev`. |
| **`deployer.php` / `.hosts.yaml`** | Deployment is out of scope, but these files name the environments and paths the handover has to cover. |
| **Uncommitted `config/system/settings.php`** | Frequently dirty with local mail or extension settings. Preserve it; it is not yours. |

## Composer

| Check | Why |
|---|---|
| **Extensions installed but unused** | The most valuable check in the whole intake. Count records before planning any migration or fork: a site can require `in2code/powermail` with **zero** forms, fields and mails because its forms are Core `EXT:form`; carry `georgringer/news` with zero news records; and list `bootstrap-sass` while shipping hand-written CSS with no Bootstrap in it. Removing beats migrating, and it beats forking by a wide margin. |
| **`ichhabrecht/filefill`, `wapplersystems/core-upgrader`** | Dev-only helpers with no v14 release. Remove — see `extension-strategy.md`. |
| **Dev tooling pinned to old majors** | Rector v2 and Fractor v0.4 hold `nikic/php-parser` back and block the core resolve. Raise them first. |

## Frontend

| Check | Why |
|---|---|
| **No build pipeline at all** | Assets are commonly hand-written CSS and JS included through `page.includeCSS` / `includeJSFooter`, with `vite` in `package.json` but no config and no scripts. Loop 020 then has no subject — record that with evidence rather than introducing a build nothing needs. |
| **jQuery 1.5.1 and `cufon.js`** | 2011-era libraries still shipped to visitors, with published vulnerabilities. Not an invariance item: replacing them changes what visitors receive, so it is Contract B with its own approval — but it must reach the report, not be silently tolerated. |
| **A custom jQuery header rotator** | Fading headers driven by `setInterval` with no library class names, so carousel pinning does not match them. If the self-test shows differences confined to one image box, this is the first thing to look at. |
| **`config.doctype = xhtml_trans`** | Defeats `html-has-lang` site-wide and is itself a P08 migration item. |

## Content and structure

| Check | Why |
|---|---|
| **A shortcut root page** | Page uid 1 is often `doktype 4` pointing elsewhere, so `/` is a redirect. Both the redirect and its target belong in the sample. |
| **`EXT:indexed_search`, not Solr** | Site search is frequently Core indexed_search. Its index must be rebuilt after the upgrade by a scheduler task, or search silently returns nothing while the results page renders perfectly. |
| **A broken or missing XML sitemap** | `EXT:seo` installed but its static TypoScript never included in the root template, so `/sitemap.xml` 500s. Since the sitemap is the sampling source, check it at P00 and expect to baseline from the database instead. |
| **Single site, single language** | Common, and it makes several loops trivial — but verify from `config/sites/*/config.yaml` rather than assuming, because the multi-site case is the one that silently under-measures. |

## How to use this file

Work down it at P00 and write the answers into the intake, including the ones that came back
negative — "checked, not present" is information the next run needs. When a project shows a pattern
that is not listed here, add it, and when a listed pattern stops appearing, remove it. A profile that
is never edited is a profile nobody is checking against.
