# webconsulting additions — `php-modernization`

> **Overlay.** The vendored `SKILL.md` and its references are upstream Netresearch content, kept
> byte-identical. This file is webconsulting's addition and changes nothing above it.

## PHP target policy in this collection

The upstream skill covers PHP 8.1–8.5 features generally. This collection applies a specific target:

- **PHP 8.4 is the standard** for project and site work.
- **PHP 8.5 is preferred where the whole dependency set resolves on it.** Attempt it explicitly with
  `composer why-not php 8.5`, and record the outcome — "we could not use 8.5" and "we never checked"
  are different statements and only one of them is a finding.
- **PHP 8.2 remains the TYPO3 v14 Core floor**, so a *reusable* package may legitimately declare
  `^8.2` when it tests that range in CI. Do not copy a project's 8.4 floor into a reusable package,
  and do not copy a package's `^8.2` into a project.

`typo3-upgrade-run` owns this policy and gates on it; `typo3-initial-release` covers the reusable-
package side.

## Platform pin

Keep `config.platform.php` in step with the container, never ahead of it. A platform pin ahead of
the runtime makes Composer select packages the runtime cannot boot, and the resulting failure looks
like a code problem rather than a configuration one — which is why it costs so much time to find.

## PHPStan levels used here

| Target | Level |
|---|---|
| Project code | 9 minimum |
| Local extensions in `packages/` | 10 |

Never lower an existing stricter level. No new suppressions or baseline entries for new or touched
code; the baseline must **shrink** across an upgrade, and gate A5 of `typo3-upgrade-run` checks that
it did.

## Credits & Attribution

This skill is based on the excellent work by **Netresearch DTT GmbH**.
Original repository: https://github.com/netresearch/php-modernization-skill

Special thanks to Netresearch for publishing and maintaining these skills.
Copyright (c) Netresearch DTT GmbH; original licence files are preserved.
Adapted by webconsulting.at for this skill collection through this overlay only; the upstream skill is unmodified.
