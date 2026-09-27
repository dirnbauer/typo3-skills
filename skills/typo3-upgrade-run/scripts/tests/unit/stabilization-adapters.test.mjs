import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { PNG } from 'pngjs';

import { HarnessError } from '../../lib/cli/exit-codes.mjs';
import { extractRecord, compareRecords, comparableCookieNames } from '../../lib/compare/http-meta.mjs';
import {
  canonicalizeRandomizedRegions, domHash, normalizeHtml, parseRegionSelector,
} from '../../lib/compare/dom-normalize.mjs';
import {
  convertGifFirstFrame, createMediaAdapters, gifFrameCount, gifInfo, mediaSourceFingerprint,
  mergeMediaReports, neutralizeSvgBlend, resolveImageMagick,
} from '../../lib/browser/media-adapters.mjs';
import { createRoutePolicy } from '../../lib/browser/route-policy.mjs';
import { profileHash, settleScript, validateStabilizationProfile } from '../../lib/browser/stabilize.mjs';
import { mediaSourcesDiffer } from '../../lib/actions/compare.mjs';

const sha = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** A well-formed GIF (1x1 frames by default), with a looping application extension. */
function gif(frames, { screen = [1, 1], first = [0, 0, 1, 1] } = {}) {
  const u16 = (n) => [n & 0xff, n >> 8];
  const parts = [
    Buffer.from('GIF89a', 'latin1'),
    Buffer.from([...u16(screen[0]), ...u16(screen[1]), 0x80, 0, 0]),   // global colour table of 2
    Buffer.from([255, 0, 0, 0, 0, 255]),
    Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'latin1'), 0x03, 0x01, 0x00, 0x00, 0x00]),
  ];
  for (let i = 0; i < frames; i += 1) {
    const [left, top, width, height] = i === 0 ? first : [0, 0, 1, 1];
    parts.push(Buffer.from([0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00]));   // graphic control
    parts.push(Buffer.from([0x2c, ...u16(left), ...u16(top), ...u16(width), ...u16(height), 0x00]));
    parts.push(Buffer.from([0x02, 0x02, 0x44, 0x01, 0x00]));                     // LZW data
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

const PAGE_A = { name: 'page-a' };
const PAGE_B = { name: 'page-b' };

function fakeRoute({ url, status = 200, body = Buffer.alloc(0), headers = {}, page = PAGE_A, fetchError = null }) {
  const calls = { fulfill: [], continued: 0, aborted: [], fetchOptions: [] };
  const route = {
    request: () => ({ url: () => url, frame: () => ({ page: () => page }) }),
    fetch: async (options) => {
      calls.fetchOptions.push(options);
      if (fetchError) throw fetchError;
      return {
        status: () => status,
        headers: () => ({ 'content-length': String(body.length), etag: '"x"', ...headers }),
        body: async () => body,
      };
    },
    fulfill: async (value) => { calls.fulfill.push(value); },
    continue: async () => { calls.continued += 1; },
    abort: async (reason) => { calls.aborted.push(reason); },
  };
  return { route, calls };
}

describe('TYPO3 nonce cookies', () => {
  const record = (cookies) => extractRecord({ url: 'u', status: 200, headers: { 'set-cookie': cookies }, body: '' });

  test('a rotating nonce suffix is request noise; the cookie family is not', () => {
    const a = record(['__Secure-typo3nonce_Ab3-_x=1', 'fe_typo_user=a']);
    const b = record(['__Secure-typo3nonce_Zq9_y-=2', 'fe_typo_user=b']);
    assert.equal(compareRecords(a, b).identical, true);
    assert.equal(compareRecords(a, record(['__Secure-othernonce_Zq9=2', 'fe_typo_user=b'])).identical, false);
  });

  test('losing the __Secure- prefix is a finding: TYPO3 stopped detecting HTTPS', () => {
    const secure = record(['__Secure-typo3nonce_Ab3=1']);
    const plain = record(['typo3nonce_Ab3=1']);
    const result = compareRecords(secure, plain);
    assert.equal(result.identical, false);
    assert.ok(result.differences.some((d) => d.field === 'cookieNames'));
  });

  test('nonce emission and revocation counts collapse; other duplicates stay visible', () => {
    assert.deepEqual(
      comparableCookieNames(['typo3nonce_a', 'typo3nonce_b', 'x', 'x', '__Secure-typo3nonce_c']),
      ['__Secure-typo3nonce_*', 'typo3nonce_*', 'x', 'x'],
    );
  });
});

describe('GIF guard', () => {
  test('counts frames through extensions and colour tables', () => {
    assert.equal(gifFrameCount(gif(1)), 1);
    assert.equal(gifFrameCount(gif(3)), 3);
    assert.equal(gifFrameCount(gif(2).subarray(0, -1)), 2, 'a missing trailer still has known frames');
  });

  test('the canvas is the logical screen united with the first frame, as Chromium renders it', () => {
    assert.deepEqual(gifInfo(gif(2, { screen: [40, 20], first: [10, 5, 20, 10] })), {
      frames: 2, first: { left: 10, top: 5, width: 20, height: 10 }, canvas: { width: 40, height: 20 },
    });
    // An overhanging first frame grows the image (Chromium 151 measured 30x15 for this shape).
    assert.deepEqual(gifInfo(gif(2, { screen: [20, 10], first: [10, 5, 20, 10] })).canvas, { width: 30, height: 15 });
  });

  test('refuses anything that is not a well-formed GIF', () => {
    assert.equal(gifFrameCount(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1')), null);
    assert.equal(gifFrameCount(Buffer.from('GIF89a', 'latin1')), null);
    assert.equal(gifFrameCount(gif(2).subarray(0, 40)), null, 'truncated inside a data sub-block');
    assert.equal(gifFrameCount(Buffer.concat([gif(1).subarray(0, -1), Buffer.from([0x99])])), null);
  });
});

describe('SVG blend guard', () => {
  test('neutralizes only the configured blend modes', () => {
    const svg = '<svg><g style="mix-blend-mode: multiply"/><g style="mix-blend-mode:screen"/><g style="mix-blend-mode:multiply-x"/></svg>';
    assert.deepEqual(neutralizeSvgBlend(svg).replaced, 1);
    assert.match(neutralizeSvgBlend(svg).text, /mix-blend-mode:normal"\/><g style="mix-blend-mode:screen"/);
    assert.equal(neutralizeSvgBlend(svg, ['multiply', 'screen']).replaced, 2);
  });
});

describe('ImageMagick resolution', () => {
  const runner = (table) => (command) => table[command] ?? { status: 1, stdout: '' };

  test('prefers magick, falls back to the v6 convert, and ignores foreign convert binaries', () => {
    assert.deepEqual(
      resolveImageMagick(null, runner({ convert: { status: 0, stdout: 'Version: ImageMagick 6.9.12-98 Q16' } })),
      { command: 'convert', version: '6.9.12-98' },
    );
    assert.deepEqual(
      resolveImageMagick(null, runner({
        magick: { status: 0, stdout: 'Version: ImageMagick 7.1.2-29 Q16-HDRI' },
        convert: { status: 0, stdout: 'Version: ImageMagick 6.9.12-98' },
      })).command,
      'magick',
    );
    assert.equal(resolveImageMagick(null, runner({ convert: { status: 0, stdout: 'Converts FAT volumes to NTFS.' } })), null);
    assert.equal(resolveImageMagick('magick', runner({ convert: { status: 0, stdout: 'Version: ImageMagick 6.9' } })), null);
  });
});

describe('media route adapters', () => {
  const adapters = (config, converter = async () => Buffer.from('png-bytes')) => createMediaAdapters(config, { gifConverter: converter });

  test('an animated GIF is served as frame 1 once, cached, and evidenced by its ORIGINAL bytes', async () => {
    const source = gif(3);
    const media = adapters({ gifFirstFrame: { adr: 'ADR-004' } });
    const first = fakeRoute({ url: 'https://acme.ddev.site/fileadmin/banner.gif?v=1', body: source, headers: { 'content-type': 'image/gif', 'content-encoding': 'identity' } });
    const second = fakeRoute({ url: 'https://acme.ddev.site/fileadmin/banner.gif?v=1', body: source, page: PAGE_B });
    assert.equal(await media.handle(first.route), true);
    assert.equal(await media.handle(second.route), true);

    assert.deepEqual(first.calls.fetchOptions, [{ maxRedirects: 0 }], 'the adapter never follows a redirect itself');
    assert.equal(second.calls.fetchOptions.length, 0, 'second request is served from the cache');
    for (const { calls } of [first, second]) {
      assert.equal(calls.fulfill.length, 1);
      assert.equal(calls.fulfill[0].headers['content-type'], 'image/png');
      assert.equal(calls.fulfill[0].headers['content-length'], undefined);
      assert.equal(calls.fulfill[0].headers['content-encoding'], undefined);
      assert.deepEqual(calls.fulfill[0].body, Buffer.from('png-bytes'));
    }
    const evidence = { kind: 'gif-first-frame', resource: '/fileadmin/banner.gif', frames: 3, sourceSha256: sha(source), sourceBytes: source.length };
    assert.deepEqual(media.takePage(PAGE_A), { resources: [evidence], failures: [] });
    assert.deepEqual(media.takePage(PAGE_B).resources, [evidence], 'a cache hit is still evidence for its own page');
    assert.deepEqual(media.takePage(PAGE_A).resources, [], 'taking evidence clears it');

    const report = media.report().gifFirstFrame;
    assert.equal(report.adr, 'ADR-004');
    assert.deepEqual(
      { requests: report.requests, transformed: report.transformed, cacheHits: report.cacheHits, failed: report.failed },
      { requests: 2, transformed: 1, cacheHits: 1, failed: 0 },
    );
    assert.equal(report.laterFramesUntested, 2);
  });

  test('guard mismatches pass through untouched and are counted, never transformed', async () => {
    const media = adapters({ gifFirstFrame: { adr: 'ADR-004' } });
    const staticGif = fakeRoute({ url: 'https://acme.ddev.site/a.gif', body: gif(1) });
    const notAGif = fakeRoute({ url: 'https://acme.ddev.site/b.gif', body: Buffer.from('<html>404</html>') });
    const redirect = fakeRoute({ url: 'https://acme.ddev.site/c.gif', status: 302, body: Buffer.alloc(0) });
    const again = fakeRoute({ url: 'https://acme.ddev.site/a.gif', body: gif(1) });
    for (const r of [staticGif, notAGif, redirect, again]) assert.equal(await media.handle(r.route), true);
    for (const r of [staticGif, notAGif, redirect, again]) {
      assert.equal(r.calls.continued, 1);
      assert.equal(r.calls.fulfill.length, 0);
    }
    assert.equal(again.calls.fetchOptions.length, 0, 'a passthrough decision is cached');
    assert.equal(media.report().gifFirstFrame.passthrough, 4);
    assert.deepEqual(media.takePage(PAGE_A).resources, []);
  });

  test('a failed conversion aborts deterministically and is recorded for its page', async () => {
    const media = adapters({ gifFirstFrame: { adr: 'ADR-004' } }, async () => { throw new Error('convert: no decode delegate\nstack'); });
    const r = fakeRoute({ url: 'https://acme.ddev.site/anim.gif', body: gif(2) });
    assert.equal(await media.handle(r.route), true);
    assert.deepEqual(r.calls.aborted, ['failed']);
    assert.deepEqual(media.takePage(PAGE_A).failures, [{ kind: 'gif', resource: '/anim.gif', error: 'convert: no decode delegate' }]);
    assert.equal(media.report().gifFirstFrame.failed, 1);
  });

  test('an SVG blend layer is neutralized only when present; the source hash is kept', async () => {
    const media = adapters({ svgBlendNeutralize: { adr: 'ADR-006' } });
    const blended = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g style="mix-blend-mode:multiply"/></svg>');
    const plain = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>');
    const withBlend = fakeRoute({ url: 'https://acme.ddev.site/logo.svg', body: blended });
    const without = fakeRoute({ url: 'https://acme.ddev.site/icon.svg', body: plain });
    const errorPage = fakeRoute({ url: 'https://acme.ddev.site/gone.svg', body: Buffer.from('<p>mix-blend-mode:multiply</p>') });
    for (const r of [withBlend, without, errorPage]) await media.handle(r.route);

    assert.equal(withBlend.calls.fulfill[0].body.toString('utf8'), '<svg xmlns="http://www.w3.org/2000/svg"><g style="mix-blend-mode:normal"/></svg>');
    assert.equal(without.calls.continued, 1);
    assert.equal(errorPage.calls.continued, 1, 'not an SVG document: the guard refuses');
    assert.deepEqual(media.takePage(PAGE_A).resources, [
      { kind: 'svg-blend-neutralized', resource: '/logo.svg', replacements: 1, sourceSha256: sha(blended), sourceBytes: blended.length },
    ]);
  });

  test('requests no adapter covers are left to the policy', async () => {
    const media = adapters({ gifFirstFrame: { adr: 'ADR-004' } });
    assert.equal(await media.handle(fakeRoute({ url: 'https://acme.ddev.site/photo.png' }).route), false);
    assert.equal(await media.handle(fakeRoute({ url: 'https://acme.ddev.site/logo.svg' }).route), false, 'SVG adapter not configured');
  });

  test('a configured GIF adapter refuses to start without ImageMagick', () => {
    assert.throws(
      () => createMediaAdapters({ gifFirstFrame: { adr: 'ADR-004', command: 'definitely-not-imagemagick' } }),
      /needs ImageMagick/,
    );
  });

  test('the route policy blocks third parties before any adapter sees them', async () => {
    let handler;
    const policy = createRoutePolicy({
      allowedOrigins: ['https://acme.ddev.site'],
      media: { gifFirstFrame: { adr: 'ADR-004' } },
      gifConverter: async () => Buffer.from('png'),
    });
    await policy.attach({ route: async (_pattern, callback) => { handler = callback; }, on: () => {}, once: () => {} });
    const tracker = fakeRoute({ url: 'https://tracker.example/pixel.gif', body: gif(2) });
    const own = fakeRoute({ url: 'https://acme.ddev.site/anim.gif', body: gif(2) });
    await handler(tracker.route);
    await handler(own.route);
    assert.deepEqual(tracker.calls.aborted, ['blockedbyclient']);
    assert.equal(tracker.calls.fetchOptions.length, 0);
    assert.equal(own.calls.fulfill.length, 1);
    assert.equal(policy.takePageMedia(PAGE_A).resources.length, 1);
    assert.equal(policy.report().media.gifFirstFrame.transformed, 1);
    assert.equal(createRoutePolicy({ allowedOrigins: ['https://acme.ddev.site'] }).report().media, undefined);
  });

  test('worker reports merge into one union of resources', () => {
    const r1 = { kind: 'gif-first-frame', resource: '/a.gif', frames: 4, sourceSha256: 'sha256:1', sourceBytes: 10 };
    const r2 = { kind: 'gif-first-frame', resource: '/b.gif', frames: 2, sourceSha256: 'sha256:2', sourceBytes: 20 };
    const worker = (resources, transformed) => ({
      gifFirstFrame: { adr: 'ADR-004', tool: null, requests: 3, transformed, cacheHits: 1, passthrough: 0, failed: 0 },
      svgBlendNeutralize: null,
      resources,
    });
    const merged = mergeMediaReports([worker([r1], 1), worker([r1, r2], 2), undefined]);
    assert.deepEqual(merged.resources, [r1, r2]);
    assert.equal(merged.gifFirstFrame.requests, 6);
    assert.equal(merged.gifFirstFrame.resources, 2);
    assert.equal(merged.gifFirstFrame.laterFramesUntested, 4);
    assert.equal(merged.svgBlendNeutralize, null);
    assert.equal(mergeMediaReports([undefined]), null);
  });

  test('the source fingerprint ignores order and renamed files, not changed bytes', () => {
    const a = { kind: 'gif-first-frame', resource: '/_processed_/a_1234.gif', frames: 2, sourceSha256: 'sha256:aa', sourceBytes: 5 };
    const b = { kind: 'svg-blend-neutralized', resource: '/logo.svg', replacements: 1, sourceSha256: 'sha256:bb', sourceBytes: 7 };
    assert.deepEqual(mediaSourceFingerprint([a, b]), mediaSourceFingerprint([b, { ...a, resource: '/_processed_/a_9876.gif' }]));
    assert.notDeepEqual(mediaSourceFingerprint([a]), mediaSourceFingerprint([{ ...a, sourceSha256: 'sha256:cc' }]));
  });
});

describe('media evidence comparison', () => {
  test('pass/pass and before/after compare the recorded source bytes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 't3u-media-'));
    try {
      const meta = async (name, mediaAdapters) => {
        await writeFile(path.join(dir, `${name}.meta.json`), JSON.stringify(mediaAdapters ? { mediaAdapters } : {}));
        return path.join(dir, `${name}.png`);
      };
      const gifA = { kind: 'gif-first-frame', resource: '/a.gif', frames: 2, sourceSha256: 'sha256:aa', sourceBytes: 5 };
      const svgB = { kind: 'svg-blend-neutralized', resource: '/b.svg', replacements: 1, sourceSha256: 'sha256:bb', sourceBytes: 9 };
      assert.equal(await mediaSourcesDiffer(await meta('one', [gifA, svgB]), await meta('two', [svgB, gifA])), null);
      assert.equal(await mediaSourcesDiffer(await meta('plain-a'), await meta('plain-b')), null, 'no adapters, nothing to compare');
      const changed = await mediaSourcesDiffer(await meta('before', [gifA]), await meta('after', [{ ...gifA, sourceSha256: 'sha256:cc' }]));
      assert.deepEqual(changed, {
        mediaSourcesA: ['gif-first-frame|sha256:aa|5'],
        mediaSourcesB: ['gif-first-frame|sha256:cc|5'],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('ImageMagick first-frame conversion (real binary)', () => {
  const tool = resolveImageMagick();
  const make = (args) => spawnSync(tool.command, args, { maxBuffer: 1 << 20 }).stdout;
  const pixel = (png, x, y) => {
    const image = PNG.sync.read(png);
    const i = (image.width * y + x) * 4;
    return { width: image.width, height: image.height, rgba: [...image.data.subarray(i, i + 4)] };
  };

  // Frame 1: 20x10 red at +10+5. Frame 2: 40x20 blue. With `-page 40x20` the logical screen is
  // 40x20; without it ImageMagick writes a 20x10 screen that frame 1 overhangs.
  const animated = (screen) => make(['-size', '40x20', 'xc:white', ...screen,
    '(', '-size', '20x10', 'xc:red', '-set', 'page', '+10+5', ')', '-delete', '0',
    '(', '-size', '40x20', 'xc:blue', ')', '-set', 'delay', '50', '-loop', '0', 'gif:-']);

  test('frame 1 on a transparent canvas of the browser size, byte-identical every run', { skip: !tool && 'ImageMagick not installed' }, async () => {
    const source = animated(['-page', '40x20+0+0']);
    assert.equal(gifFrameCount(source), 2);
    const first = await convertGifFirstFrame(source, { command: tool.command });
    const again = await convertGifFirstFrame(source, { command: tool.command });
    assert.deepEqual(first, again, 'no date chunks: identical bytes on every conversion');
    assert.deepEqual(pixel(first, 15, 10), { width: 40, height: 20, rgba: [255, 0, 0, 255] });
    assert.equal(pixel(first, 1, 1).rgba[3], 0, 'outside frame 1 stays transparent, as browsers paint it');
  });

  test('an overhanging first frame keeps the size Chromium gives the GIF', { skip: !tool && 'ImageMagick not installed' }, async () => {
    const source = animated([]);
    assert.deepEqual(gifInfo(source).canvas, { width: 30, height: 15 });
    const png = await convertGifFirstFrame(source, { command: tool.command });
    assert.deepEqual(pixel(png, 25, 12), { width: 30, height: 15, rgba: [255, 0, 0, 255] });
    assert.equal(pixel(png, 1, 1).rgba[3], 0);
  });
});

describe('stabilization profile', () => {
  const valid = {
    consent: { origin: 'https://acme.ddev.site', cookies: { consent: 'all' } },
    randomizedRegions: [{ selector: 'div.partner-logos', adr: 'ADR-004', placeholderHeight: 48, minLinks: 1, minImages: 1 }],
    media: { gifFirstFrame: { adr: 'ADR-004', command: 'convert' }, svgBlendNeutralize: { adr: 'ADR-006', modes: ['multiply'] } },
  };

  test('a complete adapter profile and a consent-only profile are accepted', () => {
    assert.equal(validateStabilizationProfile(valid), valid);
    assert.doesNotThrow(() => validateStabilizationProfile({ consent: { fallbackSelectors: ['#x'] } }));
    assert.doesNotThrow(() => validateStabilizationProfile({}));
  });

  test('every adapter needs an ADR, a supported selector and known keys', () => {
    const invalid = (profile, pattern) => assert.throws(() => validateStabilizationProfile(profile), (error) => {
      assert.ok(error instanceof HarnessError);
      assert.match(error.message, pattern);
      return true;
    });
    invalid({ randomizedRegions: [{ selector: '.logos' }] }, /randomizedRegions\[0\]\.adr/);
    invalid({ randomizedRegions: [{ selector: '.logos', adr: 'ADR-4' }] }, /\.adr must name/);
    for (const selector of ['#logos', '.a .b', 'li.logos', 'img.logo', '.logos:first-child', '']) {
      invalid({ randomizedRegions: [{ selector, adr: 'ADR-004' }] }, /selector must be/);
    }
    invalid({ randomizedRegions: [{ selector: '.logos', adr: 'ADR-004', height: 40 }] }, /height is not a known key/);
    invalid({ randomizedRegions: [{ selector: '.logos', adr: 'ADR-004', placeholderHeight: 0 }] }, /placeholderHeight/);
    invalid({ randomizedRegions: {} }, /must be a list/);
    invalid({ media: { gifFirstFrame: { adr: 'ADR-004', command: 'gm' } } }, /command must be/);
    invalid({ media: { gifFirstframe: { adr: 'ADR-004' } } }, /media\.gifFirstframe is not a known key/);
    invalid({ media: { svgBlendNeutralize: { adr: 'ADR-006', modes: ['multiply', 'multiply'] } } }, /modes must be/);
    invalid({ media: { svgBlendNeutralize: { adr: 'ADR-006', modes: ['normal'] } } }, /modes must be/);
  });

  test('the settle script embeds the regions, compiles, and seals them into the profile hash', () => {
    const script = settleScript(valid);
    assert.match(script, /const REGIONS = \[\{"selector":"div\.partner-logos","adr":"ADR-004","placeholderHeight":48,"minLinks":1,"minImages":1\}\]/);
    assert.match(settleScript({}), /const REGIONS = \[\];/);
    assert.doesNotThrow(() => new vm.Script(script), 'the page source must be valid JavaScript');
    assert.doesNotThrow(() => new vm.Script(settleScript({})));
    const other = { ...valid, randomizedRegions: [{ ...valid.randomizedRegions[0], placeholderHeight: 60 }] };
    assert.notEqual(profileHash(valid), profileHash(other));
  });
});

describe('randomized regions in server HTML', () => {
  const regions = [{ selector: '.partner-logos', adr: 'ADR-004', minLinks: 1, minImages: 1 }];
  const page = (logos, tail = 'Stable') => `<main><div class="row partner-logos"><div class="inner">${logos}</div></div>`
    + `<script>var s = "<div class=partner-logos>";</script><p>${tail}</p></main>`;
  const logo = (x) => `<a href="/partner/${x}"><img src="/logos/${x}.png" alt="${x}"></a>`;

  test('two random selections hash the same while everything around them still counts', () => {
    const a = page(logo('a') + logo('b'));
    const b = page(logo('c') + logo('a'));
    assert.equal(domHash(a, { randomizedRegions: regions }).hash, domHash(b, { randomizedRegions: regions }).hash);
    assert.notEqual(domHash(a).hash, domHash(b).hash, 'without the adapter the difference is visible');
    assert.notEqual(
      domHash(a, { randomizedRegions: regions }).hash,
      domHash(page(logo('a') + logo('b'), 'Changed'), { randomizedRegions: regions }).hash,
    );
    assert.match(canonicalizeRandomizedRegions(a, regions).html,
      /<div class="row partner-logos"><t3u-randomized-region data-selector="\.partner-logos"><\/t3u-randomized-region><\/div>/);
  });

  test('integrity is measured on the original markup', () => {
    assert.deepEqual(canonicalizeRandomizedRegions(page(logo('a')), regions).integrity, [{
      selector: '.partner-logos', adr: 'ADR-004', links: 1, images: 1, valid: true, problems: {},
      coverage: 'structure and resource integrity proven; exact selection and order not compared',
    }]);
    const broken = canonicalizeRandomizedRegions(page('<a href=""><img src=""></a><a href="/x"></a>'), regions).integrity[0];
    assert.equal(broken.valid, false);
    assert.deepEqual(broken.problems, {
      'link-without-href': 1, 'link-without-accessible-name': 2, 'image-without-alt': 1, 'image-without-url': 1,
    });
    assert.deepEqual(canonicalizeRandomizedRegions('<div class="partner-logos"></div>', regions).integrity[0].problems,
      { 'empty-region': 1, 'fewer-links-than-expected': 1, 'fewer-images-than-expected': 1 });
  });

  test('markup that cannot be balanced is refused, not guessed', () => {
    const result = canonicalizeRandomizedRegions('<div class="partner-logos"><div>x</div>', regions);
    assert.deepEqual(result.integrity[0].problems, { 'unbalanced-markup': 1 });
    assert.equal(result.html, '<div class="partner-logos"><div>x</div>', 'nothing is replaced');
    assert.deepEqual(
      canonicalizeRandomizedRegions('<ul><li class="partner-logos">x</li></ul>', regions).integrity[0].problems,
      { 'unsupported-element': 1 },
    );
  });

  test('outermost region wins and a tag-qualified selector only matches that tag', () => {
    const nested = '<section class="partner-logos"><div class="partner-logos">x</div></section>';
    const result = canonicalizeRandomizedRegions(nested, [...regions, { selector: 'div.partner-logos', adr: 'ADR-005' }]);
    assert.equal(result.integrity.length, 1);
    assert.equal(result.html, '<section class="partner-logos"><t3u-randomized-region data-selector=".partner-logos"></t3u-randomized-region></section>');
    assert.equal(canonicalizeRandomizedRegions(nested, [{ selector: 'div.partner-logos', adr: 'ADR-005' }]).html,
      '<section class="partner-logos"><div class="partner-logos"><t3u-randomized-region data-selector="div.partner-logos"></t3u-randomized-region></div></section>');
  });

  test('an unconfigured normaliser is unchanged', () => {
    const html = page(logo('a'));
    const plain = normalizeHtml(html);
    assert.deepEqual(plain.randomizedRegions, []);
    assert.equal('randomized-region' in plain.hits, false);
    assert.equal(normalizeHtml(html, { randomizedRegions: regions }).hits['randomized-region'], 1);
    assert.deepEqual(parseRegionSelector('section.teaser-random'), { tag: 'section', className: 'teaser-random' });
  });
});
