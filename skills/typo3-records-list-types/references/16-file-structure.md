# 16. File Structure

Continues `typo3-records-list-types` from [full guide](full-guide.md).

## 16. File Structure

Generated from the v2.0.2 checkout (`find Classes -type f | sort`), trimmed to directories plus the
classes this skill refers to. Classes not listed here exist but are internal helpers.

```
records_list_types/
├── Classes/
│   ├── Constants.php
│   ├── Controller/
│   │   ├── Ajax/ViewModeController.php              # AJAX preference persistence
│   │   ├── ContentElement/ElementHistoryController.php
│   │   └── RecordListController.php                 # Main controller (XClass)
│   ├── Event/
│   │   └── RegisterViewModesEvent.php               # PSR-14: custom view registration
│   ├── EventListener/
│   │   ├── GridViewButtonBarListener.php            # View toggle buttons (ModifyButtonBarEvent)
│   │   ├── RecordFilterAdditionalContentListener.php
│   │   ├── RecordFilterButtonBarListener.php
│   │   └── RecordFilterQueryListener.php
│   ├── Html/BackendFragmentSanitizerBuilder.php
│   ├── Pagination/
│   │   └── DatabasePaginator.php                    # Paginator for pre-fetched records
│   ├── RecordList/AlternativeDatabaseRecordList.php
│   ├── Service/
│   │   ├── GridConfigurationService.php             # TSconfig parsing
│   │   ├── RecordDisplayColumnResolver.php          # Column resolution order
│   │   ├── RecordGridDataProvider.php               # Record fetching & enrichment
│   │   ├── ThumbnailService.php                     # FAL image processing
│   │   ├── ViewModeResolver.php                     # View mode determination
│   │   ├── ViewTypeRegistry.php                     # View type management
│   │   └── ...                                      # Filter, sorting, enrichment, TCA services
│   └── Utility/
│       ├── AllowedViewModesUtility.php
│       └── ArrayUtility.php
├── Configuration/
│   ├── Backend/AjaxRoutes.php
│   ├── Icons.php
│   ├── JavaScriptModules.php
│   ├── page.tsconfig
│   └── Services.yaml
├── Documentation/
├── Resources/
│   ├── Private/
│   │   ├── Language/ (locallang.xlf plus de, es, fr, it)
│   │   ├── Layouts/
│   │   ├── Partials/ (Card, CompactRow, EmptyRecordsNotice, Pagination, RecordActionDropdown, RecordActions, RecordFilters, SortableColumnHeader, SortingDropdown, SortingModeToggle, TableHeading, TeaserCard, TranslationRow*, TranslationStrip)
│   │   └── Templates/ (CompactView, GenericView, GridView, RecordFilters, TeaserView)
│   └── Public/
│       ├── Css/ (base, grid-view, compact-view, teaser-view, history-overlay, view-mode-toggle)
│       ├── Icons/Extension.svg
│       └── JavaScript/ (GridViewActions, HistoryOverlay, RecordFilters)
├── Tests/ (Unit, Functional, Architecture)
├── composer.json
└── ext_localconf.php
```
