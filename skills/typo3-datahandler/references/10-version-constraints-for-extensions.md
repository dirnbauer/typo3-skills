# 10. Version Constraints for Extensions

Continues `typo3-datahandler` from [full guide](full-guide.md).

## 10. Version Constraints for Extensions

Declare the range in `composer.json`; it is the source of truth in v14:

```json
{
    "require": {
        "php": "^8.2",
        "typo3/cms-core": "^14.3"
    },
    "extra": {
        "typo3/cms": {
            "extension-key": "my_extension",
            "version": "1.0.0",
            "Package": {
                "providesPackages": {}
            }
        }
    }
}
```

- Use `^14.3`, never `^14.0`: 14.0 through 14.2 no longer receive security updates.
- `^8.2` is the TYPO3 v14 Core floor for a reusable package that tests that range; project work
  targets PHP 8.4.
- `ext_emconf.php` is deprecated since 14.2 (#108345) and no longer evaluated in v15. Do not add one;
  `extra.typo3/cms.version` and `Package.providesPackages` replace it, also in classic mode.
