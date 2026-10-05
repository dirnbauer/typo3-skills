# 11. A Lighthouse pass on an existing TYPO3 site

What to change when a TYPO3 site must score better in Lighthouse (Performance, Accessibility,
Best Practices, SEO, Agentic Browsing), and how to prove that nothing else changed. Written from a
pass on a TYPO3 14.3 brochure site right after its upgrade. The first list applies to every site;
the second lists what was specific to that site and only needs checking elsewhere.

Result on that site (local DDEV with production-like caching, Lighthouse 13.4.1, mobile, median
of 3 runs): Performance 72–83 → 88–96, Accessibility 79–89 → 100, Best Practices 73–77 → 100,
SEO 85–92 → 100, Agentic Browsing 33–67 → 100. Mobile LCP 4.2–14.4 s → 2.6–3.6 s; page weight of
the home page 1.3 MB → 0.57 MB. Desktop 88–97 → 99–100.

## Measure the right thing first

1. **Same Lighthouse version as the client**, mobile and desktop, at least 3 runs per URL, median,
   one measuring job per machine. Measure before you change anything, on the same URLs after.
2. **Local caches.** A DDEV `additional.php` that sets every cache to `NullBackend` renders every
   request uncached (here 0.6 s TTFB instead of 0.1 s). Switch to production-like caching for the
   measurement only: file backends (`FileBackend`, options cleared) — database backends fail because
   the NullBackend schema never created the cache tables. Keep the switch as a patch outside Git.
3. **Staging behind HTTP Basic auth.** Apache verifies the htpasswd hash on *every* request,
   static files included. A bcrypt hash with cost 12 costs about 230 ms per request on a Plesk
   server (cost 5: 2 ms), so every asset looks slow and TTFB is inflated. Use `htpasswd -B -C 5`
   (the person who knows the password runs it) or an IP allowlist before judging staging numbers.
4. **No backend session in the measuring browser.** Lighthouse disables the browser cache and sends
   `Cache-Control: no-cache`; TYPO3 then bypasses the page cache for a logged-in backend user and
   renders the page uncached. Run Lighthouse in a private window.
5. **Prove the rest stayed equal.** Screenshot every sampled URL before and after at two viewports.
   Wait for CSS background images too (they are not in `document.images`) and for lazy images
   (scroll through the page). Oversized hero images decode at different resolutions from run to
   run; record the boxes of images and of intentionally recoloured elements, mask them, and require
   pixel identity everywhere else. Review the masked areas by eye.

## Always — every site

### Performance

- **No web fonts through CSS `@import`.** It chains HTML → CSS → font CSS → font file, all render
  blocking. Self-host Google Fonts: fetch Google's CSS with a current Chrome user agent, keep its
  `@font-face` rules unchanged (all subsets with their `unicode-range`, so every glyph renders as
  before), download the `woff2` files, rewrite the URLs. Two render-blocking requests and the
  visitor IP transfer to Google disappear.
- **Vite must not inline fonts.** Subset files under the 4 KB `assetsInlineLimit` end up in the CSS
  as base64, once per `@font-face` rule that uses them (here +24 KB in the render-blocking CSS):
  `assetsInlineLimit: (file) => (/\.(woff2?|ttf|eot|otf)$/.test(file) ? false : undefined)`.
- **Third-party CSS that only counts** (a webfont licence counter, a tracker) loads without
  blocking: `<link rel="stylesheet" href="…" media="print" onload="this.media='all'">`. If the
  response allows any origin (`Access-Control-Allow-Origin: *`), add `crossorigin="anonymous"`: no
  cookies are sent or stored (fixes the Best Practices third-party-cookie audit), and every page
  view still requests it, so a pageview licence keeps counting.
- **Processed images as WebP** (or AVIF where the processor writes it; check with
  `gm convert -list format` / `convert -list format` on the server):
  `$GLOBALS['TYPO3_CONF_VARS']['GFX']['imageFileConversionFormats']` with `jpg`, `jpeg`, `png`
  → `webp` in `additional.php`. **Existing processed files keep their old format**: TYPO3 reuses a
  processed file whose processing configuration is unchanged. Run
  `vendor/bin/typo3 cleanup:localprocessedfiles --all --force` and `cache:flush` once per
  environment after the deploy (cached pages still point to the old files). Pin images that must
  stay JPEG, such as `og:image`, with `fileExtension: 'jpg'`. PNG with transparency becomes WebP
  with alpha. Files first processed before TYPO3 14 (`ceil()`) come back 1 px lower where TYPO3 14
  rounds (`round()`), so text below such images moves by a pixel in screenshot comparisons.
- **Never deliver hero originals.** `f:uri.image` without dimensions returns the original file, or
  for a reference with a crop a full-size crop at `jpg_quality` (1.6–1.9 MB per hero here). Give it
  a `maxWidth`.
- **Hero background images become a `<picture>`.** `background-size: cover` on a portrait phone
  shows only a centre slice of a landscape photo. A phone source cropped to that slice
  (`width: '720c', height: '960c'`, `<source media="(max-width: 767px)">`) shows the same pixels at
  a third to a tenth of the bytes; `object-fit: cover; object-position: center` on the `<img>`
  reproduces the background exactly; the preload scanner finds it, and `fetchpriority="high"` puts
  it first. `alt=""`, because the hero text is in the heading.
- **Lazy images below the fold.** `loading="lazy"` on images of content elements that are never the
  first element of a page — check per page which CType comes first:
  `SELECT CType, COUNT(*) FROM (first tt_content per pid by sorting) GROUP BY CType`. Lists keep the
  first items eager (`{f:if(condition: '{iterator.index} > 2', then: 'lazy', else: 'eager')}`);
  news lists keep only the first image eager. Never lazy-load the LCP image.
- **Twice the displayed width for list images** on high-density screens (Best Practices
  image-size-responsive) — together with lazy loading for all but the first, or the LCP grows.

### Accessibility

- **One `<main id="content">` and a working skip link** to it, visible on focus
  (`visually-hidden-focusable`) and translated. Adding the wrapper to an old template has three
  traps: percentage heights that were relative to `body` collapse inside `main` (use `vh` with an
  `svh` override); adjacent-sibling selectors such as `.navbar + :not(.hero)` must become
  `.navbar + main > :first-child:not(.hero)`; dormant CSS for `main` (an old off-canvas pattern with
  `height: 100vh; overflow: auto; transform`) suddenly applies — remove it.
- **Picture-only links need a name.** Alternative text falls back to the item title
  (`{f:if(condition: file.alternative, then: file.alternative, else: item.title)}`); lightbox links
  get an `aria-label` ("Enlarge image: {title}").
- **Generic link texts** ("weiterlesen", "mehr") get a visually hidden suffix with the item name;
  this also passes the SEO link-text audit.
- **An empty `<th>`** gets visually hidden header text.
- **Brand colour pairs.** Check accent-on-primary pairs (footer links on the dark footer, headings
  on the accent background). Take the nearest colour that passes — mix toward white or black in 1 %
  steps until axe's ratio is reached with a small margin — and write the ratio into the variable's
  comment.
- **`object-fit: cover`** for `<img>` inside aspect-ratio boxes: column padding makes the box ratio
  differ from the image ratio, and the image is stretched (Best Practices image-aspect-ratio).

### SEO and Agentic Browsing

- **Links without `href`** (a back-to-top button) are not crawlable: `href="#top"` scrolls to the top
  natively; the script keeps its `preventDefault()`.
- **Soft 404 from a route enhancer.** An Extbase enhancer (News) without `limitToPages` matches any
  path below any page, so unknown URLs answer 200 with that page — `/llms.txt` included, which the
  Agentic Browsing category then parses as an invalid llms.txt. Limit every plugin enhancer to its
  plugin pages and check that `/does-not-exist/` answers 404.
- **Staging noindex** (`X-Robots-Tag: noindex`, `Disallow: /`) keeps SEO at about 69 on staging by
  design. Do not "fix" it there; measure SEO locally or on live.

## Check per site — found on one site, may not apply elsewhere

- A licensed webfont from MyFonts with a pageview counter `@import` in the font kit CSS: keep the
  request (licence), make it non-blocking as above.
- `settings.php` with `jpg_quality` 95: processed JPEGs two to three times heavier than needed. The
  WebP conversion uses `webp_quality` (default 85) instead.
- Hero originals only 1600 px wide: `maxWidth: 1920` keeps them, only the format changes.
- Hero sized as a percentage of `body` and a dormant `main` rule from an old off-canvas navigation
  (both traps above).
- A gold accent on the dark brand colour at 3.75:1 (footer links, AA needs 4.5:1) → the accent mixed
  26 % toward white (4.63:1); white on the accent at 2.09:1 (a large CTA heading, AA needs 3:1) →
  the dark brand colour (3.75:1).
- Two content elements that can be the first element of a page (offers, references): their first
  three images stay eager.
- The staging htpasswd had been created with bcrypt cost 12 (see the measurement section).

## Verify before deploying

- Lighthouse before/after on the same URLs (median), mobile and desktop.
- Masked screenshot comparison: identical outside the image boxes and the recoloured elements.
- Diff the built CSS rule by rule: only the intended rules differ, no `url(data:font…)`.
- `curl` an unknown URL: 404. Check `og:image` is still JPEG.
- After the deploy: `cleanup:localprocessedfiles --all --force`, `cache:flush`, then the first page
  views regenerate the WebP files (crawl the sitemap to warm the cache).

Related: [Performance SEO](07-performance-seo.md) · typo3-vite (fonts, build) ·
typo3-accessibility (landmarks, skip links) · typo3-upgrade-run
[quality bars](../../typo3-upgrade-run/references/quality-bars.md).
