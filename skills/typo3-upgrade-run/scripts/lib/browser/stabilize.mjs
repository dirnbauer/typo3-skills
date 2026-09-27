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
import { HarnessError } from '../cli/exit-codes.mjs';
import { parseRegionSelector } from '../compare/dom-normalize.mjs';
import { BLEND_MODES } from './media-adapters.mjs';

const ADR_ID = /^ADR-\d{3,}$/;
const MAX_RANDOMIZED_REGIONS = 20;

/**
 * Validate the adapter keys of a stabilization profile before it is sealed.
 *
 * randomizedRegions and media narrow what the pixel claim means, so every entry names the ADR
 * that approved it, and unknown keys are refused rather than ignored: a typo would otherwise
 * seal a profile that silently does nothing. Other top-level keys are left to their owners.
 */
export function validateStabilizationProfile(profile = {}) {
  const problems = [];
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const onlyKeys = (value, allowed, at) => {
    for (const key of Object.keys(value)) if (!allowed.includes(key)) problems.push(`${at}.${key} is not a known key`);
  };
  const adr = (value, at) => {
    if (!ADR_ID.test(String(value ?? ''))) problems.push(`${at}.adr must name the approving ADR, e.g. "ADR-004"`);
  };
  const optionalInt = (value, min, max, at) => {
    if (value !== undefined && (!Number.isInteger(value) || value < min || value > max)) {
      problems.push(`${at} must be an integer from ${min} to ${max}`);
    }
  };

  const regions = profile.randomizedRegions;
  if (regions !== undefined) {
    if (!Array.isArray(regions) || regions.length > MAX_RANDOMIZED_REGIONS) {
      problems.push(`randomizedRegions must be a list of at most ${MAX_RANDOMIZED_REGIONS} entries`);
    } else {
      regions.forEach((region, i) => {
        const at = `randomizedRegions[${i}]`;
        if (!isObject(region)) { problems.push(`${at} must be an object`); return; }
        onlyKeys(region, ['selector', 'adr', 'placeholderHeight', 'minLinks', 'minImages'], at);
        if (!parseRegionSelector(region.selector)) {
          problems.push(`${at}.selector must be ".class" or "tag.class" on an element with a required end tag`);
        }
        adr(region.adr, at);
        optionalInt(region.placeholderHeight, 1, 4000, `${at}.placeholderHeight`);
        optionalInt(region.minLinks, 0, 1000, `${at}.minLinks`);
        optionalInt(region.minImages, 0, 1000, `${at}.minImages`);
      });
    }
  }

  const media = profile.media;
  if (media !== undefined) {
    if (!isObject(media)) {
      problems.push('media must be an object');
    } else {
      onlyKeys(media, ['gifFirstFrame', 'svgBlendNeutralize'], 'media');
      const gif = media.gifFirstFrame;
      if (gif !== undefined) {
        if (!isObject(gif)) problems.push('media.gifFirstFrame must be an object');
        else {
          onlyKeys(gif, ['adr', 'command'], 'media.gifFirstFrame');
          adr(gif.adr, 'media.gifFirstFrame');
          if (gif.command !== undefined && !['magick', 'convert'].includes(gif.command)) {
            problems.push('media.gifFirstFrame.command must be "magick" or "convert"');
          }
        }
      }
      const svg = media.svgBlendNeutralize;
      if (svg !== undefined) {
        if (!isObject(svg)) problems.push('media.svgBlendNeutralize must be an object');
        else {
          onlyKeys(svg, ['adr', 'modes'], 'media.svgBlendNeutralize');
          adr(svg.adr, 'media.svgBlendNeutralize');
          if (svg.modes !== undefined && (!Array.isArray(svg.modes) || !svg.modes.length
            || svg.modes.some((mode) => !BLEND_MODES.includes(mode)) || new Set(svg.modes).size !== svg.modes.length)) {
            problems.push('media.svgBlendNeutralize.modes must be a non-empty list of distinct CSS blend modes');
          }
        }
      }
    }
  }

  if (problems.length) throw new HarnessError(`Invalid stabilization profile: ${problems.join('; ')}`);
  return profile;
}

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
  // Carousels advance on setInterval or chained setTimeout calls far more often than on
  // rAF, so cancelling frames alone leaves the most common rotating element moving.
  const setIntervalOrig = globalThis.setInterval;
  const setTimeoutOrig = globalThis.setTimeout;
  globalThis.__t3uTimers = new Set();
  globalThis.__t3uTimeouts = new Set();
  globalThis.setInterval = (...a) => { const id = setIntervalOrig(...a); globalThis.__t3uTimers.add(id); return id; };
  globalThis.setTimeout = (...a) => { const id = setTimeoutOrig(...a); globalThis.__t3uTimeouts.add(id); return id; };

  globalThis.__t3uFreeze = () => {
    for (const id of globalThis.__t3uFrames) { try { cancelAnimationFrame(id); } catch {} }
    globalThis.__t3uFrames.clear();
    for (const id of globalThis.__t3uTimers) { try { clearInterval(id); } catch {} }
    globalThis.__t3uTimers.clear();
    for (const id of globalThis.__t3uTimeouts) { try { clearTimeout(id); } catch {} }
    globalThis.__t3uTimeouts.clear();
    // Seeking a video that is already at zero restarts Chromium's native loading spinner.
    // The asynchronous spinner paint then differs by a few pixels between identical runs.
    // settleScript owns the bounded seek/readiness wait; freeze only stops playback.
    for (const v of document.querySelectorAll('video')) { try { v.pause(); } catch {} }
  };
})();`;
}

/** Runs in the page immediately before the screenshot. Returns a small settle report. */
export function settleScript(profile = {}) {
  const consentSelectors = JSON.stringify(profile.consent?.fallbackSelectors ?? []);
  const scrollLockClasses = JSON.stringify(profile.consent?.scrollLockClasses ?? []);
  // Validated selectors and ADR ids only: safe to embed in the page source.
  const randomizedRegions = JSON.stringify((profile.randomizedRegions ?? []).map((region) => ({
    selector: region.selector,
    adr: region.adr,
    placeholderHeight: region.placeholderHeight ?? null,
    minLinks: region.minLinks ?? 0,
    minImages: region.minImages ?? 0,
  })));
  return `(async () => {
  const report = {
    fonts: false, lazy: 0, lazyPromoted: 0, videos: 0, height: 0,
    decoded: 0, decodeSkipped: 0, decodeFailed: 0, decodeTimedOut: 0,
  };

  try { await document.fonts.ready; } catch {}
  try {
    const faces = [...document.fonts].map((f) => f.load().catch(() => {}));
    await Promise.all(faces);
    report.fonts = true;
  } catch {}

  // Force lazy content in by promoting lazy images and stepping to the bottom, then return
  // to the top. Some browsers do not schedule a lazy image during a fast synthetic scroll;
  // promotion makes the intended coverage explicit and leaves fewer unresolved decodes.
  const lazyImgs = [...document.querySelectorAll('img[loading="lazy"]')];
  for (const img of lazyImgs) img.loading = 'eager';
  report.lazyPromoted = lazyImgs.length;

  const step = Math.max(200, Math.floor(window.innerHeight * 0.8));
  const maxScrollSteps = 250;
  let scrollSteps = 0;
  for (let y = 0; y < document.body.scrollHeight && scrollSteps < maxScrollSteps; y += step) {
    window.scrollTo(0, y);
    await new Promise((r) => setTimeout(r, 30));
    scrollSteps += 1;
  }
  report.scrollSteps = scrollSteps;
  report.scrollCapped = scrollSteps === maxScrollSteps;
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
  // decode() is permitted to remain pending while an image is incomplete. Awaiting those
  // promises without a deadline hangs the entire capture when lazy images have a currentSrc
  // but never reach complete. Decode only complete images
  // and bound every remaining promise so one corrupt resource cannot stop the run.
  const decodeTimeoutMs = 3000;
  await Promise.all(imgs.map(async (img) => {
    if (!img.complete || typeof img.decode !== 'function') {
      report.decodeSkipped += 1;
      return;
    }
    const outcome = await Promise.race([
      img.decode().then(() => 'decoded').catch(() => 'failed'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), decodeTimeoutMs)),
    ]);
    if (outcome === 'decoded') report.decoded += 1;
    else if (outcome === 'timeout') report.decodeTimedOut += 1;
    else report.decodeFailed += 1;
  }));

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
  const CONSENT = ${consentSelectors};
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
    const scrollLocks = ${scrollLockClasses};
    document.documentElement.classList.remove(...scrollLocks);
    document.body.classList.remove(...scrollLocks);
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
        try {
          // Consent overlays commonly lock scrolling while Owl first measures the page.
          // Refresh after removing those locks so responsive item widths are recalculated
          // from the final viewport, then pin the refreshed carousel to its first item.
          jq(this).trigger('refresh.owl.carousel');
          jq(this).trigger('stop.owl.autoplay');
          jq(this).trigger('to.owl.carousel', [0, 0, true]);
          report.carousels.pinned += 1;
          note('owl');
        } catch {}
      });
    }
  } catch {}

  // Server-randomized regions (sealed profile, one ADR per entry).
  //
  // PHP shuffle(), SQL RAND() and editorial rotation choose content before the HTML reaches
  // the browser, so the seeded Math.random cannot make them repeatable. Assert every selected
  // item first - link target, accessible name, image URL, alt text and load status - then
  // replace only the region's contents with a marker of stable height. The entry states that
  // structure and resource integrity were proven while the exact selection and order were not.
  report.randomizedRegions = [];
  const REGIONS = ${randomizedRegions};
  const textOf = (el) => (el && el.textContent ? el.textContent.trim() : '');
  for (const cfg of REGIONS) {
    let found = [];
    try { found = [...document.querySelectorAll(cfg.selector)]; } catch {}
    // Only the outermost match is a region; a nested match is part of it.
    const regions = found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
    for (const [index, region] of regions.entries()) {
      const rect = region.getBoundingClientRect();
      const links = [...region.querySelectorAll('a')];
      const images = [...region.querySelectorAll('img')];
      const problems = {};
      const fail = (reason) => { problems[reason] = (problems[reason] || 0) + 1; };
      for (const link of links) {
        if (!(link.getAttribute('href') || '').trim()) fail('link-without-href');
        const labelledBy = (link.getAttribute('aria-labelledby') || '').split(' ').filter(Boolean)
          .map((id) => textOf(document.getElementById(id))).join('');
        const name = (link.getAttribute('aria-label') || '').trim() || labelledBy || textOf(link)
          || (link.getAttribute('title') || '').trim()
          || [...link.querySelectorAll('img[alt]')].map((img) => img.getAttribute('alt').trim()).join('');
        if (!name) fail('link-without-accessible-name');
      }
      for (const img of images) {
        if (!img.hasAttribute('alt')) fail('image-without-alt');
        if (!(img.currentSrc || img.getAttribute('src') || '').trim()) { fail('image-without-url'); continue; }
        const loaded = img.complete && typeof img.decode === 'function'
          ? await Promise.race([
            img.decode().then(() => true, () => false),
            new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
          ])
          : false;
        if (!loaded) fail('image-not-loaded');
      }
      if (!region.children.length && !textOf(region)) fail('empty-region');
      if (links.length < cfg.minLinks) fail('fewer-links-than-expected');
      if (images.length < cfg.minImages) fail('fewer-images-than-expected');
      const height = cfg.placeholderHeight === null ? Math.round(rect.height) : cfg.placeholderHeight;
      report.randomizedRegions.push({
        selector: cfg.selector, adr: cfg.adr, index,
        links: links.length, images: images.length,
        measured: { width: Math.round(rect.width), height: Math.round(rect.height) },
        placeholderHeight: height,
        valid: Object.keys(problems).length === 0,
        problems,
        coverage: 'structure and resource integrity proven; exact selection and order not compared',
      });
      const marker = document.createElement('div');
      marker.setAttribute('data-t3u-randomized-region', cfg.selector);
      marker.style.cssText = 'display:block;width:100%;height:' + height + 'px';
      region.replaceChildren(marker);
      for (const prop of ['height', 'min-height', 'max-height']) region.style.setProperty(prop, height + 'px', 'important');
      region.style.setProperty('overflow', 'hidden', 'important');
    }
  }

  // Allow carousel refresh/layout writes to reach a paint boundary before freezing their
  // timers and recording the document height.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  // Native video controls render in Chromium's user-agent shadow DOM, outside the CSS
  // animation freeze above. An unconditional currentTime=0 starts a redundant seek even
  // when the video is already at zero, and taking the screenshot while that seek/loading
  // spinner is active produces non-reproducible control pixels. Pause every video, seek
  // only when necessary, and wait within a fixed bound for a paintable, non-loading state.
  report.videoReady = 0;
  report.videoTimedOut = 0;
  report.videoControlsHidden = 0;
  report.videoStates = [];
  const mediaTimeoutMs = 5000;
  await Promise.all([...document.querySelectorAll('video')].map(async (video) => {
    report.videos += 1;
    try {
      video.pause();
      if (Math.abs(video.currentTime) > 0.001) {
        video.currentTime = 0;
        await Promise.race([
          new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true })),
          new Promise((resolve) => setTimeout(resolve, mediaTimeoutMs)),
        ]);
      }

      const ready = await Promise.race([
        new Promise((resolve) => {
          const startedAt = performance.now();
          const check = () => {
            const paintable = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA;
            const loading = video.networkState === HTMLMediaElement.NETWORK_LOADING;
            if (paintable && !loading) resolve(true);
            else if (performance.now() - startedAt >= mediaTimeoutMs) resolve(false);
            else setTimeout(check, 50);
          };
          check();
        }),
        new Promise((resolve) => setTimeout(() => resolve(false), mediaTimeoutMs + 100)),
      ]);
      if (ready) report.videoReady += 1;
      else report.videoTimedOut += 1;
      report.videoStates.push({
        currentTime: video.currentTime,
        networkState: video.networkState,
        paused: video.paused,
        readyState: video.readyState,
      });
      if (video.controls) {
        video.controls = false;
        report.videoControlsHidden += 1;
      }
    } catch {
      report.videoTimedOut += 1;
    }
  }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (globalThis.__t3uFreeze) globalThis.__t3uFreeze();

  report.height = document.documentElement.scrollHeight;
  return report;
})();`;
}

export function profileHash(profile) {
  return `sha256:${sha256(JSON.stringify({
    css: STABILIZE_CSS,
    init: initScript(profile),
    settle: settleScript(profile),
    profile: sortKeys(profile),
  }))}`;
}

/**
 * Consent must be SEEDED, never clicked. Clicking a banner is timing-dependent and is
 * itself a flake source — the one we would be trying to remove.
 */
export function consentStateFor(config = {}) {
  const origin = config.origin ? new URL(config.origin) : null;
  const cookies = Object.entries(config.cookies ?? {}).map(([name, value]) => ({
    name,
    value: String(value),
    domain: origin?.hostname,
    path: '/',
    secure: origin?.protocol === 'https:',
    sameSite: 'Lax',
  }));
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
