---
name: "typo3-rector"
description: "Automatically fixes deprecated PHP calls in TYPO3 code by running Rector: configuration, dry run, review the diff, apply, second dry run. Covers rule sets for the v12 or v13 to v14 path, ViewFactory, Extbase responses, PSR-14 events, backend modules, TCA and the manual follow-ups the tool cannot do. Use when the user says run Rector, automatically fix the deprecated calls in this extension, automate the PHP migration, which Rector sets do I need, or asks how to review a large Rector diff. Scope: PHP source files only, and one extension at a time."
compatibility: "TYPO3 14.x"
metadata:
  skill_type: preference
  version: "2.3.0"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---
# TYPO3 Rector Upgrade Patterns

> Source: https://github.com/dirnbauer/typo3-skills

Rector rewrites TYPO3 **PHP code** toward v14. Non-PHP files (FlexForms, TypoScript, Fluid, YAML,
XLIFF) belong to `typo3-fractor`; the same change across many extensions belongs to `typo3-batch`;
a whole-site upgrade belongs to `typo3-upgrade-run`, which calls this skill for its Rector node.

## Rules

- **Run Rector instead of hand-editing deprecated calls.** Manual replacements miss namespace moves,
  signature changes and edge cases the rules already cover.
- **Run it on the PHP version the project requires** (8.4 for project work). Rector loads the project
  autoloader, and TYPO3 v14 packages use PHP 8.2+ syntax such as `readonly` classes, so an older host
  PHP fails to parse them. Use `ddev exec vendor/bin/rector …` when the host PHP differs.
- **Dry run → review the diff → apply → dry run again.** One applied pass is not completion: a rule
  can generate code that another rule only sees on the next pass. Generated list-type-to-CType
  upgrade wizards needed a second namespace migration in real v14 work, so review generated
  migration code too.
- **Bound the passes.** Inside an upgrade graph, do one bounded repair pass and return the remaining
  diff to the parent node; do not restart a sibling-owned loop. Standalone, allow at most three
  apply passes and stop earlier on two unchanged or non-improving results, or on oscillation. A
  nonzero residual diff is incomplete and needs a new decision, not more passes.
- **Skip a destructive semantic rule until its replacement exists.** Example: defer an
  icon-registration removal while the current provider (Font Awesome stays on
  `friendsoftypo3/fontawesome-provider`) has no proven SVG replacement. Skip that exact rule, record
  the manual follow-up, register the replacement icon, then rerun Rector to zero.
- **Verify every TYPO3 API Rector or you introduce** against the installed `vendor/typo3/cms-*`
  source of the 14.3 project; memory is wrong often after the v14 removals.

## 1. Installation and configuration

```bash
ddev composer require --dev ssch/typo3-rector
ddev composer update ssch/typo3-rector   # before each migration pass, so the newest v14 rules apply
```

Verified 2026-10-31 on Packagist: `ssch/typo3-rector` 3.16.0 (released 2026-09-10) requires
`rector/rector` ^2.5.2. Treat these numbers as illustrations and install the latest stable release.

Create `rector.php` in the project root:

```php
<?php
declare(strict_types=1);

use Rector\Config\RectorConfig;
use Rector\Set\ValueObject\LevelSetList;
use Rector\ValueObject\PhpVersion;
use Ssch\TYPO3Rector\Set\Typo3LevelSetList;

return RectorConfig::configure()
    ->withPaths([
        __DIR__ . '/packages',
        __DIR__ . '/public/typo3conf/ext',
    ])
    ->withSkip([
        __DIR__ . '/public/typo3conf/ext/*/Resources/',
        __DIR__ . '/public/typo3conf/ext/*/Tests/',
    ])
    ->withPhpVersion(PhpVersion::PHP_84)
    ->withSets([
        LevelSetList::UP_TO_PHP_84,
        Typo3LevelSetList::UP_TO_TYPO3_14,
    ])
    ->withImportNames();
```

- `Typo3LevelSetList::UP_TO_TYPO3_14` is cumulative. On a very old codebase, run
  `UP_TO_TYPO3_13` as a dedicated step first, then `UP_TO_TYPO3_14`.
- `Typo3SetList::TYPO3_14` applies only the v14 rules; add it when you want the v14 step on its own:

```php
use Ssch\TYPO3Rector\Set\Typo3SetList;

return RectorConfig::configure()
    ->withPaths([__DIR__ . '/packages'])
    ->withSets([Typo3SetList::TYPO3_14]);
```

## 2. Running Rector

```bash
ddev exec vendor/bin/rector process --dry-run                          # whole configured path set
ddev exec vendor/bin/rector process packages/my_extension --dry-run    # one extension
ddev exec vendor/bin/rector process packages/my_extension              # apply after review
ddev typo3 cache:flush && ddev composer dump-autoload                  # after applying
```

## 3. Version constraints

Declare the TYPO3 and PHP range in `composer.json`; it is the source of truth in v14:

```json
{
    "require": {
        "php": "^8.4",
        "typo3/cms-core": "^14.3"
    }
}
```

Use `^14.3`, never `^14.0`: 14.0 through 14.2 no longer receive security updates. `ext_emconf.php`
is deprecated since 14.2 (#108345) and no longer evaluated in v15; Rector does not migrate it. Put the
extension version and `extra.typo3/cms.Package.providesPackages` into `composer.json` instead, as
`typo3-v14-reference` shows.

## 4. Key Migration Patterns (TYPO3 v14)

The target APIs are documented in `typo3-v14-reference`; this section keeps only the patterns
Rector cannot produce on its own and that the diff review has to check by hand.

### Fluid ViewFactory (Replaces StandaloneView)

The ViewFactory approach works on TYPO3 v14:

```php
<?php
declare(strict_types=1);

namespace Vendor\Extension\Service;

use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Core\View\ViewFactoryData;
use TYPO3\CMS\Core\View\ViewFactoryInterface;

final class RenderingService
{
    public function __construct(
        private readonly ViewFactoryInterface $viewFactory,
    ) {}

    public function render(ServerRequestInterface $request): string
    {
        $viewFactoryData = new ViewFactoryData(
            templateRootPaths: ['EXT:my_extension/Resources/Private/Templates'],
            partialRootPaths: ['EXT:my_extension/Resources/Private/Partials'],
            layoutRootPaths: ['EXT:my_extension/Resources/Private/Layouts'],
            request: $request,
        );
        
        $view = $this->viewFactory->create($viewFactoryData);
        $view->assign('data', ['key' => 'value']);
        $view->assignMultiple([
            'items' => [],
            'settings' => [],
        ]);
        
        return $view->render('MyTemplate');
    }
}
```

### Extbase controller response (TYPO3 v14)

```php
<?php
declare(strict_types=1);

namespace Vendor\Extension\Controller;

use Psr\Http\Message\ResponseInterface;
use TYPO3\CMS\Extbase\Mvc\Controller\ActionController;

final class ItemController extends ActionController
{
    // v14: return ResponseInterface (required)
    public function listAction(): ResponseInterface
    {
        $items = $this->itemRepository->findAll();
        $this->view->assign('items', $items);
        return $this->htmlResponse();
    }

    // v14: JSON response
    public function apiAction(): ResponseInterface
    {
        $data = ['success' => true];
        return $this->jsonResponse(json_encode($data));
    }

    // v14: redirect
    public function createAction(Item $item): ResponseInterface
    {
        $this->itemRepository->add($item);
        return $this->redirect('list');
    }
}
```

### PSR-14 Events (Preferred over Hooks)

PSR-14 events work on TYPO3 v14. Use them instead of legacy hooks:

```php
<?php
declare(strict_types=1);

namespace Vendor\Extension\EventListener;

use TYPO3\CMS\Core\Attribute\AsEventListener;
use TYPO3\CMS\Frontend\Event\ModifyPageLinkConfigurationEvent;

#[AsEventListener(identifier: 'vendor-extension/modify-pagelink')]
final class ModifyPageLinkListener
{
    public function __invoke(ModifyPageLinkConfigurationEvent $event): void
    {
        $configuration = $event->getConfiguration();
        // Modify link configuration
        $event->setConfiguration($configuration);
    }
}
```

### Backend Module Registration (TYPO3 v14)

```php
<?php
// Configuration/Backend/Modules.php
return [
    'myextension_mymodule' => [
        'parent' => 'content',
        'position' => ['after' => 'records'],
        'access' => 'user,group',
        'iconIdentifier' => 'myextension-module',
        'path' => '/module/content/myextension',
        'labels' => 'LLL:EXT:my_extension/Resources/Private/Language/locallang_mod.xlf',
        'extensionName' => 'MyExtension',
        'controllerActions' => [
            \Vendor\MyExtension\Controller\ModuleController::class => [
                'index',
                'edit',
            ],
        ],
    ],
];
```

### Service Configuration (Services.yaml)

```yaml
# Configuration/Services.yaml
services:
  _defaults:
    autowire: true
    autoconfigure: true
    public: false

  Vendor\MyExtension\:
    resource: '../Classes/*'
    exclude:
      - '../Classes/Domain/Model/*'
```

## 5. TCA Best Practices (TYPO3 v14)

### Static TCA Only

Write TCA only in `Configuration/TCA/` and `Configuration/TCA/Overrides/`; those files build the
cached TCA that the Schema API reads. `ext_tables.php` is deprecated since 14.3 (#109438) and is no
place for TCA changes:

```php
<?php
// Configuration/TCA/Overrides/tt_content.php
defined('TYPO3') or die();

// v14: static TCA configuration
\TYPO3\CMS\Core\Utility\ExtensionManagementUtility::addTcaSelectItem(
    'tt_content',
    'CType',
    [
        'label' => 'LLL:EXT:my_extension/Resources/Private/Language/locallang.xlf:mytype.title',
        'value' => 'myextension_mytype',
        'icon' => 'content-text',
        'group' => 'default',
    ]
);

$GLOBALS['TCA']['tt_content']['types']['myextension_mytype'] = [
    'showitem' => '
        --div--;LLL:EXT:core/Resources/Private/Language/Form/locallang_tabs.xlf:general,
            --palette--;;general,
            header;LLL:EXT:frontend/Resources/Private/Language/locallang_ttc.xlf:header_formlabel,
            bodytext,
        --div--;LLL:EXT:core/Resources/Private/Language/Form/locallang_tabs.xlf:access,
            --palette--;;hidden,
            --palette--;;access,
    ',
    'columnsOverrides' => [
        'bodytext' => [
            'config' => [
                'enableRichtext' => true,
            ],
        ],
    ],
];
```


## References

Load only the file the current task needs:

- [Step-by-step migration process](references/07-step-by-step-migration-process.md): when running a
  complete Rector migration for one extension from backup to commit.
- [Troubleshooting](references/08-troubleshooting.md): when Rector fails to boot, crashes or produces
  a wrong change.
- [Common Rector rules](references/09-common-rector-rules.md): when explaining what a typical rule
  changes.
- [v14-only Rector targets](references/v14-only-rector-targets.md): when listing v14 removals and
  deprecations, including what Rector leaves for manual work.
- [TYPO3 v14 platform snapshot](references/06-typo3-v14-platform-snapshot.md): when a quick v14
  platform summary (PHP range, TCA, events) is needed.
- [Resources](references/10-resources.md): when linking upstream documentation.
