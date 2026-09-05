# Recipe: Extbase Plugin TypoScript Configuration

> Version: v12+

## What this builds

Complete TypoScript configuration for an Extbase plugin including plugin settings, persistence mapping, view paths, and frontend rendering setup for a "Job Board" extension.

## TypoScript — Plugin Configuration

```typoscript
plugin.tx_jobboard {
    view {
        templateRootPaths {
            0 = EXT:job_board/Resources/Private/Templates/
            10 = {$plugin.tx_jobboard.view.templateRootPath}
        }
        partialRootPaths {
            0 = EXT:job_board/Resources/Private/Partials/
            10 = {$plugin.tx_jobboard.view.partialRootPath}
        }
        layoutRootPaths {
            0 = EXT:job_board/Resources/Private/Layouts/
            10 = {$plugin.tx_jobboard.view.layoutRootPath}
        }
    }

    persistence {
        storagePid = {$plugin.tx_jobboard.persistence.storagePid}
        recursive = 1
    }

    settings {
        # List view
        list {
            itemsPerPage = 12
            orderBy = publishDate
            orderDirection = desc
            showCategories = 1
            showLocation = 1
        }

        # Detail view
        detail {
            pageUid = {$plugin.tx_jobboard.settings.detailPageUid}
            showApplyButton = 1
            showSocialShare = 1
        }

        # Category filter
        categories {
            # Comma-separated UIDs or leave empty for all
            include =
            exclude =
        }

        # Email notification for new applications
        notification {
            senderEmail = {$plugin.tx_jobboard.settings.notification.senderEmail}
            senderName = {$plugin.tx_jobboard.settings.notification.senderName}
            recipientEmail = {$plugin.tx_jobboard.settings.notification.recipientEmail}
            templateRootPath = EXT:job_board/Resources/Private/Templates/Email/
        }

        # SEO
        seo {
            enableStructuredData = 1
            defaultEmploymentType = FULL_TIME
        }
    }

    features {
        skipDefaultArguments = 1
        requireCHashArgumentForActionArguments = 0
    }
}
```

## TypoScript Constants

```typoscript
plugin.tx_jobboard {
    view {
        templateRootPath = EXT:job_board/Resources/Private/Templates/
        partialRootPath = EXT:job_board/Resources/Private/Partials/
        layoutRootPath = EXT:job_board/Resources/Private/Layouts/
    }

    persistence {
        storagePid = 42
    }

    settings {
        detailPageUid = 45
        notification {
            senderEmail = noreply@example.com
            senderName = Job Board
            recipientEmail = hr@example.com
        }
    }
}
```

## TypoScript — Persistence Mapping (v12+)

File: `EXT:job_board/Configuration/Extbase/Persistence/Classes.php`

```php
<?php

declare(strict_types=1);

return [
    \Vendor\JobBoard\Domain\Model\JobOffer::class => [
        'tableName' => 'tx_jobboard_domain_model_joboffer',
        'properties' => [
            'publishDate' => [
                'fieldName' => 'publish_date',
            ],
            'employmentType' => [
                'fieldName' => 'employment_type',
            ],
            'isRemote' => [
                'fieldName' => 'remote',
            ],
        ],
    ],
    \Vendor\JobBoard\Domain\Model\Application::class => [
        'tableName' => 'tx_jobboard_domain_model_application',
        'properties' => [
            'coverLetter' => [
                'fieldName' => 'cover_letter',
            ],
            'submittedAt' => [
                'fieldName' => 'crdate',
            ],
        ],
    ],
    \Vendor\JobBoard\Domain\Model\Category::class => [
        'tableName' => 'sys_category',
    ],
];
```

## Plugin Registration

File: `EXT:job_board/Configuration/TCA/Overrides/tt_content.php`

```php
<?php

declare(strict_types=1);

use TYPO3\CMS\Extbase\Utility\ExtensionUtility;

defined('TYPO3') or die();

ExtensionUtility::registerPlugin(
    'JobBoard',
    'List',
    'LLL:EXT:job_board/Resources/Private/Language/locallang_be.xlf:plugin.list.title',
    'ext-jobboard-list',
    'plugins',
    'LLL:EXT:job_board/Resources/Private/Language/locallang_be.xlf:plugin.list.description'
);

ExtensionUtility::registerPlugin(
    'JobBoard',
    'Detail',
    'LLL:EXT:job_board/Resources/Private/Language/locallang_be.xlf:plugin.detail.title',
    'ext-jobboard-detail',
    'plugins',
    'LLL:EXT:job_board/Resources/Private/Language/locallang_be.xlf:plugin.detail.description'
);

// FlexForm for the List plugin
$GLOBALS['TCA']['tt_content']['types']['list']['subtypes_addlist']['jobboard_list'] = 'pi_flexform';
$GLOBALS['TCA']['tt_content']['types']['list']['subtypes_excludelist']['jobboard_list'] = 'layout,select_key,pages,recursive';

\TYPO3\CMS\Core\Utility\ExtensionManagementUtility::addPiFlexFormValue(
    'jobboard_list',
    'FILE:EXT:job_board/Configuration/FlexForms/List.xml'
);
```

## ext_localconf.php — Controller/Action Mapping

```php
<?php

declare(strict_types=1);

use TYPO3\CMS\Extbase\Utility\ExtensionUtility;
use Vendor\JobBoard\Controller\JobOfferController;

defined('TYPO3') or die();

ExtensionUtility::configurePlugin(
    'JobBoard',
    'List',
    [
        JobOfferController::class => 'list, filter',
    ],
    // Non-cacheable actions
    [
        JobOfferController::class => 'filter',
    ]
);

ExtensionUtility::configurePlugin(
    'JobBoard',
    'Detail',
    [
        JobOfferController::class => 'show, apply, confirmApplication',
    ],
    [
        JobOfferController::class => 'apply, confirmApplication',
    ]
);
```

## FlexForm for Plugin Settings

File: `EXT:job_board/Configuration/FlexForms/List.xml`

```xml
<?xml version="1.0" encoding="utf-8" standalone="yes" ?>
<T3DataStructure>
    <sheets>
        <sDEF>
            <ROOT>
                <type>array</type>
                <el>
                    <settings.list.itemsPerPage>
                        <label>LLL:EXT:job_board/Resources/Private/Language/locallang_be.xlf:flexform.itemsPerPage</label>
                        <config>
                            <type>input</type>
                            <size>5</size>
                            <eval>int</eval>
                            <default>12</default>
                        </config>
                    </settings.list.itemsPerPage>
                    <settings.list.orderBy>
                        <label>LLL:EXT:job_board/Resources/Private/Language/locallang_be.xlf:flexform.orderBy</label>
                        <config>
                            <type>select</type>
                            <renderType>selectSingle</renderType>
                            <items>
                                <numIndex index="0">
                                    <label>Publish Date</label>
                                    <value>publishDate</value>
                                </numIndex>
                                <numIndex index="1">
                                    <label>Title</label>
                                    <value>title</value>
                                </numIndex>
                            </items>
                        </config>
                    </settings.list.orderBy>
                    <settings.categories.include>
                        <label>LLL:EXT:job_board/Resources/Private/Language/locallang_be.xlf:flexform.categories</label>
                        <config>
                            <type>category</type>
                            <relationship>manyToMany</relationship>
                            <size>5</size>
                            <maxitems>20</maxitems>
                        </config>
                    </settings.categories.include>
                    <settings.detail.pageUid>
                        <label>LLL:EXT:job_board/Resources/Private/Language/locallang_be.xlf:flexform.detailPage</label>
                        <config>
                            <type>group</type>
                            <allowed>pages</allowed>
                            <size>1</size>
                            <maxitems>1</maxitems>
                        </config>
                    </settings.detail.pageUid>
                </el>
            </ROOT>
        </sDEF>
    </sheets>
</T3DataStructure>
```

## TypoScript — Override Template Paths per Plugin Instance

```typoscript
# Override templates for a specific page
[traverse(page, "uid") == 55]
    plugin.tx_jobboard_list {
        view {
            templateRootPaths.20 = EXT:site_package/Resources/Private/Templates/JobBoard/
        }
        settings {
            list.itemsPerPage = 6
        }
    }
[end]

# Global override from site package
plugin.tx_jobboard {
    view {
        templateRootPaths.20 = EXT:site_package/Resources/Private/Templates/JobBoard/
        partialRootPaths.20 = EXT:site_package/Resources/Private/Partials/JobBoard/
    }
}
```

## TypoScript — Override for tt_content Rendering

```typoscript
# Configure the tt_content rendering for the plugin
tt_content.list.20.jobboard_list =< plugin.tx_jobboard_list
tt_content.list.20.jobboard_detail =< plugin.tx_jobboard_detail
```

## Fluid Template Example

File: `EXT:job_board/Resources/Private/Templates/JobOffer/List.html`

```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:layout name="Default" />

<f:section name="Main">
    <div class="job-list">
        <f:if condition="{paginator.paginatedItems -> f:count()}">
            <f:then>
                <div class="job-list__items">
                    <f:for each="{paginator.paginatedItems}" as="job">
                        <article class="job-card" itemscope itemtype="https://schema.org/JobPosting">
                            <h2 class="job-card__title" itemprop="title">
                                <f:link.action action="show" controller="JobOffer"
                                               pluginName="Detail"
                                               pageUid="{settings.detail.pageUid}"
                                               arguments="{jobOffer: job}">
                                    {job.title}
                                </f:link.action>
                            </h2>

                            <div class="job-card__meta">
                                <f:if condition="{job.location}">
                                    <span class="job-card__location" itemprop="jobLocation" itemscope itemtype="https://schema.org/Place">
                                        <span itemprop="address">{job.location}</span>
                                    </span>
                                </f:if>

                                <span class="job-card__type" itemprop="employmentType">
                                    {job.employmentType}
                                </span>

                                <f:if condition="{job.isRemote}">
                                    <span class="job-card__remote">Remote</span>
                                </f:if>
                            </div>

                            <p class="job-card__teaser" itemprop="description">
                                <f:format.crop maxCharacters="200" respectWordBoundaries="1">
                                    {job.description -> f:format.stripTags()}
                                </f:format.crop>
                            </p>

                            <time class="job-card__date" datetime="{f:format.date(date: job.publishDate, format: 'Y-m-d')}" itemprop="datePosted">
                                <f:format.date date="{job.publishDate}" format="%d.%m.%Y" />
                            </time>
                        </article>
                    </f:for>
                </div>

                <f:comment>
                    Pagination: build in the controller (f:widget.paginate was removed in v12):
                    $paginator = new QueryResultPaginator($jobOffers, $currentPageNumber, $itemsPerPage);
                    $pagination = new SimplePagination($paginator);
                    $this->view->assignMultiple(['paginator' => $paginator, 'pagination' => $pagination]);
                </f:comment>
                <f:if condition="{pagination.allPageNumbers -> f:count()} > 1">
                    <nav class="pagination" aria-label="Pagination">
                        <f:for each="{pagination.allPageNumbers}" as="pageNumber">
                            <f:link.action action="list" arguments="{currentPageNumber: pageNumber}">{pageNumber}</f:link.action>
                        </f:for>
                    </nav>
                </f:if>
            </f:then>
            <f:else>
                <p class="job-list__empty">
                    <f:translate key="LLL:EXT:job_board/Resources/Private/Language/locallang.xlf:list.noResults" />
                </p>
            </f:else>
        </f:if>
    </div>
</f:section>
</html>
```

## v13+ — Site Sets Integration

File: `EXT:job_board/Configuration/Sets/JobBoard/config.yaml`

```yaml
name: vendor/job-board
label: Job Board Extension
dependencies:
  - typo3/fluid-styled-content
```

File: `EXT:job_board/Configuration/Sets/JobBoard/settings.definitions.yaml`

```yaml
settings:
  job_board.persistence.storagePid:
    label: 'Storage Page ID for Job Offers'
    type: int
    default: 0

  job_board.settings.detailPageUid:
    label: 'Detail Page UID'
    type: int
    default: 0

  job_board.settings.list.itemsPerPage:
    label: 'Items per Page'
    type: int
    default: 12
```

File: `EXT:job_board/Configuration/Sets/JobBoard/setup.typoscript`

```typoscript
plugin.tx_jobboard {
    persistence.storagePid = {$job_board.persistence.storagePid}
    settings.detail.pageUid = {$job_board.settings.detailPageUid}
    settings.list.itemsPerPage = {$job_board.settings.list.itemsPerPage}
}
```

## Notes

- Plugin TypoScript uses `plugin.tx_extensionname` (lowercase, no underscores from vendor). The specific plugin is `plugin.tx_extensionname_pluginname`.
- FlexForm settings from the plugin content element override TypoScript `settings.*` values. This allows editors to customize per-instance.
- `features.skipDefaultArguments = 1` prevents default action/controller parameters from appearing in URLs.
- `requireCHashArgumentForActionArguments = 0` is needed when using route enhancers, as cHash validation is handled differently.
- In v12+, persistence mapping is done via `Configuration/Extbase/Persistence/Classes.php`, not via TypoScript `config.tx_extbase.persistence.classes`.
- Non-cacheable actions (form submissions, filtered lists) are defined in the second array of `configurePlugin()`. Keep these to a minimum for performance.
- Template path arrays use numeric keys. Key `0` is the extension default, `10` is for constants/settings override, `20` for site package overrides.
- The `f:widget.paginate` ViewHelper was removed in v12. Build pagination in the controller with `QueryResultPaginator` and `SimplePagination` (TYPO3 Pagination API) and render the page links in Fluid.
- In v13+ with Site Sets, constants are replaced by `settings.yaml` definitions. Reference them with `{$setting.name}` in TypoScript (same syntax as constants).
