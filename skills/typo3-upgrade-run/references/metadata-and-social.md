# Metadata, social cards and the legal notice

An upgrade is the one moment somebody reads every page's `<head>` on purpose. Use it.

This file covers three things that are cheap to get right once and expensive to leave wrong:
the **minimum correct metadata set**, a **generated Open Graph card**, and the **Impressum**.

None of it is invariance work. Adding a meta tag changes the DOM, so it is Contract B and needs
the same approval as any other elevation — but it is approval for a change that is nearly always
wanted, and the evidence for it comes free from the audit below.

---

## 1. The minimum set

Run this first. It takes one command and tells you how much of the problem is real:

```bash
curl -s https://site.ddev.site/ | grep -oiE '<meta[^>]*(name|property)="[^"]*" content="[^"]*"'
```

A v12-era site frequently answers with two tags — `generator` and whatever EXT:seo emits by
default. That is the finding.

Then measure the *data*, not the template, because the template is usually fine and the fields
are usually empty:

```bash
ddev mysql -N -e "SELECT COUNT(*) total,
  SUM(description<>'') has_description,
  SUM(seo_title<>'')  has_seo_title,
  SUM(og_title<>'')   has_og_title,
  SUM(og_image<>'')   has_og_image
  FROM pages WHERE deleted=0 AND hidden=0;"
```

**This is the low end — the set every page must carry.** Anything less is a defect, not a
preference:

| Tag | Value | Why it is not optional |
|---|---|---|
| `<title>` | page title + site name | The single strongest on-page SEO signal, and the browser tab and bookmark label. |
| `charset` | `utf-8` | Must be in the first 1024 bytes or the browser guesses. |
| `lang` on `<html>` | BCP 47, matching the site locale | Screen-reader pronunciation and translation. See `known-problems.md`. |
| `description` | 120–160 chars, per page | What the search result actually shows. Duplicated across pages is nearly as bad as absent. |
| `robots` | `index,follow` | Absent is *usually* the same, but stating it stops a stray `noindex` going unnoticed. |
| `canonical` | absolute self-URL | EXT:seo emits this. Verify it — a wrong canonical de-indexes the page. |
| `og:title` | page title | Without it, every shared link is titled by whatever the scraper guesses. |
| `og:description` | page description | Same. |
| `og:type` | `website` (or `article`) | Required by the OG spec. |
| `og:url` | absolute canonical URL | Consolidates shares onto one URL. |
| `og:site_name` | the organisation's **real name** | See the trap below. |
| `og:image` | 1200×630 | A shared link with no image is a grey box. Section 2 generates one. |
| `twitter:card` | `summary_large_image` when a 1200×630 image exists | Otherwise the card crops to a small square. |

Two more that are **not** in the minimum set, deliberately:

- **`viewport`** — it changes mobile rendering. On a fixed-width legacy layout, adding it is a
  redesign, not a metadata fix. It belongs to the responsive work.
- **`og:image:width` / `og:image:height` / `og:image:type`** — see the trap below. They are
  optional for crawlers and actively dangerous to set from TypoScript.

### The `websiteTitle` trap

`og:site_name` is usually wired to the site configuration's `websiteTitle`, which is very often
still the **project slug** from the day the site was scaffolded — `fischerei-verband`,
`kunde-relaunch-2019`. It is invisible in the frontend and appears in every social share.
Check it, and check what the `<title>` uses, because the two are frequently different and one of
them is wrong.

### Fallbacks: "use the correct value when empty"

Do not leave a tag off because the field is empty — derive it. A per-page value must always win,
so use `ifEmpty`/`//` chains rather than overwriting:

```typoscript
page.meta {
    description.data = page:description // page:abstract // page:subtitle
    description.ifEmpty.data = page:title

    robots = index,follow

    og:title.data = page:og_title // page:seo_title // page:title
    og:title.attribute = property

    og:description.data = page:og_description // page:description // page:abstract
    og:description.ifEmpty.data = page:title
    og:description.attribute = property

    og:type = website
    og:type.attribute = property

    og:site_name.data = site:websiteTitle
    og:site_name.attribute = property

    og:url.typolink.parameter.data = page:uid
    og:url.typolink.forceAbsoluteUrl = 1
    og:url.typolink.returnLast = url
    og:url.attribute = property
}
```

An editor filling the SEO tab silently takes over from every one of these.

---

## 2. A generated Open Graph card

A hand-made share image ages the moment a page is renamed, and nobody makes 97 of them. TYPO3
can compose one per page with **GIFBUILDER**, in pure TypoScript — no screenshot service, no
build step, no extension. TYPO3 caches the result by a hash of the configuration plus the text,
so each distinct title is rendered once and then served as a static file.

Follow the house layout: brand logo top left, the page title set large and wrapped to the card
width, and a brand accent rule along the bottom, on a 1200×630 canvas.

```typoscript
page.meta.og:image {
    cObject = IMG_RESOURCE
    cObject {
        file = GIFBUILDER
        file {
            XY = 1200,630
            format = png
            backColor = #FFFFFF

            10 = IMAGE
            10.file = EXT:site_package/Resources/Public/images/printlogo.gif
            10.offset = 80,70

            20 = TEXT
            20 {
                text.data = page:og_title // page:seo_title // page:title
                text.trim = 1
                fontFile = EXT:core/Resources/Private/Font/nimbus.ttf
                fontSize = 52
                fontColor = #4b4b4d
                offset = 80,300
                breakWidth = 1040
                breakSpace = 1.35
                niceText = 1
                angle = 0
                splitRendering.compX = 0
            }

            30 = BOX
            30 {
                dimensions = 80,540,1040,8
                color = #635a4c
            }
        }
    }
    # IMG_RESOURCE returns a web-root-relative path; og:image must be absolute.
    stdWrap.dataWrap = {getIndpEnv:TYPO3_SITE_URL}|
    attribute = property
}
```

### Four traps, all of which cost a debugging session

1. **`angle` and `splitRendering.` are mandatory on v14.**
   `GifBuilder::ImageTTFBBoxWrapper()` is typed `int $angle, …, array $splitRendering`. Most call
   sites guard with `?? 0` / `?? []`, but the ones reached by `breakWidth` word wrapping do not,
   so an absent key passes `null` and throws a **TypeError before a single pixel is drawn**.
   `splitRendering.` only has to *exist* — a non-numeric child is ignored by `splitString()`.

2. **Never set `og:image:width` from TypoScript.** TYPO3's `OpenGraphMetaTagManager` models those
   as sub-properties and rejects the top-level name with
   `This MetaTagManager can't handle property "og:image:width"` (#1524209729) — and that exception
   **aborts rendering of the entire meta block**. One stray line silently removes every meta tag
   on the site. Symptom: `description` and all `og:*` vanish while `robots` survives.

3. **`page:twitter_image` is a FAL reference field, not a path.** `data = page:twitter_image`
   yields the reference *count*, so prefixing the site URL produces `https://…/0`. Omit
   `twitter:image` entirely — consumers fall back to `og:image`, which is what you want.

4. **`twitter:card` cannot be set from `page.meta`.** EXT:seo's generator runs after TypoScript
   and overwrites it from `pages.twitter_card`, defaulting to the small `summary`. Set the field:
   a TCA default for new pages, plus a one-off fill of the empty rows. Leave rows an editor set
   deliberately alone.

   ```php
   // Configuration/TCA/Overrides/pages.php
   $GLOBALS['TCA']['pages']['columns']['twitter_card']['config']['default'] = 'summary_large_image';
   ```
   ```bash
   ddev snapshot --name pre-twitter-card
   ddev mysql -e "UPDATE pages SET twitter_card='summary_large_image'
     WHERE deleted=0 AND (twitter_card='' OR twitter_card IS NULL);"
   ```

### Check the assets before designing the card

Rasterise nothing below its native size and upscale nothing. Measure first:

```bash
find fileadmin packages -iname '*logo*' \( -name '*.png' -o -name '*.svg' -o -name '*.gif' \)
```

A 133×91 GIF blown up to fill a 1200×630 card looks worse than no card. A print logo at ~376×92
sits correctly at native size. Watch for a `logo.svg` that is still the **orange TYPO3 placeholder**
from the sitepackage kickstarter — it is present far more often than anyone expects.

Verify by fetching the generated file, not by trusting the tag:

```bash
u=$(curl -s https://site.ddev.site/ | grep -oE '<meta property="og:image" content="[^"]*"' | sed 's/.*content="//;s/"$//')
curl -so /tmp/og.png "$u" -w 'http=%{http_code} type=%{content_type} bytes=%{size_download}\n'
```

Then **look at the image**. A card that renders 200 OK with the title missing is the normal
failure, not the exception.

---

## 3. The Impressum

Every commercial Austrian site needs one, the requirements differ by company form, and an
upgrade run is the only time anybody looks. Load the **`legal-impressum`** skill and check the
page against it — do not check from memory, because the field list is company-form-specific and
the law changes.

Confirm the company form first; it determines everything else:

| Form | Register | The identifier that must appear |
|---|---|---|
| Verein | ZVR | **ZVR-Zahl**, plus the Vorstand |
| GmbH / FlexCo / AG | Firmenbuch | **FN + court**, capital, directors |
| e.U. / OG / KG | Firmenbuch | **FN + court** |
| Einzelunternehmen | none | trade authority and chamber |

Check, at minimum, that the page carries: the operator's full legal name and a geographic
address (never a P.O. box), an email address, the register identifier for the company form, the
`§ 25 MedienG` Offenlegung for a public-facing site, and a link that actually resolves from every
page. Then check what should **not** be there: a link to the EU ODR platform, which was
**discontinued on 2025-07-20** and is now an Abmahnung risk rather than a requirement.

Report findings; do not invent legal content. Missing register numbers and officer names are for
the client to supply, and a plausible-looking invented FN is worse than a visible gap.
