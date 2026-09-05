# Proving a Test

A test that passes with your fix in place proves nothing on its own. Reviewers ask for the other half, and they ask for it by name. From the review of change 92020:

> Could you please add a test case / fixture for this scenario that **fails without the patch** and succeeds with these changes in place?

Six patch sets later, the same reviewer came back with:

> Can you please check why these three tests do not actually fail without the patch to their matchers?

Both comments are about the same property: the test must fail **in the position where you put it**, for the reason you think it does.

## The procedure

1. Write the test and run it with the fix applied. It must pass.
2. Revert the fix **in the working tree only** — do not touch the commit:

   ```bash
   # one-line change: edit it back by hand or with a targeted sed
   sed -i 's/<fixed>/<broken>/' path/to/file
   git diff --stat path/to/file    # confirm exactly one file, one line
   ```

3. Run the test again. It must fail, and the failure message must name the thing you changed. A test that errors out for an unrelated reason (missing fixture, bootstrap failure) has not been proven.
4. Restore the fix and re-run:

   ```bash
   git checkout HEAD -- path/to/file
   ```

5. Run the **whole test class**, not just your filter — a new fixture or a changed shared helper can break siblings.

## When the mutation does not fail

A test that stays green after you broke the code is not a weak assertion until you have ruled out the other explanation: the harness never loaded the code you changed. `FunctionalTestCase` builds its instance from `$coreExtensionsToLoad` and `$testExtensionsToLoad`; an extension missing from those lists is simply absent, and the test exercises the core default instead. Nothing reports this — there is no "extension not loaded" error, the assertion just quietly describes something else.

Same shape outside TYPO3, where it cost a review round in [phpDocumentor/guides#1353](https://github.com/phpDocumentor/guides/pull/1353): code highlighting lives in an optional package that a project switches on in its `guides.xml`. The existing integration fixture for `literalinclude` had never switched it on, so every run rendered the fallback template — a bare `{{ node.value }}` — and a crash inside the highlighting filter could not reach it. The fixture had been green for years while never touching the code it appeared to cover. Enabling the package in the fixture's own config was what made the reverted fix fail, and it failed with the exact `TypeError` from the bug report.

So when step 3 leaves the test green, check in this order: is the component registered in **this test's** environment, does the entry point you assert on reach it, and only then whether the assertion is too weak.

## Counting occurrences for the report

`grep -r` in a tree where the suite has run counts generated output as if it were source — `var/`, `typo3temp/`, `.Build/`, and every fixture's own output directory. `git grep` sees tracked files only. Any number that lands in a commit message or a review reply has to come from the tracked tree: a count taken from a post-run worktree was wrong by four, went into a public review comment, and had to be corrected afterwards.

## Commands

```bash
./Build/Scripts/runTests.sh -s functional -- <path/to/Test.php>
./Build/Scripts/runTests.sh -s functional -- --filter <testMethod> <path/to/Test.php>
./Build/Scripts/runTests.sh -s unit -- <path/to/Test.php>
./Build/Scripts/runTests.sh -s cgl -n        # -n = dry run, reports without writing
./Build/Scripts/runTests.sh -s phpstan -n
```

Never chain `-s phpstanGenerateBaseline` into a verification run. It rewrites `Build/phpstan/phpstan-baseline.neon`, which can absorb the very findings you are checking for, and it leaves an unintended file in your diff.

## Deciding whether a test is needed

"Comparable merged changes shipped without one" describes the project's habit, not whether a test is possible or useful — do not use it as a reason to skip. Ask instead whether the changed behaviour is reachable from an existing test entry point. In EXT:form, for example, `FormRuntime::render()` returns the rendered markup and several functional tests already assert on it, so template-level changes are testable even though most merged template bugfixes carry no test.

If the behaviour genuinely cannot be reached — a build script, a CI definition, a documentation file — say so in the commit message rather than leaving the omission unexplained.

## Documenting it

When the patch carries tests, add the project's standard line to the commit message body:

```
Added tests fixate this behavior.
```
