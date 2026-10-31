# 18. Package Management for v14 Compatibility

Continues `typo3-content-blocks` from [full guide](full-guide.md).

## 18. Package Management for v14 Compatibility

If extensions don't support TYPO3 v14 yet, fork and update:

```bash
# Add private fork as VCS repository in composer.json
# Then update extension for v14 using typo3-rector and typo3-v14-reference skills
```

Check Packagist before forking, and drop a fork once upstream allows `^14.3`. Status of the
webprofil packages in the webconsulting stack (Packagist, verified 2026-10-31):

| Package | Upstream release | v14 status | Fork needed |
|---|---|---|---|
| `webprofil/wp-t3monitoring-client` | 14.0.3 (2026-05-20), `typo3/cms-core ^14` since 14.0.0 | Supported | No: require `^14.0` |
| `webprofil/deployer` | 13.0.6 (2026-10-30), requires only `deployer/deployer ^7.5` | No TYPO3 constraint; Composer does not block it | No; test the deploy tasks on v14 |
| `webprofil/crawler` | 1.2.1 (2026-04-13), `^12.0 \|\| ^13.0 \|\| ^14.0` | Supported | No: require `^1.2.1` |
| `webprofil/make` | 1.1.4 (2026-01-15) and `dev-master`, `typo3/cms-core ^13.0` | Blocked; its dependency `b13/make` 0.1.8 also stops at `^13.0` | Yes, both packages, or drop it and use Content Blocks' `make:content-block` |

---
