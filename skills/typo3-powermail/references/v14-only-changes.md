# Version selection and TYPO3 v14 verification

Recheck metadata on the day of installation. The following source snapshot was inspected
on **2026-09-26**; exact SHAs are in the [evidence report](../../../catalog/powermail-source-review.md).

## Public upstream versus forks

Public Packagist stable metadata lists Powermail **13.3.0** and powermail_cond **13.1.2**,
both declaring Core `^13.4`, PHP `^8.2`. The public conditions README points to in2code's
Early Access Programme for TYPO3 14. Do not claim there is no v14 vendor offering.

The dirnbauer Powermail fork's reviewed **14.0.3.4** tag requires Core `^14.3.6`,
PHP `>=8.3 <8.6`. The conditions fork's `typo3-v14` branch requires PHP `^8.4`,
Core `^14.3` and Powermail `^14.0`. Its observed tags contain no v14 release.
For the pair, use PHP 8.4 (or a separately verified compatible version) and satisfy the
stricter Powermail Core floor. A fork tag is not an official in2code release.

Sources: [upstream Powermail metadata](https://repo.packagist.org/p2/in2code/powermail.json),
[upstream conditions metadata](https://repo.packagist.org/p2/in2code/powermail_cond.json),
[fork Powermail manifest](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/composer.json),
[fork conditions manifest](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/composer.json).

## Install the pair deliberately

Obtain approval for third-party fork dependencies, then add **both** VCS entries to the
project's root Composer configuration. Dependency packages' `repositories` entries are
not inherited by Composer. Restrict each repository to its intended package:

```json
{
  "repositories": [
    {
      "type": "vcs",
      "url": "https://github.com/dirnbauer/powermail_cond.git",
      "only": ["in2code/powermail_cond"]
    },
    {
      "type": "vcs",
      "url": "https://github.com/dirnbauer/powermail.git",
      "only": ["in2code/powermail"]
    }
  ],
  "require": {
    "in2code/powermail": "^14.0",
    "in2code/powermail_cond": "dev-typo3-v14"
  }
}
```

Merge rather than replace existing repositories/requirements. Resolve the latest compatible
stable Powermail tag with the normal scoped Composer update workflow; inspect the selected
version and lock references. Do not broadly lower `minimum-stability` or use `--ignore-platform-reqs`.
Keep the condition branch explicit: branch updates move, `composer install` from the
committed lockfile does not. Review the package diffs on each update.

Composer behavior: [repositories are root-only](https://getcomposer.org/doc/05-repositories.md),
[repository filtering](https://getcomposer.org/doc/articles/repository-priorities.md).

## Site sets and runtime audit

On the reviewed pair, add the required sets to your site/sitepackage configuration:

```yaml
dependencies:
  - in2code/powermail-main
  - in2code/powermail-cond
```

Do not assume that this replaces custom CSS/templates. Preserve inherited site dependencies
and choose either equivalent static imports or sets.

Check installed TCA for removed keys such as `ctrl.searchFields`; patch only a demonstrated
remaining incompatibility. Do not remove required compatibility aliases solely on Scanner
warnings. Prove render, invalid/valid submit, opt-in if enabled, finishers and outgoing mail.
Test both condition directions, session behavior, wizard transitions and final payload.

Keep a fork exit condition: switch to an approved compatible upstream release when available,
after comparing required fixes/features, removing obsolete repositories and retesting.
Record source inspection separately from actual runtime tests. Core EXT:form finisher/hook
changes do not automatically apply to Powermail's unrelated classes.
