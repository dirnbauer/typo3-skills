---
name: "typo3-v14-reference"
description: "Shows how to write TYPO3 v14 code as a v14 API reference. Covers controllers, building a view with ViewFactory, Fluid templates, PSR-14 events that replaced old hooks, backend modules, TCA, QueryBuilder queries without SQL injection, CLI commands and tests. Use when the user asks what a v14 API looks like, which event replaced a hook, how to build or write a specific piece of v14 code, or which class, interface or namespace to use. It does not run upgrades or migrations: for a whole project or site upgrade use typo3-upgrade-run, which owns the version constraint, the PHP target and the process."
compatibility: "TYPO3 14.x"
metadata:
  skill_type: preference
  version: "2.1.0"
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---
# TYPO3 v14 development

> Source: https://github.com/dirnbauer/webconsulting-skills

This skill is the **v14 API reference**: how v14 code is written. It does not run upgrades.

- **Upgrades go elsewhere.** Upgrading a whole project or site from v12/v13 is `typo3-upgrade-run`,
  which owns the version constraints, the PHP target, the `ext_emconf.php` policy and the migration
  process. Where the two differ, `typo3-upgrade-run` wins; load it first for an upgrade run and use
  this skill as the API reference during its manual-migration phase. Mechanical rewrites are
  `typo3-rector` (PHP) and `typo3-fractor` (non-PHP).
- **Verify every class, method, event and config key** against the installed
  `vendor/typo3/cms-*` source of a 14.3 project before you write or assert it. v14 removed and
  renamed enough that memory is wrong often.
- **Use TYPO3 APIs before custom code**: events over hooks, ViewFactory over hand-built views,
  QueryBuilder with named parameters over SQL strings.
- **Translated sites on 14.3.6+:** Extbase follows the site language's `fallbackType`; read
  [Extbase follows fallbackType](references/13-v14-only-changes-manual-not-handled-by-rector.md#extbase-follows-fallbacktype-v1436)
  before writing a repository or detail action for a translated site.

## 1. Version Strategy

### Target: TYPO3 v14.x only

| Version | Role for this collection |
|---------|--------------------------|
| **v14.x** | **Supported target** — examples and constraints assume TYPO3 v14 |
| Older majors | **Not targeted** — complete a core upgrade, then use these patterns |

**Best Practice:** Declare TYPO3 **v14-only** constraints in `composer.json`. Composer is the single source of truth in v14 — see the `ext_emconf.php` note below before adding one.

### Version Constraints

```json
// composer.json — TYPO3 v14
{
    "name": "vendor/my-extension",
    "type": "typo3-cms-extension",
    "require": {
        "php": "^8.4",
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

Since 14.2 (#108345) `composer.json` carries the metadata `ext_emconf.php` used to hold: the version
in `extra.typo3/cms.version` (or the top-level `version`) and `Package.providesPackages`, empty when
the extension bundles no Composer packages. Without them, classic mode cannot read the extension once
`ext_emconf.php` is gone, and an extension that still ships the file logs a deprecation. The title
comes from the `description` before the first ` - ` (#108304).

Target **`^14.3`, not `^14.0`**: 14.3 is the supported LTS line, and 14.0 through 14.2 no longer receive security updates. A reusable package that genuinely tests a broader range may widen the constraint, but then proves it in CI rather than asserting it.

> **Content Blocks:** `friendsoftypo3/content-blocks` requires **`typo3/cms-core` ^14.3** or higher — match the [Packagist constraint](https://packagist.org/packages/friendsoftypo3/content-blocks) before pinning anything lower.

### `ext_emconf.php` — legacy, only where a tool still requires it

[Deprecation #108345](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.2/Deprecation-108345-Deprecation-of-ext-emconf-php.html) deprecates `ext_emconf.php` in 14.2; v15 no longer evaluates it, and since 14.2 classic mode works without it ([Feature #108345](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.2/Feature-108345-No-ext-em-conf-in-classic-mode.html)). Do not add one to a new v14 extension. Keep an existing one only while a publishing tool you have checked still requires it, and then keep it exactly in sync with `composer.json`:

```php
<?php
// ext_emconf.php — only for Classic mode or TER publishing
$EM_CONF[$_EXTKEY] = [
    'title' => 'My Extension',
    'version' => '2.0.0',
    'state' => 'stable',
    'constraints' => [
        'depends' => [
            'typo3' => '14.3.0-14.99.99',
            'php' => '8.4.0-8.5.99',
        ],
        'conflicts' => [],
        'suggests' => [],
    ],
];
```

For a full project or site upgrade, `typo3-upgrade-run` owns this policy and removes the file for project-local extensions in `packages/`.

## 2. PHP Requirements

### Core floor 8.2 — project target 8.4 (8.5 where it resolves)

TYPO3 v14 Core requires PHP 8.2+, so a reusable package that tests and documents the broader range may declare `^8.2`. **Project and site work in this collection targets PHP 8.4 as the standard**, and PHP 8.5 is supported and preferred where the whole dependency set resolves on it — check `composer why-not php 8.5` and fall back to 8.4 when a package blocks. `typo3-upgrade-run` enforces the 8.4 floor and gates on it.

Use modern PHP features:

```php
<?php
declare(strict_types=1);

namespace Vendor\Extension\Service;

// ✅ Constructor property promotion (PHP 8.0+)
final class MyService
{
    public function __construct(
        private readonly SomeDependency $dependency,
        private readonly AnotherService $anotherService,
    ) {}
}

// ✅ Named arguments (PHP 8.0+)
$result = $this->doSomething(
    name: 'value',
    options: ['key' => 'value'],
);

// ✅ Match expressions (PHP 8.0+)
$type = match ($input) {
    'a' => 'Type A',
    'b' => 'Type B',
    default => 'Unknown',
};

// ✅ Enums (PHP 8.1+)
enum Status: string
{
    case Draft = 'draft';
    case Published = 'published';
}
```

## 3. Controller Patterns (TYPO3 v14)

### Extbase Action Controller

```php
<?php
declare(strict_types=1);

namespace Vendor\Extension\Controller;

use Psr\Http\Message\ResponseInterface;
use TYPO3\CMS\Extbase\Mvc\Controller\ActionController;
use Vendor\Extension\Domain\Repository\ItemRepository;

final class ItemController extends ActionController
{
    public function __construct(
        private readonly ItemRepository $itemRepository,
    ) {}

    // ✅ Returns ResponseInterface (required in TYPO3 v14)
    public function listAction(): ResponseInterface
    {
        $items = $this->itemRepository->findAll();
        $this->view->assign('items', $items);
        return $this->htmlResponse();
    }

    public function showAction(int $item): ResponseInterface
    {
        $item = $this->itemRepository->findByUid($item);
        $this->view->assign('item', $item);
        return $this->htmlResponse();
    }

    // ✅ JSON response
    public function apiAction(): ResponseInterface
    {
        $data = ['success' => true, 'items' => []];
        return $this->jsonResponse(json_encode($data));
    }

    // ✅ Redirect
    public function createAction(): ResponseInterface
    {
        // Process creation...
        $this->addFlashMessage('Item created');
        return $this->redirect('list');
    }
}
```

> **Translated sites, 14.3.6+:** Extbase follows the site language's `fallbackType`, and a language
> without the key is `strict`. There `findByUid()` and uid-mapped action arguments return `null` for
> an untranslated record, and relations lose untranslated children; 13.4 and 14.3.0–14.3.5 returned
> the default-language record. Read [Extbase follows fallbackType](references/13-v14-only-changes-manual-not-handled-by-rector.md#extbase-follows-fallbacktype-v1436)
> before writing a repository or a detail action for a translated site, or updating one past 14.3.5.

### Backend Module Controller

```php
<?php
declare(strict_types=1);

namespace Vendor\Extension\Controller;

use Psr\Http\Message\ResponseInterface;
use Psr\Http\Message\ServerRequestInterface;
use TYPO3\CMS\Backend\Attribute\AsController;
use TYPO3\CMS\Backend\Template\ModuleTemplateFactory;

#[AsController]
final class BackendModuleController
{
    public function __construct(
        private readonly ModuleTemplateFactory $moduleTemplateFactory,
    ) {}

    public function indexAction(ServerRequestInterface $request): ResponseInterface
    {
        $moduleTemplate = $this->moduleTemplateFactory->create($request);
        $moduleTemplate->assign('items', []);
        
        return $moduleTemplate->renderResponse('Backend/Index');
    }
}
```

## 4. View & Templating (TYPO3 v14)

### ViewFactory (Preferred Pattern)

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

    public function renderEmail(ServerRequestInterface $request, array $data): string
    {
        $viewFactoryData = new ViewFactoryData(
            templateRootPaths: ['EXT:my_extension/Resources/Private/Templates/Email'],
            partialRootPaths: ['EXT:my_extension/Resources/Private/Partials'],
            layoutRootPaths: ['EXT:my_extension/Resources/Private/Layouts'],
            request: $request,
        );
        
        $view = $this->viewFactory->create($viewFactoryData);
        $view->assignMultiple($data);
        
        return $view->render('Notification');
    }
}
```

### Fluid Template Best Practices

```html
<html xmlns:f="http://typo3.org/ns/TYPO3/CMS/Fluid/ViewHelpers"
      xmlns:core="http://typo3.org/ns/TYPO3/CMS/Core/ViewHelpers"
      data-namespace-typo3-fluid="true">

<f:layout name="Default" />

<f:section name="Main">
    <div class="content">
        <!-- ✅ Auto-escaped output -->
        <h1>{item.title}</h1>
        
        <!-- ✅ Explicit HTML (use with caution) -->
        <f:format.html>{item.bodytext}</f:format.html>
        
        <!-- ✅ Conditional rendering -->
        <f:if condition="{items}">
            <f:then>
                <f:for each="{items}" as="item">
                    <f:render partial="Item" arguments="{item: item}" />
                </f:for>
            </f:then>
            <f:else>
                <p>No items found.</p>
            </f:else>
        </f:if>
        
        <!-- ✅ Link building -->
        <f:link.action action="show" arguments="{item: item.uid}">
            View Details
        </f:link.action>
    </div>
</f:section>

</html>
```

Fluid parses a partial as its own template. A custom ViewHelper namespace declared only in the
calling template or layout is not inherited by that partial; declare the namespace in every file
that uses it. Verify `templateRootPaths`, `partialRootPaths` and `layoutRootPaths`, then render every
retained CType, plugin/list type and page template at least once. Cache warm-up does not compile a
template path no request reaches.

## 5. Event System (TYPO3 v14)

### PSR-14 Event Listeners

PSR-14 events are the standard in TYPO3 v14. Always prefer events over hooks.

```php
<?php
declare(strict_types=1);

namespace Vendor\Extension\EventListener;

use TYPO3\CMS\Core\Attribute\AsEventListener;
use TYPO3\CMS\Frontend\Event\ModifyCacheLifetimeForPageEvent;

#[AsEventListener(identifier: 'vendor-extension/modify-cache-lifetime')]
final class ModifyCacheLifetimeListener
{
    public function __invoke(ModifyCacheLifetimeForPageEvent $event): void
    {
        // Reduce cache lifetime for certain pages
        if ($event->getPageId() === 123) {
            $event->setCacheLifetime(300); // 5 minutes
        }
    }
}
```

### Common Events (TYPO3 v14)

| Event | Purpose |
|-------|---------|
| `ModifyPageLinkConfigurationEvent` | Modify link building |
| `ModifyCacheLifetimeForPageEvent` | Adjust page cache |
| `BeforeStdWrapFunctionsInitializedEvent` | Modify stdWrap |
| *(DataHandler)* | Core ships **no** generic `BeforeRecordOperationEvent` / `AfterRecordOperationEvent`; use **`SC_OPTIONS`** DataHandler hooks or documented `TYPO3\CMS\Core\DataHandling\Event\*` only ([list](https://docs.typo3.org/m/typo3/reference-coreapi/main/en-us/ApiOverview/Events/Events/Core/DataHandling/Index.html)) |

### Services.yaml Registration

```yaml
# Configuration/Services.yaml
services:
  _defaults:
    autowire: true
    autoconfigure: true
    public: false

  Vendor\Extension\:
    resource: '../Classes/*'
    exclude:
      - '../Classes/Domain/Model/*'

  # Event listener (alternative to #[AsEventListener] attribute)
  Vendor\Extension\EventListener\MyListener:
    tags:
      - name: event.listener
        identifier: 'vendor-extension/my-listener'
```


## References

Load only the file the current task needs:

- [Backend module registration](references/06-backend-module-registration-typo3-v14.md): when
  registering a module in `Configuration/Backend/Modules.php` or choosing a v14 parent
  (`content`, `media`, `admin`, `system`).
- [TCA configuration](references/07-tca-configuration-typo3-v14.md): when writing or reviewing TCA
  for a record type.
- [Database operations](references/08-database-operations-typo3-v14.md): when writing QueryBuilder
  queries, restrictions or named parameters.
- [CLI commands](references/09-cli-commands-typo3-v14.md): when writing a Symfony console command.
- [Testing](references/10-testing.md): when writing unit or functional tests for v14 code.
- [v14-only changes not handled by Rector](references/13-v14-only-changes-manual-not-handled-by-rector.md):
  when an API was removed or changed in v14 and needs a manual migration.
- [Upgrade process](references/11-upgrade-process.md): only for orientation; a real upgrade is
  `typo3-upgrade-run`.
- [Resources](references/12-resources.md) and [credits](references/credits-and-attribution.md): when
  linking upstream documentation or citing sources.
