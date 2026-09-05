# Recipe: Override fluid_styled_content Templates

> Version: v12+

## What this builds
Custom Fluid template overrides for fluid_styled_content, replacing the default rendering of standard content elements like textmedia, header, and others.

## TypoScript — Override Template Paths

```typoscript
# Override all fluid_styled_content templates
lib.contentElement {
    templateRootPaths {
        # Default (from fluid_styled_content)
        # 0 = EXT:fluid_styled_content/Resources/Private/Templates/
        # Override with custom templates
        20 = EXT:site_package/Resources/Private/Templates/ContentElements/
    }
    partialRootPaths {
        # 0 = EXT:fluid_styled_content/Resources/Private/Partials/
        20 = EXT:site_package/Resources/Private/Partials/ContentElements/
    }
    layoutRootPaths {
        # 0 = EXT:fluid_styled_content/Resources/Private/Layouts/
        20 = EXT:site_package/Resources/Private/Layouts/ContentElements/
    }
}
```

## Override: Textmedia Content Element

File: `EXT:site_package/Resources/Private/Templates/ContentElements/Textmedia.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:layout name="Default" />

<f:section name="Main">
    <div class="ce-textmedia ce-textmedia--position-{data.imageorient}
                {f:if(condition: '{data.imagecols} > 1', then: 'ce-textmedia--gallery')}">

        <f:if condition="{data.header}">
            <f:render partial="Header/All" arguments="{_all}" />
        </f:if>

        <f:if condition="{files}">
            <div class="ce-textmedia__media ce-textmedia__media--cols-{data.imagecols}">
                <f:for each="{files}" as="file" iteration="iterator">
                    <div class="ce-textmedia__media-item">
                        <f:if condition="{file.type} == 2">
                            <f:then>
                                <figure class="ce-textmedia__figure">
                                    <f:image image="{file}"
                                             width="{f:if(condition: '{data.imagewidth}', then: '{data.imagewidth}', else: '1200')}"
                                             alt="{file.alternative}"
                                             title="{file.title}"
                                             loading="{f:if(condition: '{iterator.isFirst}', then: 'eager', else: 'lazy')}"
                                             class="ce-textmedia__image" />
                                    <f:if condition="{file.description}">
                                        <figcaption class="ce-textmedia__caption">
                                            {file.description}
                                        </figcaption>
                                    </f:if>
                                </figure>
                            </f:then>
                            <f:else if="{file.type} == 4">
                                <f:media file="{file}"
                                         width="800"
                                         alt="{file.alternative}"
                                         class="ce-textmedia__video" />
                            </f:else>
                        </f:if>
                    </div>
                </f:for>
            </div>
        </f:if>

        <f:if condition="{data.bodytext}">
            <div class="ce-textmedia__text">
                <f:format.html>{data.bodytext}</f:format.html>
            </div>
        </f:if>
    </div>
</f:section>
</html>
```

## Override: Header Partial

File: `EXT:site_package/Resources/Private/Partials/ContentElements/Header/All.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:if condition="{data.header}">
    <div class="ce-header ce-header--layout-{data.header_layout}
                {f:if(condition: '{data.header_position}', then: 'ce-header--align-{data.header_position}')}">

        <f:if condition="{data.header_layout} != 100">
            <f:variable name="headerTag">{f:if(condition: '{data.header_layout}', then: 'h{data.header_layout}', else: 'h2')}</f:variable>
            <{headerTag} class="ce-header__title">
                <f:if condition="{data.header_link}">
                    <f:then>
                        <f:link.typolink parameter="{data.header_link}">{data.header}</f:link.typolink>
                    </f:then>
                    <f:else>
                        {data.header}
                    </f:else>
                </f:if>
            </{headerTag}>
        </f:if>

        <f:if condition="{data.subheader}">
            <p class="ce-header__subtitle">{data.subheader}</p>
        </f:if>

        <f:if condition="{data.date}">
            <time class="ce-header__date"
                  datetime="{f:format.date(date: data.date, format: 'Y-m-d')}">
                <f:format.date date="{data.date}" format="%e. %B %Y" />
            </time>
        </f:if>
    </div>
</f:if>
</html>
```

## Override: Default Layout

File: `EXT:site_package/Resources/Private/Layouts/ContentElements/Default.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:if condition="{data.frame_class} != 'none'">
    <div id="c{data.uid}"
         class="ce-frame ce-frame--type-{data.CType}
                ce-frame--layout-{data.layout}
                {f:if(condition: '{data.frame_class}', then: 'ce-frame--{data.frame_class}')}
                {f:if(condition: '{data.space_before_class}', then: 'ce-frame--space-before-{data.space_before_class}')}
                {f:if(condition: '{data.space_after_class}', then: 'ce-frame--space-after-{data.space_after_class}')}"
         {f:if(condition: data._LOCALIZED_UID, then: 'data-ce-uid="{data._LOCALIZED_UID}"')}>
        <f:render section="Main" />
    </div>
</f:if>
<f:if condition="{data.frame_class} == 'none'">
    <f:render section="Main" />
</f:if>
</html>
```

## TypoScript — Add Custom Data Processing

```typoscript
# Add a custom DataProcessor to textmedia
tt_content.textmedia {
    dataProcessing {
        # FilesProcessor is already at key 10 by default
        # Add a GalleryProcessor for image grid calculations
        20 = TYPO3\CMS\Frontend\DataProcessing\GalleryProcessor
        20 {
            maxGalleryWidth = 1200
            maxGalleryWidthInText = 600
            columnSpacing = 10
            borderWidth = 0
            borderPadding = 0
            as = gallery
        }
    }
}

# Override rendering for a specific CType completely
tt_content.text {
    templateName = Text

    dataProcessing {
        10 = TYPO3\CMS\Frontend\DataProcessing\FlexFormProcessor
        10 {
            fieldName = pi_flexform
            as = flexformData
        }
    }
}
```

## Override: Bullet List Content Element

File: `EXT:site_package/Resources/Private/Templates/ContentElements/Bullets.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:layout name="Default" />

<f:section name="Main">
    <f:if condition="{data.header}">
        <f:render partial="Header/All" arguments="{_all}" />
    </f:if>

    <f:switch expression="{data.bullets_type}">
        <f:case value="0">
            <ul class="ce-bullets ce-bullets--unordered">
                <f:for each="{bullets}" as="bullet">
                    <li class="ce-bullets__item">{bullet}</li>
                </f:for>
            </ul>
        </f:case>
        <f:case value="1">
            <ol class="ce-bullets ce-bullets--ordered">
                <f:for each="{bullets}" as="bullet">
                    <li class="ce-bullets__item">{bullet}</li>
                </f:for>
            </ol>
        </f:case>
        <f:case value="2">
            <dl class="ce-bullets ce-bullets--definition">
                <f:for each="{bullets}" as="bullet">
                    <dt class="ce-bullets__term">{bullet.0}</dt>
                    <dd class="ce-bullets__definition">{bullet.1}</dd>
                </f:for>
            </dl>
        </f:case>
    </f:switch>
</f:section>
</html>
```

## Notes
- Template paths use numeric keys for priority. Higher numbers override lower numbers. The original fluid_styled_content uses key `0`, so use `20` or higher for overrides.
- Only override the templates you need to change. Unoverridden templates fall back to the original fluid_styled_content version.
- Template names must match the CType: `Textmedia.html` for `textmedia`, `Text.html` for `text`, `Bullets.html` for `bullets`, etc.
- `header_layout = 100` is the convention for "hidden header" in TYPO3. Check for it to suppress header rendering.
- `f:format.html` applies the `lib.parseFunc_RTE` processing to bodytext, which handles links, special chars, and other transformations.
- Always use `f:image` or `f:media` ViewHelpers instead of raw `<img>` tags to get proper FAL processing and crop support.
- The `data` variable contains all fields from the `tt_content` record of the current content element.
- In v13+ with PAGEVIEW, `lib.contentElement` template path configuration remains the same — only the page template resolution changes.
