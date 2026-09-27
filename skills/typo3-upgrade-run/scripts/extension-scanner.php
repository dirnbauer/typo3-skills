#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Headless adapter for TYPO3's own Extension Scanner (System → Upgrade → Scan Extension Files).
 *
 * TYPO3 13.4/14.3 has no console command for the scanner, and the backend module needs a system
 * maintainer in sudo mode, so an agent cannot produce the P08 evidence there. This runs the SAME
 * Core pipeline over local extension code: the project's installed typo3/cms-install matcher
 * classes and configuration files (read from UpgradeController::$matchers), php-parser for PHP 8.2
 * syntax, NameResolver, GeneratorClassesResolver and CodeStatistics, so @extensionScannerIgnoreFile
 * and @extensionScannerIgnoreLine behave as in the backend. It is not a replacement rule set.
 *
 * It boots no TYPO3, reads no database or configuration and writes only --output. It does load
 * the project's Composer autoloader: run it with the project's PHP (`ddev exec`) on trusted code.
 *
 *   php extension-scanner.php [--root=.] [--packages-dir=packages] [--path=DIR ...] [--output=FILE]
 *
 * Exit: 0 no strong match and no parse error · 1 strong match or parse error · 2 usage/unsupported
 */

use Composer\InstalledVersions;
use PhpParser\Error as ParseError;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitor\NameResolver;
use PhpParser\ParserFactory;
use PhpParser\PhpVersion;
use Symfony\Component\Finder\Finder;
use TYPO3\CMS\Install\Controller\UpgradeController;
use TYPO3\CMS\Install\ExtensionScanner\Php\CodeStatistics;
use TYPO3\CMS\Install\ExtensionScanner\Php\GeneratorClassesResolver;
use TYPO3\CMS\Install\ExtensionScanner\Php\MatcherFactory;

const USAGE = "Usage: php extension-scanner.php [--root=.] [--packages-dir=packages] [--path=DIR ...] [--output=FILE]\n";

function fail(string $message): never
{
    fwrite(STDERR, "extension-scanner: {$message}\n");
    exit(2);
}

$options = ['root' => '.', 'packages-dir' => 'packages', 'path' => [], 'output' => null];
foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--help') {
        echo USAGE;
        exit(0);
    }
    if (!preg_match('/^--(root|packages-dir|path|output)=(.+)$/', $argument, $m)) {
        fwrite(STDERR, "Unknown argument: {$argument}\n" . USAGE);
        exit(2);
    }
    if ($m[1] === 'path') {
        $options['path'][] = $m[2];
    } else {
        $options[$m[1]] = $m[2];
    }
}

$root = realpath($options['root']);
if ($root === false || !is_file($root . '/composer.json')) {
    fail('--root must be a Composer project directory');
}
$composer = json_decode((string)file_get_contents($root . '/composer.json'), true) ?: [];
$vendorDir = (string)($composer['config']['vendor-dir'] ?? 'vendor');
$vendorDir = str_starts_with($vendorDir, '/') ? $vendorDir : $root . '/' . $vendorDir;
if (!is_file($vendorDir . '/autoload.php')) {
    fail("no Composer autoloader at {$vendorDir}/autoload.php");
}
require $vendorDir . '/autoload.php';

if (!InstalledVersions::isInstalled('typo3/cms-install') || !InstalledVersions::isInstalled('typo3/cms-core')) {
    fail('typo3/cms-install and typo3/cms-core must be installed in the project');
}
$coreVersion = ltrim((string)InstalledVersions::getPrettyVersion('typo3/cms-core'), 'v');
// 13.4 and 14.3 share this pipeline (php-parser 5, 23 matchers); 12.4 differs.
if (!preg_match('/^(13\.4|14\.3)\.\d+$/', $coreVersion)) {
    fail("TYPO3 {$coreVersion} is not supported; this adapter mirrors the 13.4/14.3 scanner pipeline");
}
$installPath = (string)InstalledVersions::getInstallPath('typo3/cms-install');

// The backend's own registry, not a copy: new or changed Core matchers are picked up automatically.
$declared = (new ReflectionProperty(UpgradeController::class, 'matchers'))->getDefaultValue();
$matcherConfigurations = [];
foreach ($declared as $matcher) {
    $file = (string)($matcher['configurationFile'] ?? '');
    if (!str_starts_with($file, 'EXT:install/')) {
        fail("unexpected matcher configuration {$file}");
    }
    $configuration = require $installPath . '/' . substr($file, strlen('EXT:install/'));
    if (!is_array($configuration)) {
        fail("matcher configuration {$file} did not return an array");
    }
    $matcherConfigurations[] = ['class' => $matcher['class'], 'configurationArray' => $configuration];
}

$targets = $options['path'];
if ($targets === []) {
    $packages = $root . '/' . trim($options['packages-dir'], '/');
    $targets = is_dir($packages) ? (glob($packages . '/*', GLOB_ONLYDIR) ?: []) : [];
}
if ($targets === []) {
    fail('nothing to scan: no --path given and no package directories found');
}

$relative = static fn (string $path): string => str_starts_with($path, $root . '/') ? substr($path, strlen($root) + 1) : $path;
$parser = (new ParserFactory())->createForVersion(PhpVersion::fromComponents(8, 2));
$summary = ['packages' => 0, 'files' => 0, 'ignoredFiles' => 0, 'parseErrors' => 0, 'strong' => 0, 'weak' => 0];
$report = [];

foreach ($targets as $target) {
    $directory = realpath($target);
    if ($directory === false || !is_dir($directory)) {
        fail("not a directory: {$target}");
    }
    $summary['packages']++;
    $findings = [];
    $finder = (new Finder())->files()->ignoreUnreadableDirs()->ignoreVCS(true)
        ->exclude(['.Build', 'node_modules', 'vendor'])->in($directory)->name('*.php')->sortByName();
    foreach ($finder as $file) {
        $summary['files']++;
        $path = str_replace('\\', '/', $file->getRelativePathname());
        $code = (string)file_get_contents($file->getPathname());
        try {
            $statements = $parser->parse($code) ?? [];
        } catch (ParseError $error) {
            $summary['parseErrors']++;
            $findings[] = ['file' => $path, 'parseError' => $error->getMessage()];
            continue;
        }
        // Core order: resolve names completely first, then run the matchers on resolved nodes.
        $traverser = new NodeTraverser();
        $traverser->addVisitor(new NameResolver());
        $statements = $traverser->traverse($statements);
        $traverser = new NodeTraverser();
        $traverser->addVisitor(new GeneratorClassesResolver());
        $statistics = new CodeStatistics();
        $traverser->addVisitor($statistics);
        $matchers = (new MatcherFactory())->createAll($matcherConfigurations);
        foreach ($matchers as $matcher) {
            $traverser->addVisitor($matcher);
        }
        $traverser->traverse($statements);
        if ($statistics->isFileIgnored()) {
            $summary['ignoredFiles']++;
            continue;
        }
        $lines = preg_split('/\R/', $code) ?: [];
        $matches = [];
        foreach ($matchers as $matcher) {
            foreach ($matcher->getMatches() as $match) {
                $summary[$match['indicator'] === 'strong' ? 'strong' : 'weak']++;
                $matches[] = [
                    'line' => $match['line'],
                    'indicator' => $match['indicator'],
                    'message' => $match['message'],
                    'restFiles' => $match['restFiles'],
                    'code' => mb_substr(trim($lines[$match['line'] - 1] ?? ''), 0, 200),
                ];
            }
        }
        if ($matches !== []) {
            usort($matches, static fn (array $a, array $b): int => [$a['line'], $a['message']] <=> [$b['line'], $b['message']]);
            $findings[] = ['file' => $path, 'matches' => $matches];
        }
    }
    $report[] = ['path' => $relative($directory), 'findings' => $findings];
}

$result = [
    'schema' => 'typo3-upgrade-run/extension-scanner@1',
    'generatedAt' => gmdate('Y-m-d\TH:i:s\Z'),
    'typo3' => $coreVersion,
    'phpParser' => InstalledVersions::getPrettyVersion('nikic/php-parser'),
    'matchers' => count($matcherConfigurations),
    'summary' => $summary,
    'packages' => $report,
];
if ($options['output'] !== null) {
    file_put_contents($options['output'], json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
}

printf(
    "Extension scanner (TYPO3 %s, %d Core matchers): %d file(s) in %d package(s); %d strong, %d weak, %d parse error(s), %d ignored file(s)\n",
    $coreVersion, count($matcherConfigurations), $summary['files'], $summary['packages'],
    $summary['strong'], $summary['weak'], $summary['parseErrors'], $summary['ignoredFiles'],
);
foreach ($report as $package) {
    foreach ($package['findings'] as $finding) {
        if (isset($finding['parseError'])) {
            printf("  PARSE  %s/%s: %s\n", $package['path'], $finding['file'], $finding['parseError']);
            continue;
        }
        foreach ($finding['matches'] as $match) {
            printf("  %-6s %s/%s:%d %s\n", strtoupper($match['indicator']), $package['path'], $finding['file'], $match['line'], $match['message']);
        }
    }
}
exit($summary['strong'] > 0 || $summary['parseErrors'] > 0 ? 1 : 0);
