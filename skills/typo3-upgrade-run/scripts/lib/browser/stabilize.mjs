/**
 * Stabilisation — the code that makes two shots of an unchanged page identical.
 *
 * The init script is exported as a pure string so it is testable and so its hash can go
 * into the manifest: if the stabilisation profile changes between the before and after run,
 * the comparison is not like-for-like and the self-test lock must be invalidated.
 *
 * Two choices worth knowing:
 *  - Math.random is seeded PER CAPTURE. Rotating carousels, shuffled teasers and generated
 *    element ids cannot be stabilised with CSS, and they are the most common remaining
 *    source of flake once animations are off.
 *  - The clock is pinned but keeps MOVING. A hard freeze divides by zero in real code and
 *    breaks anything waiting on elapsed time; a fixed origin plus a monotonic counter is
 *    stable and still sane.
 */

import { sha256 } from '../run/paths.mjs';

export const STABILIZE_CSS = `
*, *::before, *::after {
  animation: none !important;
  animation-duration: 0s !important;
  transition: none !important;
  transition-duration: 0s !important;
  caret-color: transparent !important;
}
html { scroll-behavior: auto !important; scrollbar-gutter: stable !important; }
`.trim();

/** Runs before any page script. Keep it self-contained: it is serialised into the page. */
export function initScript({ seed = 20260725, epoch = 1774425600000 } = {}) {
  return `(() => {
  let s = ${seed} >>> 0;
  Math.random = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };

  let tick = 0;
  const OriginalDate = Date;
  const base = ${epoch};
  const nowFn = () => base + (tick += 1);
  class FrozenDate extends OriginalDate {
    constructor(...args) { super(...(args.length ? args : [nowFn()])); }
    static now() { return nowFn(); }
  }
  FrozenDate.parse = OriginalDate.parse;
  FrozenDate.UTC = OriginalDate.UTC;
  globalThis.Date = FrozenDate;
  if (globalThis.performance) { try { globalThis.performance.now = () => (tick += 1); } catch {} }

  const raf = globalThis.requestAnimationFrame;
  globalThis.__t3uFrames = new Set();
  if (raf) {
    globalThis.requestAnimationFrame = (cb) => { const id = raf(cb); globalThis.__t3uFrames.add(id); return id; };
  }
  // Carousels advance on setInterval far more often than on rAF, so cancelling frames
  // alone leaves the most common rotating element still moving between two passes.
  const setIntervalOrig = globalThis.setInterval;
  globalThis.__t3uTimers = new Set();
  globalThis.setInterval = (...a) => { const id = setIntervalOrig(...a); globalThis.__t3uTimers.add(id); return id; };

  globalThis.__t3uFreeze = () => {
    for (const id of globalThis.__t3uFrames) { try { cancelAnimationFrame(id); } catch {} }
    globalThis.__t3uFrames.clear();
    for (const id of globalThis.__t3uTimers) { try { clearInterval(id); } catch {} }
    globalThis.__t3uTimers.clear();
    for (const v of document.querySelectorAll('video')) { try { v.pause(); v.currentTime = 0; } catch {} }
  };
})();`;
}

/** Runs in the page immediately before the screenshot. Returns a small settle report. */
export function settleScript() {
  return `(async () => {
  const report = { fonts: false, lazy: 0, videos: 0, height: 0 };

  try { await document.fonts.ready; } catch {}
  try {
    const faces = [...document.fonts].map((f) => f.load().catch(() => {}));
    await Promise.all(faces);
    report.fonts = true;
  } catch {}

  // Force lazy content in by stepping to the bottom, then return to the top.
  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 30));
  }
  window.scrollTo(0, 0);
  await new Promise((r) => setTimeout(r, 60));

  const imgs = [...document.querySelectorAll('img')];
  await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((r) => {
    img.addEventListener('load', r, { once: true });
    img.addEventListener('error', r, { once: true });
    setTimeout(r, 3000);
  }))));
  report.lazy = imgs.filter((i) => i.complete).length;

  // img.complete only promises the bytes arrived - decoding can still be in flight, so a
  // screenshot taken here catches a partially painted photo and the same page differs
  // between two identical passes by a few hundred scattered pixels. decode() resolves
  // when the frame is ready to paint, which is the guarantee we actually need.
  await Promise.all(imgs.map((img) => {
    if (typeof img.decode !== 'function') return null;
    return img.decode().catch(() => {});
  }));
  report.decoded = imgs.length;

  // jQuery animations: switch them off and settle whatever is already running.
  //
  // CSS transition/animation overrides do not touch jQuery .fadeIn/.animate, which drive
  // most rotating headers and sliders on older sites. A fade caught mid-flight leaves the
  // element at an arbitrary opacity, so two passes differ by a scatter of pixels inside one
  // image box — the signature is a diff confined to exactly one element's rectangle.
  // fx.off makes future animations instant; finish() jumps running ones to their end state.
  report.jqueryAnimations = null;
  try {
    const jq = globalThis.jQuery || globalThis.$;
    if (jq && jq.fx) {
      const running = jq(':animated').length;
      jq.fx.off = true;
      jq(':animated').finish();
      report.jqueryAnimations = { version: jq.fn && jq.fn.jquery ? jq.fn.jquery : 'unknown', settled: running };
    }
  } catch {}

  // Consent overlays: seeding is the primary mechanism, this is the backstop.
  //
  // A banner that survives seeding covers the page and every screenshot behind it becomes a
  // picture of the banner. Remove only containers matching well-known consent implementations,
  // and REPORT each removal — silently deleting page content would hide a real regression.
  report.consent = { removed: 0, selectors: [] };
  const CONSENT = [
    '#CybotCookiebotDialog', '#usercentrics-root', '#uc-center-container', '#klaro',
    '.cc-window', '.cmplz-cookiebanner', '#cookiescript_injected', '#onetrust-consent-sdk',
    '#cookie-notice', '.cookie-consent-banner', '#cookieman-modal', '.tx-cookieman',
  ];
  for (const sel of CONSENT) {
    for (const el of document.querySelectorAll(sel)) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      el.remove();
      report.consent.removed += 1;
      if (!report.consent.selectors.includes(sel)) report.consent.selectors.push(sel);
    }
  }
  // Consent libraries commonly lock scrolling while open; restore it after removal.
  if (report.consent.removed) {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    document.body.classList.remove('cmplz-blocked', 'modal-open', 'no-scroll');
  }

  // Carousels: pin every one to its first slide and say so.
  //
  // A rotating carousel is the single worst offender in visual regression: the same page
  // shot twice lands on different slides, and the diff is a full-width image change that
  // looks exactly like a real regression. Freezing timers stops it moving, but wherever it
  // happened to be when we froze is arbitrary, so it must also be RESET to slide 1.
  //
  // Slide 2+ is therefore NOT covered by this run. That is a real coverage limit and it is
  // reported rather than left implicit — see report.carousels.
  report.carousels = { found: 0, pinned: 0, byLibrary: {}, untestedSlides: 0 };
  const note = (lib) => { report.carousels.byLibrary[lib] = (report.carousels.byLibrary[lib] || 0) + 1; };
  const countSlides = (root, sel) => { try { return root.querySelectorAll(sel).length; } catch { return 0; } };

  try {
    // Bootstrap 4/5
    for (const el of document.querySelectorAll('.carousel')) {
      report.carousels.found += 1;
      const slides = countSlides(el, '.carousel-item');
      if (slides > 1) report.carousels.untestedSlides += slides - 1;
      const B = globalThis.bootstrap;
      const inst = B && B.Carousel ? (B.Carousel.getInstance(el) || new B.Carousel(el, { interval: false, ride: false })) : null;
      if (inst) { try { inst.pause(); inst.to(0); report.carousels.pinned += 1; note('bootstrap'); } catch {} }
      else {
        const items = [...el.querySelectorAll('.carousel-item')];
        if (items.length) {
          items.forEach((s, i) => s.classList.toggle('active', i === 0));
          report.carousels.pinned += 1; note('bootstrap-css');
        }
      }
    }
    // Swiper
    for (const el of document.querySelectorAll('.swiper, .swiper-container')) {
      report.carousels.found += 1;
      const slides = countSlides(el, '.swiper-slide');
      if (slides > 1) report.carousels.untestedSlides += slides - 1;
      const sw = el.swiper;
      if (sw) { try { sw.autoplay && sw.autoplay.stop(); sw.slideTo(0, 0, false); report.carousels.pinned += 1; note('swiper'); } catch {} }
    }
    // Slick / Owl, only when their jQuery plugin is actually present
    const jq = globalThis.jQuery;
    if (jq) {
      jq('.slick-slider').each(function () {
        report.carousels.found += 1;
        const slides = countSlides(this, '.slick-slide:not(.slick-cloned)');
        if (slides > 1) report.carousels.untestedSlides += slides - 1;
        try { jq(this).slick('slickPause'); jq(this).slick('slickGoTo', 0, true); report.carousels.pinned += 1; note('slick'); } catch {}
      });
      jq('.owl-carousel').each(function () {
        report.carousels.found += 1;
        const slides = countSlides(this, '.owl-item:not(.cloned)');
        if (slides > 1) report.carousels.untestedSlides += slides - 1;
        try { jq(this).trigger('stop.owl.autoplay'); jq(this).trigger('to.owl.carousel', [0, 0, true]); report.carousels.pinned += 1; note('owl'); } catch {}
      });
    }
  } catch {}

  for (const v of document.querySelectorAll('video')) { try { v.pause(); v.currentTime = 0; report.videos += 1; } catch {} }
  if (globalThis.__t3uFreeze) globalThis.__t3uFreeze();

  report.height = document.documentElement.scrollHeight;
  return report;
})();`;
}

export function profileHash(profile) {
  return `sha256:${sha256(JSON.stringify({
    css: STABILIZE_CSS,
    init: initScript(profile),
    settle: settleScript(),
    profile: sortKeys(profile),
  }))}`;
}

/**
 * Consent must be SEEDED, never clicked. Clicking a banner is timing-dependent and is
 * itself a flake source — the one we would be trying to remove.
 */
export function consentStateFor(config = {}) {
  const cookies = Object.entries(config.cookies ?? {}).map(([name, value]) => ({ name, value: String(value) }));
  const origins = config.localStorage
    ? [{ origin: config.origin, localStorage: Object.entries(config.localStorage).map(([name, value]) => ({ name, value: String(value) })) }]
    : [];
  return { cookies, origins };
}

function sortKeys(o) {
  if (o === null || typeof o !== 'object') return o;
  if (Array.isArray(o)) return o.map(sortKeys);
  return Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])]));
}
