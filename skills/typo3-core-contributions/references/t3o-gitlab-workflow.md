# git.typo3.org — GitLab workflow for t3o sites

**When to load:** any work against `git.typo3.org` that is not reading Core CI
logs — t3o site repositories, merge requests, issues, work items, labels,
pipelines. Core patches go to Gerrit instead; see `gerrit-workflow.md`.

## typo3.org has three systems — pick the right one first

| Host | System | Used for |
|---|---|---|
| `review.typo3.org` | Gerrit | TYPO3 **Core** patches |
| `forge.typo3.org` | Redmine | TYPO3 **Core** issues |
| `git.typo3.org` | GitLab (19.x EE) | t3o **site** repositories, and read-only Core CI logs |

Getting this wrong is the first failure mode. `git.typo3.org/typo3/CI/cms/-/jobs/<id>`
is a Core CI log and belongs to the Gerrit workflow. `git.typo3.org/services/t3o-sites/**`
is ordinary GitLab work with branches, merge requests and issues — Gerrit is not
involved and `refs/for/main` means nothing there.

Known t3o site groups:

- `services/t3o-sites/extensions.typo3.org/ter` — the TER site (TYPO3 v13, DDEV)
- `services/t3o-sites/extensions.typo3.org/anubis` — the bot wall in front of it
- `services/t3o-sites/common/t3olayout` — the shared layout package for **all** t3o sites
- `services/t3o-sites/common/t3o-basic-pipeline-jobs` — the shared CI template

A change in `t3olayout` lands on every t3o site. Treat it as a shared library,
not as the site you happen to be looking at.

## Authentication

A personal access token belongs in `~/.secrets/git.typo3.org` (`glpat-…`).

```bash
curl -sS -H "PRIVATE-TOKEN: $(cat ~/.secrets/git.typo3.org)" \
  "https://git.typo3.org/api/v4/user"
```

Do not reach for `glab`: `GITLAB_HOST` is commonly exported for a different
instance, and `--hostname` only works on `glab api`. The REST API with an
explicit header is unambiguous.

`${CLAUDE_SKILL_DIR}/scripts/t3o-gitlab.py` wraps the calls below — start there
rather than hand-rolling curl.

## Check your access level before planning anything

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/t3o-gitlab.py" access services/t3o-sites/extensions.typo3.org/ter
```

`permissions.project_access.access_level` decides which plan is even possible:

| Level | You can | You cannot |
|---|---|---|
| none (`null`) | read, **create issues**, edit **your own** issue descriptions | push, set labels, link across projects |
| 20 Reporter | + set labels, link issues | push |
| 30 Developer | + push branches, open MRs, set labels | merge (see below) |

Three traps, all verified the hard way:

**Labels fail silently without Reporter.** `PUT /issues/:iid` with `labels`
returns **HTTP 200** and simply does not apply them. Always read the returned
object back and confirm the field, never trust the status code.

**Cross-project issue links need Guest in both projects.** Otherwise
`POST /issues/:iid/links` returns 403 *"You must have at least the Guest role in
both projects."* Fall back to a textual reference.

**Forking may be disabled.** `POST /projects/:id/fork` can answer
*"Limit reached — You cannot create projects in your personal namespace."*
When that happens the fork-and-MR path does not exist. File an issue containing
a ready-to-apply diff instead, and say in it that you cannot open an MR.

## Contribution rules for t3o sites

`CONTRIBUTING.md` in these repos points at the
[t3o team workflow](https://docs.typo3.org/m/typo3/team-t3oteam/main/en-us/Workflow/Index.html).
The binding rules:

- **Target `develop`, never `main`.** Maintainers merge `develop` into `main` for releases.
- **Draft while work is in progress.** Remove the `Draft:` prefix only when it is ready for maintainer review.
- **You cannot merge your own merge request.** A maintainer reviews and merges. This is not a formality — do not `merge` even with Developer rights.
- **Branch naming** is documented as `feature/<issue-number>-<description>` and `hotfix/<description>`. Repo practice also uses `task/` and `bugfix/` prefixes; keep the issue number either way.
- **The MR description must state the changes *and the testing done*.** An MR without a testing section is incomplete by their rules.
- **Commit subjects use the Core prefixes** — `[BUGFIX]`, `[TASK]`, `[FEATURE]` — so `validate-commit-message.py` still applies, minus the Gerrit-only `Change-Id`. Use `Relates: #<iid>` for the site issue.

### Stacking a merge request on another one

When a change depends on one still in review, branch off that branch and target
it rather than `develop`, so the diff shows only your own work:

```bash
git -C .bare fetch origin bugfix/first:refs/remotes/origin/bugfix/first
git -C .bare worktree add ../bugfix-second -b bugfix/second origin/bugfix/first
# then create the MR with target_branch = bugfix/first
```

Two things follow, both observed on `ter` in one session:

- **GitLab retargets the stacked MR when the base MR merges — under conditions.**
  `!900` moved from `bugfix/emconf-extraction` to `develop` by itself and was
  rebased onto the new base. This is GitLab's stacked-MR handling,
  not a general rule for dependent MRs: it applies when the base MR targets the
  project's **default branch**, which for these repos is `develop` — confirm it
  rather than assume (`t3o-gitlab.py access <project>` prints it). Deleting a
  source branch by hand does not trigger it. So check the stacked MR's target and
  diff once the base lands instead of taking the retarget for granted, and expect
  the dependency note in its description to be stale afterwards.
- **Amending the base means rebasing the stack yourself.** A plain
  `git rebase <base-branch>` replays the *old* base commit too and conflicts with
  itself. Use `git rebase --onto <base-branch> <old-base-sha> <your-branch>` so
  only your own commits are replayed.

Say in the stacked MR's description which one has to land first; a reviewer
otherwise reads a diff that assumes code they cannot see.

### Issue templates are not optional furniture

`.gitlab/issue_templates/{Bugreport,Feature,Task}.md` exist in `ter` and
`t3olayout`. **Read them before opening the first issue**, not after the tenth.
Every template requires an **Acceptance Criteria** checklist; the Bugreport one
also wants Summary, Steps to reproduce, an Example URL, current vs expected
behaviour, and logs.

Their trailing `/label ~ter` quick action refers to a label that does not exist
in `ter` — the real area labels are `TER Website`, `TER Extensions` and
`extensions.typo3.org`. Set labels explicitly rather than relying on the
template.

House label taxonomy: `Type::Bug` / `Type::Feature` / `Type::Task`,
`Skill:: Backend|Frontend|Ops|Design|Solr|Content`, `Process: To discuss`,
`Process:: Review`, plus area labels. When the cause of a finding is not
established, `Process: To discuss` is more honest than `Type::Bug`.

## Issue and work item mechanics

**Cross-project references need the full path.** `t3olayout#678` renders as
plain text; `services/t3o-sites/common/t3olayout#678` renders as a link.

**Extended references carry title and status.** Append `+` for the title, `+s`
for title *and* state:

```
!883+s                                        → Draft: [BUGFIX] … • Open
services/t3o-sites/common/t3olayout#678+s     → Main navigation carries … • Open
```

Only **bare** references expand. A markdown link `[#678](https://…)` stays a
plain link, so prefer bare references in index tables. The expansion happens in
the browser; `POST /api/v4/markdown` returns the pre-expansion HTML, so verify
by checking that `data-original` kept the `+s` and that the reference resolved
to an id — not by looking for the title in the rendered text.

**Sub-issues under an Issue are refused.** `workItemUpdate` with
`hierarchyWidget.childrenIds` answers *"it's not allowed to add this type of
parent item"* for Issue → Issue. Allowed is Epic → Issue and Issue → Task, and
`WorkItemUpdateInput` does **not** accept `workItemTypeId`, so an existing Issue
cannot be converted to a Task through the API either. Use `relates_to` links and
an index comment instead.

**URLs.** Issues resolve under both `/-/issues/<iid>` and `/-/work_items/<iid>`;
the API returns the work-item form.

## CI: check whether it runs at all

Ask the project, do not assume. `ter` used to have `builds_access_level:
disabled`, and this page used to state that no pipeline runs for anyone. That
is no longer true: as of 2026-08 the level is `private` and every merge request
gets a pipeline of eight jobs (`test:php`, `test:typoscript`, `test:phpstan`,
`test:rector`, `test:unit`, `build`, `layout`, `Create Badge`). Where builds
*are* disabled, a `head_pipeline` of `null` on your MR is not your fault and
`GET /projects/:id/pipelines` may answer 403. **Check the current value before
promising that CI will catch anything** — `t3o-gitlab.py access <project>`
prints it — and reproduce the gates locally when it is off.

A red pipeline is not automatically your change. Both retried MRs in one 2026-08
session failed on `The "https://api.github.com/repos/…/zipball/…" file could not
be downloaded (HTTP/2 504)` during `composer install` — a GitHub outage, not the
diff. Read the job log before touching the branch; `POST /projects/:id/jobs/:job_id/retry`
re-runs a single job.

The shared template `services/t3o-sites/common/t3o-basic-pipeline-jobs@v13`
defines `test:typoscript` and `test:php`; the site repo adds its own jobs.

### Reproducing the gates locally (ter)

```bash
composer install --ignore-platform-reqs --no-scripts

composer test:rector      # rector process -n
composer test:phpstan     # phpstan analyse -c phpstan.neon
composer test:unit        # phpunit -c .gitlab-ci/Tests/phpunit.xml
PHP_CS_FIXER_IGNORE_ENV=1 vendor/bin/php-cs-fixer fix --dry-run -n \
  --config=.php-cs-fixer.dist.php <changed files>
```

`test:unit` needs `TYPO3_PATH_WEB="$PWD/public"` and an existing
`public/fileadmin/currentcoredata.json`.

**The checkout's `vendor/` is not what `composer.lock` says.** A clone that has
not been reinstalled for a while can sit whole majors behind the lock file, and
nothing warns you. Before naming the version something ran on — in a merge
request, an issue, or a screenshot caption — read the *installed* version, never
the lock:

```bash
jq -r '.packages[] | select(.name=="typo3fluid/fluid") | .version' vendor/composer/installed.json
jq -r '.packages[] | select(.name=="typo3fluid/fluid") | .version' composer.lock
```

(Burned 2026-08: renders published as "typo3fluid/fluid 4.6.1" had actually run
on 2.15.0 — the lock said 4.6.1, the tree held Fluid 2 from a months-old
install, and the wrong version was baked into a screenshot in a merge request.)

To render or test on the *locked* stack without reinstalling the site, build a
scratch project beside it — for Fluid work that is enough, and it takes a
minute:

```bash
# --no-plugins is required: typo3/cms-fluid pulls typo3/cms-composer-installers,
# and composer refuses to run an unlisted plugin in a fresh project
composer require typo3fluid/fluid:4.6.1 typo3/cms-fluid:v13.4.34 \
  --no-interaction --ignore-platform-reqs --no-plugins
```

Standalone Fluid resolves neither `f:format.date` (it lives in `typo3/cms-fluid`)
nor Extbase-only helpers such as `f:link.action`; stub the latter identically on
both sides of a comparison, and set `$GLOBALS['EXEC_TIME']` to a fixed timestamp
so `f:format.date(date: 'now')` is reproducible. In Fluid 4 `$view->render($name)`
resolves `$name` as a controller action — use
`getTemplatePaths()->setTemplatePathAndFilename()` to render one file.

TypoScript lint is **not** in `require-dev`; the CI job installs it globally:

```bash
composer require helmich/typo3-typoscript-lint     # in a scratch dir
typoscript-lint -c typoscript-lint.yml --fail-on-warnings
```

Run these with the **repository's own dependencies**. Borrowing a binary from
another checkout's `vendor/` gives a different tool version and a false pass:
in one session `php-cs-fixer` from a foreign vendor reported clean while the
repo's own `rector` and `phpstan` each found a real defect in the same file.

### Rector says constructor injection — verify before obeying

`GeneralUtilityMakeInstanceToConstructorPropertyRector` will rewrite
`GeneralUtility::makeInstance()` inside a ViewHelper into constructor injection.
That is correct **only** because `typo3/cms-fluid`'s `Configuration/Services.php`
tags every `ViewHelperInterface` implementation as `fluid.viewhelper` and a
compiler pass sets those definitions public and non-shared, and because the
extension's `Services.yaml` registers `Classes/*` with `autoconfigure: true`.
Check both before accepting the rewrite — without the container registration,
`ViewHelperResolver` falls back to `new $class()` and a required constructor
argument is a fatal error. Rector's output is also mechanical: it leaves
`$x = $this->x;` aliases and misplaced blank lines worth cleaning up by hand.

## A failed `ter:publish` usually left half of itself behind

TER answers a failing publish with `HTTP 500`, and `tailor` reports it as
`Could not publish version … Reason: …`. That does not mean nothing happened:
`VersionService::upload()` writes the author record, the version record, its
relations and finally the extension row through separate repositories, so an
abort in between stores the version while the extension still advertises the
previous one. The author then cannot retry either — the version number counts as
taken and both the API and the upload form answer that it already exists.

Read the two endpoints against each other before believing the error. They are
public and need no token:

```bash
curl -s "https://extensions.typo3.org/api/v1/extension/<key>/<version>" | jq '.[0]'
curl -s "https://extensions.typo3.org/api/v1/extension/<key>" | jq '.[0].current_version.number'
```

- the **version** endpoint answering with a full record while `current_version`
  still names the older version is the signature of the partial write
- `upload_date` is a Unix timestamp; falling inside the failing job's own window
  places the write in that window — correlation, not identity. Confirm it with
  the version number and, where you can get one, the server-side log entry
- `review_state: -1` marks a version the Security Team flagged as insecure. The
  pointer does not move to such a version — it simply never moved, and the
  version it still names was flagged afterwards, which is what makes a failed
  security release the damaging case: the fix is stored and invisible while the
  vulnerable predecessor stays on display
- an empty `download.zip` follows from that flag, not from a broken upload

What the error text hints at: TER wraps every handled exception into
`{"status", "code", "message"}`, and `tailor` prints the message and the code
when they are there. A reason of `Unknown` with no code is therefore consistent
with a response that never came from `ResponseFactory` — but it is only a hint,
because `tailor` also falls back to `Unknown` for any body it cannot decode.
Read the body itself before concluding: every command takes `-r, --raw` and then
prints the response verbatim, failures included. `RouteHandler` caught
`\Exception` rather than `\Throwable` until 2026-08-31, so a PHP `\Error` passed
the handler by, reached the client as a bare 500 **and** left the
`TER.API.REST` log empty. The fix is on `develop`; on a deployment that
predates it, an `Unknown` reason may well mean that no server-side trace exists
at all.

Before reporting such a failure as a `tailor` bug, check that it is not one:
compare against another extension published in the same window
(`current_version.upload_date` on any actively released key), and remember that
a fix merged into `develop` is not yet running — `main` is what serves the site.

## extensions.typo3.org sits behind Anubis — every live probe is suspect

Anubis is a bot wall in front of `extensions.typo3.org`. Its `policy.yaml`
weighs any user agent matching `Mozilla|Opera` into `CHALLENGE`, and
`status_codes.CHALLENGE: 200` serves the challenge as a **successful response**:

- HTTP **200**, `content-type: text/html`, about **7537 bytes**
- `<title>Making sure you're not a bot!</title>`
- carries its own `<meta name="robots" content="noindex,nofollow">`
- `Set-Cookie: techaro.lol-anubis-auth-*`, body markers `anubis`, `techaro`, `within.website`

So `curl -A 'Mozilla/…' https://extensions.typo3.org/` will report that the page
is `noindex` — and that is the wall, not the site. Static asset paths are
challenged too, which is why Lighthouse logs
`Refused to execute script … MIME type ('text/html')` for perfectly healthy JS.

**Fingerprint every response before reasoning about it**: status, content type,
byte size, `<title>`, and a grep for the markers. Two unrelated URLs answering
with the identical byte size is the tell. A plain `curl` user agent passes
through to the origin, as does `Chrome-Lighthouse`.

```bash
python3 "${CLAUDE_SKILL_DIR}/scripts/t3o-gitlab.py" probe https://extensions.typo3.org/
```

Do not conclude that a crawler is blocked because a `Googlebot` user agent gets
challenged from your machine: `(data)/crawlers/_allow-good.yaml` verifies
crawlers by address, not by user agent string.

### The extension download endpoint is challenged too, and it lies quietly

`/extension/download/<key>/<version>/zip` behaves the same way, which matters more
than on an HTML page because the caller expects a file:

```
Chrome UA    200   7490 bytes   text/html          <- the wall
Firefox UA   200   7489 bytes   text/html          <- the wall
curl/8.5.0   200   3482990      x-application/octet-stream   <- the archive
```

Two details make it hard to notice. The challenge response carries **no
`Content-Disposition`**, while the real one sends
`attachment; filename=powermail_10.9.3.zip` — so a client that saves by URL path
writes a 7.5 KB HTML file named `zip`. And the status is 200 either way, so
`curl -f` does not trip.

An interactive browser solves the challenge and gets the archive, so this bites
scripts, `wget`, download managers and CI, not people. Such a script has to
reject the challenge **before** it hands the bytes to an archive tool, not after
extraction fails:

```bash
curl -sSL -o ext.zip -D headers.txt "$URL"
grep -qi '^content-type: *application/\|^content-type: *x-application/' headers.txt \
  || { echo "not an archive - bot wall or error page"; exit 1; }
unzip -t ext.zip >/dev/null || { echo "archive did not verify"; exit 1; }
```

`unzip -t` is the deterministic check; content type, byte size and the first
bytes are diagnostics that tell you *which* failure it was.

### Driving a real browser against the site

A headless browser sends a `Mozilla/…` user agent and therefore meets the wall,
which in Chromium renders as a 2.2 KB page titled **"Oh noes!"** rather than the
challenge page `curl` sees. Override the user agent at context level — the page
and every asset it pulls then go straight to the origin:

```python
ctx = browser.new_context(user_agent="curl/8.5.0")  # default Chrome UA hits the wall
page = ctx.new_page()
r = page.goto("https://extensions.typo3.org/extension/news", wait_until="networkidle")
print(r.status, page.title(), len(page.content()))  # 200, "TYPO3 Extension …", ~269 KB
```

Fingerprint the same way as with `curl` — status, `<title>`, byte size — before
reasoning about anything you measured in the page. Two runs answering with the
identical byte size mean you photographed the same thing twice, usually because
a selector matched the wrong element.

## Screenshots and attachments

Evidence belongs in the ticket, not in a sentence claiming the evidence exists.
Upload first, then embed the returned markdown:

```bash
curl -sS -H "PRIVATE-TOKEN: $(cat ~/.secrets/git.typo3.org)" \
  --form "file=@shot.png" \
  "https://git.typo3.org/api/v4/projects/<id>/uploads" | jq -r '.markdown'
# ![shot](/uploads/<hash>/shot.png)
```

The relative `/uploads/<hash>/<file>` is what belongs in the description; GitLab
rewrites it on render. The **public** URL is `/-/project/<id>/uploads/<hash>/<file>`
(anonymous, `200 image/png`); the namespace form
`/<group>/<project>/uploads/<hash>/<file>` answers 404, so testing that one
proves nothing. To confirm an embedded image really renders, push the
description through the markdown API and read `data-src` — `src` is a lazy
placeholder holding a base64 GIF:

```bash
curl -sS -X POST -H "PRIVATE-TOKEN: $T" -H "Content-Type: application/json" \
  --data @body.json "https://git.typo3.org/api/v4/markdown"   # {"text": …, "gfm": true, "project": "<full/path>"}
```

Uploads are project-scoped, so the same hash can be embedded in an issue and in
a merge request of that project.

## Reporting findings

One finding, one ticket. A long comment listing six problems gives none of them
a place to be discussed, rejected or closed. Make the comment an index that
links the tickets, and put each finding — with its evidence and acceptance
criteria — in its own issue. Search the existing tracker first: an open issue
for the same thing usually already exists.

When the fix belongs in a repository you cannot push to, the issue **is** the
deliverable: include the ready diff in a fenced block and say plainly that you
have no push access and that forking is refused.
