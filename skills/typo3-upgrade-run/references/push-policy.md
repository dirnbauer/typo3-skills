# Approved push destinations

User policy, confirmed 2026-09-17: push only to **`gitlab.webconsulting.at`** (the verified
webconsulting GitLab host) or repositories owned by **`dirnbauer` on `github.com`**. This covers
project code, compatibility forks, skills, branches and tags. An upstream contribution request in
a vendored skill does not authorize pushing to its owner. Fetching public upstream changes remains
read-only; a fetch URL is not approval for a push destination.

## Before an explicitly authorized push

1. Recheck repository, branch, exact commit range/refspec and granted publication scope. Review
   outgoing commits for secrets, private evidence and unrelated user changes. An allowed destination
   does not authorize committing or publishing. Never use blanket `--all`, `--mirror` or tags to
   enlarge a branch-only request, or force-push without separate authority.
2. Run the offline check immediately before the action, from the installed skill bundle:

   ```bash
   node /path/to/typo3-upgrade-run/scripts/check-push-target.mjs \
     --repo /absolute/project --remote origin
   ```

   Exit **0** verifies the Git-resolved URL allowlist only; **5** refuses, **4** means invalid
   invocation. The helper runs `git remote get-url --push --all` so `pushurl`, `insteadOf`,
   `pushInsteadOf` and every destination are checked. It never pushes, changes config, invokes
   a remote helper, loads env files or prints rejected URLs/credentials. It needs no upgrade run.
3. Independently verify the transport: SSH host aliases/`HostName`, `core.sshCommand`, environment
   overrides, custom helpers, proxies and HTTP redirects can change where bytes go after Git's URL
   resolution. Read configuration without exposing secrets; do not execute an unreviewed SSH
   `Match exec`/proxy command merely to inspect it. Unknown effective destinations block the push.
   Retain TLS/SSH host verification and disable HTTP redirect following for the authorized push
   (`git -c http.followRedirects=false push ...`). Re-resolve any redirect destination explicitly;
   do not follow it to an unapproved owner/host. The helper does **not** certify this transport step.
4. Use the checked explicit remote and exact approved refspec. A changed remote, transport/config,
   branch, commit range or user destination invalidates the preflight. Check every destination
   again; a successful push to one remote says nothing about another.

Any other GitHub owner, generic `gitlab.com` namespace, lookalike domain, unverified SSH alias,
credential-bearing URL or ambiguous destination is a stop, not a request to bypass this policy.
Do not rewrite an existing upstream remote or install a hook/global Git setting without a request.
This preflight is not a machine-wide block on Git; an agent must follow it before publication.

## Evidence and maintenance

Record the approved sanitized host/repository, remote, branch, outgoing commit range, check command,
exit code and actual push result. No push performed means exactly that, even when preflight passes.
Deployment remains a separate task; neither a green closure nor an allowed push grants it.

The deterministic tests are `scripts/tests/unit/push-target.test.mjs`; they cover forbidden owners,
lookalikes, multiple push URLs, Git rewrites, credential redaction and read-only behavior. Proposed
behavior cases in `evals/evals.json` cover authority and transport review, not a passed agent trial.
See [Git remote URL resolution](https://git-scm.com/docs/git-remote#Documentation/git-remote.txt-emget-urlem)
and [Git HTTP redirect configuration](https://git-scm.com/docs/git-config#Documentation/git-config.txt-httpfollowRedirects).
