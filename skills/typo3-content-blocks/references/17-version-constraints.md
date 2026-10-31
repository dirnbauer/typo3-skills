# 17. Version constraints

Continues `typo3-content-blocks` from [full guide](full-guide.md).

## 17. Version constraints

Use **TYPO3 v14.3+** with **Content Blocks 2.x**. Checked on [Packagist](https://packagist.org/packages/friendsoftypo3/content-blocks)
2026-10-31: the newest release is 2.4.10 (2026-09-22), requiring `typo3/cms-core: ^14.3.7` and PHP `^8.2`;
2.4.8 requires `^14.3.5` and 2.4.7 `^14.3`. Recent releases raise the Core patch floor, so read the
constraint of the release Composer selects.

```json
{
    "require": {
        "typo3/cms-core": "^14.3",
        "friendsoftypo3/content-blocks": "^2.4"
    }
}
```

`ext_emconf.php` is deprecated in v14; keep it only while a release still has to ship it, with the
same ranges as Composer:

```php
// ext_emconf.php — TYPO3 v14.3+ + Content Blocks 2.x
'depends' => [
    'typo3' => '14.3.0-14.99.99',
    'content_blocks' => '2.0.0-2.99.99',
],
```

---
