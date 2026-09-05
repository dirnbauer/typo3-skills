# Trailing slashes and duplicate content

## TYPO3 accepts both forms, deliberately

`PageTypeSuffix` with `default: /` decides how TYPO3 **generates** URLs — every
link then ends in a slash. It does not decide what TYPO3 **accepts**. The core
answers both `/contact` and `/contact/` with 200, on purpose:

```php
// PageRouter::matchRequest(), both branches present in v12/v13/v14
$result = $matcher->match(rtrim($prefixedUrlPath, '/'));  // asked with /, slug without
$result = $matcher->match($prefixedUrlPath . '/');        // asked without /, slug with
```

`PageSlugCandidateProvider::getCandidateSlugsFromRoutePath()` likewise emits
`$prefix . '/'` **and** `$prefix` for every path segment. So the same page is
reachable under two URLs, and the core ships no inbound normalisation to collapse
them. Do not read a missing redirect as a misconfiguration.

```yaml
routeEnhancers:
  PageTypeSuffix:
    type: PageType
    default: /        # generation only
    index: ''
    map:
      /: 0
```

## Does the duplicate matter?

The canonical tag from EXT:seo already names one form, and Google treats the
canonical as a strong signal. But its own documentation ranks the methods by
influence and puts redirects **above** the canonical, so a site that cares about
the signal wants both. Google names 301 for this, not 307.

## Normalising inbound URLs

There is no core feature for it. `b13/slash-force` (`^11.5 || ^12.4 || ^13.4 ||
^14.3`) is the maintained option, and its ordering is the part worth copying:

```php
'after'  => ['typo3/cms-frontend/page-resolver', 'typo3/cms-frontend/page-argument-validator'],
'before' => ['typo3/cms-frontend/tsfe'],
```

Running **after** the page resolver means a path that does not resolve never
reaches the middleware and gets its 404 directly — no redirect to a URL that then
404s. Running **before** `tsfe` means the redirect short-circuits ahead of
rendering, so no page is built and a static file cache stores nothing under the
non-canonical URL. It reads `routeEnhancers.PageTypeSuffix.map` from the site
configuration instead of restating the rule, sends 301, and handles only GET and
HEAD.

Beware the opposite design. A middleware registered *before* the page resolver
cannot know whether the target exists, so it redirects typos, `/api/*` and the
whole `/.well-known/` namespace onto URLs that answer 404. That is survivable at
307 because clients do not cache it, and it is exactly why such a setup cannot
simply have its status raised to 301: a permanent redirect to a 404 is cached per
client and cannot be recalled. `studiomitte/redirect2trailingslash` is that
design and is capped at TYPO3 12.4.
