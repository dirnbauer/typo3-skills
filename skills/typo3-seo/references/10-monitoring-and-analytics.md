# 10. Monitoring & Analytics

Continues `typo3-seo` from [full guide](full-guide.md).

## 10. Monitoring & Analytics

### Google Search Console

1. Verify the domain through DNS or the HTML file method; TYPO3 can serve the verification file from `public/` without a page record.
2. Submit `https://example.com/sitemap.xml`; every site language with its own base needs its own property or sitemap entry.
3. Watch the "Pages" report for `Duplicate without user-selected canonical`: in TYPO3 that is usually a page reachable under two paths (missing redirect, `?type=` or `cHash` variants, or a second site language without `hreflang`).
4. Watch Core Web Vitals and re-run the [Lighthouse pass](11-lighthouse-pass.md) after each deployment that touches templates or assets.

### Analytics and consent

An analytics snippet loaded unconditionally from TypoScript `headerData` sets cookies before consent
and is not GDPR compliant on its own. Load the tag from the consent extension the project already
uses (its template or TypoScript hook fires only after the visitor opted in), keep the measurement
ID in the site settings rather than in the template, and prove with a fresh browser profile that no
analytics request leaves before consent. Removing a tag that was placed in TypoScript is part of the
Lighthouse pass, because it is also a render-blocking third-party request.
