/**
 * The URL manifest — what will be measured, how, and what will NOT be.
 *
 * Tiering exists because "compare every URL at pixel level" does not survive contact with a
 * 5,000-URL site: that is 15,000 captures per run, several times per loop. The contract is
 * kept by proving something about EVERY url and being explicit about what:
 *
 *   stage 1 (HTTP) and stage 2 (DOM): 100%, no exception
 *   stage 3 (pixels): tier 1 first, cluster representatives, then a seeded remainder
 *
 * The honesty requirement is the load-bearing part: notCaptured records the actual URL ids
 * and a reason from a fixed set — never just a count. A report that covered 60% of a site
 * and reads exactly like one that covered all of it is worse than no report.
 */

import { sha256 } from './paths.mjs';
import { sample as seededSample, shuffle } from '../util/rng.mjs';

export const MANIFEST_SCHEMA = 'typo3-upgrade-run/url-manifest@1';

export const NOT_CAPTURED_REASONS = Object.freeze([
  'visual-budget-cap', 'tier3-budget', 'cluster-represented',
  'excluded-by-config', 'guard-blocked', 'fetch-failed',
]);

/** Pages that receive first priority inside the hard pixel budget. */
export const TIER1_PATTERNS = Object.freeze([
  /^\/$/, /^\/[a-z]{2}\/?$/i,                       // homepage per language
  /404|not-?found/i, /search|suche/i, /login/i,
  /password|passwort|reset/i, /kontakt|contact|form/i,
]);

export function isTier1(url, { goldenPaths = [] } = {}) {
  let pathname;
  try { pathname = new URL(url).pathname; } catch { return false; }
  if (goldenPaths.some((g) => pathname === g || url === g)) return true;
  return TIER1_PATTERNS.some((re) => re.test(pathname));
}

/**
 * Build the manifest. `records` may carry a template signature from the DOM stage; when it
 * does, clustering collapses same-template pages onto representatives.
 */
export function buildManifest({
  baseUrl,
  allowedOrigins,
  languages = [],
  seed,
  sourceSitemaps = [],
  urls = [],
  goldenPaths = [],
  urlSources = new Map(),
  discovery = { mode: 'sitemap', degraded: false, knownLimitations: [] },
  signatures = new Map(),
  visualBudget = 360,
  lighthouseSample = 25,
  viewports = ['desktop', 'tablet', 'mobile'],
  states = ['default'],
  browser = {},
  stabilization = {},
  stabilizationProfileHash = null,
  tierPolicy = { tier1: true, clusters: true, remainderSeeded: true },
  now = () => new Date().toISOString(),
}) {
  const all = [...new Set(urls)].sort();
  const ids = new Map(all.map((u, i) => [u, `u${String(i + 1).padStart(5, '0')}`]));

  // Cluster by template signature; a URL with no signature is its own cluster.
  const clusters = new Map();
  for (const url of all) {
    const sig = signatures.get(url) ?? `solo:${url}`;
    if (!clusters.has(sig)) clusters.set(sig, []);
    clusters.get(sig).push(url);
  }

  const tier1 = all.filter((u) => isTier1(u, { goldenPaths }));
  const tier1Set = new Set(tier1);

  const clusterRecords = [];
  const representativeCandidates = new Set();
  let clusterIndex = 0;
  for (const [sig, members] of [...clusters.entries()].sort()) {
    clusterIndex += 1;
    const id = `c-${String(clusterIndex).padStart(3, '0')}`;
    // Two representatives per multi-member cluster: one is a single point of failure.
    //
    // A SINGLE-member cluster gets no mandatory representative. It represents nothing but
    // itself, so promoting it would make every URL mandatory whenever signatures are
    // absent — which is exactly the first run, before the DOM stage has produced any. That
    // would silently bypass the capture budget on the largest sites, which is the one case
    // the tiering exists for.
    const reps = members.length > 1 ? seededSample(members, 2, `${seed}:${id}`) : [];
    reps.forEach((r) => representativeCandidates.add(r));
    clusterRecords.push({
      clusterId: id,
      signatureHash: sha256(sig),
      memberCount: members.length,
      representatives: reps.map((u) => ids.get(u)),
      escalated: false,
    });
  }

  const perUrlCaptures = viewports.length * states.length;
  const maxVisualUrls = Math.floor(Math.max(0, visualBudget) / Math.max(1, perUrlCaptures));
  // Critical pages are first, then template representatives. The cap is hard: an unusually
  // broad critical/cluster set must be reported as degraded coverage, never turn a declared
  // 360-shot budget into thousands of screenshots.
  const mandatoryCandidates = [
    ...tier1,
    ...[...representativeCandidates].filter((url) => !tier1Set.has(url)).sort(),
  ];
  const selectedMandatory = mandatoryCandidates.slice(0, maxVisualUrls);
  const mandatoryDropped = mandatoryCandidates.slice(maxVisualUrls);
  const mandatory = new Set(selectedMandatory);
  const representatives = new Set(
    [...representativeCandidates].filter((url) => mandatory.has(url)),
  );
  const representativeIds = new Set([...representatives].map((url) => ids.get(url)));
  for (const cluster of clusterRecords) {
    cluster.representatives = cluster.representatives.filter((id) => representativeIds.has(id));
  }
  const droppedMandatorySet = new Set(mandatoryDropped);
  const remainder = all.filter((u) => !mandatory.has(u) && !droppedMandatorySet.has(u));

  const budgetLeft = Math.max(0, visualBudget - mandatory.size * perUrlCaptures);
  const remainderQuota = Math.floor(budgetLeft / Math.max(1, perUrlCaptures));
  const tier3 = remainderQuota > 0 ? seededSample(remainder, remainderQuota, `${seed}:tier3`) : [];
  const tier3Set = new Set(tier3);

  const visualUrls = [...mandatory, ...tier3Set].sort();

  const notCaptured = [];
  if (mandatoryDropped.length) {
    notCaptured.push({
      reason: 'visual-budget-cap', count: mandatoryDropped.length,
      url_ids: mandatoryDropped.map((u) => ids.get(u)),
    });
  }
  const clusterRepresented = remainder.filter((u) => !tier3Set.has(u) && clusters.size < all.length);
  const budgetDropped = remainder.filter((u) => !tier3Set.has(u) && !clusterRepresented.includes(u));
  if (clusterRepresented.length) {
    notCaptured.push({
      reason: 'cluster-represented', count: clusterRepresented.length,
      url_ids: clusterRepresented.map((u) => ids.get(u)),
    });
  }
  if (budgetDropped.length) {
    notCaptured.push({
      reason: 'tier3-budget', count: budgetDropped.length,
      url_ids: budgetDropped.map((u) => ids.get(u)),
    });
  }

  const lighthouseUrls = seededSample(
    [...tier1, ...visualUrls], Math.min(lighthouseSample, visualUrls.length), `${seed}:lh`,
  );

  const captures = [];
  for (const url of visualUrls) {
    for (const viewport of viewports) {
      for (const state of states) {
        captures.push({
          captureId: sha256(`${viewport} ${state} ${url}`).slice(0, 16),
          urlId: ids.get(url), viewport, state,
        });
      }
    }
  }

  const body = {
    schema: MANIFEST_SCHEMA,
    seed, seedAlgorithm: 'sfc32', shuffle: 'fisher-yates',
    baseUrl, allowedOrigins, languages,
    sourceSitemaps,
    discovery,
    allUrls: all.map((u) => ({
      id: ids.get(u), url: u,
      source: urlSources.get(u) ?? (goldenPaths.includes(u) ? 'golden' : 'sitemap'),
      tier: tier1Set.has(u) ? 1 : (representatives.has(u) ? 2 : (tier3Set.has(u) ? 3 : 0)),
    })),
    clusters: clusterRecords,
    coverage: {
      discovered: all.length,
      httpCompared: all.length,
      domCompared: all.length,
      visualCaptured: visualUrls.length,
      lighthouseSampled: lighthouseUrls.length,
      degraded: mandatoryDropped.length > 0 || budgetDropped.length > 0,
      discoveryDegraded: discovery.degraded ?? false,
      discoveryKnownLimitations: discovery.knownLimitations ?? [],
      notCaptured,
    },
    budget: {
      visualCaptureBudget: visualBudget,
      used: captures.length,
      exhausted: mandatoryDropped.length > 0 || budgetDropped.length > 0,
    },
    visualRegressionUrls: visualUrls.map((u) => ids.get(u)),
    lighthouseSampleUrls: lighthouseUrls.map((u) => ids.get(u)),
    captures,
    viewports, states, browser, stabilization,
    stabilizationProfileHash,
    tierPolicyHash: sha256(JSON.stringify(tierPolicy)),
    createdAt: now(),
  };

  return { ...body, manifestHash: `sha256:${sha256(JSON.stringify(body))}` };
}

/** A manifest is a file on disk and can be edited. Verify before trusting it. */
export function verifyManifest(manifest) {
  const { manifestHash, ...body } = manifest;
  const expected = `sha256:${sha256(JSON.stringify(body))}`;
  return { valid: manifestHash === expected, expected, actual: manifestHash };
}

export function urlById(manifest, id) {
  return manifest.allUrls.find((u) => u.id === id)?.url ?? null;
}

/** Promote a whole cluster to full capture when any member produced a stage-1/2 finding. */
export function escalateCluster(manifest, clusterId, { maxEscalation = 50 } = {}) {
  const cluster = manifest.clusters.find((c) => c.clusterId === clusterId);
  if (!cluster || cluster.escalated) return { escalated: 0 };
  cluster.escalated = true;
  const capped = Math.min(cluster.memberCount, maxEscalation);
  return { escalated: capped, capped: capped < cluster.memberCount };
}

export { shuffle };
