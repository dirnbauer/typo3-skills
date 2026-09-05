# Architecture Testing with phpat

PHP Architecture Tester (phpat) enforces architectural rules through automated tests.

## Installation

```bash
composer require --dev carlosas/phpat
```

## Configuration

Create `phpat.php` in project root:

```php
<?php

declare(strict_types=1);

use PhpAT\Rule\Rule;
use PhpAT\Selector\Selector;
use PhpAT\Test\ArchitectureTest;

final class ArchitectureTests extends ArchitectureTest
{
    public function testServicesDoNotDependOnControllers(): Rule
    {
        return $this->newRule
            ->classesThat(Selector::haveClassName('*Service'))
            ->mustNotDependOn()
            ->classesThat(Selector::haveClassName('*Controller'))
            ->build();
    }

    public function testDomainDoesNotDependOnInfrastructure(): Rule
    {
        return $this->newRule
            ->classesThat(Selector::havePath('Domain/*'))
            ->mustNotDependOn()
            ->classesThat(Selector::havePath('Infrastructure/*'))
            ->build();
    }

    public function testEventsAreReadonly(): Rule
    {
        return $this->newRule
            ->classesThat(Selector::havePath('Event/*'))
            ->mustBeReadonly()
            ->build();
    }
}
```

## TYPO3 Extension Rules

### Layer Constraints

```php
public function testCleanArchitecture(): Rule
{
    return $this->newRule
        ->classesThat(Selector::havePath('Classes/Domain/*'))
        ->mustNotDependOn()
        ->classesThat(Selector::havePath('Classes/Controller/*'))
        ->andClassesThat(Selector::havePath('Classes/Command/*'))
        ->build();
}
```

### Service Layer Rules

```php
public function testServicesHaveInterface(): Rule
{
    return $this->newRule
        ->classesThat(Selector::haveClassName('*Service'))
        ->excludingClassesThat(Selector::haveClassName('*Interface'))
        ->mustImplement()
        ->classesThat(Selector::haveClassName('*Interface'))
        ->build();
}
```

## Running Tests

```bash
# Via PHPUnit
vendor/bin/phpunit --testsuite Architecture

# Via runTests.sh
Build/Scripts/runTests.sh -s architecture
```

## PHPUnit Configuration

Add to `phpunit.xml`:

```xml
<testsuite name="Architecture">
    <file>phpat.php</file>
</testsuite>
```

## Common Rules

| Rule | Purpose |
|------|---------|
| `mustNotDependOn` | Prevent unwanted dependencies |
| `mustImplement` | Enforce interface usage |
| `mustBeReadonly` | Enforce immutability (PHP 8.2+) |
| `mustBeFinal` | Prevent inheritance |
| `mustNotConstruct` | Enforce DI |

## Security-Critical Extensions

For security-critical code, enforce:

1. Events are readonly
2. Services don't construct other services (use DI)
3. Domain layer is isolated
4. No circular dependencies

## Hand-Rolled Reflective Sweeps on a Dual-Version Matrix

Beyond phpat, extensions write their own tests that walk `Classes/` with
reflection — API-surface snapshots, naming sweeps, "every X implements Y"
checks. On a CI matrix spanning two TYPO3 majors these hit a trap:

**`class_exists()` does not return false for a class whose parent or interface
is missing on this matrix leg — the autoload attempt THROWS an `Error`.**
Observed on a `^13.4 || ^14.3` matrix: an upgrade wizard implementing
`TYPO3\CMS\Core\Upgrades\UpgradeWizardInterface` (that name exists only on
14.x) made `class_exists()` fatal the whole sweep on every 13.4 leg, while all
14.x legs — including the local default — stayed green. The failure surfaces
one CI round trip after the test was written.

Guard the existence check and keep the two failure modes apart:

```php
try {
    $loadable = class_exists($fqcn) || interface_exists($fqcn)
        || trait_exists($fqcn) || enum_exists($fqcn);
} catch (\Throwable) {
    // THREW: a parent/interface comes from a package this matrix leg does
    // not ship — the class cannot be part of this leg's sweep. Skip it.
    continue;
}

// Clean FALSE (no throw): the PSR-4 name resolves to nothing anywhere.
// That is a broken discovery rule, not a matrix difference — keep it fatal.
self::assertTrue($loadable, sprintf('%s does not autoload', $fqcn));
```

Two consequences worth stating in the test: a snapshot-style sweep turns a
version-split class into a visible diff on the leg that lacks it (instead of a
fatal), and the `catch (\Throwable)` also swallows a `ParseError` in a swept
file — say explicitly that the lint job owns that case.
