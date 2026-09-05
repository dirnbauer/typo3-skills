# Recipe: Custom Content Element from Scratch

> Version: v12+

## What this builds
A complete custom content element "Team Member Card" with TCA registration, database fields, TypoScript rendering with DataProcessors, and Fluid template.

## Database Schema

File: `EXT:site_package/ext_tables.sql`
```sql
CREATE TABLE tt_content (
    tx_sitepackage_person_name varchar(255) DEFAULT '' NOT NULL,
    tx_sitepackage_person_position varchar(255) DEFAULT '' NOT NULL,
    tx_sitepackage_person_email varchar(255) DEFAULT '' NOT NULL,
    tx_sitepackage_person_phone varchar(100) DEFAULT '' NOT NULL,
    tx_sitepackage_person_linkedin varchar(255) DEFAULT '' NOT NULL,
);
```

## TCA — Register Content Element Type

File: `EXT:site_package/Configuration/TCA/Overrides/tt_content.php`
```php
<?php

declare(strict_types=1);

use TYPO3\CMS\Core\Utility\ExtensionManagementUtility;

defined('TYPO3') or die();

// Register the CType
ExtensionManagementUtility::addTcaSelectItem(
    'tt_content',
    'CType',
    [
        'label' => 'LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:ctype.team_member',
        'value' => 'sitepackage_team_member',
        'icon' => 'content-person',
        'group' => 'special',
    ]
);

// Configure fields for this CType
$GLOBALS['TCA']['tt_content']['types']['sitepackage_team_member'] = [
    'showitem' => '
        --div--;LLL:EXT:core/Resources/Private/Language/locallang_general.xlf:LGL.type,
            CType,
        --div--;LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:tab.person,
            tx_sitepackage_person_name,
            tx_sitepackage_person_position,
            tx_sitepackage_person_email,
            tx_sitepackage_person_phone,
            tx_sitepackage_person_linkedin,
            --linebreak--,
            image,
            bodytext;LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:field.biography,
        --div--;LLL:EXT:frontend/Resources/Private/Language/locallang_ttc.xlf:tabs.appearance,
            --palette--;;frames,
            --palette--;;appearanceLinks,
        --div--;LLL:EXT:core/Resources/Private/Language/locallang_general.xlf:LGL.access,
            --palette--;;hidden,
            --palette--;;access,
    ',
    'columnsOverrides' => [
        'bodytext' => [
            'config' => [
                'enableRichtext' => true,
                'richtextConfiguration' => 'minimal',
            ],
        ],
        'image' => [
            'config' => [
                'maxitems' => 1,
                'overrideChildTca' => [
                    'columns' => [
                        'crop' => [
                            'config' => [
                                'cropVariants' => [
                                    'default' => [
                                        'title' => 'Portrait',
                                        'allowedAspectRatios' => [
                                            '1:1' => [
                                                'title' => '1:1',
                                                'value' => 1.0,
                                            ],
                                        ],
                                        'selectedRatio' => '1:1',
                                    ],
                                ],
                            ],
                        ],
                    ],
                ],
            ],
        ],
    ],
];

// Configure custom columns
$additionalColumns = [
    'tx_sitepackage_person_name' => [
        'label' => 'LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:field.person_name',
        'config' => [
            'type' => 'input',
            'size' => 50,
            'max' => 255,
            'required' => true,
        ],
    ],
    'tx_sitepackage_person_position' => [
        'label' => 'LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:field.person_position',
        'config' => [
            'type' => 'input',
            'size' => 50,
            'max' => 255,
        ],
    ],
    'tx_sitepackage_person_email' => [
        'label' => 'LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:field.person_email',
        'config' => [
            'type' => 'email',
        ],
    ],
    'tx_sitepackage_person_phone' => [
        'label' => 'LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:field.person_phone',
        'config' => [
            'type' => 'input',
            'size' => 30,
            'max' => 100,
        ],
    ],
    'tx_sitepackage_person_linkedin' => [
        'label' => 'LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:field.person_linkedin',
        'config' => [
            'type' => 'link',
            'allowedTypes' => ['url'],
        ],
    ],
];

ExtensionManagementUtility::addTCAcolumns('tt_content', $additionalColumns);
```

## Backend Preview (PageTSconfig)

File: `EXT:site_package/Configuration/page.tsconfig` (or via Site Set)
```tsconfig
mod.wizards.newContentElement.wizardItems.special {
    elements {
        sitepackage_team_member {
            iconIdentifier = content-person
            title = LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:ctype.team_member
            description = LLL:EXT:site_package/Resources/Private/Language/locallang_be.xlf:ctype.team_member.description
            tt_content_defValues {
                CType = sitepackage_team_member
            }
        }
    }
    show := addToList(sitepackage_team_member)
}
```

## TypoScript — Rendering Configuration

```typoscript
tt_content.sitepackage_team_member =< lib.contentElement
tt_content.sitepackage_team_member {
    templateName = TeamMember

    dataProcessing {
        10 = TYPO3\CMS\Frontend\DataProcessing\FilesProcessor
        10 {
            references.fieldName = image
            as = images
        }
    }
}
```

## Fluid Template

File: `EXT:site_package/Resources/Private/Templates/ContentElements/TeamMember.html`
```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:layout name="Default" />

<f:section name="Main">
    <div class="ce-team-member" itemscope itemtype="https://schema.org/Person">

        <f:if condition="{images}">
            <div class="ce-team-member__image">
                <f:for each="{images}" as="image" iteration="iterator">
                    <f:if condition="{iterator.isFirst}">
                        <f:image image="{image}"
                                 width="300c"
                                 height="300c"
                                 alt="{data.tx_sitepackage_person_name}"
                                 class="ce-team-member__photo"
                                 loading="lazy"
                                 itemprop="image" />
                    </f:if>
                </f:for>
            </div>
        </f:if>

        <div class="ce-team-member__info">
            <h3 class="ce-team-member__name" itemprop="name">
                {data.tx_sitepackage_person_name}
            </h3>

            <f:if condition="{data.tx_sitepackage_person_position}">
                <p class="ce-team-member__position" itemprop="jobTitle">
                    {data.tx_sitepackage_person_position}
                </p>
            </f:if>

            <ul class="ce-team-member__contact">
                <f:if condition="{data.tx_sitepackage_person_email}">
                    <li class="ce-team-member__contact-item">
                        <a href="mailto:{data.tx_sitepackage_person_email}"
                           class="ce-team-member__email"
                           itemprop="email">
                            {data.tx_sitepackage_person_email}
                        </a>
                    </li>
                </f:if>

                <f:if condition="{data.tx_sitepackage_person_phone}">
                    <li class="ce-team-member__contact-item">
                        <a href="tel:{data.tx_sitepackage_person_phone}"
                           class="ce-team-member__phone"
                           itemprop="telephone">
                            {data.tx_sitepackage_person_phone}
                        </a>
                    </li>
                </f:if>

                <f:if condition="{data.tx_sitepackage_person_linkedin}">
                    <li class="ce-team-member__contact-item">
                        <f:link.typolink parameter="{data.tx_sitepackage_person_linkedin}"
                                         class="ce-team-member__linkedin"
                                         additionalAttributes="{itemprop: 'sameAs'}">
                            LinkedIn Profile
                        </f:link.typolink>
                    </li>
                </f:if>
            </ul>

            <f:if condition="{data.bodytext}">
                <div class="ce-team-member__biography" itemprop="description">
                    <f:format.html>{data.bodytext}</f:format.html>
                </div>
            </f:if>
        </div>
    </div>
</f:section>
</html>
```

## Language Labels

File: `EXT:site_package/Resources/Private/Language/locallang_be.xlf`
```xml
<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
    <file source-language="en" datatype="plaintext" original="messages" date="2024-01-01T00:00:00Z" product-name="site_package">
        <body>
            <trans-unit id="ctype.team_member">
                <source>Team Member Card</source>
            </trans-unit>
            <trans-unit id="ctype.team_member.description">
                <source>Displays a team member card with photo, contact details, and biography.</source>
            </trans-unit>
            <trans-unit id="tab.person">
                <source>Person Details</source>
            </trans-unit>
            <trans-unit id="field.person_name">
                <source>Full Name</source>
            </trans-unit>
            <trans-unit id="field.person_position">
                <source>Position / Job Title</source>
            </trans-unit>
            <trans-unit id="field.person_email">
                <source>Email Address</source>
            </trans-unit>
            <trans-unit id="field.person_phone">
                <source>Phone Number</source>
            </trans-unit>
            <trans-unit id="field.person_linkedin">
                <source>LinkedIn Profile URL</source>
            </trans-unit>
            <trans-unit id="field.biography">
                <source>Biography</source>
            </trans-unit>
        </body>
    </file>
</xliff>
```

File: `EXT:site_package/Resources/Private/Language/de.locallang_be.xlf`
```xml
<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
    <file source-language="en" target-language="de" datatype="plaintext" original="messages" date="2024-01-01T00:00:00Z" product-name="site_package">
        <body>
            <trans-unit id="ctype.team_member">
                <source>Team Member Card</source>
                <target>Teammitglied-Karte</target>
            </trans-unit>
            <trans-unit id="ctype.team_member.description">
                <source>Displays a team member card with photo, contact details, and biography.</source>
                <target>Zeigt eine Teammitglied-Karte mit Foto, Kontaktdaten und Biografie.</target>
            </trans-unit>
            <trans-unit id="tab.person">
                <source>Person Details</source>
                <target>Personendetails</target>
            </trans-unit>
            <trans-unit id="field.person_name">
                <source>Full Name</source>
                <target>Vollständiger Name</target>
            </trans-unit>
            <trans-unit id="field.person_position">
                <source>Position / Job Title</source>
                <target>Position / Berufsbezeichnung</target>
            </trans-unit>
            <trans-unit id="field.person_email">
                <source>Email Address</source>
                <target>E-Mail-Adresse</target>
            </trans-unit>
            <trans-unit id="field.person_phone">
                <source>Phone Number</source>
                <target>Telefonnummer</target>
            </trans-unit>
            <trans-unit id="field.person_linkedin">
                <source>LinkedIn Profile URL</source>
                <target>LinkedIn-Profil-URL</target>
            </trans-unit>
            <trans-unit id="field.biography">
                <source>Biography</source>
                <target>Biografie</target>
            </trans-unit>
        </body>
    </file>
</xliff>
```

## Icon Registration (optional)

File: `EXT:site_package/Configuration/Icons.php` (v12+)
```php
<?php

declare(strict_types=1);

use TYPO3\CMS\Core\Imaging\IconProvider\SvgIconProvider;

return [
    'content-person' => [
        'provider' => SvgIconProvider::class,
        'source' => 'EXT:site_package/Resources/Public/Icons/ContentElements/team-member.svg',
    ],
];
```

## Notes
- The `=< lib.contentElement` operator copies the base content element configuration (from fluid_styled_content) which includes the Default layout and standard frame wrapping.
- Custom fields must be prefixed with `tx_extensionkey_` to avoid conflicts with other extensions.
- The `type` => `email` TCA type (v12+) provides built-in email validation. For v11, use `type` => `input` with `eval` => `email`.
- The `type` => `link` TCA type (v12+) replaces the old `renderType` => `inputLink`. The `allowedTypes` option restricts which link types are available.
- Always use `locallang.xlf` labels for all backend-visible strings. Never hardcode labels in TCA.
- The `FilesProcessor` makes FAL file references available as proper File objects in Fluid, enabling crop variants and image processing.
- Run `vendor/bin/typo3 extension:setup` or clear caches and update the database schema after adding `ext_tables.sql` fields.
- In v13+, register the content element in the new content element wizard via Site Sets `page.tsconfig` instead of manual TSconfig.
