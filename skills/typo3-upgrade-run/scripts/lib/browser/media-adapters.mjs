/**
 * Media route adapters — stable pixels, untouched source evidence.
 *
 * Two kinds of media survive every other stabilisation step:
 *
 *  - An animated GIF keeps animating inside Chromium's image decoder. CSS `animation: none`,
 *    frozen timers and cancelled frames do not reach it, so two passes photograph different
 *    frames of the same file.
 *  - An SVG blend layer (`mix-blend-mode`) can rasterise differently between fresh browser
 *    processes. `--disable-gpu` fixes the known cases; the blend adapter is the narrow
 *    fallback for bytes that still differ with software rendering.
 *
 * Both adapters are opt-in through the sealed stabilization profile and carry an ADR, because
 * they narrow what the pixel claim means. They apply identically to every capture and record
 * the ORIGINAL response per page (SHA-256 and byte length), so a changed source is still
 * caught even though the transformed pixels cannot show it. A response that does not match an
 * adapter's guard is never transformed: it is re-requested by the browser untouched and counted.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { PreconditionError } from '../cli/exit-codes.mjs';

/**
 * ImageMagick arguments for "frame 1 exactly as the browser shows it".
 *
 * The canvas is computed here, not left to ImageMagick. Chromium sizes a GIF as the union of
 * its logical screen and the first frame (a first frame may be offset, or overhang a screen
 * that is too small); ImageMagick's own flatten uses the declared screen, and `-coalesce`
 * fills uncovered pixels with the GIF background colour that browsers never paint. Either
 * would change the image's natural size or pixels, not just freeze it.
 *
 *  - `xc:none` of the browser's canvas size is transparent, as browsers start.
 *  - `gif:-[0] +repage` decodes only the first frame from stdin, without its page offset;
 *    `-geometry` then places it at that offset.
 *  - `-strip` drops tIME/tEXt date chunks and cHRM/bKGD colour chunks, so the bytes are
 *    identical on every conversion and nothing is colour-managed differently.
 */
export function gifFirstFrameArgs({ canvas, first }) {
  return [
    '-size', `${canvas.width}x${canvas.height}`, 'xc:none',
    '(', 'gif:-[0]', '+repage', ')',
    '-geometry', `+${first.left}+${first.top}`, '-composite',
    '-strip', 'png:-',
  ];
}

export const BLEND_MODES = Object.freeze([
  'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Frame count and first-frame geometry of a GIF, or null when the bytes are not a well-formed
 * GIF (the guard). `canvas` is the size Chromium renders: logical screen ∪ first frame.
 */
export function gifInfo(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (b.length < 13) return null;
  const signature = b.toString('latin1', 0, 6);
  if (signature !== 'GIF87a' && signature !== 'GIF89a') return null;
  const screen = { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  let first = null;
  let i = 13;
  if (b[10] & 0x80) i += 3 * 2 ** ((b[10] & 0x07) + 1);   // global colour table
  let frames = 0;
  const result = () => (frames && first ? {
    frames,
    first,
    canvas: {
      width: Math.max(screen.width, first.left + first.width),
      height: Math.max(screen.height, first.top + first.height),
    },
  } : null);
  const skipSubBlocks = () => {
    while (i < b.length) {
      const size = b[i];
      i += 1;
      if (size === 0) return true;
      i += size;
    }
    return false;
  };
  while (i < b.length) {
    const block = b[i];
    i += 1;
    if (block === 0x3b) return result();                     // trailer
    if (block === 0x21) {                                    // extension: label, sub-blocks
      i += 1;
      if (!skipSubBlocks()) return null;
      continue;
    }
    if (block !== 0x2c || i + 9 > b.length) return null;     // only image descriptors remain
    first ??= { left: b.readUInt16LE(i), top: b.readUInt16LE(i + 2), width: b.readUInt16LE(i + 4), height: b.readUInt16LE(i + 6) };
    const flags = b[i + 8];
    i += 9;
    if (flags & 0x80) i += 3 * 2 ** ((flags & 0x07) + 1);    // local colour table
    i += 1;                                                  // LZW minimum code size
    if (!skipSubBlocks()) return null;
    frames += 1;
  }
  return result();                                           // truncated before the trailer
}

/** Number of frames in a GIF, or null when the bytes are not a well-formed GIF. */
export function gifFrameCount(bytes) {
  return gifInfo(bytes)?.frames ?? null;
}

/** Locate ImageMagick. `magick` (v7) first, then the v6 `convert` that DDEV images ship. */
export function resolveImageMagick(command = null, run = spawnSync) {
  for (const candidate of command ? [command] : ['magick', 'convert']) {
    const probe = run(candidate, ['-version'], { encoding: 'utf8', timeout: 10_000 });
    const version = probe?.status === 0
      ? /Version: ImageMagick (\S+)/.exec(String(probe.stdout ?? ''))?.[1]
      : null;
    if (version) return { command: candidate, version };
  }
  return null;
}

/** Convert GIF bytes to a PNG of the first frame, byte-identical on every run. */
export function convertGifFirstFrame(input, { command = 'magick', timeoutMs = 20_000, info = gifInfo(input) } = {}) {
  return new Promise((resolve, reject) => {
    if (!info) { reject(new Error('not a well-formed GIF')); return; }
    const child = spawn(command, gifFirstFrameArgs(info), { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`GIF first-frame conversion exceeded ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    // ImageMagick may stop reading once frame 1 is decoded; writing the remaining frames then
    // raises EPIPE although the conversion succeeded. The exit code and PNG signature decide.
    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') { clearTimeout(timer); reject(error); }
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const png = Buffer.concat(stdout);
      if (code === 0 && png.subarray(0, 8).equals(PNG_SIGNATURE)) resolve(png);
      else reject(new Error(`GIF first-frame conversion exited ${code}: ${Buffer.concat(stderr).toString('utf8').slice(0, 200)}`));
    });
    child.stdin.end(input);
  });
}

/** Replace the configured blend modes with `normal`; everything else stays byte-identical. */
export function neutralizeSvgBlend(text, modes = ['multiply']) {
  const pattern = new RegExp(`mix-blend-mode\\s*:\\s*(?:${modes.join('|')})(?![\\w-])`, 'gi');
  let replaced = 0;
  const out = String(text).replace(pattern, () => { replaced += 1; return 'mix-blend-mode:normal'; });
  return { text: out, replaced };
}

/**
 * Build the adapter set for one route policy (one browser context).
 *
 * @param {object} config  stabilization.media — { gifFirstFrame?, svgBlendNeutralize? }
 * @param {object} options gifConverter and imageMagick are injectable for tests.
 */
export function createMediaAdapters(config = {}, { gifConverter = null, imageMagick = null } = {}) {
  const gif = config?.gifFirstFrame ?? null;
  const svg = config?.svgBlendNeutralize ?? null;
  const modes = svg?.modes?.length ? [...svg.modes] : ['multiply'];
  let tool = null;
  let converter = gifConverter;
  if (gif && !converter) {
    tool = imageMagick ?? resolveImageMagick(gif.command ?? null);
    if (!tool) {
      throw new PreconditionError('stabilization media.gifFirstFrame needs ImageMagick ("magick" or "convert") on PATH.');
    }
    converter = (bytes, info) => convertGifFirstFrame(bytes, { command: tool.command, info });
  }

  const counters = () => ({ requests: 0, transformed: 0, cacheHits: 0, passthrough: 0, failed: 0 });
  const stats = { gif: counters(), svg: counters() };
  const cache = new Map();          // url -> { passthrough } | { fulfil, evidence }
  const evidenceByKey = new Map();  // unique transformed resources across this policy
  const pages = new WeakMap();      // page -> { resources: Map, failures: [] }

  const kindOf = (rawUrl) => {
    let pathname;
    try { pathname = new URL(rawUrl).pathname.toLowerCase(); } catch { return null; }
    if (gif && pathname.endsWith('.gif')) return 'gif';
    if (svg && pathname.endsWith('.svg')) return 'svg';
    return null;
  };
  const pageRecord = (request) => {
    let page = null;
    try { page = request.frame()?.page() ?? null; } catch { page = null; }
    if (!page) return null;
    if (!pages.has(page)) pages.set(page, { resources: new Map(), failures: [] });
    return pages.get(page);
  };
  const note = (record, evidence) => {
    evidenceByKey.set(`${evidence.kind}:${evidence.resource}:${evidence.sourceSha256}`, evidence);
    record?.resources.set(`${evidence.kind}:${evidence.resource}:${evidence.sourceSha256}`, evidence);
  };

  return {
    enabled: Boolean(gif || svg),

    /**
     * Handle a request the policy has already allowed. Returns false when no adapter applies
     * (the caller continues the request); true when the route was completed here.
     */
    async handle(route) {
      const request = route.request();
      const url = request.url();
      const kind = kindOf(url);
      if (!kind) return false;
      const counter = stats[kind];
      counter.requests += 1;
      const record = pageRecord(request);
      const cached = cache.get(url);
      if (cached?.passthrough) {
        counter.passthrough += 1;
        await route.continue();
        return true;
      }
      if (cached) {
        counter.cacheHits += 1;
        note(record, cached.evidence);
        await route.fulfill(cached.fulfil);
        return true;
      }

      let resource;
      try { resource = new URL(url).pathname; } catch { resource = '(unparseable)'; }
      try {
        // Never follow a redirect from Node: the adapter must not reach further than the browser
        // would. A 3xx fails the guard below and is handed back to the browser untouched; the
        // context's egress proxy then refuses any hop outside the allow-list.
        const response = await route.fetch({ maxRedirects: 0 });
        const source = await response.body();
        const headers = { ...response.headers() };
        for (const name of ['content-length', 'content-encoding', 'transfer-encoding', 'etag']) delete headers[name];
        let transformed = null;
        if (response.status() === 200 && kind === 'gif') {
          const info = gifInfo(source);
          // A static GIF is already deterministic; only animated ones are replaced.
          if (info && info.frames > 1) {
            headers['content-type'] = 'image/png';
            transformed = {
              body: await converter(source, info),
              evidence: { kind: 'gif-first-frame', resource, frames: info.frames },
            };
          }
        }
        if (response.status() === 200 && kind === 'svg') {
          const text = source.toString('utf8');
          const neutral = /<svg[\s>]/i.test(text) ? neutralizeSvgBlend(text, modes) : { replaced: 0 };
          if (neutral.replaced > 0) {
            headers['content-type'] = 'image/svg+xml';
            transformed = {
              body: Buffer.from(neutral.text, 'utf8'),
              evidence: { kind: 'svg-blend-neutralized', resource, replacements: neutral.replaced },
            };
          }
        }
        if (!transformed) {
          cache.set(url, { passthrough: true });
          counter.passthrough += 1;
          await route.continue();
          return true;
        }
        const evidence = {
          ...transformed.evidence,
          sourceSha256: `sha256:${createHash('sha256').update(source).digest('hex')}`,
          sourceBytes: source.length,
        };
        const fulfil = { status: 200, headers, body: transformed.body };
        cache.set(url, { fulfil, evidence });
        counter.transformed += 1;
        note(record, evidence);
        await route.fulfill(fulfil);
        return true;
      } catch (error) {
        // Abort rather than show the untransformed original: a deterministic broken image
        // plus a recorded failure is honest, a moving one is not.
        counter.failed += 1;
        record?.failures.push({ kind, resource, error: String(error?.message ?? error).split('\n', 1)[0] });
        await route.abort('failed').catch(() => {});
        return true;
      }
    },

    /** Evidence for one page since the last call; clears it so reused pages start empty. */
    takePage(page) {
      const record = page ? pages.get(page) : null;
      if (page) pages.delete(page);
      return {
        resources: [...(record?.resources.values() ?? [])].sort(compareEvidence),
        failures: record?.failures ?? [],
      };
    },

    report() {
      const resources = [...evidenceByKey.values()].sort(compareEvidence);
      const gifResources = resources.filter((r) => r.kind === 'gif-first-frame');
      return {
        gifFirstFrame: gif ? {
          adr: gif.adr,
          tool,
          ...stats.gif,
          resources: gifResources.length,
          laterFramesUntested: gifResources.reduce((sum, r) => sum + Math.max(0, r.frames - 1), 0),
          coverage: 'frame 1 compared as pixels; later frames untested, original bytes compared by SHA-256',
        } : null,
        svgBlendNeutralize: svg ? {
          adr: svg.adr,
          modes,
          ...stats.svg,
          resources: resources.filter((r) => r.kind === 'svg-blend-neutralized').length,
          coverage: 'blend instruction neutralized for pixels; original SVG bytes compared by SHA-256',
        } : null,
        resources,
      };
    },
  };
}

/** Merge per-worker adapter reports into one capture-index entry; resources are unioned. */
export function mergeMediaReports(reports) {
  const present = reports.filter(Boolean);
  if (!present.length) return null;
  const resources = new Map();
  for (const report of present) {
    for (const r of report.resources ?? []) resources.set(`${r.kind}|${r.resource}|${r.sourceSha256}`, r);
  }
  const all = [...resources.values()].sort(compareEvidence);
  const sum = (section, key) => present.reduce((total, report) => total + (report[section]?.[key] ?? 0), 0);
  const merged = (section, kind) => {
    const first = present.find((report) => report[section])?.[section];
    if (!first) return null;
    const own = all.filter((r) => r.kind === kind);
    const counters = Object.fromEntries(['requests', 'transformed', 'cacheHits', 'passthrough', 'failed']
      .map((key) => [key, sum(section, key)]));
    return {
      ...first,
      ...counters,
      resources: own.length,
      ...(kind === 'gif-first-frame'
        ? { laterFramesUntested: own.reduce((total, r) => total + Math.max(0, r.frames - 1), 0) }
        : {}),
    };
  };
  return {
    gifFirstFrame: merged('gifFirstFrame', 'gif-first-frame'),
    svgBlendNeutralize: merged('svgBlendNeutralize', 'svg-blend-neutralized'),
    resources: all,
  };
}

/** Order-independent identity of a page's transformed sources, for pass/pass and before/after. */
export function mediaSourceFingerprint(resources = []) {
  return resources
    .map((r) => `${r.kind}|${r.sourceSha256}|${r.sourceBytes}`)
    .sort();
}

function compareEvidence(a, b) {
  return `${a.kind}|${a.resource}|${a.sourceSha256}`.localeCompare(`${b.kind}|${b.resource}|${b.sourceSha256}`);
}
