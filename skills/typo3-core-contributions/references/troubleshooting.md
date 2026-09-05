# TYPO3 Contribution Troubleshooting Guide

Failures specific to contributing to TYPO3 Core through Gerrit. Generic Git,
Composer and DDEV problems are not covered here — the error message is enough to
solve those, and repeating them buries the parts that are actually TYPO3's.

Related: `gerrit-workflow.md` (the workflow itself), `commit-message-format.md`
(subject, type, footer tags), `commit-msg-hook.md`, `ddev-setup-workflow.md`.

## Gerrit access and identity

### Problem: "Permission denied (publickey)" against Gerrit

```
ssh: connect / Permission denied (publickey)
```

The SSH key must be registered at **review.typo3.org**, not my.typo3.org — the
accounts are linked but the key store is not:

1. <https://review.typo3.org/settings/#SSHKeys> → "Add new SSH key"
2. Paste `cat ~/.ssh/id_ed25519.pub`

Gerrit speaks SSH on port **29418**, so the connection test and the remote both
carry the port and your Gerrit username:

```bash
ssh -p 29418 <username>@review.typo3.org
git remote set-url origin ssh://<username>@review.typo3.org:29418/Packages/TYPO3.CMS
```

`~/.ssh/config` avoids repeating both:

```
Host review.typo3.org
    User <your-typo3-username>
    IdentityFile ~/.ssh/id_ed25519
    Port 29418
```

### Problem: "SSH timeout connecting to Gerrit"

```
ssh: connect to host review.typo3.org port 29418: Operation timed out
```

Port 29418 is the usual casualty of a corporate firewall — a timeout here is a
network verdict, not an account problem. `telnet review.typo3.org 29418` tells
you which. HTTPS is available as a fallback, uncommon for TYPO3:

```bash
git config remote.origin.url https://review.typo3.org/Packages/TYPO3.CMS
```

### Problem: "email address is not registered in your account"

```
remote: ERROR: commit abc123: email address user@example.com is not registered
in your account, and you lack 'forge committer' permission.
```

A commit carries **two** email addresses, and Gerrit checks the one people
overlook:

- **Author** — who wrote the code, shown in `git log`
- **Committer** — who ran the commit; **this is what Gerrit validates**

So a patch can keep a foreign author and still pass, as long as the committer
email is one of yours at <https://review.typo3.org/settings#EmailAddresses>.

```bash
git config user.email "your-registered@email.com"     # future commits
git commit --amend --reset-author --no-edit           # fix: both fields
```

Keeping the original author but fixing only the committer:

```bash
GIT_COMMITTER_NAME="Your Name" \
GIT_COMMITTER_EMAIL="your-registered@email.com" \
git commit --amend --no-edit
```

### Problem: "Can't access Gerrit"

Two separate systems: <https://my.typo3.org> holds the account,
<https://review.typo3.org> is Gerrit and signs in with those credentials. An
account that works on my.typo3.org and not on Gerrit is usually a stale session
— try a private window before suspecting the account.

## Pushing to Gerrit

### Problem: "Change-Id not found in commit message footer"

```
remote: ERROR: commit abc123: missing Change-Id in message footer
```

The `commit-msg` hook is not installed, or was bypassed. Any of:

```bash
composer gerrit:setup                       # if the repo provides it

curl -o "$(git rev-parse --git-dir)/hooks/commit-msg" \
  https://review.typo3.org/tools/hooks/commit-msg && \
chmod +x "$(git rev-parse --git-dir)/hooks/commit-msg"

cp Build/git-hooks/commit-msg .git/hooks/ && chmod +x .git/hooks/commit-msg
```

Then `git commit --amend --no-edit` to let the hook run over the existing
message. If the Change-Id still does not appear, run the hook by hand:

```bash
.git/hooks/commit-msg .git/COMMIT_EDITMSG
git commit --amend -F .git/COMMIT_EDITMSG
```

### Problem: "Prohibited by Gerrit: not permitted to upload"

```
remote: ERROR: Prohibited by Gerrit: not permitted to upload
```

Almost always the ref, not the permission. Gerrit takes patches on
`refs/for/<branch>`; a push to the branch itself is refused:

```bash
git push origin HEAD:refs/for/main          # not HEAD:main
git config remote.origin.pushurl            # ssh://<USERNAME>@review.typo3.org:29418/Packages/TYPO3.CMS.git
```

A permanent setup for the same thing:

```bash
git config remote.origin.push +refs/heads/main:refs/for/main
```

### Problem: "Invalid Change-Id"

A hand-written or edited Change-Id. Delete the line, then let the hook generate
a fresh one:

```bash
git commit --amend            # remove the Change-Id line, save
git commit --amend --no-edit  # hook writes a new one
git log -1 | grep Change-Id   # "Change-Id: I" + 40 hex characters
```

### Problem: "New patchset not appearing"

The push succeeded but Gerrit shows nothing new. Either the commit is identical
to the current patchset, or the Change-Id changed — in which case the push
created a *separate* review, and the push output names its URL.

```bash
git fetch origin refs/changes/XX/XXXX/X
git diff FETCH_HEAD           # what Gerrit already has vs. your commit
```

If the Change-Id was lost, copy it back from the Gerrit page into the commit
message and push again; a new Change-Id cannot be merged into the old review.

### Problem: merge conflict while rebasing a patch

Resolve as usual, then continue the rebase and push a new patchset — the point
that differs from a normal Git workflow is the push target:

```bash
git rebase --continue
git push origin HEAD:refs/for/main
```

Details in `gerrit-workflow.md`, "Resolving Merge Conflicts".

## CI (GitLab)

TYPO3 Core CI runs on **GitLab** (`git.typo3.org`) and reports back onto the
Gerrit review; the pipeline definition lives in `Build/gitlab-ci.yml` and
`Build/gitlab-ci/` in the core repository. There is no Bamboo left in the core
repo — a guide that still tells you to read Bamboo results is describing a CI
that is gone.

### Problem: "How do I find ALL failing CI jobs?"

**Never assume what failed — read every job log.** A patch commonly fails
several jobs for one root cause, and just as commonly for several.

1. Open the review: `https://review.typo3.org/c/Packages/TYPO3.CMS/+/<number>`
2. Scroll to the CI results and note **every** red job, not the first
3. Follow each into GitLab (`https://git.typo3.org/typo3/CI/cms/-/jobs/<id>`) and
   append `/raw` or click "Show complete raw" to read the actual error

Job names follow `<what> php <version> pre-merge`: `cgl pre-merge`,
`phpstan php X.X pre-merge`, `unit php X.X pre-merge`,
`functional php X.X pre-merge`. The PHP version in the name matters — a failure
on one version and not another is a compatibility finding, not a flake.

### Problem: "Code Style (cgl) failed"

```
1) path/to/File.php (single_quote)
   ---------- begin diff ----------
-   body: "some string"
+   body: 'some string'
   ----------- end diff -----------
```

TYPO3 CGL is PSR-12 plus TYPO3 rules; the recurring offenders are double quotes
on simple strings, indentation and stray spaces. The repo ships the fixer:

```bash
./Build/Scripts/cglFixMyCommit.sh
```

### Problem: "PHPStan failed"

```
 236    Call to static method Assert::assertNotNull()
        with string will always evaluate to true.
```

Run the same analysis the job runs, rather than a locally installed PHPStan:

```bash
./Build/Scripts/runTests.sh -s phpstan
```

The frequent finding in test code is an assertion that cannot fail — asserting
non-null on a value the signature already types as `string`. `assertNotEmpty()`
is usually what was meant.

### Problem: "Unit tests failed"

```bash
./Build/Scripts/runTests.sh -s unit path/to/Tests/Unit/ClassTest.php::testMethod
./Build/Scripts/runTests.sh -s unit path/to/Tests/Unit/ClassTest.php
```

`runTests.sh` runs the suite in a container (docker or podman), which is why it
reproduces CI where a locally installed PHPUnit often does not. A test that only
fails on one PHP version of the matrix is reproduced with `-p`:

```bash
./Build/Scripts/runTests.sh -s unit -p 8.6
```

The accepted values follow the branch — on `main` today 8.5 (default) and 8.6.
`./Build/Scripts/runTests.sh -h` lists what the checked-out branch supports;
passing a version outside that set is rejected rather than silently ignored.

### Problem: "Multiple jobs failed — which do I fix first?"

All of them, in **one** patchset. Gerrit reviews patchsets, not commits: three
pushes for three fixes cost three CI runs and make the review history harder to
read than the change deserves.

```bash
./Build/Scripts/cglFixMyCommit.sh
./Build/Scripts/runTests.sh -s phpstan
./Build/Scripts/runTests.sh -s unit
git commit --amend --no-edit
git push origin HEAD:refs/for/main
```

### Problem: "CI takes forever"

A full pipeline is 10–20 minutes. Beyond ~30 the pipeline is usually queued
behind other patches — <https://git.typo3.org/typo3/CI/cms/-/pipelines> shows
whether that is the case, and #typo3-cms-coredev reports outages.

Pushing again while CI runs does not speed it up: it queues another pipeline
behind the current one and the earlier result becomes worthless.

## Patch content

### Problem: "composer.lock included in patch"

TYPO3 Core manages dependencies centrally. A lock file change belongs in its own
dedicated patch, never inside a bugfix or feature — a reviewer seeing it in a
feature patch will ask for it to be removed before anything else is discussed.

```bash
git reset HEAD~ -- composer.lock
git checkout -- composer.lock
git commit --amend --no-edit
git push origin HEAD:refs/for/main
```

It gets in through `git add .` after a `composer install`. Stage named paths, and
check before committing:

```bash
git diff --cached --name-only | grep composer.lock
```

### Problem: "patch was created without a push certificate"

Informational, and safe to ignore — patches are merged without one every day.
Worth knowing why the obvious fix does not apply:

- Push certificates are **GPG**, not SSH. Having an SSH key on Gerrit does not
  produce one, and adding another SSH key never will.
- They sign the *push operation*, not the commit.
- They are optional for TYPO3 contributions.

If you want one anyway:

```bash
git config --global user.signingkey <KEY_ID>
git config --global push.gpgSign true
# public key to https://review.typo3.org/settings/#GPGKeys
```

### Commit message rejected

Subject too long, wrong type, missing footer — all fixed with
`git commit --amend`, keeping the `Change-Id` line untouched. The format itself
(≤52 characters recommended and 72 maximum, `[BUGFIX]` vs `[FEATURE]`,
`Resolves:` and `Releases:` footers) is in `commit-message-format.md`.

## WIP state

**Every new patch is WIP, and reviewers cannot see WIP patches.** This is the
reason a patch with green CI can sit for days with no feedback: nobody has seen
it. Marking it ready is a step you take, not one that happens.

```bash
git push origin HEAD:refs/for/main%ready    # with your changes
git commit --amend --allow-empty --no-edit  # nothing to change? empty patchset
git push origin HEAD:refs/for/main%ready
git push origin HEAD:refs/for/main%wip      # deliberately back to WIP
```

The web UI does the same through "Start Review" in the ⋮ menu.

What does **not** work, having been tried: the SSH `gerrit review` command has no
WIP flags at all.

```bash
# both are rejected
ssh -p 29418 user@review.typo3.org gerrit review --ready 12345,1
ssh -p 29418 user@review.typo3.org gerrit review --wip 12345,1
```

Fix the CI before marking ready — a reviewer's first look at a red patch is a
wasted one.

## Before you push

- `scripts/verify-prerequisites.sh` — SSH, hooks, Git identity in one run
- One commit per patch, with its `Change-Id`
- Rebased on current `main`
- `git diff --cached --name-only | grep composer.lock` comes back empty
- `./Build/Scripts/runTests.sh -s unit` and `-s phpstan` pass locally

## Quick diagnostics

```bash
git config -l | grep -E "user\.|remote\.origin"   # identity + push URL
ssh -T -p 29418 <username>@review.typo3.org       # Gerrit reachability
git log -1 | grep Change-Id                       # patch is pushable
ls -la .git/hooks/commit-msg                      # hook installed and +x
```

## Where to ask

- Slack **#typo3-cms-coredev** (<https://typo3.slack.com>) — include the Gerrit
  URL and the full error, not a paraphrase
- Forge: <https://forge.typo3.org>
- Contribution guide:
  <https://docs.typo3.org/m/typo3/guide-contributionworkflow/>
- Gerrit documentation: <https://review.typo3.org/Documentation/>
