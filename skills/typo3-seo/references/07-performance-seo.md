# 7. Performance SEO

Continues `typo3-seo` from [full guide](full-guide.md).

## 7. Performance SEO

### Core Web Vitals Optimization

```typoscript
# Preload critical resources
page.headerData.50 = TEXT
page.headerData.50.value (
<link rel="preload" href="/_assets/<hash>/Fonts/raleway.woff2" as="font" type="font/woff2" crossorigin>
<link rel="dns-prefetch" href="https://www.google-analytics.com">
)

# Self-host web fonts instead of fonts.googleapis.com: a CSS @import of Google Fonts is a
# render-blocking chain and sends the visitor's IP to Google (see 11-lighthouse-pass.md).

# Lazy load images (built-in TYPO3 v14)
lib.contentElement {
    settings {
        media {
            lazyLoading = lazy
        }
    }
}
```

### Image Optimization (TYPO3 v14)

```php
// config/system/additional.php
$GLOBALS['TYPO3_CONF_VARS']['GFX']['processor_allowUpscaling'] = false;

// WebP is NOT automatic in TYPO3 v14: GFX/imageFileConversionFormats (Feature #93981)
// defaults to keeping the original format. Opt in explicitly, e.g.:
$GLOBALS['TYPO3_CONF_VARS']['GFX']['imageFileConversionFormats'] = [
    'jpg' => 'webp',
];
// WebP output itself is available since v13 (Feature #88537) when
// ImageMagick/GraphicsMagick supports it.
// Existing processed files keep their format: TYPO3 reuses a processed file whose processing
// configuration is unchanged. After switching, run once per environment:
//   vendor/bin/typo3 cleanup:localprocessedfiles --all --force && vendor/bin/typo3 cache:flush
// Keep og:image as JPEG for social networks: f:uri.image(..., fileExtension: 'jpg').
```

> **Responsive images:** configure image processing via your site package, `fluid_styled_content`, and FAL — there is no stable Core TypoScript path `tt_content.image.settings.responsive_image_rendering`; avoid copy-pasting fabricated keys.
