/**
 * Refuse to seal a baseline that was rendered by a frontend development server.
 *
 * A site whose Vite or webpack dev server was running while Baseline A was captured serves
 * `/@vite/client`, hot-reload runtimes and unbuilt sources instead of its production assets.
 * The double-shoot is green (the dev server answers the same way twice), so nothing else stops
 * the seal. Every later capture against built assets then differs on every page, and a sealed
 * baseline has no unseal: the run is lost. The captured DOM is the evidence, so the check reads
 * the baseline's own DOM snapshots right before sealing.
 *
 * Only what the browser executes or loads is inspected: script and link URLs and the bodies of
 * executable inline scripts. Body text, code samples and JSON-LD that merely MENTION a dev server
 * (a blog post about webpack-dev-server) are not markers.
 *
 * Run bookkeeping, not measurement: the guard decides whether a capture may be sealed and never
 * changes what a capture or comparison sees.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { PreconditionError } from '../cli/exit-codes.mjs';
import { redactUrl } from '../util/redact.mjs';

/** Path fragments only a development server serves or a hot-reload client requests. */
export const DEV_SERVER_PATH_MARKERS = Object.freeze([
  '/@vite/client',
  '@react-refresh',
  '/__vite_ping',
  'webpack-dev-server',
]);

/** Module specifiers Vite's dev server injects inline (`import "/@vite/client"`, the React refresh preamble). */
const INLINE_SCRIPT_MARKERS = Object.freeze(['/@vite/client', '@react-refresh', '/__vite_ping']);

/** Vite's default dev-server port. */
export const DEV_SERVER_PORTS = Object.freeze(['5173']);

/** A dev host such as the DDEV Vite sidecar, https://vite.<project>.ddev.site. */
const DEV_HOST_PREFIX = 'vite.';
const UNKNOWN_PAGE = 'https://t3u.invalid/';

const ATTRS = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)`;
const SCRIPT = new RegExp(String.raw`<script\b${ATTRS}>([\s\S]*?)<\/script\s*>`, 'gi');
const LINK = new RegExp(String.raw`<link\b${ATTRS}>`, 'gi');
const COMMENT = /<!--[\s\S]*?-->/g;
const EXECUTABLE_TYPE = /^(?:module|(?:text|application)\/(?:x-)?(?:java|ecma)script)$/i;
const MESSAGE_PAGES = 8;

/** Attribute value, '' for a bare boolean attribute, null when absent. */
function attribute(attrs, name) {
  const valued = new RegExp(String.raw`(?:^|\s)${name}\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))`, 'i').exec(attrs);
  if (valued) return valued[1] ?? valued[2] ?? valued[3] ?? '';
  return new RegExp(String.raw`(?:^|\s)${name}(?=\s|/|$)`, 'i').test(attrs) ? '' : null;
}

/**
 * Dev-server markers in one script or link URL. A dev host is a host other than the page's own:
 * a site that itself lives on vite.example.com loads its assets from there legitimately, and a
 * relative URL is the page's own host by definition.
 */
export function devServerUrlMarkers(rawUrl, pageUrl = null) {
  const value = String(rawUrl ?? '').trim();
  if (!value) return [];
  const markers = DEV_SERVER_PATH_MARKERS.filter((marker) => value.includes(marker));
  let page;
  try { page = new URL(pageUrl ?? UNKNOWN_PAGE); } catch { page = new URL(UNKNOWN_PAGE); }
  let url = null;
  try { url = new URL(value, page); } catch { /* not a URL: path markers only */ }
  if (url && url.host !== page.host) {
    if (url.hostname.toLowerCase().startsWith(DEV_HOST_PREFIX)) markers.push(`${DEV_HOST_PREFIX}* dev host`);
    if (DEV_SERVER_PORTS.includes(url.port)) markers.push(`:${url.port} dev host`);
  }
  return markers;
}

/**
 * Inspect one (normalised) HTML document.
 * @returns {{markers: string[], stylesheets: number}} dev-server markers, and the number of
 *   built stylesheets the page links (`rel=stylesheet`, or a preload `as=style`).
 */
export function inspectDocument(html, { pageUrl = null } = {}) {
  const text = String(html ?? '').replace(COMMENT, '');
  const markers = new Set();
  let stylesheets = 0;
  for (const [, attrs, body] of text.matchAll(SCRIPT)) {
    const src = attribute(attrs, 'src');
    if (src) for (const marker of devServerUrlMarkers(src, pageUrl)) markers.add(marker);
    const type = (attribute(attrs, 'type') ?? '').trim();
    if (type && !EXECUTABLE_TYPE.test(type)) continue;   // JSON-LD, templates, data blocks
    for (const marker of INLINE_SCRIPT_MARKERS) if (body.includes(marker)) markers.add(marker);
  }
  for (const [, attrs] of text.matchAll(LINK)) {
    const href = attribute(attrs, 'href');
    if (!href) continue;
    const found = devServerUrlMarkers(href, pageUrl);
    for (const marker of found) markers.add(marker);
    const rel = (attribute(attrs, 'rel') ?? '').toLowerCase().split(/\s+/);
    const style = rel.includes('stylesheet')
      || (rel.includes('preload') && (attribute(attrs, 'as') ?? '').toLowerCase() === 'style');
    if (style && !found.length) stylesheets += 1;
  }
  return { markers: [...markers].sort(), stylesheets };
}

/**
 * Scan a capture directory's DOM snapshots (`dom/<capture key>.html`), naming each page by the
 * URL in its HTTP record. A capture without DOM snapshots cannot be judged and says so.
 */
export async function scanCaptureForDevServer(dir) {
  const domDir = path.join(dir, 'dom');
  let files;
  try {
    files = (await readdir(domDir)).filter((file) => file.endsWith('.html')).sort();
  } catch (error) {
    if (error.code === 'ENOENT') files = [];
    else throw error;
  }
  const pages = [];
  for (const file of files) {
    const url = await recordedPageUrl(dir, file);
    const { markers, stylesheets } = inspectDocument(await readFile(path.join(domDir, file), 'utf8'), { pageUrl: url });
    pages.push({ file: `dom/${file}`, url: url ? redactUrl(url) : null, markers, stylesheets });
  }
  const devServer = pages.filter((page) => page.markers.length);
  const withStylesheet = pages.filter((page) => page.stylesheets > 0).length;
  const withoutStylesheet = pages.filter((page) => page.stylesheets === 0);
  // Heuristic, warn only: a page with no built stylesheet among pages that all have one was
  // probably rendered while the asset build was missing or being rewritten. When such pages are
  // not the clear minority, the site simply styles them differently and nothing is flagged.
  const missingStylesheet = withStylesheet > withoutStylesheet.length
    ? withoutStylesheet.map(({ file, url }) => ({ file, url }))
    : [];
  return { scanned: pages.length, devServer, missingStylesheet, withStylesheet };
}

/**
 * The seal-time guard. Refuses (exit 4) a capture rendered by a development server, naming the
 * pages; warns about pages that link no built stylesheet when the other pages do.
 */
export async function assertProductionCapture(dir, { id = 'A-original', log = null } = {}) {
  const scan = await scanCaptureForDevServer(dir);
  if (!scan.scanned) {
    log?.warn?.(`Baseline ${id} has no DOM snapshots; development-server markers could not be checked before sealing.`);
    return scan;
  }
  if (scan.devServer.length) {
    const named = scan.devServer.slice(0, MESSAGE_PAGES)
      .map((page) => `${page.url ?? page.file} (${page.markers.join(', ')})`);
    const more = scan.devServer.length > MESSAGE_PAGES ? `, and ${scan.devServer.length - MESSAGE_PAGES} more` : '';
    throw new PreconditionError(
      `Baseline ${id} was rendered by a frontend development server: ${scan.devServer.length} of ${scan.scanned} page(s) `
      + `load dev-server assets: ${named.join('; ')}${more}. A sealed baseline has no unseal, and every later capture `
      + 'against built assets would differ on every page. Nothing was sealed. Stop the dev server (for example '
      + '`ddev vite` or `npm run dev`), build the production assets, move the unsealed capture '
      + `${dir} aside, re-run "t3u selftest-determinism" (its pass B becomes the baseline again), then seal.`,
      { pages: scan.devServer.map(({ file, url, markers }) => ({ file, url, markers })), scanned: scan.scanned },
    );
  }
  if (scan.missingStylesheet.length) {
    const named = scan.missingStylesheet.slice(0, MESSAGE_PAGES).map((page) => page.url ?? page.file);
    const more = scan.missingStylesheet.length > MESSAGE_PAGES ? `, and ${scan.missingStylesheet.length - MESSAGE_PAGES} more` : '';
    log?.warn?.(
      `${scan.missingStylesheet.length} page(s) in baseline ${id} link no built stylesheet while ${scan.withStylesheet} `
      + `other page(s) do: ${named.join('; ')}${more}. Check that the asset build was complete when they were captured; `
      + 'sealing continues.',
    );
  }
  return scan;
}

async function recordedPageUrl(dir, domFile) {
  try {
    const record = JSON.parse(await readFile(path.join(dir, 'http', domFile.replace(/\.html$/, '.json')), 'utf8'));
    const url = record?.url ?? record?.requestedUrl;
    return typeof url === 'string' && url ? url : null;
  } catch {
    return null;
  }
}
