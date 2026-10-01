#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Class probe for typo3-14-readiness.mjs: does each named class exist in THIS install?
 *
 * Rector, Fractor and the extension scanner read PHP. A class named in TypoScript, TSconfig, YAML,
 * XML or database TSconfig is a string nobody resolves until the request that needs it, so a class
 * the upgrade removed (TYPO3\CMS\Recordlist\LinkHandler\RecordLinkHandler, gone with TYPO3 13) breaks
 * a backend module or a page, never the build. The Node script extracts the names; this probe asks
 * the project's own Composer autoloader about each one.
 *
 * It loads class declarations and nothing else: no TYPO3 boot, no instantiation, no database. Loading
 * can still fail. A Throwable (parse error, missing parent) is caught per name. A compile error such
 * as "Non-readonly class X cannot extend readonly class Y", or an exit() in a class file, ends the
 * process instead, so a shutdown handler prints everything known so far with "complete": false and
 * the failing name, and the caller restarts the probe with the names that are left.
 *
 *   php class-exists-check.php [--describe] [--input=FILE] AUTOLOAD.php [AUTOLOAD.php ...] < names.json
 *
 * Input (stdin, or --input=FILE): a JSON array of class names.
 * Output: {"schema": "typo3-upgrade-run/class-exists@1", "complete": bool,
 *          "results": {name: true|false}, "errors": {name: message}, "fatal": null|{name, message},
 *          "canonical": {name: declared name}, "namespaces": {name: true},
 *          "suggestions": {name: [fqcn, ...]}, "shapes": {name: {...}}}   (shapes only with --describe)
 * "results" is the plain {name: true|false} answer; the other maps explain false and odd cases.
 *
 * Exit: 0 complete · 2 usage or unreadable input · 3 incomplete (the process died loading a class)
 *       · 4 the autoloader is missing or fails to load
 */

const SCHEMA = 'typo3-upgrade-run/class-exists@1';
const USAGE = "Usage: php class-exists-check.php [--describe] [--input=FILE] AUTOLOAD.php [AUTOLOAD.php ...] < names.json\n";
const FATAL_TYPES = [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR];

// Interfaces whose implementations TYPO3 14's compiler passes (SingletonPass, PublicServicePass) make
// public, so GeneralUtility::makeInstance() receives the container instance with its dependencies.
const PUBLIC_SERVICE_INTERFACES = [
    'TYPO3\\CMS\\Core\\SingletonInterface',
    'Psr\\Http\\Server\\MiddlewareInterface',
    'Psr\\Http\\Server\\RequestHandlerInterface',
    'TYPO3\\CMS\\Core\\Imaging\\IconProviderInterface',
];

function usage(string $message, int $code = 2): never
{
    fwrite(STDERR, "class-exists-check: {$message}\n" . ($code === 2 ? USAGE : ''));
    exit($code);
}

function relativePath(?string $path): ?string
{
    if ($path === null || $path === '') {
        return null;
    }
    $cwd = getcwd();
    return $cwd !== false && str_starts_with($path, $cwd . '/') ? substr($path, strlen($cwd) + 1) : $path;
}

/** @return list<array{0: string, 1: string}> PSR-4 prefix and real directory of every registered Composer loader. */
function psr4Prefixes(): array
{
    $loaderClass = 'Composer\\Autoload\\ClassLoader';
    if (!class_exists($loaderClass, false) || !method_exists($loaderClass, 'getRegisteredLoaders')) {
        return [];
    }
    $prefixes = [];
    foreach ($loaderClass::getRegisteredLoaders() as $loader) {
        foreach ($loader->getPrefixesPsr4() as $prefix => $directories) {
            foreach ((array)$directories as $directory) {
                $real = realpath((string)$directory);
                if ($real !== false) {
                    $prefixes[] = [(string)$prefix, $real];
                }
            }
        }
    }
    return $prefixes;
}

/**
 * A name that is a namespace, not a class: a Fluid ViewHelper namespace in settings.php, or a
 * Services.yaml resource key. Reporting it as a missing class would be a false finding.
 */
function isNamespace(string $name, array $prefixes): bool
{
    $namespace = $name . '\\';
    foreach ($prefixes as [$prefix, $directory]) {
        if (str_starts_with($prefix, $namespace)) {
            return true;
        }
        if (str_starts_with($namespace, $prefix)
            && is_dir($directory . '/' . str_replace('\\', '/', substr($namespace, strlen($prefix))))
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Classes with the same short name under the same vendor root: TYPO3\CMS\Core\Html\TextCropper moved
 * to TYPO3\CMS\Core\Text\TextCropper. Directory listing only; nothing is loaded.
 *
 * @param array<string, array<string, list<string>>> $indexes per-root cache, filled lazily
 * @return list<string>
 */
function suggestionsFor(string $name, array $prefixes, array &$indexes): array
{
    $segments = explode('\\', $name);
    if (count($segments) < 3) {
        return [];
    }
    $root = $segments[0] . '\\' . $segments[1] . '\\';
    if (!isset($indexes[$root])) {
        $index = [];
        foreach ($prefixes as [$prefix, $directory]) {
            if (!str_starts_with($prefix, $root)) {
                continue;
            }
            try {
                $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS));
                foreach ($files as $file) {
                    if (!$file->isFile() || $file->getExtension() !== 'php') {
                        continue;
                    }
                    $relative = substr($file->getPathname(), strlen($directory) + 1, -4);
                    $index[strtolower($file->getBasename('.php'))][] = $prefix . str_replace('/', '\\', $relative);
                }
            } catch (Throwable) {
                continue;
            }
        }
        $indexes[$root] = $index;
    }
    $candidates = array_filter(
        $indexes[$root][strtolower((string)end($segments))] ?? [],
        static fn (string $candidate): bool => strcasecmp($candidate, $name) !== 0,
    );
    $candidates = array_values(array_unique($candidates));
    sort($candidates);
    return array_slice($candidates, 0, 5);
}

/**
 * Evidence that makeInstance() gets this class from the DI container, as far as reflection can see
 * without booting TYPO3. null means "no evidence", never "certainly not public".
 */
function publicService(ReflectionClass $class): ?string
{
    foreach ($class->getAttributes() as $attribute) {
        if ($attribute->getName() !== 'Symfony\\Component\\DependencyInjection\\Attribute\\Autoconfigure') {
            continue;
        }
        try {
            $arguments = $attribute->getArguments();
        } catch (Throwable) {
            continue;
        }
        if (($arguments['public'] ?? $arguments[4] ?? null) === true) {
            return '#[Autoconfigure(public: true)]';
        }
    }
    foreach (PUBLIC_SERVICE_INTERFACES as $interface) {
        // A class that implements an interface has loaded it; an unloaded interface is not implemented.
        if (interface_exists($interface, false) && $class->implementsInterface($interface)) {
            return "implements {$interface}";
        }
    }
    $file = $class->getFileName();
    $yaml = 'Symfony\\Component\\Yaml\\Yaml';
    if (!is_string($file) || !class_exists($yaml)) {
        return null;
    }
    $directory = dirname($file);
    for ($depth = 0; $depth < 10; $depth++) {
        if (is_file($directory . '/composer.json')) {
            $servicesFile = $directory . '/Configuration/Services.yaml';
            if (!is_file($servicesFile)) {
                return null;
            }
            try {
                $definitions = $yaml::parseFile($servicesFile, $yaml::PARSE_CUSTOM_TAGS)['services'] ?? [];
            } catch (Throwable) {
                return null;
            }
            if (!is_array($definitions)) {
                return null;
            }
            $entry = $definitions[$class->getName()] ?? null;
            if (is_array($entry) && array_key_exists('public', $entry)) {
                return $entry['public'] === true ? 'Configuration/Services.yaml: public: true' : null;
            }
            return ($definitions['_defaults']['public'] ?? null) === true ? 'Configuration/Services.yaml: _defaults public: true' : null;
        }
        $parent = dirname($directory);
        if ($parent === $directory) {
            break;
        }
        $directory = $parent;
    }
    return null;
}

/** @return array<string, mixed> */
function shape(ReflectionClass $class): array
{
    $kind = match (true) {
        $class->isInterface() => 'interface',
        $class->isTrait() => 'trait',
        method_exists($class, 'isEnum') && $class->isEnum() => 'enum',
        default => 'class',
    };
    $constructor = $class->getConstructor();
    return [
        'name' => $class->getName(),
        'kind' => $kind,
        'final' => $class->isFinal(),
        'abstract' => $kind === 'class' && $class->isAbstract(),
        // ReflectionClass::isReadOnly() exists from PHP 8.2, the release that introduced readonly classes.
        'readonly' => method_exists($class, 'isReadOnly') ? $class->isReadOnly() : null,
        'internal' => $class->isInternal(),
        'file' => relativePath($class->getFileName() ?: null),
        'publicService' => $kind === 'class' ? publicService($class) : null,
        'constructor' => $constructor === null ? null : [
            'class' => $constructor->getDeclaringClass()->getName(),
            'public' => $constructor->isPublic(),
            'required' => $constructor->getNumberOfRequiredParameters(),
            'parameters' => array_map(static fn (ReflectionParameter $parameter): array => [
                'name' => $parameter->getName(),
                'type' => $parameter->hasType() ? (string)$parameter->getType() : null,
                'optional' => $parameter->isOptional(),
                'variadic' => $parameter->isVariadic(),
            ], $constructor->getParameters()),
        ],
    ];
}

function emit(stdClass $state, ?array $fatal): void
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }
    echo json_encode([
        'schema' => SCHEMA,
        'complete' => $fatal === null,
        'results' => (object)$state->results,
        'errors' => (object)$state->errors,
        'fatal' => $fatal,
        'canonical' => (object)$state->canonical,
        'namespaces' => (object)$state->namespaces,
        'suggestions' => (object)$state->suggestions,
        'shapes' => (object)$state->shapes,
    ], JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR), "\n";
}

$describe = false;
$inputFile = null;
$autoloaders = [];
foreach (array_slice($argv, 1) as $argument) {
    if ($argument === '--help') {
        echo USAGE;
        exit(0);
    }
    if ($argument === '--describe') {
        $describe = true;
        continue;
    }
    if (str_starts_with($argument, '--input=')) {
        $inputFile = substr($argument, strlen('--input='));
        continue;
    }
    if (str_starts_with($argument, '--')) {
        usage("unknown option {$argument}");
    }
    $autoloaders[] = $argument;
}
if ($autoloaders === []) {
    usage('name at least one autoloader');
}

$raw = $inputFile !== null ? @file_get_contents($inputFile) : stream_get_contents(STDIN);
if (!is_string($raw)) {
    usage('cannot read the input');
}
try {
    $names = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
} catch (JsonException $exception) {
    usage('the input is not JSON: ' . $exception->getMessage());
}
if (!is_array($names) || !array_is_list($names)) {
    usage('the input must be a JSON array of class names');
}
foreach ($names as $name) {
    if (!is_string($name) || $name === '') {
        usage('every class name must be a non-empty string');
    }
}
$names = array_values(array_unique($names));

// Loaded code may raise notices or deprecations. They are not this probe's findings, and on the CLI
// they would land on stdout in the middle of the JSON. Fatal errors bypass this handler and are read
// back in the shutdown function.
ini_set('display_errors', 'stderr');
ini_set('log_errors', '0');
error_reporting(E_ALL);
set_error_handler(static fn (): bool => true);

// Classic class files open with `defined('TYPO3') or die();`. Without the constant, loading such a
// class would end this process silently, so define what a booted TYPO3 defines.
defined('TYPO3') || define('TYPO3', true);
defined('TYPO3_MODE') || define('TYPO3_MODE', 'BE');

$state = new stdClass();
$state->results = [];
$state->errors = [];
$state->canonical = [];
$state->namespaces = [];
$state->suggestions = [];
$state->shapes = [];
$state->current = null;
$state->finished = false;

register_shutdown_function(static function () use ($state): void {
    if ($state->finished) {
        return;
    }
    $error = error_get_last();
    $message = $error !== null && in_array($error['type'], FATAL_TYPES, true)
        ? $error['message']
        : 'the process ended while this class was loading (exit or die in a class file?)';
    if ($state->current === null) {
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        fwrite(STDERR, "class-exists-check: the autoloader failed: {$message}\n");
        exit(4);
    }
    emit($state, ['name' => $state->current, 'message' => $message]);
    exit(3);
});

// Stray output from loaded files (a BOM, whitespace before <?php) must not corrupt the JSON.
ob_start();
foreach ($autoloaders as $autoloader) {
    if (!is_file($autoloader)) {
        $state->finished = true;
        usage("no autoloader at {$autoloader}", 4);
    }
    try {
        require_once $autoloader;
    } catch (Throwable $exception) {
        $state->finished = true;
        usage("the autoloader {$autoloader} failed: " . $exception->getMessage(), 4);
    }
}

$prefixes = psr4Prefixes();
$suggestionIndexes = [];
foreach ($names as $name) {
    $state->current = $name;
    $class = ltrim($name, '\\');
    try {
        // One autoload attempt per name: the later checks only look at what that attempt declared.
        $exists = class_exists($class)
            || interface_exists($class, false)
            || trait_exists($class, false)
            || (function_exists('enum_exists') && enum_exists($class, false));
    } catch (Throwable $exception) {
        $state->results[$name] = false;
        $state->errors[$name] = $exception::class . ': ' . $exception->getMessage();
        continue;
    }
    $state->results[$name] = $exists;
    if (!$exists) {
        if (isNamespace($class, $prefixes)) {
            $state->namespaces[$name] = true;
        } else {
            $suggestions = suggestionsFor($class, $prefixes, $suggestionIndexes);
            if ($suggestions !== []) {
                $state->suggestions[$name] = $suggestions;
            }
        }
        continue;
    }
    try {
        $reflection = new ReflectionClass($class);
        if ($reflection->getName() !== $class) {
            $state->canonical[$name] = $reflection->getName();
        }
        if ($describe) {
            $state->shapes[$name] = shape($reflection);
        }
    } catch (Throwable $exception) {
        $state->errors[$name] = $exception::class . ': ' . $exception->getMessage();
    }
}

$state->current = null;
$state->finished = true;
emit($state, null);
exit(0);
