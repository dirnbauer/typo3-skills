# Security Patterns for TypoScript and Fluid

## Fluid XSS Prevention

### Default Auto-Escaping

Fluid escapes all variable output by default. Every `{variable}` is HTML-entity-encoded before
rendering. This protects against XSS as long as raw output ViewHelpers are not used carelessly.

### f:format.raw — Only for Trusted Content

```html
<!-- Acceptable: content authored in the CMS backend by trusted editors -->
{contentFromRte -> f:format.raw()}

<!-- Never acceptable: user-submitted data -->
{searchQuery -> f:format.raw()}
```

`f:format.raw` disables all escaping. Only use it for content that is fully controlled by trusted
CMS authors (e.g., RTE fields stored in `tt_content`). Never apply it to any value that can be
influenced by frontend users or external systems.

### f:format.html — Applies parseFunc, Still Risky

`f:format.html` processes content through `lib.parseFunc_RTE` (or a custom `parseFuncTSPath`).
This adds some sanitization but is designed for RTE output, not for arbitrary user input. Do not
use it as a general-purpose sanitizer for user-submitted data.

### f:sanitize.html (v12+) — Proper HTML Sanitization

```html
<!-- Available since TYPO3 v12, requires EXT:fluid -->
<f:sanitize.html>{userProvidedHtml}</f:sanitize.html>
```

`f:sanitize.html` uses the HtmlSanitizer library to strip disallowed tags and attributes. This is
the correct ViewHelper when HTML input from editors or external sources must be rendered but still
sanitized.

### Rules

- Never use `{variable -> f:format.raw()}` with user-submitted data
- Never use `f:format.html` as a sanitizer for user input — it is for RTE content
- Use `f:sanitize.html` (v12+) when rendering HTML from untrusted or semi-trusted sources
- Keep auto-escaping active by default; only opt out when you have explicit control over the value

---

## TypoScript Security

### config.no_cache = 1 — Session Data Leaks

```typoscript
# Dangerous: disables page cache globally
config.no_cache = 1
```

Setting `no_cache = 1` on a cached page causes TYPO3 to regenerate it on every request. If session
data or user-specific content is mixed into the page output without proper USER_INT handling, it can
leak between requests under certain caching proxy setups. Use `COA_INT`/`USER_INT` for
user-specific content instead of disabling caching globally.

### GP:* in getText — Input Validation Required

```typoscript
# Reads GET/POST parameter directly — never use unvalidated
lib.dangerousExample = TEXT
lib.dangerousExample.data = GP:tx_myplugin|searchQuery
```

`GP:*` reads raw GET or POST parameters. Any value from `GP:*` must be validated and sanitized
before use in output, database queries, or file paths. Use `stdWrap.required`, `stdWrap.intval`, or
equivalent sanitization. Never pass GP values directly to `dataWrap`, file paths, or user-visible
output without validation.

```typoscript
# Safer: restrict to integer values
lib.pageId = TEXT
lib.pageId.data = GP:page
lib.pageId.intval = 1
```

### GIFBUILDER Text Injection

```typoscript
# If the text source contains user input, it can alter the rendered image
lib.myImage = IMAGE
lib.myImage.file = GIFBUILDER
lib.myImage.file {
  XY = [10.w]+20,[10.h]+20
  10 = TEXT
  10.text.data = GP:title  # Dangerous: user controls image text
}
```

Do not feed user-controlled data into `GIFBUILDER` `TEXT` objects. An attacker can inject arbitrary
text into generated images, which may be used for phishing or content spoofing.

### userFunc — Arbitrary PHP Execution

```typoscript
lib.example = USER
lib.example.userFunc = MyVendor\MyExt\UserFunction->render
```

`userFunc` calls arbitrary PHP. Never allow the class or method name to be influenced by user input
or external configuration. Audit every registered `userFunc` to ensure it does not expose sensitive
operations or accept unsanitized parameters.

Since v14, TypoScript/TSconfig callables require explicit opt-in registration (#108054) — an
unregistered `userFunc` is no longer executed. Treat the allow-list as a security boundary and keep
it minimal.

### Absolute URLs — config.absRefPrefix Removed in v14

```typoscript
# v14+: config.absRefPrefix was REMOVED (Breaking #108114).
# Use forceAbsoluteUrls where unambiguous absolute links are required:
config.forceAbsoluteUrls = 1

# v12/v13 only: avoid protocol-relative prefixes (mixed-content abuse)
config.absRefPrefix = //example.com   # Avoid
config.absRefPrefix = auto            # Prefer
```

### stdWrap.data = GP:* — Never Trust Directly

```typoscript
# Dangerous: outputs raw GET parameter
lib.output = TEXT
lib.output.data = GP:name
lib.output.wrap = <p>|</p>

# Safer: validate and sanitize
lib.output = TEXT
lib.output.data = GP:name
lib.output.htmlSpecialChars = 1
lib.output.required = 1
lib.output.wrap = <p>|</p>
```

Always apply `htmlSpecialChars = 1` or `intval = 1` (depending on expected type) to any value
sourced from `GP:*`. Never trust GET/POST parameters directly in output context.

---

## TSconfig Security

### TCEMAIN.permissions — Restrict Access Appropriately

```
# Page TSconfig: prevent editors from creating pages under certain pages
TCEMAIN.permissions.everybody = 0
TCEMAIN.permissions.user = show,edit,delete,new,editcontent
TCEMAIN.permissions.group = show,edit,new,editcontent
```

Apply the principle of least privilege. Do not grant `admin`-equivalent permissions to regular
editor groups via TSconfig. Review `TCEMAIN` permission settings per page tree branch.

### TCEFORM — Limit Available Fields for Editors

```
# Restrict which fields editors can modify
TCEFORM.tt_content.layout.disabled = 1
TCEFORM.tt_content.space_before_class.disabled = 1
```

Use `TCEFORM` to hide or disable fields that editors should not modify. This reduces the attack
surface for editors accidentally or intentionally manipulating content structure.

### RTE Allowed Tags — Prevent Script Injection

```
# Restrict allowed HTML elements in the RTE
RTE.default.proc.allowTags = p,br,strong,em,a,ul,ol,li,h2,h3,h4,table,tr,td,th
```

Explicitly whitelist allowed HTML tags in RTE configuration. Do not allow `<script>`, `<iframe>`,
`<object>`, `<embed>`, or event handler attributes (`onclick`, `onload`, etc.). Use the
`allowTags` property rather than relying on defaults.

### File Upload Restrictions

```
# Restrict uploadable file types in file fields
TCAdefaults.sys_file_reference.crop =
options.uploadFieldsInTopOfEB = 0
```

Use `allowedFileExtensions` in TCA/TSconfig file field configuration to prevent upload of
executable file types (`.php`, `.phtml`, `.js`, `.sh`, etc.). Verify that the web server is
configured to not execute uploaded files regardless.

---

## Production Settings

### config.contentObjectExceptionHandler — Never Disable in Production

```typoscript
# Wrong: suppresses error handling, can expose sensitive debug info
config.contentObjectExceptionHandler = 0

# Correct: use the production exception handler (default in production context)
config.contentObjectExceptionHandler = TYPO3\CMS\Frontend\ContentObject\Exception\ProductionContentObjectExceptionHandler
```

The production exception handler catches rendering errors and outputs a generic message instead of
a stack trace. Never disable or replace it with the debug handler in production.

### config.debug = 0 in Production

```typoscript
# Must be 0 in production — exposes internal paths, queries, and configuration otherwise
config.debug = 0
```

### config.no_cache = 0 Always in Production

```typoscript
# Must be 0 in production
config.no_cache = 0
```

Leaving `no_cache = 1` in production degrades performance and can cause session/cache cross-
contamination in proxy environments.

### Error Handling: productionExceptionHandler

In `LocalConfiguration.php` or `AdditionalConfiguration.php`, ensure:

```php
$GLOBALS['TYPO3_CONF_VARS']['SYS']['productionExceptionHandler'] =
    \TYPO3\CMS\Core\Error\ProductionExceptionHandler::class;
```

The production exception handler must not output stack traces, file paths, or SQL errors to the
browser.

### Logging — Never Log Sensitive Data

Do not log passwords, session tokens, full request bodies containing personal data, or API keys.
Configure log levels appropriately per environment:

- Production: `WARNING` or higher only
- Development: `DEBUG` acceptable, but never commit debug log config to production

```typoscript
# Do not enable debug output in TypoScript setup for production
# config.debug = 1      # Never in production
# config.no_cache = 1   # Never in production
```
