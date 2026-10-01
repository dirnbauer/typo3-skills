#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Static class facts for typo3-14-readiness.mjs: what does the site-package PHP declare and use?
 *
 * A 13.4 site package can break on 14.3 with every PHP tool green: it extends a core class that
 * became readonly or final, imports a class that moved (Html\TextCropper is Text\TextCropper now),
 * or makeInstance()s a core class whose constructor gained a required argument. Judging that needs
 * two kinds of knowledge: what the package's code says (this script) and what the installed core
 * looks like (class-exists-check.php --describe). The Node script joins the two.
 *
 * This half never loads, includes or executes package code. It reads every PHP file with PHP's own
 * tokenizer (TOKEN_PARSE first, so a syntax error for this PHP version is reported as a fact) and
 * resolves names with the file's namespace and imports, exactly as PHP would.
 *
 *   php site-package-class-check.php DIR [DIR ...]
 *
 * Output: {"schema": "typo3-upgrade-run/php-class-facts@1", "php": "8.x.y", "files": N,
 *          "missingDirs": [...], "parseErrors": [{file, line, message}],
 *          "declarations": [{name, kind, anonymous, final, abstract, readonly, extends: [...],
 *                            implements: [...], file, line}],
 *          "references": [{name, via, file, line, guarded}],
 *          "instantiations": [{name, via: "new"|"makeInstance", arguments, spread, file, line}]}
 * "via" is use · namespace-use · extends · implements · trait · attribute · class-constant · static ·
 * new · makeInstance. A "namespace-use" import is only ever used as a namespace prefix.
 *
 * Exit: 0 facts written (parse errors are facts, not failures) · 2 usage
 */

const SCHEMA = 'typo3-upgrade-run/php-class-facts@1';
const USAGE = "Usage: php site-package-class-check.php DIR [DIR ...]\n";
const SKIP_DIRECTORIES = ['.Build', '.git', '.github', '.gitlab', '.ddev', '.idea', '.typo3-update', 'Build', 'Documentation', 'Documentation-GENERATED-temp', 'node_modules', 'Tests', 'tests', 'vendor'];
const MAKE_INSTANCE_OWNER = 'TYPO3\\CMS\\Core\\Utility\\GeneralUtility';
// A ::class reference passed straight to one of these is a deliberate optional dependency.
const GUARD_FUNCTIONS = ['class_exists', 'interface_exists', 'trait_exists', 'enum_exists', 'is_a', 'is_subclass_of', 'method_exists', 'property_exists'];

if (!defined('T_NAME_QUALIFIED')) {
    fwrite(STDERR, "site-package-class-check: PHP 8.0 or later is required\n");
    exit(2);
}

define('NAME_TOKENS', [T_STRING, T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED, T_NAME_RELATIVE]);
define('T_ENUM_TOKEN', defined('T_ENUM') ? T_ENUM : -1);
define('T_READONLY_TOKEN', defined('T_READONLY') ? T_READONLY : -2);

function relativePath(string $path): string
{
    $cwd = getcwd();
    return $cwd !== false && str_starts_with($path, $cwd . '/') ? substr($path, strlen($cwd) + 1) : $path;
}

/** @return list<string> */
function phpFiles(string $directory): array
{
    $filter = new RecursiveCallbackFilterIterator(
        new RecursiveDirectoryIterator($directory, FilesystemIterator::SKIP_DOTS),
        static fn (SplFileInfo $file): bool => $file->isDir()
            ? !in_array($file->getFilename(), SKIP_DIRECTORIES, true)
            : $file->getExtension() === 'php',
    );
    $files = [];
    foreach (new RecursiveIteratorIterator($filter) as $file) {
        $files[] = $file->getPathname();
    }
    sort($files);
    return $files;
}

/**
 * Significant tokens as [id, text, line]; single characters use themselves as id. Whitespace and
 * comments are dropped, which is what lets the analysis look at "the previous token" directly.
 *
 * @return list<array{0: int|string, 1: string, 2: int}>
 */
function significantTokens(array $tokens): array
{
    $significant = [];
    $line = 1;
    foreach ($tokens as $token) {
        if (is_array($token)) {
            [$id, $text, $line] = $token;
            $skip = in_array($id, [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT, T_OPEN_TAG, T_CLOSE_TAG, T_INLINE_HTML], true);
            if (!$skip) {
                $significant[] = [$id, $text, $line];
            }
            $line += substr_count($text, "\n");
            continue;
        }
        $significant[] = [$token, $token, $line];
    }
    return $significant;
}

/** Number of arguments of the call whose "(" is at $open, and whether one is spread (...). */
function argumentCount(array $tokens, int $open): array
{
    $depth = 0;
    $count = 0;
    $pending = false;
    $spread = false;
    for ($i = $open, $n = count($tokens); $i < $n; $i++) {
        $id = $tokens[$i][0];
        if (in_array($id, ['(', '[', '{', T_CURLY_OPEN, T_DOLLAR_OPEN_CURLY_BRACES, T_ATTRIBUTE], true)) {
            $depth++;
            if ($depth === 1) {
                continue;
            }
        } elseif (in_array($id, [')', ']', '}'], true)) {
            $depth--;
            if ($depth === 0) {
                return ['count' => $count + ($pending ? 1 : 0), 'spread' => $spread];
            }
        }
        if ($depth === 1) {
            if ($id === ',') {
                $count++;
                $pending = false;
                continue;
            }
            if ($id === T_ELLIPSIS) {
                $spread = true;
            }
            $pending = true;
        }
    }
    return ['count' => null, 'spread' => $spread];
}

/** The "class" of Foo::class: T_CLASS from the plain lexer, T_STRING under TOKEN_PARSE. */
function isClassKeyword(?array $token): bool
{
    return $token !== null
        && ($token[0] === T_CLASS || ($token[0] === T_STRING && strtolower($token[1]) === 'class'));
}

/** Index just after the "(" ... ")" group starting at $open. */
function skipGroup(array $tokens, int $open): int
{
    $depth = 0;
    for ($i = $open, $n = count($tokens); $i < $n; $i++) {
        if ($tokens[$i][0] === '(') {
            $depth++;
        } elseif ($tokens[$i][0] === ')') {
            $depth--;
            if ($depth === 0) {
                return $i + 1;
            }
        }
    }
    return count($tokens);
}

function analyse(array $tokens, string $file, array &$facts): void
{
    $namespace = '';
    $imports = [];
    $importReferences = [];
    $namespaceAliases = [];
    $depth = 0;
    $namespaceDepth = 0;
    $classBodies = [];
    $pendingClassBody = false;

    $resolve = static function (string $name, int $id) use (&$namespace, &$imports, &$namespaceAliases): ?string {
        if ($id === T_NAME_FULLY_QUALIFIED) {
            return ltrim($name, '\\');
        }
        if ($id === T_NAME_RELATIVE) {
            $relative = substr($name, strlen('namespace\\'));
            return $namespace === '' ? $relative : $namespace . '\\' . $relative;
        }
        if (in_array(strtolower($name), ['self', 'static', 'parent'], true)) {
            return null;
        }
        $first = explode('\\', $name, 2);
        $alias = strtolower($first[0]);
        if (isset($imports[$alias])) {
            if (isset($first[1])) {
                $namespaceAliases[$alias] = true;
            }
            return $imports[$alias] . (isset($first[1]) ? '\\' . $first[1] : '');
        }
        // Class names never fall back to the global namespace: unimported DateTime in a namespace
        // is Vendor\Ext\DateTime, and PHP fails exactly like this resolution says.
        return $namespace === '' ? $name : $namespace . '\\' . $name;
    };
    $reference = static function (?string $name, string $via, int $line, bool $guarded = false) use (&$facts, $file): void {
        if ($name !== null && $name !== '') {
            $facts['references'][] = ['name' => $name, 'via' => $via, 'file' => $file, 'line' => $line, 'guarded' => $guarded];
        }
    };
    $flushImports = static function () use (&$importReferences, &$namespaceAliases, &$facts): void {
        foreach ($importReferences as $import) {
            if (isset($namespaceAliases[$import['alias']])) {
                $import['via'] = 'namespace-use';
            }
            unset($import['alias']);
            $facts['references'][] = $import;
        }
        $importReferences = [];
        $namespaceAliases = [];
    };

    for ($i = 0, $n = count($tokens); $i < $n; $i++) {
        [$id, $text, $line] = $tokens[$i];

        if ($id === T_NAMESPACE && in_array($tokens[$i + 1][0] ?? null, [T_STRING, T_NAME_QUALIFIED, '{', ';'], true)) {
            $flushImports();
            $imports = [];
            $namespace = '';
            if (in_array($tokens[$i + 1][0], [T_STRING, T_NAME_QUALIFIED], true)) {
                $namespace = $tokens[$i + 1][1];
                $i++;
            }
            $namespaceDepth = ($tokens[$i + 1][0] ?? null) === '{' ? $depth + 1 : $depth;
            continue;
        }

        if ($id === '{' || $id === T_CURLY_OPEN || $id === T_DOLLAR_OPEN_CURLY_BRACES) {
            $depth++;
            if ($pendingClassBody && $id === '{') {
                $classBodies[] = $depth;
                $pendingClassBody = false;
            }
            continue;
        }
        if ($id === '}') {
            if ($classBodies !== [] && end($classBodies) === $depth) {
                array_pop($classBodies);
            }
            $depth--;
            continue;
        }

        if ($id === T_USE) {
            $next = $tokens[$i + 1][0] ?? null;
            if ($next === '(') {
                continue; // closure: function () use ($variable)
            }
            if ($classBodies !== [] && end($classBodies) === $depth) {
                // Trait use inside a class body; a conflict block "{ ... }" is left to the main loop.
                for ($j = $i + 1; $j < $n && !in_array($tokens[$j][0], [';', '{'], true); $j++) {
                    if (in_array($tokens[$j][0], NAME_TOKENS, true)) {
                        $reference($resolve($tokens[$j][1], $tokens[$j][0]), 'trait', $tokens[$j][2]);
                    }
                }
                $i = $j - 1;
                continue;
            }
            if ($depth !== $namespaceDepth) {
                continue;
            }
            // Import statement, possibly grouped: use A\B\{C, D as E, function f};
            $group = null;
            $kindSkip = in_array($next, [T_FUNCTION, T_CONST], true);
            $entryName = null;
            $entryLine = $line;
            $alias = null;
            $expectAlias = false;
            $entrySkip = false;
            $finishEntry = static function () use (&$entryName, &$alias, &$group, &$entrySkip, &$entryLine, &$imports, &$importReferences, $file): void {
                if ($entryName !== null && !$entrySkip) {
                    $full = ltrim(($group !== null ? $group . '\\' : '') . $entryName, '\\');
                    $short = strtolower($alias ?? substr((string)strrchr('\\' . $full, '\\'), 1));
                    $imports[$short] = $full;
                    $importReferences[] = ['name' => $full, 'via' => 'use', 'file' => $file, 'line' => $entryLine, 'guarded' => false, 'alias' => $short];
                }
                $entryName = null;
                $alias = null;
                $entrySkip = false;
            };
            for ($j = $i + 1; $j < $n; $j++) {
                [$tid, $ttext, $tline] = $tokens[$j];
                if ($tid === ';') {
                    break;
                }
                if ($kindSkip) {
                    continue;
                }
                if ($tid === T_NS_SEPARATOR && ($tokens[$j + 1][0] ?? null) === '{') {
                    $group = $entryName;
                    $entryName = null;
                    continue;
                }
                if ($tid === '{') {
                    continue;
                }
                if ($tid === ',' || $tid === '}') {
                    $finishEntry();
                    continue;
                }
                if ($tid === T_FUNCTION || $tid === T_CONST) {
                    $entrySkip = true;
                    continue;
                }
                if ($tid === T_AS) {
                    $expectAlias = true;
                    continue;
                }
                if (in_array($tid, NAME_TOKENS, true)) {
                    if ($expectAlias) {
                        $alias = $ttext;
                        $expectAlias = false;
                    } else {
                        $entryName = $ttext;
                        $entryLine = $tline;
                    }
                }
            }
            $finishEntry();
            $i = $j;
            continue;
        }

        if ($id === T_CLASS || $id === T_INTERFACE || $id === T_TRAIT || $id === T_ENUM_TOKEN) {
            $previous = $tokens[$i - 1][0] ?? null;
            if ($id === T_CLASS && $previous === T_DOUBLE_COLON) {
                continue; // Foo::class
            }
            $final = $abstract = $readonly = false;
            $k = $i - 1;
            while ($k >= 0 && in_array($tokens[$k][0], [T_FINAL, T_ABSTRACT, T_READONLY_TOKEN], true)) {
                $final = $final || $tokens[$k][0] === T_FINAL;
                $abstract = $abstract || $tokens[$k][0] === T_ABSTRACT;
                $readonly = $readonly || $tokens[$k][0] === T_READONLY_TOKEN;
                $k--;
            }
            $anonymous = $id === T_CLASS && ($tokens[$k][0] ?? null) === T_NEW;
            $kind = match ($id) {
                T_INTERFACE => 'interface',
                T_TRAIT => 'trait',
                T_ENUM_TOKEN => 'enum',
                default => 'class',
            };
            $j = $i + 1;
            $name = 'class@anonymous';
            if (!$anonymous && ($tokens[$j][0] ?? null) === T_STRING) {
                $name = $namespace === '' ? $tokens[$j][1] : $namespace . '\\' . $tokens[$j][1];
                $j++;
            }
            if ($anonymous && ($tokens[$j][0] ?? null) === '(') {
                $j = skipGroup($tokens, $j);
            }
            if ($kind === 'enum' && ($tokens[$j][0] ?? null) === ':') {
                $j += 2; // backing type
            }
            $extends = [];
            $implements = [];
            $list = null;
            for (; $j < $n && $tokens[$j][0] !== '{'; $j++) {
                $tid = $tokens[$j][0];
                if ($tid === T_EXTENDS) {
                    $list = 'extends';
                } elseif ($tid === T_IMPLEMENTS) {
                    $list = 'implements';
                } elseif ($list !== null && in_array($tid, NAME_TOKENS, true)) {
                    $resolved = $resolve($tokens[$j][1], $tid);
                    if ($resolved === null) {
                        continue;
                    }
                    if ($list === 'extends') {
                        $extends[] = $resolved;
                    } else {
                        $implements[] = $resolved;
                    }
                    $reference($resolved, $list, $tokens[$j][2]);
                }
            }
            $facts['declarations'][] = [
                'name' => $name, 'kind' => $kind, 'anonymous' => $anonymous,
                'final' => $final, 'abstract' => $abstract, 'readonly' => $readonly,
                'extends' => $extends, 'implements' => $implements, 'file' => $file, 'line' => $line,
            ];
            $pendingClassBody = true;
            $i = $j - 1;
            continue;
        }

        if ($id === T_ATTRIBUTE) {
            // Attribute class names sit at bracket depth 1, outside argument parentheses.
            $brackets = 1;
            $parentheses = 0;
            $expect = true;
            for ($j = $i + 1; $j < $n && $brackets > 0; $j++) {
                $tid = $tokens[$j][0];
                if ($tid === '[') {
                    $brackets++;
                } elseif ($tid === ']') {
                    $brackets--;
                } elseif ($tid === '(') {
                    $parentheses++;
                } elseif ($tid === ')') {
                    $parentheses--;
                } elseif ($tid === ',' && $brackets === 1 && $parentheses === 0) {
                    $expect = true;
                } elseif ($expect && $brackets === 1 && $parentheses === 0 && in_array($tid, NAME_TOKENS, true)) {
                    $reference($resolve($tokens[$j][1], $tid), 'attribute', $tokens[$j][2]);
                    $expect = false;
                }
            }
            continue; // names inside the arguments are still visited by the main loop
        }

        if ($id === T_NEW) {
            $target = $tokens[$i + 1] ?? null;
            if ($target === null || !in_array($target[0], NAME_TOKENS, true)) {
                continue; // new class, new static, new $variable, new (expression)
            }
            $resolved = $resolve($target[1], $target[0]);
            if ($resolved === null) {
                continue;
            }
            $arguments = ($tokens[$i + 2][0] ?? null) === '(' ? argumentCount($tokens, $i + 2) : ['count' => 0, 'spread' => false];
            $reference($resolved, 'new', $line);
            $facts['instantiations'][] = [
                'name' => $resolved, 'via' => 'new', 'arguments' => $arguments['count'],
                'spread' => $arguments['spread'], 'file' => $file, 'line' => $line,
            ];
            $i++;
            continue;
        }

        if (in_array($id, NAME_TOKENS, true) && ($tokens[$i + 1][0] ?? null) === T_DOUBLE_COLON) {
            $resolved = $resolve($text, $id);
            if ($resolved === null) {
                continue;
            }
            $member = $tokens[$i + 2] ?? null;
            if (isClassKeyword($member)) {
                $caller = $tokens[$i - 2] ?? null;
                $guarded = ($tokens[$i - 1][0] ?? null) === '('
                    && in_array($caller[0] ?? null, [T_STRING, T_NAME_FULLY_QUALIFIED], true)
                    && in_array(strtolower(ltrim((string)$caller[1], '\\')), GUARD_FUNCTIONS, true);
                $reference($resolved, 'class-constant', $line, $guarded);
                continue;
            }
            $reference($resolved, 'static', $line);
            if (($member[0] ?? null) === T_STRING && strcasecmp((string)$member[1], 'makeInstance') === 0
                && strcasecmp($resolved, MAKE_INSTANCE_OWNER) === 0 && ($tokens[$i + 3][0] ?? null) === '('
            ) {
                $first = $tokens[$i + 4] ?? null;
                $class = null;
                if ($first !== null && in_array($first[0], NAME_TOKENS, true)
                    && ($tokens[$i + 5][0] ?? null) === T_DOUBLE_COLON && isClassKeyword($tokens[$i + 6] ?? null)
                    && in_array($tokens[$i + 7][0] ?? null, [',', ')'], true)
                ) {
                    $class = $resolve($first[1], $first[0]);
                } elseif ($first !== null && $first[0] === T_CONSTANT_ENCAPSED_STRING && in_array($tokens[$i + 5][0] ?? null, [',', ')'], true)) {
                    $class = ltrim(str_replace('\\\\', '\\', substr($first[1], 1, -1)), '\\');
                    $reference($class, 'makeInstance', $line);
                }
                if ($class !== null && $class !== '') {
                    $arguments = argumentCount($tokens, $i + 3);
                    $facts['instantiations'][] = [
                        'name' => $class, 'via' => 'makeInstance',
                        'arguments' => $arguments['count'] === null ? null : max(0, $arguments['count'] - 1),
                        'spread' => $arguments['spread'], 'file' => $file, 'line' => $line,
                    ];
                }
            }
        }
    }
    $flushImports();
}

$directories = array_slice($argv, 1);
if ($directories === [] || in_array('--help', $directories, true)) {
    fwrite($directories === [] ? STDERR : STDOUT, USAGE);
    exit($directories === [] ? 2 : 0);
}

$facts = [
    'schema' => SCHEMA, 'php' => PHP_VERSION, 'files' => 0, 'missingDirs' => [], 'parseErrors' => [],
    'declarations' => [], 'references' => [], 'instantiations' => [],
];
foreach ($directories as $directory) {
    if (!is_dir($directory)) {
        $facts['missingDirs'][] = $directory;
        continue;
    }
    foreach (phpFiles($directory) as $path) {
        $facts['files']++;
        $relative = relativePath($path);
        $code = (string)file_get_contents($path);
        try {
            $tokens = token_get_all($code, TOKEN_PARSE);
        } catch (ParseError $error) {
            $facts['parseErrors'][] = ['file' => $relative, 'line' => $error->getLine(), 'message' => $error->getMessage()];
            $tokens = token_get_all($code);
        }
        analyse(significantTokens($tokens), $relative, $facts);
    }
}

echo json_encode($facts, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR), "\n";
exit(0);
