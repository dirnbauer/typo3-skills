# TYPO3 Security Checklists

## Login Rate Limiting

Core limits failed logins since v11.3 (#93825); v14 changed nothing here:

```php
// config/system/additional.php
// Login rate limits exist for BE (default 5) and FE (default 10) per `loginRateLimitInterval`,
// with `loginRateLimitIpExcludeList`; there is no `security.backend.rateLimiter` feature toggle (14.3.9)

// Configure rate limits
$GLOBALS['TYPO3_CONF_VARS']['BE']['loginRateLimit'] = 5;  // max attempts per `loginRateLimitInterval` (Core default '15 minutes' in 14.3.9), not per minute
```

## Security Audit Checklist

### Before Go-Live

- [ ] `displayErrors` = 0
- [ ] `debug` = false (BE and FE)
- [ ] `trustedHostsPattern` configured
- [ ] Install Tool disabled
- [ ] HTTPS enforced at the edge (web server / proxy); `BE.lockSSL` set for the backend (`lockSSL` is BE-only)
- [ ] Strong backend passwords (12+ chars)
- [ ] MFA enabled for admins
- [ ] File permissions correct
- [ ] Sensitive directories protected
- [ ] Error logs to files, not screen
- [ ] Encryption key unique
- [ ] CSP enabled
- [ ] Rate limiting enabled

### Regular Maintenance

- [ ] Update TYPO3 core monthly
- [ ] Update extensions monthly
- [ ] Review security bulletins (https://typo3.org/security)
- [ ] Audit backend user accounts
- [ ] Review access logs
- [ ] Test backup restoration

### Monitoring

- [ ] Set up uptime monitoring
- [ ] Configure error alerting
- [ ] Monitor authentication failures
- [ ] Track file integrity (optional)

## Security Resources

- **TYPO3 Security**: https://typo3.org/security (advisories, team contact, coordinated releases)
- **Security Guide**: https://docs.typo3.org/m/typo3/reference-coreapi/main/en-us/Security/Index.html
- **v14 changelog index**: https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog-14.html

The v14-only security changes (HMAC algorithm, `CipherService`, MFA notifications, Install Tool
CLI and sessions, credential residue) are collected in [v14-notes.md](v14-notes.md).
