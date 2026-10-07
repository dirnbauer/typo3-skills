#!/usr/bin/env node
/**
 * Processed images: local vs live colour check.
 *
 * A DDEV clone renders processed images (`csm_*` derivatives) with its own GFX processor and
 * colourspace. When those differ from production, every derivative changes colour. The measured
 * case: GraphicsMagick live, ImageMagick in the DDEV override, and TYPO3 12.4's default
 * `processor_colorspace` `RGB`, which ImageMagick 6.7.7+ reads as linear RGB: the local icons were
 * 28-44 % darker. An upgrade proof cannot see this, because Baseline A is captured locally and before
 * and after are equally dark. Only live against local shows it.
 *
 * This fetches the same page from live and from the local clone (read-only GETs, no cookies, every
 * URL and redirect hop through the URL guard), extracts processed image URLs (`/_processed_/`
 * folders and `typo3temp/assets/images/`), pairs them by file name and compares the alpha-weighted
 * mean of each channel as a browser displays it. Pairing tries the exact name first (same checksum:
 * same processing instruction), then the base name without the `csm_`/`preview_` prefix and the
 * 10-character checksum, which differs when the file record's modification time or the processing
 * configuration differs. The checksum never includes the processor, so a stale derivative keeps its
 * name after the processor changes.
 *
 * A pair fails when the lightness of its mean colour (CIE L*, 0-100) moves by more than the
 * threshold (default 5 %: 5 L* units) or the colour by a CIE76 delta E above 5. Relative changes of
 * channel means would flag a one-level encoder difference on a dark icon; the relative luma change
 * is reported for reading. On the measured site the reproduced darkening moved L* by 11-24 units;
 * after the fix, live and local GraphicsMagick renders differed by 0.8 L* (delta E 1.6) at most.
 *
 * Alpha-weighted, because transparent pixels are not seen and the two processors store different
 * colours under alpha 0. ImageMagick's `%[fx:mean.g]` also reads 0 on a Gray image, so a plain
 * `identify` comparison of a Gray local file with an sRGB live file reports a false 100 % drop.
 * As displayed, because a browser applies a PNG's gAMA chunk: GraphicsMagick tags some derivatives
 * gAMA 1.0, and Chromium shows a stored 100 grey with that tag as 168. An sRGB or iCCP chunk takes
 * precedence over gAMA; an ICC profile is reported, not applied.
 *
 * PNG is decoded with pngjs. JPEG, WebP, GIF and AVIF are converted to PNG by the host's
 * ImageMagick (`magick`, IM6 `convert`) or GraphicsMagick (`gm`); without one, those pairs are
 * reported as unmeasured.
 *
 * Usage:
 *   node gfx-colour-parity.mjs --live https://www.example.org/page/ --local https://example.ddev.site/page/ \
 *     [--live … --local …] [--threshold 5%] [--max-pairs 50] [--allow-origin https://cdn.example.org] \
 *     [--report gfx-colour-parity.json] [--json]
 *
 * Exit: 0 every measured pair within the threshold · 1 a pair is darker, brighter, colour-shifted or
 *       differs in transparency beyond it · 2 bad input or harness error · 3 nothing comparable
 *       (no processed-image pair measured) · 5 a URL guard refused (origin, redirect, size)
 */

import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import { isMain } from './lib/cli/is-main.mjs';
import { EXIT, HarnessError } from './lib/cli/exit-codes.mjs';
import { UrlGuard, assertPlausibleBaseUrl } from './lib/net/url-guard.mjs';
import { safeFetch } from './lib/net/safe-fetch.mjs';

export const DEFAULTS = Object.freeze({
  // 5 % of the CIE L* lightness scale (5 units), and a CIE76 delta E of 5 for colour.
  threshold: 0.05,
  maxPairs: 50,
  maxImageBytes: 25 * 1024 * 1024,
  concurrency: 4,
});

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif|bmp|tiff?)$/i;
const PROCESSED_PATH = /\/_processed_\/|typo3temp\/assets\/images\//i;
const HEADERS = Object.freeze({ 'user-agent': 'typo3-upgrade-run gfx-colour-parity' });
// The same Accept header on both sides: a server that negotiates WebP/AVIF must answer both alike.
const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';
const IDENTITY = Float64Array.from({ length: 256 }, (_, v) => v);
const SRGB_FILE_GAMMA = 1 / 2.2;

/* ------------------------------------------------------------------ extraction and pairing */

/** Processed image URLs in document order, from any attribute, srcset, inline style or JSON. */
export function extractProcessedImageUrls(html, pageUrl) {
  const text = String(html)
    .replace(/\\\//g, '/')
    .replace(/&(?:amp|#0*38|#x0*26);/gi, '&')
    .replace(/&(?:quot|#0*34|#x0*22);/gi, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/gi, "'");
  const seen = new Set();
  const urls = [];
  for (const token of text.split(/[\s"'<>()\\,`]+/)) {
    if (!PROCESSED_PATH.test(token)) continue;
    const absolute = token.search(/(?:https?:)?\/\//i);
    const candidate = (absolute >= 0 ? token.slice(absolute) : token.replace(/^[\w:.-]*=/, '')).replace(/;+$/, '');
    let url;
    try { url = new URL(candidate, pageUrl); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || !IMAGE_PATH.test(url.pathname)) continue;
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    urls.push(url.href);
  }
  return urls;
}

/** File name, extension and the pairing stem: no `csm_`/`preview_` prefix, no checksum. */
export function processedName(href) {
  let name = new URL(href).pathname.split('/').pop() ?? '';
  try { name = decodeURIComponent(name); } catch { /* keep the encoded name */ }
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  const base = dot > 0 ? name.slice(0, dot) : name;
  const stem = base.replace(/^(?:csm|preview)_/i, '').replace(/_[0-9a-f]{10}$/i, '');
  return { name, ext, stem: stem || base };
}

/** Pair live and local URLs: exact name, then same stem and format, then same stem in order. */
export function pairImages(liveUrls, localUrls) {
  const group = (urls) => {
    const groups = new Map();
    urls.forEach((href, order) => {
      const entry = { href, order, ...processedName(href) };
      const key = entry.stem.toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    return groups;
  };
  const local = group(localUrls);
  const pairs = [];
  const unpairedLive = [];
  for (const [key, lives] of group(liveUrls)) {
    const candidates = local.get(key) ?? [];
    const take = (live, test, match) => {
      const index = candidates.findIndex(test);
      if (index < 0) return false;
      pairs.push({ live, local: candidates.splice(index, 1)[0], match });
      return true;
    };
    const noName = lives.filter((live) => !take(live, (c) => c.name === live.name, 'name'));
    const noFormat = noName.filter((live) => !take(live, (c) => c.ext === live.ext, 'stem'));
    for (const live of noFormat) {
      if (!take(live, () => true, 'stem, other format')) unpairedLive.push(live.href);
    }
  }
  // Whatever stayed in the local groups found no live partner.
  const unpairedLocal = [...local.values()].flat().sort((a, b) => a.order - b.order).map((e) => e.href);
  pairs.sort((a, b) => a.live.order - b.live.order);
  return { pairs, unpairedLive, unpairedLocal };
}

/* ------------------------------------------------------------------ measurement */

/**
 * Alpha-weighted channel means (0-255), visible coverage (0-1) and Rec. 709 luma of RGBA pixels.
 * `transfer` maps a stored 8-bit value to the value a browser displays (see displayTransfer).
 */
export function measurePixels({ width, height, data }, transfer = null) {
  const t = transfer ?? IDENTITY;
  let weight = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (!a) continue;
    weight += a;
    r += t[data[i]] * a;
    g += t[data[i + 1]] * a;
    b += t[data[i + 2]] * a;
  }
  const pixels = width * height;
  const coverage = pixels ? weight / (255 * pixels) : 0;
  if (!weight) return { width, height, coverage: 0, mean: null, luma: null };
  const mean = { r: r / weight, g: g / weight, b: b / weight };
  return { width, height, coverage, mean, luma: 0.2126 * mean.r + 0.7152 * mean.g + 0.0722 * mean.b };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Container format from the leading bytes; the URL extension can lie after content negotiation. */
export function sniffFormat(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  const ascii = buffer.subarray(0, 16).toString('latin1');
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'webp';
  if (ascii.slice(4, 8) === 'ftyp' && /^avi[fs]$/.test(ascii.slice(8, 12))) return 'avif';
  if (ascii.startsWith('BM')) return 'bmp';
  if (ascii.startsWith('II*\u0000') || ascii.startsWith('MM\u0000*')) return 'tiff';
  return null;
}

/** The colour chunks a browser reads, straight from the byte stream: they precede the image data. */
export function pngColourTags(buffer) {
  const tags = { srgb: false, iccp: false, gamma: null };
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    if (type === 'IDAT' || type === 'IEND') break;
    if (type === 'sRGB') tags.srgb = true;
    if (type === 'iCCP') tags.iccp = true;
    if (type === 'gAMA' && length === 4 && offset + 12 <= buffer.length) tags.gamma = buffer.readUInt32BE(offset + 8) / 100000;
    offset += 12 + length;
  }
  return tags;
}

/**
 * Stored value → displayed value for a PNG whose gAMA is not sRGB's 1/2.2 and that has no sRGB or
 * iCCP chunk (those take precedence). The browser decodes the sample to linear light with the file
 * gamma and encodes it as sRGB: in Chromium a flat 100 grey tagged gAMA 1.0 displays as 168.
 * GraphicsMagick writes gAMA 1.0 on some derivatives, so equal stored values can look different.
 */
export function displayTransfer(tags) {
  if (tags.srgb || tags.iccp || !tags.gamma || Math.abs(tags.gamma - SRGB_FILE_GAMMA) <= 0.01) return null;
  return Float64Array.from({ length: 256 }, (_, v) => {
    const linear = (v / 255) ** (1 / tags.gamma);
    const encoded = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, encoded)) * 255;
  });
}

/** Decode a PNG and measure it as displayed; the colourspace label comes from its header. */
export function decodePng(buffer) {
  const png = PNG.sync.read(buffer);
  const tags = pngColourTags(buffer);
  const transfer = displayTransfer(tags);
  const gray = png.colorType === 0 || png.colorType === 4;
  let colourspace = gray ? 'Gray' : 'sRGB';
  if (transfer) colourspace += ` gAMA ${tags.gamma.toFixed(2)}`;
  if (tags.iccp && !tags.srgb) colourspace += ' ICC (not applied)';
  const measured = measurePixels(png, transfer);
  return transfer ? { colourspace, ...measured, stored: measurePixels(png).mean } : { colourspace, ...measured };
}

function runBinary(cmd, args, input, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, timeout: timeoutMs },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = String(stderr ?? '').slice(0, 400);
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    child.stdin.on('error', () => { /* the binary exited early; execFile reports why */ });
    child.stdin.end(input);
  });
}

const CLI_CANDIDATES = [
  { name: 'magick', cmd: 'magick', probe: ['-version'], args: (fmt) => [`${fmt}:-[0]`, '-depth', '8', 'png:-'] },
  { name: 'gm', cmd: 'gm', probe: ['version'], args: (fmt) => ['convert', `${fmt}:-[0]`, '-depth', '8', 'png:-'] },
  { name: 'convert', cmd: 'convert', probe: ['-version'], args: (fmt) => [`${fmt}:-[0]`, '-depth', '8', 'png:-'] },
];

/** The host's ImageMagick or GraphicsMagick, or null. Only used to turn non-PNG files into PNG. */
export async function findImageCli({ run = runBinary } = {}) {
  for (const candidate of CLI_CANDIDATES) {
    try {
      const out = String(await run(candidate.cmd, candidate.probe, Buffer.alloc(0), { timeoutMs: 10_000 }));
      // `convert` on Windows is a disk tool: accept only a real ImageMagick/GraphicsMagick answer.
      if (/ImageMagick|GraphicsMagick/.test(out)) {
        return { name: candidate.name, version: out.split('\n')[0].trim(), toPng: (fmt, input) => run(candidate.cmd, candidate.args(fmt), input) };
      }
    } catch { /* not installed */ }
  }
  return null;
}

/** Measure one downloaded image. Non-PNG input needs `cli`; without it the result says why. */
export async function measureImage(buffer, { cli = null } = {}) {
  const format = sniffFormat(buffer);
  if (!format) return { format: null, error: 'not a recognised image format' };
  if (format === 'png') {
    try { return { format, ...decodePng(buffer) }; } catch (error) { return { format, error: `unreadable PNG: ${error.message}` }; }
  }
  if (!cli) return { format, error: `no ImageMagick/GraphicsMagick CLI on this host to decode ${format}` };
  try {
    const converted = await cli.toPng(format, buffer);
    return { format, ...decodePng(converted) };
  } catch (error) {
    return { format, error: `${cli.name} could not decode it: ${error.stderr || error.message}`.trim() };
  }
}

/** CIE L*a*b* (D65) of an sRGB-encoded colour with 0-255 channels. */
export function toLab({ r, g, b }) {
  const linear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [linear(r), linear(g), linear(b)];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return { L: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
}

/**
 * The verdict for one pair. The gate is perceptual: the lightness (CIE L*, 0-100) of the mean
 * colour moves by more than threshold x 100, or the colour by a CIE76 delta E above it. A relative
 * change of the mean would flag a one-level encoder difference on a dark icon; the relative luma
 * change is still reported, because "39 % darker" is how people read it.
 */
export function compareMeasurements(live, local, { threshold = DEFAULTS.threshold } = {}) {
  const coverage = local.coverage - live.coverage;
  if (!live.mean || !local.mean) {
    const verdict = live.mean || local.mean ? 'transparency' : 'match';
    return { verdict, lightness: null, deltaE: null, luma: null, coverage };
  }
  const before = toLab(live.mean);
  const after = toLab(local.mean);
  const lightness = after.L - before.L;
  const deltaE = Math.hypot(lightness, after.a - before.a, after.b - before.b);
  const luma = (local.luma - live.luma) / Math.max(live.luma, 1);
  const limit = threshold * 100;
  let verdict = 'match';
  if (Math.abs(lightness) > limit) verdict = lightness < 0 ? 'darker' : 'brighter';
  else if (deltaE > limit) verdict = 'colour-shift';
  else if (Math.abs(coverage) > threshold) verdict = 'transparency';
  return { verdict, lightness, deltaE, luma, coverage };
}

/* ------------------------------------------------------------------ the check */

async function fetchPage(guard, url, fetchImpl) {
  const res = await safeFetch(guard, url, {
    purpose: 'gfx-colour-parity page', accept: 'html', headers: { ...HEADERS, accept: 'text/html' }, fetchImpl,
  });
  if (res.status !== 200) throw new HarnessError(`${url} answered HTTP ${res.status}; pass a page that renders.`);
  return res;
}

async function fetchImage(guard, url, fetchImpl, maxBytes) {
  try {
    const res = await safeFetch(guard, url, {
      purpose: 'gfx-colour-parity image', binary: true, maxBytes, headers: { ...HEADERS, accept: IMAGE_ACCEPT }, fetchImpl,
    });
    if (res.status !== 200) return { error: `HTTP ${res.status}` };
    return { buffer: res.buffer };
  } catch (error) {
    if (error.exitCode === EXIT.BLOCKED_BY_POLICY) throw error;
    return { error: String(error.message ?? error) };
  }
}

async function inBatches(items, size, worker) {
  const results = [];
  for (let i = 0; i < items.length; i += size) {
    results.push(...await Promise.all(items.slice(i, i + size).map(worker)));
  }
  return results;
}

const round = (value, digits = 1) => (value === null || value === undefined ? null : Number(value.toFixed(digits)));
const describe = (url, measured) => ({
  url,
  format: measured.format ?? null,
  colourspace: measured.colourspace ?? null,
  width: measured.width ?? null,
  height: measured.height ?? null,
  coverage: round(measured.coverage, 3),
  mean: measured.mean ? { r: round(measured.mean.r), g: round(measured.mean.g), b: round(measured.mean.b) } : null,
  luma: round(measured.luma),
  // Only for a PNG whose gAMA changes the display: the means as stored in the file.
  ...(measured.stored ? { stored: { r: round(measured.stored.r), g: round(measured.stored.g), b: round(measured.stored.b) } } : {}),
});

/**
 * Compare the processed images of each live/local page pair.
 * @param {{ pages: {live: string, local: string}[], threshold?: number, maxPairs?: number,
 *           allowOrigins?: string[], fetchImpl?: Function, resolver?: Function, cli?: object|null }} options
 */
export async function checkColourParity({
  pages, threshold = DEFAULTS.threshold, maxPairs = DEFAULTS.maxPairs, allowOrigins = [],
  fetchImpl = globalThis.fetch, resolver, cli,
}) {
  if (!pages?.length) throw new HarnessError('Pass at least one --live/--local page pair.');
  for (const { live, local } of pages) {
    await assertPlausibleBaseUrl(live, { resolver });
    await assertPlausibleBaseUrl(local, { resolver });
  }
  const origins = [...new Set([...pages.flatMap(({ live, local }) => [new URL(live).origin, new URL(local).origin]), ...allowOrigins])];
  const guard = await UrlGuard.create({ allowedOrigins: origins, resolver });
  const decoder = cli === undefined ? await findImageCli() : cli;

  const results = [];
  const unmeasured = [];
  const skipped = [];
  const unpaired = { live: [], local: [] };
  let budget = maxPairs;
  let truncated = 0;

  for (const page of pages) {
    const [livePage, localPage] = await Promise.all([fetchPage(guard, page.live, fetchImpl), fetchPage(guard, page.local, fetchImpl)]);
    const allowed = (urls) => urls.filter((href) => {
      if (guard.isAllowedOrigin(new URL(href).origin)) return true;
      skipped.push({ url: href, reason: 'origin not allowed; add it with --allow-origin' });
      return false;
    });
    const { pairs, unpairedLive, unpairedLocal } = pairImages(
      allowed(extractProcessedImageUrls(livePage.body, livePage.url)),
      allowed(extractProcessedImageUrls(localPage.body, localPage.url)),
    );
    unpaired.live.push(...unpairedLive);
    unpaired.local.push(...unpairedLocal);
    const selected = pairs.slice(0, Math.max(budget, 0));
    truncated += pairs.length - selected.length;
    budget -= selected.length;

    const measured = await inBatches(selected, DEFAULTS.concurrency, async (pair) => {
      const [liveFile, localFile] = await Promise.all([
        fetchImage(guard, pair.live.href, fetchImpl, DEFAULTS.maxImageBytes),
        fetchImage(guard, pair.local.href, fetchImpl, DEFAULTS.maxImageBytes),
      ]);
      const liveM = liveFile.buffer ? await measureImage(liveFile.buffer, { cli: decoder }) : { error: liveFile.error };
      const localM = localFile.buffer ? await measureImage(localFile.buffer, { cli: decoder }) : { error: localFile.error };
      return { pair, liveM, localM };
    });

    for (const { pair, liveM, localM } of measured) {
      const name = pair.live.name === pair.local.name ? pair.live.name : `${pair.live.name} ↔ ${pair.local.name}`;
      if (liveM.error || localM.error) {
        unmeasured.push({ name, live: pair.live.href, local: pair.local.href, reason: [liveM.error && `live: ${liveM.error}`, localM.error && `local: ${localM.error}`].filter(Boolean).join('; ') });
        continue;
      }
      const delta = compareMeasurements(liveM, localM, { threshold });
      const notes = [];
      if (liveM.width !== localM.width || liveM.height !== localM.height) {
        notes.push(`dimensions differ: ${liveM.width}x${liveM.height} live, ${localM.width}x${localM.height} local`);
      }
      if (liveM.colourspace !== localM.colourspace) notes.push(`colourspace ${liveM.colourspace} live, ${localM.colourspace} local`);
      results.push({
        name,
        match: pair.match,
        verdict: delta.verdict,
        delta: {
          lightness: round(delta.lightness, 2),
          deltaE: round(delta.deltaE, 2),
          luma: round(delta.luma, 4),
          coverage: round(delta.coverage, 4),
        },
        live: describe(pair.live.href, liveM),
        local: describe(pair.local.href, localM),
        notes,
      });
    }
  }

  const findings = results.filter((r) => r.verdict !== 'match');
  const verdict = findings.length ? 'findings' : results.length ? 'pass' : 'not-comparable';
  return {
    schema: 'typo3-upgrade-run/gfx-colour-parity@1',
    pages,
    threshold,
    decoder: decoder ? decoder.version : null,
    counts: {
      measured: results.length,
      findings: findings.length,
      unmeasured: unmeasured.length,
      unpairedLive: unpaired.live.length,
      unpairedLocal: unpaired.local.length,
      skipped: skipped.length,
      truncated,
    },
    pairs: results,
    unmeasured,
    unpaired,
    skipped,
    verdict,
  };
}

export function exitCodeFor(report) {
  if (report.verdict === 'findings') return EXIT.FINDINGS;
  if (report.verdict === 'pass') return EXIT.PASS;
  return EXIT.INVALID;
}

/* ------------------------------------------------------------------ CLI */

const signed = (value, digits, unit = '') => (value === null || value === undefined
  ? 'n/a' : `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}${unit}`);
const rgb = (side) => (side.mean ? `${Math.round(side.mean.r)} ${Math.round(side.mean.g)} ${Math.round(side.mean.b)} ${side.colourspace}` : `transparent ${side.colourspace}`);

export function formatReport(report) {
  const limit = (report.threshold * 100).toFixed(1);
  const lines = [`Processed images, live vs local — a pair fails beyond ${limit} L* or ΔE ${limit}`];
  for (const page of report.pages) lines.push(`  live  ${page.live}`, `  local ${page.local}`);
  lines.push('');
  for (const pair of report.pairs) {
    const mark = pair.verdict === 'match' ? '✓' : '✗';
    const d = pair.delta;
    const figures = `L* ${signed(d.lightness, 1).padStart(6)}  ΔE ${(d.deltaE ?? 0).toFixed(1).padStart(5)}  luma ${signed(d.luma === null ? null : d.luma * 100, 1, ' %').padStart(8)}`;
    lines.push(`  ${mark} ${pair.verdict.padEnd(12)} ${figures}  ${pair.name}`);
    lines.push(`      live ${rgb(pair.live)} · local ${rgb(pair.local)}${pair.notes.length ? ` · ${pair.notes.join('; ')}` : ''}`);
  }
  for (const item of report.unmeasured) lines.push(`  ? unmeasured   ${item.name}: ${item.reason}`);
  const c = report.counts;
  lines.push('', `${c.measured} pair(s) measured, ${c.findings} beyond it; ${c.unmeasured} unmeasured; unpaired ${c.unpairedLive} live / ${c.unpairedLocal} local${c.skipped ? `; ${c.skipped} on other origins skipped` : ''}${c.truncated ? `; ${c.truncated} over --max-pairs` : ''}.`);
  if (report.verdict === 'findings') {
    lines.push('✗ Local processed images differ from live. Give DDEV the processor and colourspace of live, regenerate the processed files, run this again.');
  } else if (report.verdict === 'pass') {
    lines.push('✓ Local processed images match live in colour.');
  } else {
    lines.push('? Nothing comparable: no processed image was paired and measured. Pick a page that shows processed images on both sides.');
  }
  return `${lines.join('\n')}\n`;
}

function parseThreshold(raw) {
  const text = String(raw).trim();
  const value = text.endsWith('%') ? Number(text.slice(0, -1)) / 100 : Number(text);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new HarnessError(`--threshold must be a fraction such as 0.05 or a percentage such as 5%, got: ${raw}`);
  }
  return value;
}

async function main(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        live: { type: 'string', multiple: true },
        local: { type: 'string', multiple: true },
        threshold: { type: 'string', default: String(DEFAULTS.threshold) },
        'max-pairs': { type: 'string', default: String(DEFAULTS.maxPairs) },
        'allow-origin': { type: 'string', multiple: true },
        report: { type: 'string' },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
      strict: true,
    }));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return EXIT.HARNESS_ERROR;
  }
  if (values.help) {
    process.stdout.write('node gfx-colour-parity.mjs --live <url> --local <url> [--live … --local …] [--threshold 5%] [--max-pairs 50] [--allow-origin <origin>] [--report <file>] [--json]\n');
    return EXIT.PASS;
  }
  const live = values.live ?? [];
  const local = values.local ?? [];
  if (!live.length || live.length !== local.length) {
    process.stderr.write('Pass --live and --local in pairs: the same page on production and on the local clone.\n');
    return EXIT.HARNESS_ERROR;
  }
  try {
    const maxPairs = Number.parseInt(values['max-pairs'], 10);
    if (!Number.isFinite(maxPairs) || maxPairs < 1) throw new HarnessError(`--max-pairs must be a positive integer, got: ${values['max-pairs']}`);
    const report = await checkColourParity({
      pages: live.map((url, i) => ({ live: url, local: local[i] })),
      threshold: parseThreshold(values.threshold),
      maxPairs,
      allowOrigins: values['allow-origin'] ?? [],
    });
    if (values.report) await writeFile(values.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
    return exitCodeFor(report);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return error.exitCode ?? EXIT.HARNESS_ERROR;
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
