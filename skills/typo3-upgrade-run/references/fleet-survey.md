# Fleet survey — deciding which projects to upgrade, and what each will cost

**This is not P00.** P00 scopes a single run that is about to happen. This surveys *many*
projects, read-only, before any of them is started, to answer three questions:

1. Which projects can be upgraded cheaply, and which carry a hidden workstream?
2. What is the order — and what has lead time that must start now (licences, data migrations)?
3. Where is the effort actually concentrated?

Run it when a batch of sites has to move to a new major. For one project, go straight to P00.

## The one rule

**Read only. Change nothing.** No `composer update`, no cache flush, no DDEV start, no writes of
any kind. A survey that modifies a project has stopped being a survey, and half the value here is
that it can be run against every site in an afternoon without touching a single one.

Report **what you found**, not what you infer. "No `Build/` directory and no `scripts` in
`package.json`" is a finding; "no build process" is a conclusion — write the first, then the
conclusion separately, so a wrong conclusion can be spotted.

---

## What to collect, per project

Answer every point explicitly, **including the negatives**. "Checked, none present" is the
finding that stops the next survey re-checking it.

### Identity

- **What is this site?** One sentence from the README: whose it is, who it serves, what it is for.
  Everything below is judged against this, and a survey of twelve indistinguishable
  `composer.json` files is useless three weeks later.
- Deployment shape: CI configuration, DDEV, the environments that exist (staging, live).

### Versions

- TYPO3 version — from **`composer.lock`**, not `composer.json`. The constraint says `^12.4`;
  the lock says what is actually installed, and only the second one is a fact.
- PHP: the `require` constraint *and* `config.platform.php`, which frequently disagree.
- Database engine and version. Below the target's DBAL floor is a blocker, not a detail —
  see `known-problems.md`.

### Extensions

- Every third-party `typo3/`, vendor extension with its **version constraint**.
- Which have **no release for the target major**. This is the number that decides the order of
  the whole batch, so get it from the resolver rather than by reading release pages:

  ```bash
  ddev composer why-not typo3/cms-core "^14.3"      # if a container may be started
  composer why-not typo3/cms-core "^14.3"           # otherwise, host-side, still read-only
  ```

- **Commercially licensed extensions.** A new major usually needs a new licence from a private
  repository. That is a purchase with lead time — it belongs in the survey, not in week three.

### Custom code — where the effort actually is

The extension count is a poor predictor. Forty third-party extensions and no custom PHP is a
smaller job than four extensions and a bespoke domain model. Per in-house package:

- one sentence on what it does, from `composer.json` / `ext_emconf.php`
- `.php` file count and line count
- Extbase plugins, custom backend modules, middlewares, event listeners, hooks
- **domain models and their tables** — bespoke data is the single largest effort driver, because
  nothing upstream migrates it for you
- **integrations with anything outside TYPO3** — APIs, imports, exports, external systems. These
  break with no TYPO3 error at all and are invisible to every automated gate.

```bash
for d in packages/* extensions/*; do
  [ -d "$d" ] || continue
  echo "$d  php:$(find "$d" -name '*.php' | wc -l)  loc:$(find "$d" -name '*.php' -exec cat {} + | wc -l)"
done
```

### Subsystems that are their own project

Not "an extension to update" — a workstream with its own version matrix, data to migrate or
reindex, and sometimes its own licence. Record presence, version, **and how much data each holds**:

| Subsystem | Why it is a workstream | The number that matters |
|---|---|---|
| Search stack (Solr and companions) | separate server, schema and version matrix; index must be rebuilt | documents indexed |
| Form framework | live submissions, finisher configuration | forms, and submissions stored |
| News / blog / archive | template and routing surface | records |
| Content Blocks | definition format changes between majors | blocks defined |
| Commerce | orders, payment integrations, tax data | orders |

**The record count is the point.** An extension with zero records gets *removed*, not migrated —
and that is the cheapest possible outcome, so it is worth ten seconds of SQL to find. On a real
survey a site carried a full form framework with **zero** forms, because its forms had quietly
moved to the core one years earlier.

### Frontend

- Build tooling actually present: `package.json` scripts, `Build/`, config files for whichever
  bundler. Note when a bundler is *declared* but has no config and no scripts — that is common
  and means there is no build, whatever the dependency list suggests.
- Sitepackage: Fluid template and TypoScript file counts, as a volume measure.
- Frontend libraries shipped to visitors, with versions. Decade-old jQuery with published
  advisories is an upgrade driver in its own right.

### Accessibility

Do **not** ask the README. It essentially never records this, and an absent answer reads as "no
work done" when it may simply be unwritten. If a number is wanted, measure it — `a11y-audit.mjs`
gives a real count in a minute. Otherwise record "not assessed" and move on.

---

## Reporting

One section per project, same order every time, so the batch can be read as a table. Then a
**cross-project summary** — which is the actual deliverable:

- projects with no blocking extension, ordered cheapest first
- projects blocked, with the specific package and what it provides
- anything with lead time that must start now: licences, engine migrations, data migrations
- where the custom-code effort is concentrated

Keep measurements and estimates visually separate. A line count is a measurement; "about three
days" is an estimate that depends on the reader knowing the code. Presenting them in the same
column is how a survey turns into a commitment nobody agreed to.
