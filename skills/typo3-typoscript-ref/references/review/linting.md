# TypoScript Lint Rules Reference

Reference for [helmich/typo3-typoscript-lint](https://github.com/martin-helmich/typo3-typoscript-lint) rules.

## Sniffs

### 1. Indentation
**What it checks:** Correct nesting indentation in TypoScript blocks.
**Parameters:**
- `useSpaces` (bool, default: true)
- `indentPerLevel` (int, default: 4)
- `indentConditions` (bool, default: false)

**Before (violation):**
```typoscript
page = PAGE
page {
  10 = TEXT
10.value = Hello
}
```

**After (correct):**
```typoscript
page = PAGE
page {
    10 = TEXT
    10.value = Hello
}
```

### 2. DeadCode
**What it checks:** Commented-out TypoScript code (lines starting with #).
**Parameters:** None

**Before (violation):**
```typoscript
page = PAGE
# page.10 = TEXT
# page.10.value = Hello
page.10 = TEXT
page.10.value = World
```

**After (correct):**
```typoscript
page = PAGE
page.10 = TEXT
page.10.value = World
```

### 3. OperatorWhitespace
**What it checks:** Single space before and after assignment operators (`=`, `<`, `>`, `=<`).
**Parameters:** None

**Before (violation):**
```typoscript
page=PAGE
page.10=TEXT
page.10.value=Hello
```

**After (correct):**
```typoscript
page = PAGE
page.10 = TEXT
page.10.value = Hello
```

### 4. RepeatingRValue
**What it checks:** Duplicated values that should be extracted to a constant.
**Parameters:**
- `allowedRightValues` (array)
- `valueLengthThreshold` (int, default: 8)

**Before (violation):**
```typoscript
page.10.value = My long repeated value
page.20.value = My long repeated value
page.30.value = My long repeated value
```

**After (correct):**
```typoscript
myConstant = My long repeated value

page.10.value = {$myConstant}
page.20.value = {$myConstant}
page.30.value = {$myConstant}
```

### 5. DuplicateAssignment
**What it checks:** Same TypoScript path assigned multiple times.
**Parameters:** None

**Before (violation):**
```typoscript
page.10 = TEXT
page.10.value = First
page.10.value = Second
```

**After (correct):**
```typoscript
page.10 = TEXT
page.10.value = Second
```

### 6. EmptySection
**What it checks:** Empty blocks like `foo { }`.
**Parameters:** None

**Before (violation):**
```typoscript
page = PAGE
page.10 = TEXT
page.10 {
}
```

**After (correct):**
```typoscript
page = PAGE
page.10 = TEXT
```

### 7. NestingConsistency
**What it checks:** Multiple blocks for the same path that should be merged.
**Parameters:**
- `commonPathPrefixThreshold` (int, default: 1)

**Before (violation):**
```typoscript
page.10 = TEXT
page.10.value = Hello

page.10.wrap = <p>|</p>
```

**After (correct):**
```typoscript
page.10 = TEXT
page.10 {
    value = Hello
    wrap = <p>|</p>
}
```

### 8. ConfigNoCache
**What it checks:** Usage of `config.no_cache = 1`.
**Parameters:**
- `allowNoCacheForPages` (array, default: [])

**Before (violation):**
```typoscript
config.no_cache = 1
```

**After (correct):**
```typoscript
# Use proper caching strategy instead of disabling cache globally
config.cache_period = 86400
```

---

## Default Configuration (typoscript-lint.dist.yml)

The default configuration enables all sniffs with their default parameters:

```yaml
sniffs:
  - class: Indentation
    parameters:
      useSpaces: true
      indentPerLevel: 4
      indentConditions: false
  - class: DeadCode
  - class: OperatorWhitespace
  - class: RepeatingRValue
    parameters:
      allowedRightValues: []
      valueLengthThreshold: 8
  - class: DuplicateAssignment
  - class: EmptySection
  - class: NestingConsistency
    parameters:
      commonPathPrefixThreshold: 1
  - class: ConfigNoCache
    parameters:
      allowNoCacheForPages: []
```

To customize, create a project config file and override only what you need:

```yaml
sniffs:
  - class: Indentation
    parameters:
      indentPerLevel: 2
  - class: DeadCode
    disabled: true
  - class: ConfigNoCache
    parameters:
      allowNoCacheForPages:
        - 42
        - 123
```

---

## Project Config Detection

The linter searches for a configuration file in this order:

1. `.typoscript-lint.yml` (preferred, dot-prefixed)
2. `typoscript-lint.yml`
3. `tslint.yml` (deprecated name, kept for backwards compatibility)

If no project config is found, the built-in defaults apply (all sniffs enabled).

---

## How Claude Uses This

When `--lint-rules` is called, `lookup.sh` reads the project's config file and shows which sniffs are active or disabled based on the detected configuration.

This reference is used to:
- Explain which rule triggered a linting violation
- Suggest the correct fix for a given sniff
- Show available parameters when a project wants to customize behaviour
