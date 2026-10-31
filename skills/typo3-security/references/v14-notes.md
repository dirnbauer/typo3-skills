# TYPO3 Security v14 Notes

### MFA Failed Verification Notifications **[v14 only]**

Backend users are now **notified on failed MFA verification attempts** (#105783). This provides early warning of potential brute-force attacks against MFA-protected accounts.

### Install Tool Password via CLI **[v14 only]**

New CLI command `install:password:set` (#104058) allows setting the Install Tool password without web access. Useful for automated deployments:

```bash
vendor/bin/typo3 install:password:set
```

### Redis-Based Install Tool Sessions **[v14 only]**

Install Tool sessions can now be stored in **Redis** (#101059) instead of the filesystem. This enables Install Tool access in multi-server / shared-nothing deployments without shared filesystems.

### Stronger HMAC Algorithm **[v14 only]**

TYPO3 v14 uses a **stronger cryptographic algorithm for HMAC** (#106307). Existing HMAC tokens (e.g., in URLs, form tokens) generated with the old algorithm will be invalid after upgrade. Plan for token regeneration.

### Built-in CipherService **[v14 only]**

New `CipherService` (#108002) provides **symmetric encryption/decryption** out of the box. Use it instead of custom encryption implementations:

```php
use TYPO3\CMS\Core\Crypto\Cipher\CipherService;

$cipherService = GeneralUtility::makeInstance(CipherService::class);
$keyFactory = GeneralUtility::makeInstance(\TYPO3\CMS\Core\Crypto\Cipher\KeyFactory::class);
$key = $keyFactory->deriveSharedKeyFromEncryptionKey('my-context');
$cipherValue = $cipherService->encrypt('sensitive data', $key);
$decrypted = $cipherService->decrypt($cipherValue, $key);
```

## Credential residue in `be_users` settings (#109585)

TYPO3 12.4/13.4 EXT:setup stores an **empty** `password`/`password2` key in `be_users.uc` on every
User Settings save; 14.2 stored the **submitted plaintext** there; 14.3 no longer writes them.
`setup_userSettingsMigration` copies `uc` into the new `user_settings` JSON, and
`setup_userSettingsScrubbingMigration` removes `password`/`password2` from both.

- Run the scrubbing wizard on every upgrade to 14.3, including direct 13.4 → 14.3; never mark it
  done unrun. A plain `upgrade:run` keeps the registry order. Run one by one, keep
  `setup_userSettingsMigration` → `setup_userSettingsCleanUpMigration` →
  `setup_userSettingsScrubbingMigration`.
- The scrubber skips rows whose `user_settings` is still empty and reports success anyway. An
  out-of-order run or a later `be_users` re-sync therefore leaves residue behind a wizard marked
  done: re-run it with a reviewed `upgrade:mark:undone setup_userSettingsScrubbingMigration` and
  `upgrade:run setup_userSettingsScrubbingMigration`.
- Judge findings by value, not key: an empty value is the v12/v13 marker, a non-empty one is a
  credential exposure. Report only uid, column and whether the value is empty — never the value,
  its length or hash, or the username. For a non-empty value, force a password change and treat
  database copies taken before the scrub (DDEV snapshots, rollback dumps, staging) as holding
  secrets.

## Related Skills

- [security-incident-reporting/TYPO3](../../security-incident-reporting/SKILL-TYPO3.md) - TYPO3 forensics, vulnerability classification, Security Team communication with PGP templates
- [security-audit](../../security-audit/SKILL.md) - General security audit patterns, OWASP, CVSS scoring
