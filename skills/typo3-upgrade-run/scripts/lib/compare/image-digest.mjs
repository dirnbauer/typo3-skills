/**
 * Content digests of images that the page only names (og:image, twitter:image).
 *
 * The HTTP stage accepts a processed-file rename only with a content proof (http-meta.mjs
 * imageProof), so the capture records what each named image actually is: its bytes and, for PNG,
 * its picture. pngjs is imported lazily, like the pixel engines in image.mjs, so the pure parts
 * stay testable without an install.
 */

import { sha256 } from '../run/paths.mjs';
import { safeFetch } from '../net/safe-fetch.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Chunks that describe the file, not the picture. Everything else that is not decoded into the
 * pixels (IHDR, PLTE, tRNS, IDAT, IEND) enters the digest raw, so a colour profile, gamma or EXIF
 * orientation that changes how the picture is shown still makes two images different.
 */
const PNG_METADATA_CHUNKS = new Set(['tEXt', 'zTXt', 'iTXt', 'tIME', 'pHYs']);
const PNG_DECODED_CHUNKS = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND']);

/** The chunks of a PNG file, or null when the buffer is not a well-formed PNG. */
export function pngChunks(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    if (offset + 12 + length > buffer.length) return null;
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === 'IEND') return chunks;
  }
  return null;
}

/**
 * Digest of what a PNG shows: dimensions, decoded RGBA samples (16-bit kept, not rescaled) and
 * every display-relevant chunk. Null for anything that is not a decodable PNG.
 */
export async function pngPixelDigest(buffer) {
  const chunks = pngChunks(buffer);
  if (!chunks) return null;
  let PNG;
  try {
    ({ PNG } = await import('pngjs'));
  } catch {
    return null;
  }
  let image;
  try {
    image = PNG.sync.read(buffer, { skipRescale: true });
  } catch {
    return null;
  }
  const hash = (await import('node:crypto')).createHash('sha256');
  hash.update(`png ${image.width}x${image.height}\n`);
  for (const chunk of chunks) {
    if (PNG_METADATA_CHUNKS.has(chunk.type) || PNG_DECODED_CHUNKS.has(chunk.type)) continue;
    hash.update(`${chunk.type}:${chunk.data.length}\n`);
    hash.update(chunk.data);
  }
  hash.update(Buffer.from(image.data.buffer, image.data.byteOffset, image.data.byteLength));
  return `sha256:${hash.digest('hex')}`;
}

/** The recorded digest of one fetched image. Pure apart from the PNG decode. */
export async function imageDigestRecord({ url, status, contentType = null, buffer = null, error = null }) {
  if (error) return { url, status: status ?? null, error };
  const record = { url, status, contentType: contentType || null, bytes: buffer?.length ?? 0 };
  if (status !== 200 || !buffer) return record;
  record.sha256 = `sha256:${sha256(buffer)}`;
  const pixels = await pngPixelDigest(buffer);
  if (pixels) record.pixelSha256 = pixels;
  return record;
}

/**
 * A per-capture memo: pages usually share one site-wide og:image, which is fetched once. Every
 * fetch goes through the URL guard; an image on a host outside the run's allowed origins is
 * recorded as refused and never fetched, so its rename cannot be proven.
 */
export function createImageDigester(guard, { fetchImpl } = {}) {
  // Holds digests, never bodies: a news site names a different image on each of thousands of pages.
  const memo = new Map();
  const digest = async (absoluteUrl) => {
    try {
      const res = await safeFetch(guard, absoluteUrl, {
        purpose: 'capture-meta-image', accept: 'any', binary: true, ...(fetchImpl ? { fetchImpl } : {}),
      });
      return imageDigestRecord({ url: null, status: res.status, contentType: res.contentType, buffer: res.buffer });
    } catch (err) {
      // Exit code 5 covers an origin outside the run's allow-list and the response size cap alike.
      const message = String(err?.message ?? err).split('\n', 1)[0].slice(0, 160);
      return imageDigestRecord({ url: null, error: err?.exitCode === 5 ? `refused by policy: ${message}` : message });
    }
  };
  return async (rawUrl, pageUrl) => {
    let absoluteUrl;
    try {
      absoluteUrl = new URL(rawUrl, pageUrl).href;
    } catch {
      return { url: rawUrl, status: null, error: 'not a URL' };
    }
    if (!memo.has(absoluteUrl)) memo.set(absoluteUrl, digest(absoluteUrl));
    return { ...(await memo.get(absoluteUrl)), url: rawUrl };
  };
}
