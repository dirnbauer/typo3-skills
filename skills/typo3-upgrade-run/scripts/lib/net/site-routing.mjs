/**
 * Site configuration as URL facts for page-tree discovery.
 *
 * `base + slug` is not the URL a visitor requests. The site language adds its base (`/en/`) and a
 * PageType route enhancer adds its suffix (`/` or `.html`); both live in config/sites/<id>/config.yaml.
 * Only paths are taken from it: the run measures one local origin, whatever production host the
 * file names. Among `base` and `baseVariants`, the variant on the run's origin wins, so variant
 * conditions never need evaluating.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const ENV_PLACEHOLDER = /%env\([^)]*\)%/g;

export async function readSiteConfigs(root) {
  const dir = path.join(root, 'config', 'sites');
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const configs = [], warnings = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    try {
      configs.push({ identifier: entry.name, config: parseYaml(await readFile(path.join(dir, entry.name, 'config.yaml'), 'utf8')) ?? {} });
    } catch (error) {
      warnings.push(`site ${entry.name}: config.yaml unreadable (${error.message.split('\n')[0]}); its language bases and suffix are not applied`);
    }
  }
  return { configs, warnings };
}

/** The default suffix of the site's one PageType enhancer; none, or more than one, adds nothing. */
export function pageTypeSuffix(routeEnhancers) {
  const pageTypes = Object.values(routeEnhancers ?? {}).filter((enhancer) => enhancer?.type === 'PageType');
  return pageTypes.length === 1 ? String(pageTypes[0].default ?? '') : '';
}

/**
 * Per site: root page, suffix and, per language, the path prefix on the run's origin. A relative
 * language base extends the site base (TYPO3's rule); an absolute one stands alone and must be on
 * the run's origin or one of the site's own hosts, otherwise the language is unreachable here.
 * `servedHere` is narrower: a site whose every base names another host is served elsewhere, so a
 * request for its sitemap here would fail; only its languages based on this origin are served here.
 */
export function siteRouting(configs, runBase) {
  const origin = new URL(runBase).origin;
  return configs.map(({ identifier, config }) => {
    const siteBase = localBase(config, origin);
    const bases = baseCandidates(config).map(absoluteOrigin);
    const siteOrigins = new Set([origin, ...bases.filter(Boolean)]);
    // A relative base, or a host behind an unresolved placeholder, may well be this origin.
    const siteHere = !bases.length || bases.some((base) => base === null || base === origin);
    const languages = Array.isArray(config?.languages) ? config.languages : [];
    const pageTypes = Object.values(config?.routeEnhancers ?? {}).filter((enhancer) => enhancer?.type === 'PageType').length;
    const warnings = [];
    if (pageTypes > 1) warnings.push(`site ${identifier} has ${pageTypes} PageType enhancers; no suffix is applied`);
    if (!pageTypes && Array.isArray(config?.imports) && config.imports.length) {
      warnings.push(`site ${identifier} imports configuration that is not followed; a PageType suffix defined there is not applied`);
    }
    return {
      identifier,
      rootPageId: Number(config?.rootPageId),
      suffix: pageTypeSuffix(config?.routeEnhancers),
      warnings,
      languages: languages.map((language) => {
        const languageBase = localBase(language, origin);
        const routed = languagePrefix(siteBase, languageBase, siteOrigins);
        return {
          languageId: Number(language?.languageId),
          enabled: language?.enabled !== false,
          codes: languageCodes(language),
          ...routed,
          servedHere: routed.prefix !== null && (siteHere || absoluteOrigin(languageBase) === origin),
        };
      }),
    };
  });
}

/** What a --languages value may name: languageId, iso-639-1/twoLetterIsoCode, hreflang, locale or base segment. */
export function languageCodes(language) {
  const codes = new Set([String(language?.languageId)]);
  for (const key of ['iso-639-1', 'twoLetterIsoCode', 'hreflang', 'locale']) {
    const value = String(language?.[key] ?? '').trim().toLowerCase();
    if (value) codes.add(value).add(value.split(/[-_.]/)[0]);
  }
  const segment = pathOf(String(language?.base ?? '')).split('/').find(Boolean);
  if (segment) codes.add(segment.toLowerCase());
  return codes;
}

/** The language prefix plus the slug; the suffix goes on every page except a root. */
export function pagePath(prefix, slug, suffix = '') {
  const rest = String(slug).replace(/^\/+/, '');
  if (!rest) return prefix;
  return suffix ? `${prefix}${rest.replace(/\/+$/, '')}${suffix}` : `${prefix}${rest}`;
}

function languagePrefix(siteBase, languageBase, siteOrigins) {
  const bare = languageBase.replace(ENV_PLACEHOLDER, '').trim();
  if (!bare) return { prefix: null, unreachable: `based on the unresolved placeholder ${languageBase}` };
  const languageOrigin = absoluteOrigin(languageBase);
  if (languageOrigin && !siteOrigins.has(languageOrigin)) return { prefix: null, unreachable: `served from ${languageOrigin}` };
  // An absolute base stands alone, even with a placeholder host; a relative one extends the site base.
  return { prefix: slashed(hasScheme(bare) ? pathOf(bare) : `${pathOf(siteBase)}/${bare}`) };
}

function baseCandidates(entry) {
  const variants = Array.isArray(entry?.baseVariants) ? entry.baseVariants.map((variant) => variant?.base) : [];
  return [entry?.base, ...variants].filter((base) => typeof base === 'string' && base.trim());
}

function localBase(entry, origin) {
  const candidates = baseCandidates(entry);
  return candidates.find((base) => absoluteOrigin(base) === origin) ?? candidates[0] ?? '/';
}

const hasScheme = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value));

function absoluteOrigin(value) {
  if (!hasScheme(value)) return null;
  try { return new URL(value).origin; } catch { return null; }
}

/** The path of a base. A placeholder stands for scheme and host, so what remains is a path. */
function pathOf(base) {
  const value = String(base).replace(ENV_PLACEHOLDER, '');
  return hasScheme(value) ? value.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '') || '/' : value;
}

/** One leading and one trailing slash: '' → '/', 'en' → '/en/', '//a//b' → '/a/b/'. */
function slashed(value) {
  const inner = String(value).split('/').filter(Boolean).join('/');
  return inner ? `/${inner}/` : '/';
}
