# Mutation Testing for TYPO3 Extensions

## Overview

Mutation testing verifies test suite quality by introducing small bugs (mutants) into the code and checking if tests catch them. If a test suite has good coverage but low mutation score, the tests may not be actually testing the important behaviors.

> **Key Distinction**: Mutation testing mutates **code** to verify test quality. For testing that mutates **inputs** to find crashes, see [Fuzz Testing](fuzz-testing.md).

| Aspect | Mutation Testing | Fuzz Testing |
|--------|-----------------|--------------|
| **Mutates** | Source code | Input data |
| **Purpose** | Verify test quality | Find crashes/vulnerabilities |
| **Example** | `if (x != y)` → `if (x == y)` | `<img src="` → `<img src="../../../../etc/passwd` |
| **Finds** | Weak/missing tests | Parsing bugs, security issues |
| **Tool (PHP)** | Infection | nikic/php-fuzzer |

## When to Use Mutation Testing

- After achieving high code coverage (70%+) to verify test quality
- Before releases to ensure critical paths are well-tested
- When refactoring to ensure tests catch regressions
- To identify "weak spots" in test coverage

## The Single-Mutant Check: Prove One Regression Guard By Hand

A full Infection run is the wrong tool when the question is narrow: *does the test I just
wrote actually catch the bug I just fixed?* Answer it directly — revert the production line
to its buggy form, run the affected tests, and require them to **fail**; then restore the
fix and require them to pass. A test that stays green both ways guards nothing, and it looks
identical to a working one in a passing suite.

Do this whenever the bug is one a test could plausibly miss: a silently dropped argument, a
default that quietly substitutes for a rejected value, a mocked collaborator that accepts any
call shape. Mock-based tests are especially prone to it — a mock cannot reproduce the real
library's argument filtering, so asserting *how* it was called is the only thing that binds.

Run it through `runTests.sh` so the check inherits the project's Docker PHP-version isolation —
a pass/fail signal is only worth as much as the environment it came from:

```bash
# 1. Baseline: the guard passes
Build/Scripts/runTests.sh -s unit -- --filter=theGuardingTest

# 2. Reintroduce the bug (exact string replace, not a regex sed)
python3 - <<'PY'
p = 'Classes/Service/Thing.php'
s = open(p).read()
old, new = "save($path, quality: $quality)", "save($path, $quality)"
assert s.count(old) == 1, f'expected 1 occurrence, found {s.count(old)}'
open(p, 'w').write(s.replace(old, new))
PY
grep -n 'save(\$path' Classes/Service/Thing.php   # confirm the edit applied

# 3. The guard MUST fail now
Build/Scripts/runTests.sh -s unit -- --filter=theGuardingTest

# 4. Restore and confirm green again
git checkout -- Classes/Service/Thing.php
git diff --quiet -- Classes/ && Build/Scripts/runTests.sh -s unit -- --filter=theGuardingTest
```

Where the project has no `runTests.sh` — or you are already inside the container — the direct
equivalent is `vendor/bin/phpunit -c Build/phpunit/UnitTests.xml --filter=theGuardingTest`. This is
the single-class case that [`test-runners.md`](test-runners.md) reserves plain `phpunit --filter`
for; do not generalise it to running whole suites outside the entry point.

Four traps make this check lie:

- **Verify the mutation applied.** A `sed` pattern that silently matches nothing leaves the
  file untouched, and the suite then "fails" for some unrelated reason — or passes, and you
  conclude the guard is worthless. Assert the occurrence count when replacing, and `grep`
  the file afterwards. Restore from a byte copy and confirm with `git diff --quiet`.
- **Read the failure, not just the exit code.** In an environment with pre-existing failures
  (a missing `gd`/`imagick` extension makes unrelated tests error), a non-zero exit proves
  nothing on its own. Scope the run with `--filter`, or compare the failing-test set against
  the baseline.
- **A mutation that does not compile is not a caught defect.** The trap above assumes the
  mutated file still parses. When the edit breaks syntax — a dropped semicolon, an unmatched
  brace, a wrong indent in a Python or YAML fixture — the runner exits non-zero at *load*
  time, before any assertion runs. The exit code looks like a kill, and comparing against the
  baseline makes it look like a large one: every test in the file fails, not just the guard.
  Assert the file parses before you run anything, and read the log for a parse diagnostic
  rather than trusting the status alone:

  ```bash
  php -l Classes/Service/Thing.php
  python3 -c 'import ast, sys; ast.parse(open(sys.argv[1]).read())' tests/test_thing.py
  node --check src/thing.js
  ```

  In a language that rejects unused imports, deleting a call breaks the build without touching
  syntax — `go build ./...` catches that, and `php -l` deliberately does not: an orphaned
  `use` is valid PHP.
- **If a test other than the intended one goes red, suspect the mutation.** The guard you
  wrote should be the thing that catches the defect you built for it. When a different test
  fails instead — or fails *as well* — the usual cause is that the injected defect is not the
  one you meant: it fires earlier, or on a broader path, so a coarser test reaches it first
  and the intended guard is never exercised. That leaves the guard unproven while the run
  reads like a success. Name which test you expect to fail before running, and if the answer
  differs, fix the mutation rather than accepting the tally.

Re-run this after any refactor of the test itself — consolidating duplicated test setup can
quietly detach the assertion from the behaviour it was guarding.

### Running a batch: two ways the tally lies

Injecting several defects in a loop and counting kills is the natural next step, and the
count is the whole output — so an error in the counting reads as a statement about the tests.

- **PHPUnit names a failing test with its full namespace.** The failure line is
  `1) Vendor\Ext\Tests\Unit\Service\ThingTest::theCase`, so a harness matching on the
  short class name at the start of the line matches nothing and reports every mutation as
  survived. Measured: a batch of six defects reported "0 caught" against a suite that in fact
  caught all six, and the number was two minutes away from being written up as "these tests
  assert nothing". Match on `::`, or on the whole line, and print one captured name per
  mutation while developing the harness.
- **Accept a run on its case count *and* its outcome fields.** `Tests: 1` where the file holds
  four is an aborted run — a collection error, a missing bootstrap, a filter that matched one
  case — and its exit code is indistinguishable from a kill. Parse the `Tests: N` line and
  compare against the file's case count. That is necessary and not sufficient: PHPUnit can
  report the full count with every case skipped and exit 0. Count a mutant killed only on an
  assertion failure — exit 1 with `Failures: N` and no `Errors:` — and treat an error, a
  skipped-only run or any other status as an invalid run rather than a kill.

A tally that comes out at 0 or at 100 % is the moment to verify the harness against a known
answer: mutate one line you are sure a named test covers, and check the harness reports that
test.

### When a mutation survives, ask what level the assertion sits at

A surviving mutation has two readings — the code is untested, or the test looks at the wrong
thing — and they need different fixes. Two shapes from one review round on a credential
derivation:

- The test compared a **fingerprint** built from several fields, and the mutation changed only
  one of them. Dropping the username from the id derivation left every account with the same
  id, while length and transports still differed per account, so the fingerprints differed and
  the test passed. The assertion had to move onto the id alone.
- The test then compared ids for **inequality**, and the mutation still survived: with a shared
  derivation the ids differ only by the length they are cut to, so one is a prefix of the other.
  Inequality holds and the disclosure remains. The assertion had to reject a shared prefix.

Both were found by building a mutation for a property rather than for a line. Before accepting
a test as coverage, name the defect it exists to catch and mutate exactly that.

## Tools

### Infection (Recommended)

PHP mutation testing framework with PHPUnit integration.

**Installation:**
```bash
composer require --dev infection/infection:^0.27
```

**Key features:**
- Mutates PHP code with various operators
- Integrates with PHPUnit and Pest
- Generates HTML and JSON reports
- Supports incremental analysis

## Preflight: Tests Must Pass Before Mutating

Infection runs the configured PHPUnit suite **once, unmutated**, before applying any mutations. If that initial run reports failures or errors -- even a single one -- Infection aborts and reports nothing. In practice, two recurring causes blow up the preflight:

1. **Flaky fuzz tests.** `random_int(0, $n)` legitimately returns `0`, and `random_bytes(0)` then throws `\ValueError("random_bytes(): Argument #1 ($length) must be greater than 0")` (PHP 8.0+ — was `\Error` before). The fuzz suite passes most of the time and randomly fails inside Infection's preflight. **Fix:** use `random_int(1, $n)` (or `max(1, $n)`) anywhere a randomly-chosen length feeds into `random_bytes()` / `openssl_random_pseudo_bytes()` / similar zero-rejecting APIs.
2. **Functional tests included in the unit suite.** If `phpunit.xml` mixes unit and functional suites, Infection tries to boot a database it cannot reach during local mutation runs.
3. **A test case that asserts nothing.** PHPUnit marks it *risky*, which most project configs tolerate -- but Infection does not run your `phpunit.xml`. It writes its own, under the configured `tmpDir` (`phpunitConfiguration.initial.infection.xml` -- with the `infection.json5` in `assets/` that is `.Build/infection/tmp/`), and that config is strict, so PHPUnit exits 1 and Infection aborts with `Project tests must be in a passing state before running Infection` while the same suite is green in CI. The usual source is a data provider whose expectation is an empty array over which the test loops: `'valid key' => ['ext1', []]` iterates zero times and asserts nothing. **Fix:** compare the whole result (`assertSame($expected, $actual)`) instead of searching it for expected entries -- that closes the real gap, since the "valid" cases were the ones testing nothing.

**Rule of thumb:** before running `infection`, run the exact same command Infection will run (`testFrameworkOptions` from `infection.json5`) and confirm it is green. Fix flakes there, not in Infection's CI logs. Add `--fail-on-risky` to that rehearsal: without it the run passes locally and Infection still aborts, because its generated config is stricter than the project's.

**If your PHPUnit config points at a remote schema, Infection needs the network.** It validates the configuration it generates and keeps the `xsi:noNamespaceSchemaLocation` of the config it started from. With `https://schema.phpunit.de/<version>/phpunit.xsd` there, an offline machine dies in `XmlConfigurationManipulator` with `failed to load external entity` before the first mutant, and a green CI job says nothing about the local failure. The `UnitTests.xml` in `assets/` points at the vendored `../../vendor/phpunit/phpunit/phpunit.xsd` and is unaffected -- pointing the schema at the vendored copy is the fix, not a workaround.

## Suite Layout: Split Unit/Fuzz From Functional

Keep two PHPUnit configs:

- `phpunit.xml` (or `Build/phpunit/UnitTests.xml`) -- unit + fuzz suites only, no DB, fast.
- `phpunit.functional.xml` (or `Build/phpunit/FunctionalTests.xml`) -- functional tests, requires MySQL/MariaDB.

Point Infection's `testFrameworkOptions` at the unit/fuzz config so the preflight is fast and DB-free:

```json5
"testFrameworkOptions": "-c Build/phpunit/UnitTests.xml"
```

Infection also auto-discovers a `phpunit.xml` (or `phpunit.xml.dist`) in `phpUnit.configDir` (defaults to project root) when `testFrameworkOptions` is not used -- it expects the **standard file names**, so do not rename to `phpunit-unit.xml` or similar without setting `phpUnit.configDir` explicitly:

```json5
"phpUnit": {
    "configDir": "Build/phpunit"
}
```

Either pin the config explicitly (`testFrameworkOptions`) or keep the default name and use `phpUnit.configDir` -- never both implicit. This keeps `composer ci:test:php:unit` and `composer ci:test:mutation` running the same PHPUnit invocation, which is the point of the split.

## Configuration

Create `infection.json5` in project root.

> **TYPO3 convention:** When using `.Build/` for vendor dependencies, use the local schema path
> `".Build/vendor/infection/infection/resources/schema.json"` instead of the remote URL. This
> works offline and reflects the actual installed version.

```json5
{
    "$schema": ".Build/vendor/infection/infection/resources/schema.json",
    "source": {
        "directories": [
            "Classes"
        ],
        "excludes": [
            "Domain/Model"  // Skip simple DTOs
        ]
    },
    "logs": {
        "html": ".Build/logs/infection.html",
        "text": ".Build/logs/infection.log",
        "summary": ".Build/logs/infection-summary.log"
    },
    "mutators": {
        "@default": true,
        // Disable noisy mutators if needed
        "TrueValue": false,
        "FalseValue": false
    },
    "minMsi": 60,           // Minimum Mutation Score Indicator
    "minCoveredMsi": 80,    // Minimum MSI for covered code only
    "testFramework": "phpunit",
    "testFrameworkOptions": "-c Build/phpunit/UnitTests.xml"
}
```

## Mutation Operators

Infection applies these types of mutations:

### Arithmetic Operators
```php
// Original
$result = $a + $b;

// Mutants
$result = $a - $b;  // PlusToMinus
$result = $a * $b;  // PlusToMultiplication
```

### Comparison Operators
```php
// Original
if ($value > 10) { ... }

// Mutants
if ($value >= 10) { ... }  // GreaterThan to GreaterThanOrEqual
if ($value < 10) { ... }   // GreaterThan to LessThan
if (true) { ... }          // Always truthy
```

### Boolean Operators
```php
// Original
if ($a && $b) { ... }

// Mutants
if ($a || $b) { ... }  // LogicalAnd to LogicalOr
if ($a) { ... }        // Remove operand
```

### Return Values
```php
// Original
return $value;

// Mutants
return null;           // Return null
return [];             // Return empty array
return !$value;        // Negate boolean
```

### Method Calls
```php
// Original
$this->save($entity);

// Mutant
// Line removed (method call deleted)
```

## Running Mutation Tests

### Via Composer Scripts

```json
{
    "scripts": {
        "ci:test:mutation": [
            "@ci:test:php:unit",
            ".Build/bin/infection --threads=4"
        ],
        "ci:test:mutation:quick": [
            ".Build/bin/infection --threads=4 --only-covered --min-msi=60"
        ]
    }
}
```

### Via runTests.sh

```bash
# Add to Build/Scripts/runTests.sh
mutation)
    # Run unit tests first to generate coverage
    COMMAND=(.Build/bin/phpunit -c Build/phpunit/UnitTests.xml --coverage-xml=.Build/logs/coverage-xml --coverage-html=.Build/logs/coverage-html)
    ${CONTAINER_BIN} run ${CONTAINER_COMMON_PARAMS} --name unit-${SUFFIX} ${IMAGE_PHP} "${COMMAND[@]}"

    # Run mutation testing
    COMMAND=(.Build/bin/infection --threads=4 --coverage=.Build/logs/coverage-xml)
    ${CONTAINER_BIN} run ${CONTAINER_COMMON_PARAMS} --name mutation-${SUFFIX} ${IMAGE_PHP} "${COMMAND[@]}"
    SUITE_EXIT_CODE=$?
    ;;
```

### Directly

```bash
# Full mutation test run
.Build/bin/infection --threads=4

# Quick run (only test covered code)
.Build/bin/infection --threads=4 --only-covered

# With existing coverage
.Build/bin/infection --threads=4 --coverage=.Build/logs/coverage-xml

# Filter to specific directory
.Build/bin/infection --threads=4 --filter=Classes/Service
```

## Interpreting Results

### Mutation Score Indicator (MSI)

```
Mutations:       150 total
Killed:          120 (80%)    ← Tests caught the mutation
Escaped:          15 (10%)    ← Tests MISSED the mutation (bad!)
Errors:            5 (3%)     ← Mutation caused fatal error
Uncovered:        10 (7%)     ← No tests for this code

MSI: 80%                      ← (Killed + Errors) / Total
Covered MSI: 86%              ← MSI for covered code only
```

### Understanding Results

| Status | Meaning | Action |
|--------|---------|--------|
| **Killed** | Test failed when mutant introduced | Good - test is effective |
| **Escaped** | Test passed with mutant | **Bad - add/improve tests** |
| **Errors** | Mutant caused fatal error | Counted as killed — read them before trusting the score (below) |
| **Uncovered** | No test coverage | Add coverage first |
| **Timeout** | Test took too long with mutant | Usually OK |
| **Skipped** | Mutant not tested | Check config |

### Errored Mutants Inflate the Score

Infection counts an errored mutant as killed, so errors raise the MSI. A
few type errors that a mutation provokes are fine. A cluster of errors with
the **same message** is not: it is a defect of the test setup, and the
score built on it is too high. Group the messages before reading the number:

```bash
jq -r '.errored[].processOutput' build/infection-log.json \
  | grep -E 'Message:|Error:' | sort | uniq -c | sort -rn | head
```

The typical cluster is `Class "Vendor\Ext\Tests\...\AbstractFooTest" not
found`. Infection runs PHPUnit once per mutant, filtered to the test files
that cover it. A test base class that only ever loaded because the
directory suite happened to read its file first is then missing, while the
full suite stays green. Reproduce it with one file on its own:

```bash
vendor/bin/phpunit -c <config> path/to/FooSubclassTest.php   # Class "..." not found
```

The fix is an autoload mapping for the test namespaces, and it belongs in
the **root** `composer.json`. In a site project whose extensions come in
through a `path` repository, an extension's own `autoload-dev` is ignored —
Composer reads `autoload-dev` from the root package only:

```json
"autoload-dev": {
  "psr-4": {
    "Vendor\\Ext\\Tests\\": "extensions/ext/Tests/"
  }
}
```

Then check that every test class matches the mapping: for each file under
`Tests/`, `class_exists()` on its declared namespace and class name through
`vendor/autoload.php` must be true. A namespace missing its `Unit\`
segment, or a test declared in the production namespace, stays unloadable.

Declare a shared base class `abstract` and give it the suffix `TestCase`.
A concrete base needs a placeholder test that every subclass inherits, and
PHPUnit 12 warns about an abstract class in a file that matches the suite's
`Test.php` suffix.

After the fix the score drops to its honest value — the former errors now
count as escaped or killed. Derive thresholds such as `minCoveredMsi` from
that run, not from the inflated one.

### Equivalent Mutants Escape by Design

An equivalent mutant changes the code without changing any observable
result, so no test can kill it. Recognize the shape before writing tests
for it. A common one in Extbase validators is the `return` directly after
`$this->addError(...)`:

```php
if ($value === '') {
    $this->addError('Value must not be empty.', 1700000001);
    return;   // mutant: this return removed
}
```

Removing the `return` leaves the error recorded, so the value is still
invalid; the checks after it now run as well. The mutant is equivalent only
if those checks can do nothing but add further errors (no exception, no
state change, no call on a collaborator) and no caller depends on the exact
error list. Read the checks after the `return` before classifying the
mutant. Only if stopping at the first error is a contract does a test
asserting the complete error list (count and codes) belong here. Otherwise
leave these escapes in the report instead of chasing the score.

### Target Scores

| Level | MSI | Covered MSI | Use Case |
|-------|-----|-------------|----------|
| Basic | 50%+ | 60%+ | Initial implementation |
| Good | 70%+ | 80%+ | Production code |
| Excellent | 85%+ | 90%+ | Critical/security code |

## Improving Mutation Score

### 1. Fix Escaped Mutants

Review the HTML report to find escaped mutants:

```html
<!-- .Build/logs/infection.html -->
<!-- Shows: Original code, Mutated code, Test that should have caught it -->
```

### 2. Add Boundary Tests

```php
// If this escapes:
//   if ($age >= 18) → if ($age > 18)
// Add boundary test:
public function testAgeExactly18IsAllowed(): void
{
    self::assertTrue($this->validator->isAdult(18));
}
```

Time-based checks hide the same gap. An expiry test whose fixtures sit an
hour away from "now" (`exp = now - 3600` and `now + 3600`) passes for both
`$expiresAt < $now` and `$expiresAt <= $now`, so the `<` → `<=` mutant
escapes and nothing pins what happens at the exact second. Decide what the
boundary must do, freeze the clock, and add a fixture **exactly on the
boundary** (`exp == now`) that asserts that decision.

### 3. Add Negative Tests

```php
// If method removal escapes:
//   $logger->error($message);  // removed
// Add test verifying the call:
public function testErrorIsLogged(): void
{
    $logger = $this->createMock(LoggerInterface::class);
    $logger->expects(self::once())
        ->method('error')
        ->with('Expected message');

    $service = new MyService($logger);
    $service->doSomethingThatLogs();
}
```

### 4. Test Return Values

```php
// If return value mutation escapes:
//   return $result; → return null;
// Verify return value explicitly:
public function testReturnsCalculatedValue(): void
{
    $result = $calculator->compute(5, 3);
    self::assertSame(8, $result);  // Not just assertNotNull!
}
```

### 5. Kill Common TYPO3 Escaped Mutants

#### Concat mutations (string reordering/removal)
```php
// WEAK — Concat mutations escape because substring order doesn't matter
$message = $service->getErrorMessage();
self::assertStringContainsString('provider', $message);
self::assertStringContainsString('LLM module', $message);

// STRONG — kills Concat mutations by asserting the exact string
$message = $service->getErrorMessage();
self::assertSame(
    'No LLM provider configured. Create a provider in Admin Tools > LLM > Providers.',
    $message,
);
```

#### LogicalOr to LogicalAnd mutations
```php
// Given this code under test:
//
// public function getStatusMessage(\Throwable $e): string {
//     $msg = $e->getMessage();
//     if (str_contains($msg, '401') || str_contains($msg, 'Unauthorized')) {
//         return 'The API key was rejected.';
//     }
//     return 'An unknown error occurred.';
// }
//
// Test each OR branch individually to kill the LogicalAnd mutation:

#[Test]
public function recognizes401Code(): void
{
    // Only "401", no "Unauthorized" — kills LogicalAnd mutation
    $result = $this->subject->getStatusMessage(
        new \RuntimeException('HTTP 401 error'),
    );
    self::assertSame('The API key was rejected.', $result);
}

#[Test]
public function recognizesUnauthorized(): void
{
    // Only "Unauthorized", no "401"
    $result = $this->subject->getStatusMessage(
        new \RuntimeException('Request Unauthorized'),
    );
    self::assertSame('The API key was rejected.', $result);
}
```

#### GreaterThan to GreaterThanOrEqual mutations
```php
// If code has: $check = $count > 0 ? createOkCheck() : createErrorCheck();
// You must assert BOTH branches to kill the mutation.

// 1. Test for count > 0 (e.g., count = 1)
$passingCheck = $this->service->runCheck(1);
self::assertSame(Severity::Ok, $passingCheck->severity);
self::assertNull($passingCheck->fixRoute);

// 2. Test for count = 0. This kills the `>` to `>=` mutation.
$failingCheck = $this->service->runCheck(0);
self::assertSame(Severity::Error, $failingCheck->severity);
self::assertSame('nrllm_providers', $failingCheck->fixRoute);
```

## CI Integration

### GitHub Actions

```yaml
# .github/workflows/tests.yml
mutation:
  name: Mutation Testing
  runs-on: ubuntu-latest
  needs: [unit]  # Run after unit tests pass
  steps:
    - uses: actions/checkout@v4
    - uses: shivammathur/setup-php@v2
      with:
        php-version: '8.2'
        coverage: xdebug

    - run: composer install

    - name: Run unit tests with coverage
      run: |
        .Build/bin/phpunit -c Build/phpunit/UnitTests.xml \
          --coverage-xml=.Build/logs/coverage-xml \
          --log-junit=.Build/logs/phpunit.xml

    - name: Run mutation testing
      run: |
        .Build/bin/infection \
          --threads=4 \
          --coverage=.Build/logs/coverage-xml \
          --min-msi=60 \
          --min-covered-msi=80 \
          --skip-initial-tests

    - name: Upload mutation report
      if: always()
      uses: actions/upload-artifact@v4
      with:
        name: mutation-report
        path: .Build/logs/infection.html
```

### Quality Gate

```yaml
# Fail CI if mutation score drops
- name: Check mutation score
  run: |
    .Build/bin/infection \
      --threads=4 \
      --min-msi=60 \
      --min-covered-msi=80 \
      --only-covered
```

## Best Practices

1. **Run unit tests first** - Mutation testing needs passing tests
2. **Start with low thresholds** - Increase gradually (50% → 60% → 70%)
3. **Focus on covered code** - Use `--only-covered` for actionable results
4. **Prioritize escaped mutants** - These indicate weak tests
5. **Exclude trivial code** - Skip getters/setters/DTOs in config
6. **Run incrementally** - Use `--git-diff-filter=AM` for changed files only
7. **Document exclusions** - Explain why code is excluded from mutation testing

## Incremental Mutation Testing

For large codebases, run mutation testing only on changed files:

```bash
# Only test files changed in current branch
.Build/bin/infection \
  --threads=4 \
  --git-diff-filter=AM \
  --git-diff-base=origin/main \
  --only-covered
```

## Directory Structure

```
project/
├── infection.json5           # Infection configuration
├── .Build/
│   └── logs/
│       ├── infection.html    # HTML report
│       ├── infection.log     # Detailed log
│       └── infection-summary.log
└── Tests/
    └── Unit/
        └── Service/
            └── MyServiceTest.php
```

## Resources

- [Infection PHP](https://infection.github.io/) - PHP mutation testing framework
- [Mutation Testing](https://en.wikipedia.org/wiki/Mutation_testing) - Concept overview
- [Pitest](https://pitest.org/) - Java mutation testing (for comparison)
- [Stryker](https://stryker-mutator.io/) - JavaScript/TypeScript mutation testing
