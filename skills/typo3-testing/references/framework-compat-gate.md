# Framework Compatibility Gate

A package whose only consumers are TYPO3 projects has a failure mode its own
test suite cannot reach: the code is correct, the tests are green, and Composer
still refuses to install it next to TYPO3. The suite runs the package in
isolation, so the version constraints it shares with the framework are never
compared to anything.

This is not hypothetical. Two SDKs required `phpdocumentor/reflection-docblock:
^5.3.0`. `typo3/cms-extbase ^14.3` requires `^6.0.3`. Every TYPO3 14 project was
therefore unable to install them, the previous major carried the same pin so
falling back did not help — and 120 green unit tests, PHPStan level 8, Rector,
CGL and a mutation-testing gate all said nothing, because none of them ever put
the package and the framework in the same dependency graph. It surfaced months
later, by accident.

## The gate

One script, one CI job: install the package into a throwaway project together
with the TYPO3 packages a consumer pulls, then load both.

```bash
#!/usr/bin/env bash
# tools/typo3-compat.sh <typo3-constraint> <class-that-must-load>
set -euo pipefail

constraint=${1:?}; probeClass=${2:?}
root=$(cd "$(dirname "$0")/.." && pwd)
package=$(php -r 'echo json_decode(file_get_contents($argv[1]), true)["name"];' "$root/composer.json")

composer=(composer); [ -f "$root/composer.phar" ] && composer=(php "$root/composer.phar")

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT; cd "$work"

"${composer[@]}" init --quiet --no-interaction --name=vendor/typo3-compat-probe
"${composer[@]}" config minimum-stability dev
"${composer[@]}" config prefer-stable true
"${composer[@]}" config allow-plugins.typo3/cms-composer-installers true
"${composer[@]}" config allow-plugins.typo3/class-alias-loader true
# The version is pinned in the repository definition rather than derived from
# the checkout: CI builds on a detached HEAD, where the branch name a path
# repository would otherwise report does not exist.
"${composer[@]}" config repositories.package --json \
    "{\"type\":\"path\",\"url\":\"$root\",\"options\":{\"versions\":{\"$package\":\"9999999-dev\"}}}"

# --no-scripts: the TYPO3 installer plugin runs console commands that need a
# configured application; they fail in a bare probe and say nothing about the
# question asked here, which is whether the versions fit and load.
"${composer[@]}" require --no-interaction --no-progress --prefer-dist --no-scripts \
    "typo3/cms-core:$constraint" "typo3/cms-extbase:$constraint" "$package:9999999-dev"

php -r '
    require $argv[1] . "/vendor/autoload.php";
    foreach ([$argv[2], "TYPO3\\CMS\\Core\\Core\\Bootstrap"] as $class) {
        if (!class_exists($class)) {
            fwrite(STDERR, sprintf("Class %s is not autoloadable.%s", $class, PHP_EOL));
            exit(1);
        }
    }
' "$work" "$probeClass"
```

GitLab CI, binding, across every TYPO3 line the consumers run:

```yaml
typo3-compat:
    stage: testing
    image: php:$PHP
    needs: []
    parallel:
        matrix:
            -   TYPO3: [ '^12.4', '^13.4', '^14.3' ]
                PHP: [ '8.4', '8.5' ]
    before_script:
        - apt-get update -yqq
        - apt-get install -yqq git libicu-dev libxml2-dev libzip-dev zip unzip
        - docker-php-ext-install intl xml zip
    script:
        - curl -sS https://getcomposer.org/installer | php
        - bash tools/typo3-compat.sh "$TYPO3" 'Vendor\Package\EntryClass'
```

No Xdebug and no `needs`: the job resolves and loads, it collects no coverage
and does not want the project's own vendor directory.

## Prove the gate can fail

A gate that has never gone red is a hypothesis. Two probes settle it, both
cheap:

- Put the old constraint back (`^5.3.0`) and run the newest TYPO3 line — the
  run must exit non-zero on `Conclusion: don't install …`.
- Pass an unsatisfiable constraint (`^99.0`) — the run must fail as well.

If either passes, the job is measuring something other than resolvability.

## Reading a failure

Composer names the conflicting package, not the guilty constraint. Compare the
two requirements directly before concluding anything:

```bash
composer why-not typo3/cms-core 14.3
curl -sS https://repo.packagist.org/p2/typo3/cms-extbase.json \
  | jq -r '.packages["typo3/cms-extbase"][] | select(.version|startswith("v14.3")) | .require["phpdocumentor/reflection-docblock"]'
```

Widen to the union of the supported lines (`^5.6.5 || ^6.0.3`) rather than
jumping to the newest — the older TYPO3 lines still have to install. Then run
the package's own suite against the newly admitted versions: resolvability and
correctness are different questions, and only the suite answers the second.

## When the package has no runtime dependencies

Keep the job anyway. It costs one CI minute, and it turns the next dependency
someone adds into a checked assumption instead of an unchecked one.
