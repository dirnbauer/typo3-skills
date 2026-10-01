/**
 * HTTP with manual redirect handling.
 *
 * axios was dropped precisely because it follows redirects internally and never lets the
 * guard see the hops. Every hop is re-validated here, and Authorization/Cookie are
 * dropped the moment the origin changes - that is the fix for "backend credentials
 * follow a redirect to a foreign host".
 *
 * Size limits count streamed bytes rather than trusting Content-Length, so a lying
 * header or a decompression bomb cannot get past them.
 */

import { PolicyError, HarnessError } from '../cli/exit-codes.mjs';

export const DEFAULT_LIMITS = Object.freeze({
  maxRedirects: 5,
  maxBytes: 10 * 1024 * 1024,   // 10 MiB decoded
  timeoutMs: 15_000,
});

export const CONTENT_TYPES = Object.freeze({
  sitemap: ['application/xml', 'text/xml', 'application/xhtml+xml', 'text/plain'],
  html: ['text/html', 'application/xhtml+xml'],
  any: null,
});

const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

/**
 * @param {UrlGuard} guard
 * @param {string} rawUrl
 * @param {object} opts
 * @returns {Promise<{url:string, status:number, headers:Headers, body:string, buffer?:Buffer,
 *                    bytes:number, contentType:string, redirects:string[], finalOrigin:string}>}
 */
export async function safeFetch(guard, rawUrl, {
  purpose = 'fetch',
  accept = 'any',
  maxBytes = DEFAULT_LIMITS.maxBytes,
  maxRedirects = DEFAULT_LIMITS.maxRedirects,
  timeoutMs = DEFAULT_LIMITS.timeoutMs,
  headers = {},
  method = 'GET',
  // Binary bodies (images) are returned as a Buffer; decoding them as UTF-8 would destroy the
  // bytes a digest is taken of.
  binary = false,
  fetchImpl = globalThis.fetch,
} = {}) {
  let current = (await guard.assertUrl(rawUrl, { purpose })).url.href;
  const startOrigin = new URL(current).origin;
  const redirects = [];
  let hdrs = { ...headers };

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const res = await fetchImpl(current, {
      method,
      redirect: 'manual',
      headers: hdrs,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      if (hop === maxRedirects) {
        throw new PolicyError(`Too many redirects (${maxRedirects}) for ${purpose}`, { purpose, redirects });
      }
      const next = await guard.assertRedirect(res.headers.get('location'), current, { purpose });
      if (!next.sameOrigin) {
        // Never carry credentials across an origin boundary.
        hdrs = Object.fromEntries(
          Object.entries(hdrs).filter(([k]) => !CREDENTIAL_HEADERS.includes(k.toLowerCase())),
        );
      }
      redirects.push(next.url.href);
      current = next.url.href;
      continue;
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    const allowed = CONTENT_TYPES[accept];
    if (allowed && contentType && !allowed.includes(contentType)) {
      throw new HarnessError(`Unexpected content-type for ${purpose}: ${contentType}`, {
        purpose, contentType, expected: allowed,
      });
    }

    const { buffer, bytes } = await readCapped(res, maxBytes, purpose);
    return {
      url: current,
      status: res.status,
      headers: res.headers,
      body: binary ? '' : buffer.toString('utf8'),
      ...(binary ? { buffer } : {}),
      bytes,
      contentType,
      redirects,
      finalOrigin: new URL(current).origin,
      leftStartOrigin: new URL(current).origin !== startOrigin,
    };
  }
  throw new HarnessError(`Redirect loop handling fell through for ${purpose}`);
}

/** Count decoded bytes as they stream; abort the moment the cap is exceeded. */
async function readCapped(res, maxBytes, purpose) {
  if (!res.body) {
    const buffer = Buffer.from(await res.arrayBuffer());
    const bytes = buffer.length;
    if (bytes > maxBytes) throw new PolicyError(`Response exceeds ${maxBytes} bytes`, { purpose, bytes });
    return { buffer, bytes };
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of res.body) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      try { await res.body.cancel?.(); } catch { /* already closed */ }
      throw new PolicyError(`Response exceeds ${maxBytes} bytes for ${purpose}`, { purpose, bytes, maxBytes });
    }
    chunks.push(Buffer.from(chunk));
  }
  return { buffer: Buffer.concat(chunks), bytes };
}
