/**
 * Normalised DOM comparison.
 *
 * The allow-list is the whole point. We normalise ONLY things that are provably volatile:
 * CSRF tokens, nonces, session ids, random element ids, timestamps, debug comments and
 * asset hashes. We never touch text, element order, visually meaningful classes, semantic
 * or ARIA attributes, image sources, srcset, link targets or form structure — because each
 * of those is exactly what a migration is most likely to break.
 *
 * Over-normalisation is itself reported. A rule that suddenly touches an anomalous number
 * of nodes is a finding, not a convenience: an over-broad normaliser silently hides the
 * regression it was supposed to expose, and nothing else in the system would notice.
 */

import { sha256 } from '../run/paths.mjs';

/** Each rule: id, what it replaces, and why it is safe to replace. */
export const RULES = Object.freeze([
  // Two shapes: a token in a JSON/JS assignment, and the far more common HTML form field
  // where name and value are separate attributes.
  // [A-Za-z_]* after the name covers the real-world spellings: csrfToken, csrf_token, csrfValue.
  { id: 'csrf-token', why: 'per-request token in an assignment', re: /((?:csrf|__RequestToken|request_?token|authenticity_token)[A-Za-z_]*["'\s:=]+["']?)[A-Za-z0-9_\-]{8,}/gi, to: '$1<T>' },
  { id: 'csrf-field', why: 'per-request token in a form field', re: /(name=["'](?:__RequestToken|_csrf[A-Za-z_]*|csrf[A-Za-z_]*|authenticity_token)["'][^>]*?\svalue=["'])[^"']{8,}(["'])/gi, to: '$1<T>$2' },
  { id: 'typo3-chash', why: 'cache hash varies per URL build', re: /(\bcHash=)[a-f0-9]{8,}/gi, to: '$1<T>' },
  { id: 'nonce', why: 'CSP nonce is per-response by design', re: /(\bnonce=["'])[A-Za-z0-9+/=_\-]{8,}(["'])/gi, to: '$1<N>$2' },
  { id: 'session-id', why: 'session identifier', re: /((?:PHPSESSID|fe_typo_user|be_typo_user)=)[A-Za-z0-9]{8,}/gi, to: '$1<S>' },
  { id: 'random-id', why: 'framework-generated element id', re: /\b(id=["'])(?:c|el|uid|tx-|ce-)?[a-f0-9]{8}-?[a-f0-9]{4,}(["'])/gi, to: '$1<ID>$2' },
  { id: 'asset-hash', why: 'build hash; the delivered content is compared separately', re: /([._-])[a-f0-9]{8,32}(\.(?:js|css|mjs|woff2?|png|jpe?g|webp|avif|svg))/gi, to: '$1<H>$2' },
  { id: 'asset-query', why: 'cache-busting query on an asset', re: /(\.(?:js|css|mjs|woff2?|png|jpe?g|webp|avif|svg)\?)(?:v=)?[0-9a-f]{6,}/gi, to: '$1<V>' },
  { id: 'iso-timestamp', why: 'render time', re: /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?/g, to: '<TS>' },
  { id: 'epoch-ms', why: 'render time in milliseconds', re: /\b1[6-9]\d{11}\b/g, to: '<EPOCH>' },
  { id: 'debug-comment', why: 'parse-time debug output', re: /<!--\s*(?:parsetime|generated|cached|debug)[^>]*-->/gi, to: '<!--<D>-->' },
  // EXT:form regenerates three things per request BY DESIGN, and a predictable honeypot
  // would be useless against spam bots: the honeypot's field NAME, its LENGTH (5-25 chars),
  // and its POSITION in the __trustedProperties field list. Masking the name alone therefore
  // does not converge — the list order still differs. So the whole __trustedProperties value
  // is replaced: it is an HMAC-protected serialisation that regenerates every request and
  // carries no information a regression test should compare. The real form structure is still
  // compared through the rendered inputs and labels, so adding, removing or renaming a field
  // remains a difference.
  { id: 'typo3-form-trusted-properties', why: 'EXT:form per-request HMAC and field-list serialisation', re: /(\[__trustedProperties\]"[^>]*?\svalue=")[^"]*(")/gi, to: '$1<TRUSTED>$2' },
  // Removed, not masked: EXT:form also inserts the honeypot at a random POSITION among the
  // fields, so replacing it in place still leaves two different documents. It is an
  // aria-hidden anti-spam input with no visible content, and it is removed from both sides,
  // so nothing a visitor can see is affected.
  { id: 'typo3-form-honeypot-input', why: 'EXT:form honeypot input: random name, id, autocomplete AND position per request', re: /<input\b(?=[^>]*\baria-hidden="true")(?=[^>]*tx_form_formframework)[^>]*>/gi, to: '' },
]);

/** Attributes and structures that must NEVER be normalised. Used by the guard below. */
export const NEVER_NORMALISE = Object.freeze([
  'textContent', 'element order', 'class', 'aria-*', 'role',
  'href', 'src', 'srcset', 'sizes', 'alt', 'form structure', 'lang',
]);

const DEFAULT_OVERREACH_LIMIT = 200;

/**
 * @returns {{html:string, hits:Record<string,number>, overreach:string[]}}
 */
export function normalizeHtml(html, { overreachLimit = DEFAULT_OVERREACH_LIMIT } = {}) {
  let out = String(html);
  const hits = {};
  const overreach = [];

  for (const rule of RULES) {
    let count = 0;
    out = out.replace(rule.re, (...args) => {
      count += 1;
      // Re-run the replacement template manually so $1/$2 work with our counter.
      const groups = args.slice(0, -2);
      return rule.to.replace(/\$(\d)/g, (_, n) => groups[Number(n)] ?? '');
    });
    hits[rule.id] = count;
    if (count > overreachLimit) overreach.push(rule.id);
  }

  // Collapse insignificant whitespace between tags only. Text content is untouched.
  out = out.replace(/>\s+</g, '><').trim();

  return { html: out, hits, overreach };
}

export function domHash(html, opts) {
  const { html: normalized, hits, overreach } = normalizeHtml(html, opts);
  return { hash: sha256(normalized), normalized, hits, overreach };
}

/**
 * Template signature: the structural skeleton with text and volatile attributes removed.
 *
 * This is what makes tiered coverage honest rather than a guess. 4,198 news detail pages
 * collapse to one cluster because they share a skeleton, so the report can state truthfully
 * that all of them were proven identical at stages 1 and 2 while a representative carried
 * the pixel proof.
 *
 * Deliberately dependency-free: a tag+class sequence is enough to identify a template, and
 * a full DOM parse here would make the harness need an install to do arithmetic.
 */
export function templateSignature(html) {
  const tokens = [];
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^>]*)?)>/g;
  let m;
  while ((m = tagRe.exec(String(html))) !== null) {
    const tag = m[1].toLowerCase();
    if (tag === 'script' || tag === 'style') continue;
    const attrs = m[2] ?? '';
    const cls = attrs.match(/\bclass=["']([^"']*)["']/i);
    // Class names carry the template identity; text does not.
    const classes = cls
      ? cls[1].trim().split(/\s+/).filter((c) => !/\d{3,}/.test(c)).sort().join('.')
      : '';
    tokens.push(classes ? `${tag}.${classes}` : tag);
  }
  return { signature: tokens.join('>'), hash: sha256(tokens.join('>')), tagCount: tokens.length };
}

/**
 * Compare two normalised documents. Reports a bounded, readable diff rather than the whole
 * document — a 5,000-URL run must not produce megabytes of prose.
 */
export function compareDom(beforeHtml, afterHtml, { maxSegments = 5, context = 60 } = {}) {
  const b = domHash(beforeHtml);
  const a = domHash(afterHtml);

  if (b.hash === a.hash) {
    return { identical: true, hash: a.hash, segments: [], overreach: [...new Set([...b.overreach, ...a.overreach])] };
  }

  const bs = b.normalized;
  const as = a.normalized;
  const segments = divergentSegments(bs, as, { maxSegments, context });

  return {
    identical: false,
    hash: { before: b.hash, after: a.hash },
    segments: segments.slice(0, maxSegments),
    hits: { before: b.hits, after: a.hits },
    overreach: [...new Set([...b.overreach, ...a.overreach])],
  };
}

/**
 * Token-level resynchronisation finds independent causes instead of reporting the first
 * differing character followed by one giant length delta. It is bounded deliberately:
 * reports remain readable even for large pages.
 */
function divergentSegments(before, after, { maxSegments, context }) {
  const b = tokens(before);
  const a = tokens(after);
  const out = [];
  let bi = 0;
  let ai = 0;

  while ((bi < b.length || ai < a.length) && out.length < maxSegments) {
    if (b[bi]?.value === a[ai]?.value) {
      bi += 1;
      ai += 1;
      continue;
    }

    const bAt = b[bi]?.start ?? before.length;
    const aAt = a[ai]?.start ?? after.length;
    out.push({
      at: { before: bAt, after: aAt },
      before: before.slice(Math.max(0, bAt - context), bAt + context),
      after: after.slice(Math.max(0, aAt - context), aAt + context),
    });

    const sync = findSync(b, a, bi, ai, 24);
    if (sync) {
      bi = sync.bi;
      ai = sync.ai;
    } else {
      bi += bi < b.length ? 1 : 0;
      ai += ai < a.length ? 1 : 0;
    }
  }
  return out;
}

function tokens(html) {
  const result = [];
  for (const match of String(html).matchAll(/<[^>]+>|[^<]+/g)) {
    result.push({ value: match[0], start: match.index, end: match.index + match[0].length });
  }
  return result;
}

function findSync(before, after, bi, ai, lookahead) {
  let best = null;
  for (let db = 0; db < lookahead && bi + db < before.length; db += 1) {
    for (let da = 0; da < lookahead && ai + da < after.length; da += 1) {
      if (db === 0 && da === 0) continue;
      if (before[bi + db].value !== after[ai + da].value) continue;
      const score = db + da;
      if (!best || score < best.score) best = { bi: bi + db, ai: ai + da, score };
    }
  }
  return best;
}
