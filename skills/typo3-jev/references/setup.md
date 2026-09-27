# Setup and operations

## Resolve the installed packages

The reviewed **v0.2.6** manifest declares:

| Component | Requirement |
|---|---|
| PHP | `^8.4`, with `ext-intl` |
| TYPO3 Core, Backend, Fluid | `^14.3` |
| Vault | `netresearch/nr-vault ^0.16 \|\| ^1.0` |
| Powermail / Conditions | Optional integrations, not mandatory runtime dependencies |

Inspect the project's `composer.json`, `composer.lock`, PHP runtime and installed packages
before changing them. Resolve current available versions rather than treating this snapshot
as a claim about the newest release. On the review date, the public Packagist metadata endpoint
for this package returned **404**. Do not assume a bare `composer require` can discover it.
For this source, merge a scoped VCS entry into the **root project's** `composer.json`, preserving
existing repository entries and any approved project-specific package source:

```json
{
  "repositories": [
    {
      "type": "vcs",
      "url": "https://github.com/dirnbauer/typo3-webcon-jev.git",
      "only": ["webconsulting/webcon-jev"]
    }
  ]
}
```

Then a project-approved installation of the reviewed version line can use:

```bash
composer require webconsulting/webcon-jev:^0.2.6
vendor/bin/typo3 extension:setup
```

Use the stable Git tag rather than globally lowering `minimum-stability`. Review the resolved
source reference, dependency diff and schema changes. Follow the project's migration/backup workflow;
do not run setup against production just to check a skill example.

`^0.2.6` currently resolves to **v0.2.14** (`7c4626b1`, checked 2026-09-27), not the reviewed
snapshot. Pin `0.2.6` to reproduce it, or review v0.2.7+ first. v0.2.8 added a frontend debug
panel switched by `plugin.tx_webconjev.settings.debug` (site set `webconsulting/webcon-jev`). When
on, it renders the state sent to Jev, the answers and the routing receiver addresses into the page,
and visitors see it too. Keep it off in production, or set it only inside a
`[backend.user.isLoggedIn]` TypoScript condition: the flag is read from the request's TypoScript
setup.

For Powermail Conditions, the reviewed integration requires the fork's
`In2code\PowermailCond\Event\EvaluateRuleEvent`. Check for that actual class, not merely
an installed package named `powermail_cond`. The public upstream version reviewed alongside
this snapshot lacks the event. Follow [the Powermail version guide](../../typo3-powermail/references/v14-only-changes.md)
for both root VCS repositories, compatible versions and exact lock references.
Jev registers the optional listeners itself; do not duplicate them in the sitepackage.

## Store and diagnose the token

The default vault identifier is `typesafe_api_key`. The extension reads nr-vault first,
then falls back to the **`TYPESAFE_API_KEY` environment variable** if no usable vault token
is returned. The environment fallback is not restricted to development by the code.

Use an existing authorized secret-injection mechanism. Never put the key in committed YAML,
TypoScript, example PHP, a command argument or chat. If the project uses local DDEV secret
configuration, check that the actual file is ignored; do not assume it from its name.
Do not weaken nr-vault's global CLI access to make a command work.

These commands are **mutations**, not diagnostic prerequisites:

```bash
vendor/bin/typo3 webcon-jev:vault:setup-provisioner
vendor/bin/typo3 webcon-jev:token:import --as-provisioner
```

Use the first only when provisioning is in scope and the existing vault identity/configuration
has been inspected. It creates or updates a backend group/user and normally writes nr-vault's
`provisioningBeUserUid`; it can overwrite grants/group membership of an existing matching
identity. The second imports the securely supplied environment token; `--force` rotates an
existing token and needs explicit intent. Its success output includes token length and the last
four characters: redact that metadata in shared logs too.

The importer marks a **newly created** secret **frontend-accessible** so server-side
unauthenticated form requests can retrieve it. An existing secret is skipped, or with `--force`
rotated, and rotation keeps its current flag; check the ping line “Frontend can read it”. This
does not put the secret in browser JavaScript. Backend/CLI and
frontend retrieval use different vault access paths; a successful backend check alone does not
prove the condition endpoint can read the token. Disabling the vault frontend flag is also not
a complete off switch while an environment fallback remains available.

After authorization for a real external request, use synthetic data and check:

```bash
vendor/bin/typo3 webcon-jev:ping --as-provisioner
```

This contacts the configured service and may incur usage. A successful ping proves that
connection/actor, not the entire form. The backend Connection page and decision playground
also include controls that make real requests. Do not click them during an offline review.

## Configuration and operational limits

Configure `webcon_jev` through TYPO3 extension configuration; verify effective project overrides.

| Key | Shipped default | Meaning |
|---|---|---|
| `enabled` | `1` | Runner off switch; disabled runs use fallback behavior. Not applied to `webcon-jev:ping`, the Connection-page ping or direct `ask()` callers |
| `endpoint` | `https://api.typesafe.ai/v1/systemone` | Destination receives state and the bearer credential |
| `model` | `jev-latest` | Mutable service alias, not a pinned model version |
| `timeout` | `10` | HTTP timeout in seconds |
| `cacheLifetime` | `300` | Shared result lifetime in seconds; `0` disables it |
| `maxCallsPerMinute` | `120` | Approximate request counter; `0` disables the guard |
| `logRuns` | `1` | Store run metadata and answers |
| `logRetentionDays` | `30` | Age used by the prune command |
| `storagePid` | `0` | Storage location for newly created decision records |

Treat endpoint changes as credential/data-destination changes. Keep TLS and the approved
destination; do not switch to an arbitrary debugging proxy. Do not quote costs, latency or
model accuracy from an old README as a present-day guarantee.

A decision cache lifetime of **-1** inherits the extension value; **0** disables its result
cache. The runner keys by decision UID, language, decision model, questions and rendered state.
When the decision inherits the global model, the hash does not include the resolved global
model value: invalidate the relevant `webcon_jev` cache and retest after changing it. An upstream
change behind `jev-latest` also requires fresh evaluation; a model alias is not reproducibility.

The per-minute counter is non-atomic and is **not a hard financial spending cap**. A public
form still needs project-appropriate abuse controls and service-side usage limits. A repeated
request or a different state can trigger another call even when one request shares its result.

The run log contains answers, model, origin/context, state hash, usage, timing and fallback
details, not a stored copy of the full input state. Answers, error messages and origin strings
can still be sensitive. Keep origins free of visitor text, restrict logs, and review retention.
`webcon-jev:log:prune` deletes old run rows when executed; the retention setting alone does not
prove that a scheduler runs it. Do not run it or the example-seeding command as a health check.

Sources: [pinned evidence index](source-review.md).
