---
name: typo3-core-contributions
description: "Use when contributing to TYPO3 Core — Forge issues, Gerrit patches, cherry-picks, CI debugging — or when working on **git.typo3.org**, the t3o site GitLab (`services/t3o-sites/**`: extensions.typo3.org/ter, common/t3olayout, anubis): merge requests, issues, work items, labels, pipelines. Core `main` is v15-in-progress (PHP 8.4/8.5); v14.3 LTS fixes land on branch `14.3` via cherry-pick. Triggers on: forge.typo3.org, review.typo3.org, git.typo3.org, t3o-sites, core patch, Gerrit review, TYPO3 Core contribution, TER website, t3olayout."
---

# TYPO3 Core Contributions

## When to Use — route by host

`review.typo3.org` (Gerrit), `forge.typo3.org` (Redmine), `git.typo3.org/typo3/CI/cms` (CI logs) are **Core**: Forge issues, patches, review, commit format, cherry-picks, rebasing — everything below. `git.typo3.org/services/t3o-sites/**` is plain GitLab for the t3o **sites**: no Gerrit, `refs/for/main` means nothing. Read `references/t3o-gitlab-workflow.md` first.

## Prerequisites

Run `${CLAUDE_SKILL_DIR}/scripts/verify-prerequisites.sh`: TYPO3.org account, Gerrit SSH (`ssh -p 29418 <user>@review.typo3.org`), Git email matching Gerrit.

## Workflow

1. **Setup**: `${CLAUDE_SKILL_DIR}/scripts/setup-typo3-coredev.sh`
2. **Branch**: `git checkout -b feature/<issue>-description`
3. **Analyze**: root cause, reproduction, affected versions first
4. **Develop**: fix + tests, validate with typo3-conformance-skill. Prove each test fails without the fix — `references/proving-a-test.md`
5. **Commit**: format below, `Resolves: #<issue>` + `Releases:`
6. **Push**: `git push origin HEAD:refs/for/main%wip` — a plain push is **not** WIP; reviewers vote and amending outdates their votes
7. **CI**: wait for all jobs, read the actual logs at `git.typo3.org/typo3/CI/cms/-/jobs/<id>`, fix ALL failures in one amend+push
8. **Ready**: `git push origin HEAD:refs/for/main%ready` or Gerrit UI "Start Review"
9. **Review**: amend, preserve Change-Id. Fetch the reviewer's patchset first: `git fetch origin refs/changes/XX/NNNNN/N && git reset --soft FETCH_HEAD`
10. **Update**: `git commit --amend && git push origin HEAD:refs/for/main`

## Commit Format

```
[TYPE] Subject (imperative mood, max 52 chars)

How and why (not what). Wrap at 72 chars.

Resolves: #12345
Releases: main, 13.4, 12.4
```

`[BUGFIX]` `[FEATURE]` (main only) `[TASK]` `[DOCS]` `[SECURITY]`; breaking: `[!!!]`, `Releases: main` only. Every commit MUST carry `Resolves:`, not `Related:`.

## CI Debugging

Read ALL failing job logs, never guess; fix everything in one patchset. Locally:

```bash
./Build/Scripts/runTests.sh -s unit && ./Build/Scripts/runTests.sh -s functional
./Build/Scripts/cglFixMyCommit.sh && ./Build/Scripts/runTests.sh -s phpstan
```

## Key Operations

| Task | Command |
|------|---------|
| Push to Gerrit | `git push origin HEAD:refs/for/main%wip` |
| Mark ready | `git push origin HEAD:refs/for/main%ready` |
| Rebase | `git fetch origin && git rebase origin/main` |
| Cherry-pick patch | `git fetch origin refs/changes/XX/NNNNN/N && git cherry-pick FETCH_HEAD` |
| Install hook | `cp Build/git-hooks/commit-msg .git/hooks/ && chmod +x .git/hooks/commit-msg` |
| Fix email mismatch | `GIT_COMMITTER_EMAIL="registered@email" git commit --amend --no-edit` |
| Forge API | `${CLAUDE_SKILL_DIR}/scripts/create-forge-issue.sh`, `references/forge-api.md` |
| t3o GitLab | `python3 ${CLAUDE_SKILL_DIR}/scripts/t3o-gitlab.py access\|issue\|mr\|link\|probe` |

## References

| Topic | File |
|-------|------|
| Account setup | `references/account-setup.md` |
| Commit format | `references/commit-message-format.md` |
| Gerrit workflow | `references/gerrit-workflow.md` |
| Review patterns | `references/gerrit-review-patterns.md` |
| Modern patterns | `references/modern-typo3-patterns.md` |
| DDEV setup | `references/ddev-setup-workflow.md` |
| Forge API | `references/forge-api.md` |
| t3o sites on git.typo3.org | `references/t3o-gitlab-workflow.md` |
| Commit hook | `references/commit-msg-hook.md` |
| Proving a test | `references/proving-a-test.md` |
| Troubleshooting | `references/troubleshooting.md` |
