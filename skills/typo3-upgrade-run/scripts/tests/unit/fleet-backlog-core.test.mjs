/**
 * Fleet backlog (2026-10-01): processed-image renames in HTTP metadata (#25) and named capture
 * errors (#10).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { compareRecords, foldImageHash, metaImageUrls, imageProof, extractRecord } from '../../lib/compare/http-meta.mjs';
import { normalizeHtml } from '../../lib/compare/dom-normalize.mjs';
import { pngChunks, pngPixelDigest, imageDigestRecord, createImageDigester } from '../../lib/compare/image-digest.mjs';
import { captureErrorTarget } from '../../lib/actions/compare.mjs';
import { PolicyError } from '../../lib/cli/exit-codes.mjs';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A PNG of the given RGBA pixels, optionally with extra chunks after IHDR. */
function png(width, height, pixels, extraChunks = []) {
  const image = new PNG({ width, height });
  Buffer.from(pixels).copy(image.data);
  let buf = PNG.sync.write(image);
  const ihdrEnd = 8 + 12 + buf.readUInt32BE(8);
  for (const [type, data] of extraChunks) {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 'latin1');
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])), 8 + data.length);
    buf = Buffer.concat([buf.subarray(0, ihdrEnd), chunk, buf.subarray(ihdrEnd)]);
  }
  return buf;
}
const RED = [255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255];
const BLUE = [0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255];
const stamp = (text) => ['tEXt', Buffer.from(`date:timestamp\0${text}`, 'latin1')];

const OLD = 'https://acme.ddev.site/typo3temp/assets/images/csm_printlogo_6df2234e32_0334133a12.png';
const NEW = 'https://acme.ddev.site/typo3temp/assets/images/csm_printlogo_6df2234e32_71adfc2077.png';

function page(image, metaImages) {
  const record = extractRecord({
    url: 'https://acme.ddev.site/de/', status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<html lang="de"><head><title>Start</title>
      <meta property="og:title" content="Start">
      <meta property="og:image" content="${image}">
      <meta name="twitter:card" content="summary"></head></html>`,
  });
  if (metaImages) record.metaImages = metaImages;
  return record;
}
const digest = (url, over = {}) => ({ url, status: 200, contentType: 'image/png', bytes: 10, sha256: 'sha256:aa', ...over });

describe('processed-image renames in HTTP metadata (#25)', () => {
  test('the fold is the DOM stage asset-hash rule, applied to the URL', () => {
    assert.equal(foldImageHash(OLD), foldImageHash(NEW));
    assert.match(foldImageHash(OLD), /csm_printlogo_6df2234e32_<H>\.png$/);
    const dom = normalizeHtml(`<meta property="og:image" content="${OLD}">`).html;
    assert.ok(dom.includes(foldImageHash(OLD)), 'HTTP and DOM must fold the same way');
    assert.equal(foldImageHash('https://acme.ddev.site/fileadmin/og.png'), 'https://acme.ddev.site/fileadmin/og.png');
  });

  test('metaImageUrls lists every image field the metadata names', () => {
    assert.deepEqual(metaImageUrls(page(OLD)), [{ field: 'openGraph.image', url: OLD }]);
  });

  test('a rename with byte-identical content is accepted and stays visible as evidence', () => {
    const cmp = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD) }),
      page(NEW, { 'openGraph.image': digest(NEW) }),
    );
    assert.equal(cmp.identical, true);
    assert.deepEqual(cmp.metaImageRenames, [{ field: 'openGraph.image', before: OLD, after: NEW, proof: 'bytes-identical' }]);
  });

  test('a rename with different content is a difference that says why', () => {
    const cmp = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD) }),
      page(NEW, { 'openGraph.image': digest(NEW, { sha256: 'sha256:bb' }) }),
    );
    assert.equal(cmp.identical, false);
    assert.equal(cmp.differences[0].field, 'openGraph');
    assert.equal(cmp.differences[0].metaImages[0].reason, 'the image content differs');
    assert.deepEqual(cmp.differences[0].metaImages[0].digest, { before: 'sha256:aa', after: 'sha256:bb' });
  });

  test('without a digest on either side the rename is never trusted', () => {
    const cmp = compareRecords(page(OLD), page(NEW, { 'openGraph.image': digest(NEW) }));
    assert.equal(cmp.identical, false);
    assert.equal(cmp.differences[0].metaImages[0].reason, 'no image digest recorded');
  });

  test('a digest that names another URL, or a failed fetch, proves nothing', () => {
    const elsewhere = compareRecords(
      page(OLD, { 'openGraph.image': digest('https://acme.ddev.site/other.png') }),
      page(NEW, { 'openGraph.image': digest(NEW) }),
    );
    assert.equal(elsewhere.differences[0].metaImages[0].reason, 'the image digest names a different URL');
    const missing = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD) }),
      page(NEW, { 'openGraph.image': { url: NEW, status: 404, bytes: 0 } }),
    );
    assert.match(missing.differences[0].metaImages[0].reason, /not fetched \(200 \/ 404\)/);
  });

  test('equal pictures with different file bytes are accepted as pixels-identical', () => {
    const cmp = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD, { pixelSha256: 'sha256:px' }) }),
      page(NEW, { 'openGraph.image': digest(NEW, { sha256: 'sha256:bb', pixelSha256: 'sha256:px' }) }),
    );
    assert.equal(cmp.identical, true);
    assert.equal(cmp.metaImageRenames[0].proof, 'pixels-identical');
  });

  test('another image, or another metadata value, is still a plain difference', () => {
    const other = 'https://acme.ddev.site/typo3temp/assets/images/csm_banner_6df2234e32_71adfc2077.png';
    const cmp = compareRecords(
      page(OLD, { 'openGraph.image': digest(OLD) }),
      page(other, { 'openGraph.image': digest(other) }),
    );
    assert.equal(cmp.identical, false);
    assert.equal(cmp.differences[0].metaImages, undefined);
    const b = page(OLD, { 'openGraph.image': digest(OLD) });
    const a = page(NEW, { 'openGraph.image': digest(NEW) });
    a.openGraph.title = 'Changed';
    assert.equal(compareRecords(b, a).identical, false);
  });

  test('imageProof refuses incomplete evidence', () => {
    assert.equal(imageProof(null, digest(NEW)).proven, false);
    assert.equal(imageProof(digest(OLD), digest(NEW)).kind, 'bytes-identical');
  });
});

describe('image content digests (#25)', () => {
  test('a PNG text stamp changes the bytes but not the picture', async () => {
    const plain = png(2, 2, RED);
    const stamped = png(2, 2, RED, [stamp('2026-10-01T08:00:00')]);
    assert.notDeepEqual(plain, stamped);
    assert.equal(await pngPixelDigest(plain), await pngPixelDigest(stamped));
    assert.notEqual(await pngPixelDigest(plain), await pngPixelDigest(png(2, 2, BLUE)));
  });

  test('a colour chunk is part of the picture', async () => {
    const gamma = Buffer.alloc(4);
    gamma.writeUInt32BE(45455);
    assert.notEqual(await pngPixelDigest(png(2, 2, RED)), await pngPixelDigest(png(2, 2, RED, [['gAMA', gamma]])));
  });

  test('non-PNG content has no pixel digest, only bytes', async () => {
    assert.equal(pngChunks(Buffer.from('GIF89a')), null);
    assert.equal(await pngPixelDigest(Buffer.from([0xff, 0xd8, 0xff])), null);
    const record = await imageDigestRecord({ url: 'u', status: 200, contentType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8, 0xff]) });
    assert.match(record.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(record.pixelSha256, undefined);
  });

  test('the digester fetches each image once and records refusals', async () => {
    const calls = [];
    const guard = {
      assertUrl: async (url) => {
        if (url.startsWith('https://cdn.example.org/')) throw new PolicyError('origin not allowed');
        return { url: new URL(url) };
      },
      assertRedirect: async () => { throw new Error('no redirects expected'); },
    };
    const fetchImpl = async (url) => {
      calls.push(url);
      return new Response(png(2, 2, RED), { status: 200, headers: { 'content-type': 'image/png' } });
    };
    const digester = createImageDigester(guard, { fetchImpl });
    const first = await digester('/typo3temp/assets/images/og.png', 'https://acme.ddev.site/de/');
    const second = await digester('https://acme.ddev.site/typo3temp/assets/images/og.png', 'https://acme.ddev.site/en/');
    assert.equal(calls.length, 1);
    assert.equal(first.url, '/typo3temp/assets/images/og.png', 'the record keeps the URL as the page names it');
    assert.equal(second.sha256, first.sha256);
    assert.match(first.pixelSha256, /^sha256:/);
    const refused = await digester('https://cdn.example.org/og.png', 'https://acme.ddev.site/');
    assert.equal(refused.error, 'refused by the URL policy');
    assert.equal(refused.sha256, undefined);
  });
});

describe('capture errors name their artifact (#10)', () => {
  test('stage 1/2 errors name the record, screenshots the shot, and nothing is undefined', () => {
    assert.equal(captureErrorTarget({ captureId: 'abc', record: 'http', stage: 'http/dom' }), 'http/abc.json');
    assert.equal(captureErrorTarget({ captureId: 'abc', record: 'dom', stage: 'randomized-region-integrity' }), 'dom/abc.html');
    assert.equal(captureErrorTarget({ captureId: 'abc', stage: 'visual' }), 'abc.png');
    assert.equal(captureErrorTarget({ stage: 'http/dom' }), '(http/dom: no capture id)');
  });
});
