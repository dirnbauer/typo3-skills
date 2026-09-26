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

The personal access token (`glpat-…`) reaches `t3o-gitlab.py` through
`GIT_TYPO3_ORG_TOKEN`. The script reads that variable **first** and falls back
to `~/.secrets/git.typo3.org` only when it is unset, so the file is a
convenience, never a requirement.

Prefer the variable wherever the token already lives in a secret store: export
it for the call instead of copying it to disk. A copy is a second place to
leak from, and it goes stale silently — the store gets the rotated token, the
file keeps the old one, and the script reads the file.

```bash
# pass through from wherever you keep it; nothing is written to disk
export GIT_TYPO3_ORG_TOKEN="$(your-secret-store read .../git.typo3.org)"
uv run scripts/t3o-gitlab.py access services/t3o-sites/common/t3olayout

# the same token against the raw API
curl -sS -H "PRIVATE-TOKEN: $GIT_TYPO3_ORG_TOKEN" \
  "https://git.typo3.org/api/v4/user"
```

Do not reach for `glab`: `GITLAB_HOST` is commonly exported for a different
instance, and `--hostname` only works on `glab api`. The REST API with an
explicit header is unambiguous.

A `401` with `Token is expired` means the personal access token has passed
its expiry date — it is not an OAuth token that a refresh could revive.
Before asking anyone to log in again, look in the secret store the team
keeps credentials in; a replacement is often already there. Install it in
both places at once:

```bash
export GIT_TYPO3_ORG_TOKEN="$(your-secret-store read .../git.typo3.org)"
# only if you also use glab, which has no environment path of its own:
printf '%s' "$GIT_TYPO3_ORG_TOKEN" | glab auth login --hostname git.typo3.org \
  --api-host git.typo3.org --api-protocol https --git-protocol ssh --stdin
```

Write the token to `~/.secrets/git.typo3.org` only if you have no store to
read it from; if you do, refresh the store and leave the disk alone.

The flags matter when someone does use `glab`: a host entry in
`~/.config/glab-cli/config.yml` that holds nothing but `token` is why the
interactive login asks for the API host and protocols again every time.
`--stdin` writes every field it is given and does not validate the token,
so prove it afterwards with the `curl` above.

`${CLAUDE_SKILL_DIR}/scripts/t3o-gitlab.py` wraps the calls below — start there
rather than hand-rolling curl.

It covers a merge request's whole life: `mr create`, `mr update` (title,
`--description-file`, `--label`, `--draft`/`--ready`) and `mr show` — which
prints state, draft, `detailed_merge_status`, the head pipeline and whether
threads are unresolved, i.e. the merge gate in one call — plus `pipeline
status` and `pipeline wait --merge-request <iid>`, which polls to a terminal
status and lists the failed jobs. Reach for those before a hand-rolled curl:
one session re-inlined `PRIVATE-TOKEN: $(cat ~/.secrets/…)` about sixty times
for exactly these operations, and one of its hand-written `sleep` watchers was
killed by the OOM killer mid-wait (2026-09-14).

Mind what it still does **not** wrap: closing or reopening an MR
(`state_event`), merging, and reading discussions. Whenever you do fall back to
curl, read the field back afterwards — the PUT answers `200` either way.

### Which transport answers what

Three access paths, and they fail in different directions:

- **Anonymous HTTPS REST** carries further than expected on these public
  projects: the merge-request list, a single merge request with its SHA,
  description, diff and `detailed_merge_status`, and the label list.
  `notes` and `discussions` answer `401` — review comments always need a token.
  **Pipeline status does not come out anonymously**, in three different
  disguises across the four calls below — `null`, `403`, and an empty `200`
  (measured on `ter`, 2026-09-13):

  | call | anonymous | with token |
  |---|---|---|
  | merge request object, `.head_pipeline` | `null` | populated |
  | `/projects/:id/pipelines` | `403` | `200` |
  | `/projects/:id/pipelines/:pipeline_id` | `403` | `200` |
  | `/merge_requests/:iid/pipelines` | `200`, **empty array** | `200`, populated |

  The last row is the one that misleads silently: a `200` with an empty array
  reads as "no pipeline ran", not as "you may not see it". A watcher built on
  `head_pipeline` without a token therefore reports `none` forever and never
  fires, which is indistinguishable from CI not having started. Poll
  `detailed_merge_status` instead — it is the only CI signal anonymous access
  gives you (`ci_still_running` → `mergeable` / `ci_must_pass`) — or send the
  token. Sibling of the label-write trap below: do not read a status code as
  an answer.
- **Git over HTTPS** clones and fetches anonymously, which is enough to
  inspect and rebase a branch locally.
- **Git over SSH** (`ssh://git@git.typo3.org:2222/…`) is what you push with,
  and in an agent shell it is commonly blocked by the sandbox: `git
  fetch`/`push` and a bare `ssh` both hang until the timeout with no error.
  Re-issue the call with the sandbox disabled rather than concluding the host
  is unreachable.

Do not use a `/dev/tcp` probe to decide any of this. It is blocked by the same
sandbox and reports port 443 as closed on a host that `curl` reaches in the same
second, so it produces a confident wrong answer about the network.

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
- **Maintainers merge with review threads still open.** Nothing in `ter` blocks a merge on unresolved discussions, and a merge can land while a review is being written. Read the merge request's `state` again immediately before posting review comments — a check of `sha` and `diff_refs` alone does not tell you. (`!911` was merged at 14:31 UTC; three review threads arrived at 14:52 and were never read.)
- **Findings from a review go into the review, never into new issues.** When the merge request is already merged, the review has nowhere to land: turn the findings into a follow-up merge request that fixes them, target `develop`, and link the original threads from its description. The only exception is the case above where you cannot push and forking is refused: then no follow-up merge request can exist, and the issue with a ready-to-apply diff is the fallback.

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

### Rebasing your own open merge requests onto `develop`

`develop` moves under open merge requests, usually several at once. Rebasing
three of them on `ter` in one pass (2026-09-14) turned up four things:

- **Check that nobody else is on the branch.** A merge request pushed minutes
  ago with its pipeline still running belongs to a session that is still
  working; rebasing underneath it force-pushes over that session's next push.
  Hold `updated_at` and `head_pipeline.status` of the merge request against the
  clock, and look for a live watcher on its pipeline, before touching it.
- **A branch checked out in another worktree cannot be checked out again.**
  Rebase a detached copy and push by name, with the lease pinned to the SHA you
  rebased from:

  ```bash
  git -C .bare worktree add --detach ../mr-x origin/task/x
  old_sha=$(git -C ../mr-x rev-parse HEAD)
  git -C ../mr-x rebase origin/develop
  git -C ../mr-x push --force-with-lease=refs/heads/task/x:"$old_sha" \
    origin HEAD:refs/heads/task/x
  ```

- **A conflict where `develop` rewrote the code leaves stale text behind.**
  Resolving to `develop`'s side drops the hunk the commit carried, and with it
  whatever the commit message and the merge request description say about that
  hunk. Re-read both for the dropped change, the base SHA they name and the
  test counts they quote. On `!880` a whole commit-message paragraph described
  an `!is_array()` removal that no longer existed after the rebase.
- **A description written back through the API reads back one newline short**
  when the original was fetched with `jq -r`. Drop that one terminal newline
  and compare the rest exactly before concluding that the `PUT` did not apply
  — stripping all trailing whitespace would also swallow Markdown hard breaks
  and make a changed description look unchanged.

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

**`Type::`, `Skill::` and `Process::` are scoped labels — one value each.**
GitLab treats a `key::value` label as exclusive within its key, so a second
value of the same scope silently replaces the first. Setting `Type::Task`,
`Skill:: Backend` and `Skill:: Ops` in one call returns HTTP 200 and leaves
two labels on the merge request; the one you meant is not necessarily the one
that survives. Pick the scope value that matches the bulk of the change and say
so, rather than trying to express two skills. `Process: To discuss` has a
single colon and is therefore *not* scoped — it can sit beside `Process:: Review`
without either being dropped. This compounds the silent-failure warning above:
read the returned `labels` array back in both cases, for rights and for scope.

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

**A bare reference already renders its own state**, without `+s`: `!874` comes
out as "!874 (merged)". So an index table listing sibling merge requests must
**not** carry a hand-maintained "State" column — the column cannot be right for
long, and it fails in the most visible way possible, printing `open` in the cell
next to a link that says merged. Drop the column and let each reference speak
for itself; the same goes for prose that pins a sibling's state ("!881 after
!876") once that sibling has landed.

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

A job can also hang before it starts. `Create Badge` once sat for 25
minutes in `Preparing the "docker-autoscaler" executor`, where it normally
finishes in about 80 seconds, and held the whole pipeline — and with it the
merge request's mergeability — on `running`. Cancel it and retry the single
job (`POST /projects/:id/jobs/:job_id/cancel`, then `…/retry`); the retry
ran normally. The cancelled job may stay `canceling` for a while; the retry
does not have to wait for it.

**Do not copy `expire_in` from a junit job onto a report a person reads.** The
neighbouring jobs in `ter` set `expire_in: 15 mins`, which is right for a junit
or coverage artifact: GitLab ingests it on upload and never needs the file
again. A mutation log, a profile or an analyser report is opened by a human, days
later, from the merge request — and fifteen minutes means it is gone before the
first reviewer arrives, leaving a job that says "success" and an artifact link
that 404s. Give those a retention someone can actually reach (`1 week`), and
when you quote numbers out of such a report, take them while the artifact still
exists.

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

**`test:typoscript` has no composer script, so a four-gate local run still
pushes a red pipeline.** The job comes from the shared template and installs
the linter itself; `composer.json` never mentions it, which is exactly why it
is the gate that gets forgotten. Install it once outside the repository — a
`composer require` inside `ter` would change its lock file:

```bash
mkdir -p /tmp/tslint && (cd /tmp/tslint && composer require -n helmich/typo3-typoscript-lint:^3.3)
/tmp/tslint/vendor/bin/typoscript-lint -c typoscript-lint.yml --fail-on-warnings   # from the repo root
```

The warning that fails it is not a syntax error. A dotted assignment whose
prefix already has a block elsewhere in the file — `tx_terfe2_rating.mvc.x = 1`
written below an existing `tx_terfe2_rating { … }` — reports *Operation on
value "…", although nested statement for path "…" exists at line N* and, under
`--fail-on-warnings`, exits 2. Put the assignment inside the existing block
instead of appending a dotted line (ter !920, 2026-09-14).

`test:unit` needs `TYPO3_PATH_WEB="$PWD/public"` and an existing
`public/fileadmin/currentcoredata.json`.

The suite leaves `public/fileadmin` behind without read permission for its
owner (`d-wxr----t`), so removing a scratch clone afterwards fails with
`rm: cannot remove 'ter/public/fileadmin': Permission denied`. Give the
directory its permissions back first:

```bash
chmod u+rwx ter/public/fileadmin && rm -rf ter
```

Infection (`composer test:mutation`) validates the PHPUnit configuration it
generates against `https://schema.phpunit.de/<version>/phpunit.xsd`, and
`Typo3VersionServiceTest` fetches `https://get.typo3.org`. Where PHP cannot
reach those hosts — a broken IPv6 route is enough, because PHP tries the
AAAA record first and hangs — map the schema to the vendor copy and leave
the live-API test out, and say so next to any score you report:

```bash
cat > catalog.xml <<EOF
<catalog xmlns="urn:oasis:names:tc:entity:xmlns:xml:catalog">
  <uri name="https://schema.phpunit.de/10.5/phpunit.xsd"
       uri="file://$PWD/vendor/phpunit/phpunit/phpunit.xsd"/>
</catalog>
EOF
XML_CATALOG_FILES=$PWD/catalog.xml COMPOSER_PROCESS_TIMEOUT=0 \
  composer test:mutation -- --test-framework-options="--exclude-filter=Typo3VersionServiceTest"
```

A full run takes longer than Composer's 300-second default for scripts,
hence `COMPOSER_PROCESS_TIMEOUT=0`.

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
Both commands below read `$GIT_TYPO3_ORG_TOKEN`, exported as in *Authentication*
above — they are not self-contained.

Upload first, then embed the returned markdown:

```bash
curl -sS -H "PRIVATE-TOKEN: $GIT_TYPO3_ORG_TOKEN" \
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
curl -sS -X POST -H "PRIVATE-TOKEN: $GIT_TYPO3_ORG_TOKEN" -H "Content-Type: application/json" \
  --data @body.json "https://git.typo3.org/api/v4/markdown"   # {"text": …, "gfm": true, "project": "<full/path>"}
```

Uploads are project-scoped, so the same hash can be embedded in an issue and in
a merge request of that project.

## Reporting findings

This section is about findings from your own analysis of a site. Findings from
reviewing someone's merge request are different: they belong in that review, or
in a follow-up merge request once it is merged — see *Contribution rules* above.

One finding, one ticket. A long comment listing six problems gives none of them
a place to be discussed, rejected or closed. Make the comment an index that
links the tickets, and put each finding — with its evidence and acceptance
criteria — in its own issue. Search the existing tracker first: an open issue
for the same thing usually already exists.

When the fix belongs in a repository you cannot push to, the issue **is** the
deliverable: include the ready diff in a fenced block and say plainly that you
have no push access and that forking is refused.
