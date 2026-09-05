# Recipe: IMAGE cObject and Responsive Images

> Version: v12+

## What this builds
Responsive image rendering using the IMAGE cObject with srcset, picture element approaches, and crop variants for art direction.

## TypoScript — Basic IMAGE cObject

```typoscript
lib.headerImage = IMAGE
lib.headerImage {
    file {
        import.data = levelmedia:-1, slide
        treatIdAsReference = 1
        width = 1200c
        height = 400c
    }

    altText.data = levelmedia:-1, slide
    titleText.data = levelmedia:-1, slide

    # Add CSS class
    params = class="header-image"

    # Wrap in figure element
    stdWrap.wrap = <figure class="header-figure">|</figure>
}
```

## TypoScript — Responsive Images with srcset

```typoscript
lib.responsiveImage = IMAGE
lib.responsiveImage {
    file {
        import.data = file:current:uid
        treatIdAsReference = 1
        width = 1200
    }

    altText.data = file:current:alternative
    titleText.data = file:current:title

    # srcset for responsive images
    sourceCollection {
        small {
            width = 400
            srcsetCandidate = 400w
            mediaQuery = (max-width: 480px)
            dataKey = small
        }
        medium {
            width = 800
            srcsetCandidate = 800w
            mediaQuery = (max-width: 768px)
            dataKey = medium
        }
        large {
            width = 1200
            srcsetCandidate = 1200w
            mediaQuery = (max-width: 1200px)
            dataKey = large
        }
        xlarge {
            width = 1600
            srcsetCandidate = 1600w
            mediaQuery = (min-width: 1201px)
            dataKey = xlarge
        }
    }

    # Output as <picture> element
    layoutKey = srcset
}
```

## TypoScript — imgResource for processed file URLs

```typoscript
lib.processedImageUrl = IMG_RESOURCE
lib.processedImageUrl {
    file {
        import.data = file:current:uid
        treatIdAsReference = 1
        width = 600c
        height = 400c
    }

    stdWrap.wrap = <div class="background" style="background-image: url('|');"></div>
}
```

## Fluid Template — Responsive Images with ViewHelper

File: `EXT:site_package/Resources/Private/Partials/Media/ResponsiveImage.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:comment><!-- Simple responsive image with f:image --></f:comment>
<f:image image="{file}"
         width="1200"
         alt="{file.alternative}"
         title="{file.title}"
         class="img-fluid"
         loading="lazy" />

<f:comment><!-- Picture element with multiple sources for art direction --></f:comment>
<picture>
    <source media="(min-width: 1200px)"
            srcset="{f:uri.image(image: file, width: '1600c', height: '600c', cropVariant: 'desktop')}" />
    <source media="(min-width: 768px)"
            srcset="{f:uri.image(image: file, width: '1024c', height: '500c', cropVariant: 'tablet')}" />
    <f:image image="{file}"
             width="768c"
             height="500c"
             cropVariant="mobile"
             alt="{file.alternative}"
             loading="lazy"
             class="img-fluid" />
</picture>

<f:comment><!-- srcset with sizes attribute --></f:comment>
<img srcset="{f:uri.image(image: file, width: '400')} 400w,
             {f:uri.image(image: file, width: '800')} 800w,
             {f:uri.image(image: file, width: '1200')} 1200w,
             {f:uri.image(image: file, width: '1600')} 1600w"
     sizes="(max-width: 480px) 400px,
            (max-width: 768px) 800px,
            (max-width: 1200px) 1200px,
            1600px"
     src="{f:uri.image(image: file, width: '1200')}"
     alt="{file.alternative}"
     loading="lazy"
     class="img-fluid" />
</html>
```

## Crop Variant Configuration (TCA)

This is configured in `ext_localconf.php` or `Configuration/TCA/Overrides/sys_file_reference.php`:

```php
$GLOBALS['TCA']['sys_file_reference']['columns']['crop']['config']['cropVariants'] = [
    'desktop' => [
        'title' => 'Desktop',
        'allowedAspectRatios' => [
            '16:9' => [
                'title' => '16:9',
                'value' => 16 / 9,
            ],
            '21:9' => [
                'title' => '21:9',
                'value' => 21 / 9,
            ],
        ],
        'selectedRatio' => '16:9',
    ],
    'tablet' => [
        'title' => 'Tablet',
        'allowedAspectRatios' => [
            '4:3' => [
                'title' => '4:3',
                'value' => 4 / 3,
            ],
        ],
        'selectedRatio' => '4:3',
    ],
    'mobile' => [
        'title' => 'Mobile',
        'allowedAspectRatios' => [
            '1:1' => [
                'title' => '1:1',
                'value' => 1.0,
            ],
            '3:4' => [
                'title' => '3:4',
                'value' => 3 / 4,
            ],
        ],
        'selectedRatio' => '1:1',
    ],
];
```

## TypoScript — Content Element Image Rendering Override

```typoscript
# Override default image rendering for textmedia CE
tt_content.textmedia {
    dataProcessing {
        10 = TYPO3\CMS\Frontend\DataProcessing\FilesProcessor
        10 {
            references.fieldName = assets
            as = files
        }
    }
}

# Custom image rendering configuration
lib.contentElement.settings.media {
    popup {
        # Disable click-enlarge
        enabled = 0
    }
    gallery {
        columnSpacing = 10
        rows {
            horizontal {
                borderWidth = 0
                borderPadding = 0
            }
        }
    }
}
```

## Notes
- The `sourceCollection` approach generates `srcset` or `<picture>` markup depending on the `layoutKey` setting.
- Valid `layoutKey` values: `default` (plain `<img>`), `srcset` (img with srcset), `picture` (picture element), `data` (data-attributes for JS).
- `treatIdAsReference = 1` is required when working with FAL file references (sys_file_reference UIDs) instead of sys_file UIDs.
- Crop variants define named crop areas in TCA. Reference them via `cropVariant` in Fluid or TypoScript.
- `width = 1200c` means crop-and-scale to 1200px. Without `c`, the image is scaled proportionally. Use `m` for max-width/max-height scaling.
- `loading="lazy"` is natively supported since v11. Avoid it for above-the-fold images (hero, header).
- For WebP conversion, configure `$GLOBALS['TYPO3_CONF_VARS']['GFX']['imagefile_ext']` to include `webp` and use ImageMagick/GraphicsMagick with WebP support.
- In v12+, the `FilesProcessor` is the standard way to make file references available in Fluid templates.
