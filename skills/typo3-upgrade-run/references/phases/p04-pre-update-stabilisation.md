# P04 — Pre-update stabilisation (loops 010, 020, 030, 040)

Track `invariance`. These changes happen **after** the baseline is sealed, and each is measured
against it.

| Loop | Slug | Scope |
|---|---|---|
| 010 | `sitemap-and-routing` | per-language sitemaps, hreflang, canonicals, excluded doktypes, `EXT:seo` |
| 020 | `build-pipeline-vite` | plain Vite: hashed output plus a manifest, referenced from Fluid/TypoScript, no bridge extension |
| 030 | `bootstrap-5-latest` | latest 5.x, in small verified steps |
| 040 | `accessibility-automated-green` | axe-core to 0 serious/critical per language |

## First: does the loop have a subject?

Three of these four loops are frequently **inapplicable**, and running one anyway is not neutral —
it changes a site that did not need changing, and every change then has to be proven invariant.
Measure before deciding, and record the measurement:

| Loop | Skip when | How to know |
|---|---|---|
| 020 Vite | the site uses no core concatenation or compression | `compressCss`, `compressJs`, `concatenateCss`, `concatenateJs` appear in no TypoScript file and no `sys_template` row. v14 removes those features — if they are unused, the removal breaks nothing and a build would be introduced solely to have one. |
| 030 Bootstrap | Bootstrap is not used | zero Bootstrap class names or variables in the shipped CSS and templates. A `bootstrap*` entry in `package.json` proves nothing: unused npm dependencies outlive their use, and a **Bootstrap 3** package is not a Bootstrap 5 upgrade waiting to happen. |
| 010 sitemap | never — the sitemap is the sampling source for every later loop | |

Write the decision as an ADR with the evidence in it. "We skipped it" and "there was nothing to
skip" read identically in a report six months later, and only one of them is defensible.

## Expectation per loop
- **010 and 020 must be pixel-identical.** They change routing metadata and asset delivery, not
  rendering. Any difference is a `regression`.
- **030 and 040 are declared-change loops.** Differences are expected, but each needs an approval per
  difference class with before/after evidence.

## Loop 010 — Sitemap and routing

A broken or partial sitemap is not cosmetic here: it is the sampling source for every later loop, so
whatever it omits is never measured. Fix it, then **prove** it — a sitemap that returns 200 is not
the same as a sitemap that is correct.

**Wiring.** The usual cause of a 500 on `/sitemap.xml` is that `EXT:seo` is installed but its static
TypoScript is not included in the root template, so no `PAGE` object exists for the sitemap page
type — the route resolves and then has nothing to render. Check the root template's
`include_static_file` before assuming a routing problem. Add the sitemap page type to the
`PageType` enhancer only if it is genuinely absent.

**Records, not just pages.** Every extension whose records have their own detail URLs needs its own
sitemap provider — news, events, products. Two failure modes are equally common: the provider is
missing, so detail pages never appear; or the provider is configured for an extension carrying **no
records**, which produces an empty `<urlset>` that looks configured and proves nothing. Check the
record count before configuring a provider.

**Languages.** One sitemap per configured language, each reachable under that language's own base,
each listing only that language's URLs. A single-language site needs no index; a multi-language site
does, and `sitemap.xml` must then point at the per-language documents rather than duplicating them.

**Nice URLs.** Detail routes belong in the sitemap as slugs, not as parameter chains. If a listed URL
contains `?tx_`, `&cHash=` or `?id=`, the route enhancer is missing or not matching — fix the
enhancer rather than putting the parameter form in the sitemap, because that form is what search
engines would then index.

### The double check: run it, do not read it

```bash
node scripts/sitemap-audit.mjs --base-url "https://acme.ddev.site" --json sitemap-audit.json
```

Reading a sitemap tells you whether the document you *looked at* is right. It cannot tell you about
the one you never thought to open — a second site nobody enumerated, or a language that quietly
falls back to the default. So the audit never trusts one source:

| Source | Answers |
|---|---|
| `config/sites/*/config.yaml` | which sites and languages **should** exist — every base, every `baseVariant`, every enabled language |
| The live HTTP responses | which sitemaps **do** exist, following any `<sitemapindex>` to the documents it names |
| The database | how many indexable pages there **are**, so an empty or partial sitemap cannot pass |

A disagreement between any two is a finding: config without live is a missing sitemap, live without
config is a document nobody declared, and database without live is a page tree the sitemap does not
cover. It exits 1 on findings, so it can gate the loop instead of being read and nodded at.

It also checks language purity per document (a `de` sitemap listing `en` URLs is a fallback fault),
canonical URL form (a listed `?tx_…` or `&cHash=` means the route enhancer is missing — fix the
enhancer, never ship the parameter form), and that `robots.txt` advertises a sitemap that resolves.

### Checks — each of these has to pass before the loop closes

| Check | Passes when |
|---|---|
| Reachable | `/sitemap.xml` → **200** with `Content-Type: application/xml` or `text/xml`, not `text/html` |
| Parseable | The body is well-formed XML with a `<urlset>` or `<sitemapindex>` root |
| Complete | Entry count equals the number of indexable pages plus records with detail URLs — derive that number from the database, do not eyeball the list |
| Correctly excluded | No `no_search` pages, sysfolders, shortcut/link doktypes, the 404 page, or hidden and deleted rows |
| Live | Every listed URL answers 200 — sample them all on a small site, a random sample on a large one, and record which |
| Canonical form | No `?tx_`, `&cHash=`, `?id=`, no duplicate URLs, no mixed trailing-slash forms, absolute URLs on the site's own base |
| Per language | Each language's sitemap is reachable and lists only that language's URLs |
| Advertised | `robots.txt` names the sitemap, and the path it names resolves |
| Discovery parity | Re-run `t3u discover-urls` **without** `--golden-file` and diff the URL set against the baseline sample. Every URL the sample missed is recorded — that diff is what the fix was worth |

The last one is the check that matters most when the baseline was captured with degraded sampling:
it converts "the sitemap works now" into a measured statement about what the earlier sample could
not see.

## Loop 030 — Bootstrap, in order
Dependency bump → removed or renamed utilities → component markup → custom SCSS overrides. Re-shoot
the affected pages after **each** step rather than making one large jump, and read the diffs instead
of skimming the pass/fail count. Inspect grid and container behaviour, spacing utilities, typography
scale, buttons, forms, navigation, modals and tables at every breakpoint.

Repairs available: map new utility classes onto the old behaviour, add SCSS compatibility rules, set
changed variables back to their previous values, adjust component markup, align grid and container
widths, correct form-control heights, override new default spacing, restore typography defaults.

The goal is not to preserve old Bootstrap internals. It is **new Bootstrap implementation, same
rendered result**.

## Loop 040 — Accessibility
Audit representative pages per language with `typo3-wcag22-aa-agentic`, fix with `typo3-accessibility`
patterns, re-audit until 0 serious/critical.

Most fixes are visually neutral. Where one is not — a new focus indicator, for example — it changes
one interaction *state*, which is why states are captured separately. Name the permitted visible
changes concretely, limit them to specific states, and get them approved. The default state of a page
is never changed wholesale because an accessibility audit happens to be running.

**Measure each fix separately, and be ready to revert it.** Whether a markup correction is visually
neutral is a measurement, not a judgement — and the answer is regularly no for reasons that are
invisible in the diff you are editing. A real case: a template wrapped a menu in a `<ul>` that
already emitted its own `<ul>`, which axe flags as invalid nesting. Removing the redundant wrapper
produced correct markup and changed **57 of 60 sampled captures**. Every finding carried
`diffPixels: 0` — the pixels were identical and the page *height* was not, because the stylesheet
used descendant selectors (`#sidebar ul`, `#sidebar ul li ul`) that applied twice under the nesting
and once without it. Layout detection caught what a pixel threshold alone would have missed.

That fix was reverted, not approved. A site-wide layout shift is not the "one interaction state"
this loop is allowed to change, and accepting it mid-run costs more than the violation: after the
migration, every question about that region would have had two possible causes instead of one.

**A partial close is a legitimate outcome.** Fix what is genuinely neutral, defer what is not to
Contract B with the measurement attached, and record the loop as *one rule fixed, two open* rather
than dressing it up as green. A deferred violation with evidence is worth more than a closed loop
that quietly moved the baseline.

**Fix the cause where you can reach it.** `html-has-lang` failing site-wide usually means
`config.doctype` is an XHTML variant, which emits `xml:lang` and no `lang`. Setting
`config.htmlTag.attributes.lang` fixes it now at zero rendering cost; migrating the doctype to HTML5
in P08 makes that explicit attribute redundant. Do the cheap fix now and note the real cause — do
not depend on a doctype change that has not happened yet.

## Exit
Compared against `A-original`: 0 unclassified findings, every `declared-change` carrying an approval,
idempotence re-run clean.

## Blocking
Any difference without a cause. Any attempt to update `baseline/A-original/`. Newly reachable URLs go
to `A-supplemental/` and are excluded from the invariance claim.

