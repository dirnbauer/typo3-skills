# Image output format — AVIF first, WebP as the fallback

**Default to AVIF for every processed image, with WebP as the fallback, and JPEG/PNG only as
the last resort.** On a real v12-era site this was the single largest performance win available:
two header images went from 502 KB to 120 KB and Lighthouse performance went 89 → 100, LCP
3.8s → 1.8s, without moving a single element.

Measured on that run, same source, same 742×362 dimensions:

| Format | Bytes | PSNR vs original |
|---|---|---|
| original JPEG, unprocessed | 251 KB | — |
| JPEG re-encoded at `-quality 82` | 62 KB | 37.4 dB |
| **AVIF at the same quality setting** | **47 KB** | **38.8 dB** |

AVIF is both **smaller and closer to the original** than the JPEG. That is the usual result, and
it is why AVIF is the default rather than a nice-to-have.

---

## 1. Check what the processor can actually do — first, at P01

Never configure a format the installation cannot write; every image silently falls back and you
find out from a client. ImageMagick must report the delegate as `rw+` (readable **and**
writable):

```bash
ddev exec convert -list format | grep -iE '^ *(AVIF|WEBP|HEIC)'
```

```
AVIF  HEIC   rw+   AV1 Image File Format
WEBP* WEBP   rw+   WebP Image Format
```

`r--` means it can read the format but not produce it. Then check TYPO3 allows the extension:

```bash
ddev typo3 configuration:show GFX/imagefile_ext
```

`avif` and `webp` must both appear. On TYPO3 13.4+ they are in the default list; on older
installations, and on any list a project has overridden by hand, they are frequently missing.

**Decide the format from that evidence, in this order:** AVIF if writable → WebP if writable →
leave JPEG/PNG and record why. Put the answer in the run notes so the next phase does not
re-derive it.

## 2. The TypoScript property is `ext`, not `fileExtension`

This costs everyone an hour exactly once:

```typoscript
file.ext = avif          # correct
file.fileExtension = avif  # silently does nothing
```

`ContentObjectRenderer` reads the TypoScript key `ext` and maps it to the processor's internal
`fileExtension`. Writing `fileExtension` in TypoScript is not an error — it is ignored, the image
is emitted as JPEG, and the only symptom is that nothing improved.

## 3. Force processing when the source is already the target size

A source file that is already exactly the requested dimensions is **passed through untouched**.
TYPO3 sees no resize to perform, so it never re-encodes — and an unoptimised 250 KB upload stays
a 250 KB download no matter what quality is configured.

This is the trap behind "we set the quality and nothing changed". `params` forces the file
through the processor:

```typoscript
renderObj = IMAGE
renderObj {
    file.import.dataWrap = {file:current:storage}:{file:current:identifier}
    file.width = 742
    file.height = 362
    file.ext = avif
    file.params = -quality 82 -strip -interlace Plane
}
```

`-strip` removes EXIF and colour profiles, which on camera uploads is often a third of the file.

## 4. Browser fallback: `<picture>`, not a bare `<img>`

`file.ext = avif` emits `<img src="…​.avif">` with **no fallback at all**. AVIF is supported by
roughly 95% of browsers — Chrome 85+, Firefox 93+, Safari 16.4+ — so a bare AVIF `<img>` shows
*nothing* on Safari 16.3 and older. For a hero image that is a blank page.

Where the markup is yours, emit a `<picture>` so the browser picks:

```html
<f:variable name="src" value="{f:uri.image(image: file, width: '742', ext: 'avif')}" />
<picture>
    <source srcset="{f:uri.image(image: file, width: '742', ext: 'avif')}" type="image/avif" />
    <source srcset="{f:uri.image(image: file, width: '742', ext: 'webp')}" type="image/webp" />
    <f:image image="{file}" width="742" alt="{file.alternative}" />
</picture>
```

The `<img>` stays the last child and keeps its `width`/`height`, so layout is unchanged and
CLS stays at zero. `<picture>` is a wrapper with no box of its own — **this is layout-neutral**,
which is what makes it safe during an invariance run.

When you cannot change the markup — a third-party extension's template — `file.ext = avif` alone
is a deliberate trade: measure the audience first, and prefer WebP (support ~97%, back to Safari
14) if the site has meaningful old-Safari or old-Android traffic.

## 5. Where NOT to use AVIF

- **`og:image` and `twitter:image`.** Social scrapers are not browsers. Facebook, LinkedIn,
  WhatsApp and Slack unfurlers largely do not decode AVIF, and the result is a link preview with
  no image at all. **Keep generated share cards as PNG or JPEG.**
- **Favicons**, `apple-touch-icon`, and anything consumed by an OS rather than a browser.
- **Email templates.** Mail clients are years behind; JPEG or PNG only.
- **PDF and print output.**

## 6. Verify, do not assume

Re-encoding changes pixels. During an invariance run that means the visual gate will report the
image tiles as different — expected, and it must be recorded as an approved elevation rather than
waved through. Quantify it instead of eyeballing:

```bash
# bytes actually delivered, and whether anything failed to decode
node scripts/lighthouse-sample.mjs --base-url … --count 10 --report …
```

```python
# PSNR against the original: >40 dB is visually indistinguishable, >35 dB is safe for photos
from PIL import Image, ImageChops; import math
a = Image.open(original).convert('RGB'); b = Image.open(processed).convert('RGB')
px = list(ImageChops.difference(a, b).getdata())
mse = sum(sum(c*c for c in p) for p in px) / (len(px)*3)
print(10 * math.log10(255**2 / mse))
```

And check the browser actually decoded them — a 200 response is not proof:

```js
[...document.images].filter(i => !i.complete || i.naturalWidth === 0).length   // must be 0
```

A format the browser cannot decode still returns 200, still appears in the network panel, and
renders as empty space.
