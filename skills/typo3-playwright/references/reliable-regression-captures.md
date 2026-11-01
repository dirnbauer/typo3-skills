# Reliable regression captures

Parent: [typo3-playwright](../SKILL.md). Read for paired staging/live captures,
large screenshot sets, strict image readiness or lossless image archives.
The calling update workflow owns deployment, URL coverage and report retention.

## Paired evidence

Freeze exact URLs, viewport/device parameters, locale, timezone, consent state,
fonts and browser/container versions before comparing. Capture the broad live
baseline before merge or deployment; use the identical selection afterward.
Keep the small staging comparison separate from that broader live comparison.
Do not re-resolve dependencies during promotion: verify the exact tested code.

## Every selected page must finish rendering

When complete image loading is required, a warning or a known broken baseline
image cannot count as a passed capture. Report the page, affected asset and next
action, and stop acceptance until the required rendering is proved.

- Scroll the full page to activate lazy loaders, wait for stable dimensions,
  then return to the declared capture position. Repeat discovery after scrolling
  and component activation so newly inserted images are included.
- Check `picture`/`srcset` through the selected `currentSrc`, nonzero intrinsic
  dimensions and successful `decode()`. Preserve decode rejection and timeout;
  catching them and counting the image as loaded is insufficient.
- Check rendered CSS background URLs, including pseudo-elements and image-set
  choices, and wait for their decoding. HTTP success alone is not pixel proof.
- Wait for the required fonts and stable layout. A generic network-idle wait
  cannot replace these checks on pages with analytics or long-lived connections.
- Distinguish intentionally inactive content from missing visible media. A
  consent-blocked embed may correctly show its placeholder before consent;
  exercise its allowed activation separately. Do not silently remove it.

Run real next/previous and keyboard journeys for each present carousel family.
Use fresh contexts for consent rejection and acceptance, then reopen settings
and verify the actual tracking consequence with external delivery intercepted.
Stabilising autoplay on a first slide or masking an external moving frame is
only rendering preparation; it cannot prove the component works. Inventory
unrecognised components and retain the gap until a real journey covers them.

## Faster captures with bounded load

Reuse the installed Playwright runner and pinned browser. Keep browser processes
warm while isolating cookies and state in fresh contexts. Start with four read
workers on an adequately provisioned runner; benchmark a higher count against
the same representative URL set, including long pages and lazy backgrounds.
Respect CPU, memory, shared-memory and per-origin request limits. Record elapsed
time, peak memory, errors and expected/completed captures; more concurrency is
accepted only if it preserves complete and reproducible results. Do not turn a
shared-runner limit into unlimited workers or assume a hosted service is faster.

Keep write journeys isolated by fixture and keep Lighthouse in a quiet window.
Bound image-encoding workers separately so compression does not starve captures.
Retain first failures; retry only classified transport failures with the same
inputs and the calling workflow's retry budget.

## Lossless AVIF evidence

Verify the installed screenshot API. Capture a supported lossless format first,
then encode AVIF using an explicit lossless codec, full-resolution chroma and a
reversible colour conversion appropriate to the source bit depth. A quality
value of 100 alone is not proof of unchanged RGB or alpha.

Decode the result and compare dimensions and the complete pixel array, including
alpha, against the captured source. Record file hashes, decoded-pixel hashes,
encoder/decoder versions, settings, byte sizes and timings. Test display with the
supported browser decoder as well. Preserve the source and report failure if any
pixel changes or the archived image cannot be decoded. Delete temporary source
files only after verification and durable storage of the complete evidence.

Benchmark actual full-page captures: lossless AVIF is not guaranteed smaller than
PNG, and encoding cost belongs in the capacity budget. Honour an explicit AVIF
requirement; do not silently substitute lossy images to meet a size target.

Sources: [Playwright screenshots](https://playwright.dev/docs/screenshots),
[parallelism](https://playwright.dev/docs/test-parallel), and
[libavif encoder](https://github.com/AOMediaCodec/libavif/blob/main/apps/avifenc.c).
