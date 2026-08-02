# Stabilisation — making loop 000 reach zero

Loop 000 shoots the untouched site twice and requires zero differences. Nothing changed between the
passes, so **every** difference is a property of the measurement. This file is the catalogue of what
to fix, roughly in the order the causes appear in practice.

Passing loop 000 by shrinking the sample, raising a threshold, or excluding a page without an ADR is
forbidden — it makes every later comparison meaningless, because the harness can then no longer tell
a real regression from its own noise.

## The context

```js
const context = await browser.newContext({
  viewport, deviceScaleFactor: 1,
  locale: 'de-AT', timezoneId: 'Europe/Vienna',
  colorScheme: 'light', reducedMotion: 'reduce', forcedColors: 'none',
});
```

## The init script — run before any page code

```js
await context.addInitScript(({ seed, epoch }) => {
  // 1. Seed Math.random per capture.
  //    This is the single highest-leverage stabilisation: randomised carousels, shuffled
  //    teasers and generated element ids all become deterministic, and none of them can be
  //    fixed with CSS.
  let s = seed >>> 0;
  Math.random = () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296);
  };

  // 2. Pin the clock, but keep it MOVING.
  //    A hard freeze divides by zero in real code and breaks animation libraries that wait
  //    for elapsed time. A fixed origin plus a monotonic counter is stable and still sane.
  let tick = 0;
  const OriginalDate = Date;
  Date.now = () => epoch + (tick += 1);
  globalThis.Date = class extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [epoch])); }
    static now() { return epoch + (tick += 1); }
  };

  // 3. Track rAF ids so pending frames can be cancelled before the shot.
  const raf = globalThis.requestAnimationFrame;
  globalThis.__t3uFrames = new Set();
  globalThis.requestAnimationFrame = (cb) => {
    const id = raf(cb); globalThis.__t3uFrames.add(id); return id;
  };
  globalThis.__t3uFreeze = () => {
    for (const id of globalThis.__t3uFrames) cancelAnimationFrame(id);
    globalThis.__t3uFrames.clear();
  };
}, { seed: config.pageRandomSeed, epoch: config.frozenClockEpoch });
```

## The style patch

```css
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; scrollbar-gutter: stable !important; }
```

`scrollbar-gutter: stable` matters more than it looks: a scrollbar appearing on one pass and not the
other shifts the entire layout horizontally and reads as a site-wide regression.

## Before every shot

| Step | Why |
|---|---|
| `await page.evaluate(() => document.fonts.ready)` **plus** an explicit `document.fonts.load()` per declared face | `fonts.ready` resolves for fonts already requested; a face used further down the page may still be pending |
| Pause every `<video>`, rewind only when it moved, and hide native controls while recording the hidden-control count | A frame difference of one is still a difference; Chromium's buffered-range paint is asynchronous browser UI |
| Force lazy-load completion: stepped scroll to the bottom, wait until every `img[loading=lazy]` reports `complete`, scroll back to 0 | Full-page screenshots do not trigger lazy loading reliably |
| Seed the consent state from configuration as cookies or localStorage | **Never dismiss the banner by clicking** — clicking is timing-dependent and is itself a source of flake |
| Warm image processing before the first capture | TYPO3 generates `_processed_` files on demand; the first request pays for it and may capture a placeholder |
| `__t3uFreeze()` | cancel pending animation frames |
| Wait for a network quiet period fed by the route handler | **Do not use `networkidle`** — it is unreliable and it hides which requests were in flight |

## Diagnosing by failure shape

| What differs | Almost always |
|---|---|
| Text that looks like a date, time, or "x minutes ago" | clock not pinned |
| Teaser or slide order | `Math.random` not seeded |
| Whole layout shifted horizontally | scrollbar gutter |
| First fold correct, lower page blank or shifted | lazy loading not completed |
| Letterforms subtly different | fonts not fully loaded, or a font missing in one environment |
| One image differs, others fine | `_processed_` generated during the capture |
| A banner present in one pass | consent state not seeded |
| Random small regions | animation or transition not suppressed |
| Everything differs slightly | device scale factor, colour scheme, or a browser version change → check the environment fingerprint first; this is `INVALID`, not a stabilisation problem |

## When a page genuinely cannot be stabilised

A live feed, a third-party embed that cannot be mocked, or genuinely random editorial content.

Record it in `config/run.yml` under `unstable_urls`, write an ADR explaining why, and accept that
the URL is **excluded from the invariance claim** and named in the closure certificate.

This is an escape hatch with a cost, and the cost must stay visible. It is not a way to silence an
inconvenient regression: the test is whether the instability reproduces on the *untouched* site,
which is exactly what loop 000 measures.


## Consent banners: verify by hand, then seed and remove

Two different jobs, and conflating them is why consent handling usually goes wrong.

**Verification is a behaviour check, not a capture step.** Clicking the banner during captures is
timing-dependent and is itself a flake source — the very thing stabilisation removes. So exercise it
deliberately, once, outside the capture loop, and look at the result:

1. Load a page with no consent cookie and confirm the banner appears.
2. **Accept all** → banner closes, choice persists across a reload and a second page, and any
   content it gates (embedded video, maps) now renders.
3. Clear state, reload, **reject all** → banner closes, gated content stays blocked, and nothing
   third-party loads. Check the network list, not just the page.
4. Clear state, reload, use **settings / individual choice** → toggling one category persists that
   category and only that one.
5. On at least two of those runs, look at the banner itself at desktop and mobile width: is it
   readable, are the buttons reachable, is it keyboard-operable, does it trap focus.

Record the result. A banner that cannot be rejected, or whose rejection does not actually block
third-party requests, is a legal finding as much as a technical one and belongs in the report.

**Capture handling is separate: seed, never click.** Put the accepted state and selectors in a
project-local JSON file and pass it to `discover-urls --stabilization-config`; the entire adapter is
sealed into the manifest:

```json
{
  "consent": {
    "origin": "https://site.ddev.site",
    "cookies": { "consent": "accepted" },
    "localStorage": {},
    "fallbackSelectors": ["#project-consent-overlay"],
    "scrollLockClasses": ["project-consent-lock", "no-scroll"],
    "modalTriggerSelectors": ["button[data-open-consent]"]
  }
}
```

The default capture is the accepted state. When modal triggers exist, discovery automatically adds
`consent-modal-open` as a separate visual state. The settle script removes only the configured
fallback selectors, restores only the configured scroll-lock classes, and reports every removal.
No project or provider selector belongs in harness source.

## Native video controls: hide during pixels, cover behavior separately

Chromium paints native video controls in user-agent shadow DOM. Even after the video is paused,
ready, network-idle and at `currentTime = 0`, its buffered-range and timeline pixels can vary between
fresh browser processes. Author CSS cannot freeze that browser-owned paint, and waiting for more
media data made real full-site runs much slower without making the controls deterministic.

The default pixel capture therefore pauses and conditionally rewinds each video, waits within a
fixed bound for current data, then sets the DOM `controls` property to false. The video box, first
frame or poster, dimensions and surrounding layout remain in the strict-zero proof. The settle
report records `videoControlsHidden`, `videoReady`, `videoTimedOut` and `videoStates`; the hidden
count is a coverage limit and belongs in the closure report.

Control behavior is a separate interaction/manual check: play/pause, seek, mute, fullscreen,
keyboard operation and an accessible name. If native control pixels themselves are contractual,
replace them with a deterministic site-owned control component and capture explicit states; do not
raise the pixel threshold or silently crop the video.

## Carousels: pinned to slide 1, and slide 2+ is declared untested

A rotating carousel is the worst single offender in visual regression. The same page shot twice
lands on different slides, and the diff is a full-width image change that looks exactly like a real
regression — so it burns an iteration of the one loop that matters.

Freezing is not enough on its own. Two things are needed:

- **Stop the motion.** Carousels advance on `setInterval` or chained `setTimeout` calls
  far more often than on `requestAnimationFrame`, so cancelling frames leaves them running.
  The init script wraps both timer APIs and clears every registered timer at freeze time.
- **Reset the position.** Wherever the carousel happened to be when the timers stopped is arbitrary
  and differs between passes, so each one is driven back to its first slide through its own library
  API — Bootstrap, Swiper, Slick and Owl are handled, with a CSS-class fallback for Bootstrap markup
  when the library object is absent.

**The consequence is a real coverage limit: only slide 1 is ever compared.** A regression that
exists exclusively on slide 3 will not be caught. The settle report carries
`report.carousels.untestedSlides` for exactly this reason — it is the count of slides this run never
looked at, and it belongs in the coverage declaration alongside URLs that were not captured. Pinning
without declaring would be the dishonest version of this fix.

If a carousel matters enough to need real coverage, give it explicit capture states rather than
loosening the pinning: a state per slide, each deterministic.
