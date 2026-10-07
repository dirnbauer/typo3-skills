import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';

import {
  extractProcessedImageUrls,
  processedName,
  pairImages,
  decodePng,
  measureImage,
  compareMeasurements,
  checkColourParity,
  exitCodeFor,
  formatReport,
} from '../../gfx-colour-parity.mjs';
import { EXIT } from '../../lib/cli/exit-codes.mjs';

// Two 8x8 icons: live is the GraphicsMagick render (RGBA, grey 160, the same grey under alpha 0);
// dark is the same icon as ImageMagick wrote it with linear RGB (160 -> 90, black under alpha 0,
// saved as Gray+alpha) — the shape of the measured case.
const fixture = (name) => readFileSync(new URL(`../fixtures/gfx/${name}`, import.meta.url));
const LIVE_ICON = fixture('icon-live.png');
const DARK_ICON = fixture('icon-dark.png');

const LIVE = 'https://www.example.org';
const LOCAL = 'https://site.ddev.site';
const resolver = async (host) => {
  if (host === 'www.example.org' || host === 'cdn.example.org') return ['93.184.215.14'];
  if (host === 'site.ddev.site') return ['127.0.0.1'];
  throw new Error(`ENOTFOUND ${host}`);
};

/** A fetch replacement serving a fixed map of URL -> body. */
function fetchFrom(map) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    const body = map[url];
    if (body === undefined) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    const type = typeof body === 'string' ? 'text/html; charset=utf-8' : 'image/png';
    return new Response(body, { status: 200, headers: { 'content-type': type } });
  };
  return { fetchImpl, calls };
}

/** CRC-32 for inserting a colour chunk into a pngjs-written PNG. */
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function withChunk(png, type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), data])));
  const afterIhdr = 8 + 12 + 13;
  return Buffer.concat([png.subarray(0, afterIhdr), head, data, crc, png.subarray(afterIhdr)]);
}

function flatGrey(value) {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data.fill(value, i, i + 3);
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

const gama = (gamma) => {
  const data = Buffer.alloc(4);
  data.writeUInt32BE(Math.round(gamma * 100000));
  return data;
};

describe('extracting and pairing processed images', () => {
  test('finds processed images in src, srcset, lazy attributes, JSON, inline style and meta tags', () => {
    const html = `<html><head><meta property="og:image" content="${LIVE}/fileadmin/_processed_/1/2/csm_hero_0123456789.jpg"></head><body>
      <img src="/fileadmin/_processed_/a/b/csm_icon-eye_5e2a91c0d3.png" alt="">
      <img srcset="/fileadmin/_processed_/c/d/csm_team_aaaaaaaaaa.webp 480w, /fileadmin/_processed_/c/d/csm_team_bbbbbbbbbb.webp 960w">
      <div data-src="/fileadmin/_processed_/e/f/csm_lazy_cccccccccc.jpg?1700000000&amp;x=1"></div>
      <div data-gallery='{"src":"\\/fileadmin\\/_processed_\\/9\\/9\\/csm_json_dddddddddd.png"}'></div>
      <div style="background-image:url(/typo3temp/assets/images/csm_gifbuilder_eeeeeeeeee.png)"></div>
      <img src="/fileadmin/user_upload/original.png"><img src="/fileadmin/_processed_/0/0/csm_logo_ffffffffff.svg">
      <img src="/fileadmin/_processed_/a/b/csm_icon-eye_5e2a91c0d3.png">
    </body></html>`;
    assert.deepEqual(extractProcessedImageUrls(html, `${LIVE}/page/`), [
      `${LIVE}/fileadmin/_processed_/1/2/csm_hero_0123456789.jpg`,
      `${LIVE}/fileadmin/_processed_/a/b/csm_icon-eye_5e2a91c0d3.png`,
      `${LIVE}/fileadmin/_processed_/c/d/csm_team_aaaaaaaaaa.webp`,
      `${LIVE}/fileadmin/_processed_/c/d/csm_team_bbbbbbbbbb.webp`,
      `${LIVE}/fileadmin/_processed_/e/f/csm_lazy_cccccccccc.jpg?1700000000&x=1`,
      `${LIVE}/fileadmin/_processed_/9/9/csm_json_dddddddddd.png`,
      `${LIVE}/typo3temp/assets/images/csm_gifbuilder_eeeeeeeeee.png`,
    ]);
  });

  test('strips the csm_ prefix and the 10-character checksum for the pairing stem', () => {
    assert.deepEqual(processedName(`${LIVE}/fileadmin/_processed_/8/e/csm_Team_Photo_9f1c2b7a40.png`),
      { name: 'csm_Team_Photo_9f1c2b7a40.png', ext: 'png', stem: 'Team_Photo' });
    assert.equal(processedName(`${LIVE}/typo3temp/assets/images/0a1b2c3d4e.png`).stem, '0a1b2c3d4e');
  });

  test('pairs by exact name first, then by stem when the checksum differs, and reports the rest', () => {
    const p = (origin, name) => `${origin}/fileadmin/_processed_/0/0/${name}`;
    const { pairs, unpairedLive, unpairedLocal } = pairImages(
      [p(LIVE, 'csm_icon_1111111111.png'), p(LIVE, 'csm_same_2222222222.png'), p(LIVE, 'csm_live-only_3333333333.png'),
        p(LIVE, 'csm_team_4444444444.jpg'), p(LIVE, 'csm_team_5555555555.jpg')],
      [p(LOCAL, 'csm_same_2222222222.png'), p(LOCAL, 'csm_icon_9999999999.png'), p(LOCAL, 'csm_team_6666666666.jpg'),
        p(LOCAL, 'csm_team_7777777777.jpg'), p(LOCAL, 'csm_local-only_8888888888.png')],
    );
    assert.deepEqual(pairs.map((x) => [x.live.name, x.local.name, x.match]), [
      ['csm_icon_1111111111.png', 'csm_icon_9999999999.png', 'stem'],
      ['csm_same_2222222222.png', 'csm_same_2222222222.png', 'name'],
      ['csm_team_4444444444.jpg', 'csm_team_6666666666.jpg', 'stem'],
      ['csm_team_5555555555.jpg', 'csm_team_7777777777.jpg', 'stem'],
    ]);
    assert.deepEqual(unpairedLive, [p(LIVE, 'csm_live-only_3333333333.png')]);
    assert.deepEqual(unpairedLocal, [p(LOCAL, 'csm_local-only_8888888888.png')]);
  });
});

describe('measuring what a visitor sees', () => {
  test('the darkened fixture is 43.75 % darker and saved as Gray', () => {
    const live = decodePng(LIVE_ICON);
    const local = decodePng(DARK_ICON);
    assert.equal(live.colourspace, 'sRGB');
    assert.equal(local.colourspace, 'Gray');
    assert.deepEqual(live.mean, { r: 160, g: 160, b: 160 });
    assert.deepEqual(local.mean, { r: 90, g: 90, b: 90 });
    const delta = compareMeasurements(live, local);
    assert.equal(delta.verdict, 'darker');
    assert.ok(Math.abs(delta.luma + 0.4375) < 1e-9, `luma delta ${delta.luma}`);
    assert.equal(compareMeasurements(live, decodePng(LIVE_ICON)).verdict, 'match');
  });

  test('the gate is perceptual: a few levels on a dark icon pass, the linear-RGB darkening fails', () => {
    const side = (r, g, b) => ({ mean: { r, g, b }, luma: 0.2126 * r + 0.7152 * g + 0.0722 * b, coverage: 0.1 });
    // Two GraphicsMagick versions on one site: 5 % in luma, but 0.6 L* and delta E 1.4.
    const encoder = compareMeasurements(side(139, 22, 54), side(140, 25, 57));
    assert.equal(encoder.verdict, 'match');
    assert.ok(encoder.luma > 0.04 && Math.abs(encoder.lightness) < 1 && encoder.deltaE < 2);
    // The measured darkening of a red icon: 12 L* units.
    const linear = compareMeasurements(side(192.8, 62.8, 62.8), side(140.7, 47.2, 47.2));
    assert.equal(linear.verdict, 'darker');
    assert.ok(linear.lightness < -10);
    // A hue change at equal lightness is a colour shift.
    assert.equal(compareMeasurements(side(200, 60, 60), side(150, 82, 60)).verdict, 'colour-shift');
  });

  test('colour under alpha 0 is not seen and does not count', () => {
    const png = PNG.sync.read(LIVE_ICON);
    for (let i = 0; i < png.data.length; i += 4) if (png.data[i + 3] === 0) png.data.fill(0, i, i + 3);
    const zeroed = decodePng(PNG.sync.write(png));
    assert.deepEqual(zeroed.mean, decodePng(LIVE_ICON).mean);
    assert.equal(compareMeasurements(decodePng(LIVE_ICON), zeroed).verdict, 'match');
  });

  test('a gAMA 1.0 tag changes what the browser shows; sRGB takes precedence', () => {
    const plain = decodePng(flatGrey(100));
    const linearTag = decodePng(withChunk(flatGrey(100), 'gAMA', gama(1)));
    const srgbGamma = decodePng(withChunk(flatGrey(100), 'gAMA', gama(0.45455)));
    const srgbChunk = decodePng(withChunk(withChunk(flatGrey(100), 'gAMA', gama(1)), 'sRGB', Buffer.from([0])));
    assert.equal(plain.mean.r, 100);
    // Chromium displays a stored 100 grey tagged gAMA 1.0 as 168.
    assert.equal(Math.round(linearTag.mean.r), 168);
    assert.equal(linearTag.colourspace, 'sRGB gAMA 1.00');
    assert.deepEqual(linearTag.stored, { r: 100, g: 100, b: 100 });
    assert.equal(srgbGamma.mean.r, 100);
    assert.equal(srgbChunk.mean.r, 100);
    assert.equal(compareMeasurements(linearTag, plain).verdict, 'darker');
  });

  test('a format the host cannot decode is reported, not guessed', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
    assert.match((await measureImage(jpeg, { cli: null })).error, /no ImageMagick\/GraphicsMagick CLI/);
    const converted = await measureImage(jpeg, { cli: { name: 'fake', toPng: async () => LIVE_ICON } });
    assert.equal(converted.format, 'jpeg');
    assert.deepEqual(converted.mean, { r: 160, g: 160, b: 160 });
    assert.match((await measureImage(Buffer.concat([LIVE_ICON.subarray(0, 8), Buffer.from('cut')]))).error, /unreadable PNG/);
  });
});

describe('checkColourParity end to end', () => {
  const livePage = `<img src="/fileadmin/_processed_/e/1/csm_icon-eye_5e2a91c0d3.png">
    <img src="/fileadmin/_processed_/3/6/csm_badge_a4d07e19b6.png"><img src="/fileadmin/_processed_/7/7/csm_live-only_1234567890.png">
    <img src="https://cdn.example.org/fileadmin/_processed_/c/c/csm_cdn_abcdefabcd.png">`;
  const localPage = (icon) => `<img src="/fileadmin/_processed_/f/2/csm_icon-eye_7c1e2d3f4a.png">
    <img src="/fileadmin/_processed_/3/6/csm_badge_a4d07e19b6.png">
    <img src="https://cdn.example.org/fileadmin/_processed_/c/c/csm_cdn_abcdefabcd.png">${icon}`;
  const files = (localIcon) => ({
    [`${LIVE}/`]: livePage,
    [`${LIVE}/fileadmin/_processed_/e/1/csm_icon-eye_5e2a91c0d3.png`]: LIVE_ICON,
    [`${LIVE}/fileadmin/_processed_/3/6/csm_badge_a4d07e19b6.png`]: LIVE_ICON,
    [`${LIVE}/fileadmin/_processed_/7/7/csm_live-only_1234567890.png`]: LIVE_ICON,
    [`${LOCAL}/`]: localPage(''),
    [`${LOCAL}/fileadmin/_processed_/f/2/csm_icon-eye_7c1e2d3f4a.png`]: localIcon,
    [`${LOCAL}/fileadmin/_processed_/3/6/csm_badge_a4d07e19b6.png`]: LIVE_ICON,
  });

  test('a darker local derivative is a finding, exit 1, and only GETs are sent', async () => {
    const { fetchImpl, calls } = fetchFrom(files(DARK_ICON));
    const report = await checkColourParity({ pages: [{ live: `${LIVE}/`, local: `${LOCAL}/` }], fetchImpl, resolver, cli: null });
    assert.equal(report.verdict, 'findings');
    assert.equal(exitCodeFor(report), EXIT.FINDINGS);
    assert.deepEqual(report.pairs.map((p) => [p.name, p.verdict, p.match]), [
      ['csm_icon-eye_5e2a91c0d3.png ↔ csm_icon-eye_7c1e2d3f4a.png', 'darker', 'stem'],
      ['csm_badge_a4d07e19b6.png', 'match', 'name'],
    ]);
    assert.deepEqual(report.pairs[0].delta, { lightness: -27.63, deltaE: 27.63, luma: -0.4375, coverage: 0 });
    assert.deepEqual(report.pairs[0].notes, ['colourspace sRGB live, Gray local']);
    assert.deepEqual(report.counts, { measured: 2, findings: 1, unmeasured: 0, unpairedLive: 1, unpairedLocal: 0, skipped: 2, truncated: 0 });
    assert.ok(calls.every((c) => c.method === 'GET'));
    assert.ok(!calls.some((c) => c.url.startsWith('https://cdn.example.org/')), 'other origins stay untouched');
    assert.match(formatReport(report), /✗ darker\s+L\*\s+−27\.6\s+ΔE\s+27\.6\s+luma\s+−43\.8 %/);
  });

  test('matching derivatives pass with exit 0; a page without processed images cannot be judged', async () => {
    const { fetchImpl } = fetchFrom(files(LIVE_ICON));
    const report = await checkColourParity({ pages: [{ live: `${LIVE}/`, local: `${LOCAL}/` }], fetchImpl, resolver, cli: null });
    assert.equal(report.verdict, 'pass');
    assert.equal(exitCodeFor(report), EXIT.PASS);

    const empty = fetchFrom({ [`${LIVE}/`]: '<p>no images</p>', [`${LOCAL}/`]: '<p>no images</p>' });
    const none = await checkColourParity({ pages: [{ live: `${LIVE}/`, local: `${LOCAL}/` }], fetchImpl: empty.fetchImpl, resolver, cli: null });
    assert.equal(none.verdict, 'not-comparable');
    assert.equal(exitCodeFor(none), EXIT.INVALID);
  });

  test('a redirect to an origin nobody allowed is refused by the URL guard (exit 5)', async () => {
    const fetchImpl = async (url) => (url === `${LOCAL}/`
      ? new Response('', { status: 302, headers: { location: 'https://evil.example/steal' } })
      : new Response(livePage, { status: 200, headers: { 'content-type': 'text/html' } }));
    await assert.rejects(
      () => checkColourParity({ pages: [{ live: `${LIVE}/`, local: `${LOCAL}/` }], fetchImpl, resolver, cli: null }),
      (error) => error.exitCode === EXIT.BLOCKED_BY_POLICY,
    );
  });
});
