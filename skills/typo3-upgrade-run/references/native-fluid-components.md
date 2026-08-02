# Replacing fluid-components with native Fluid components

Use this playbook when `fluidtypo3/fluid-components` blocks the target or the project wants to
remove the extra rendering abstraction. Native TYPO3 Fluid components can preserve the existing
component namespace and template API, making this a controlled dependency replacement rather than
a frontend rewrite.

## Inventory before editing

Find every component definition and invocation, including templates stored outside the sitepackage:

```bash
grep -RIn '<fc:\|xmlns:fc\|fc:component\|fc:renderer\|fc:param' packages/ config/ fileadmin/
ddev mysql -N -e "SELECT uid,title FROM sys_template WHERE deleted=0
  AND (config LIKE '%fluid-components%' OR constants LIKE '%fluid-components%');"
```

Record the component names, arguments, optional/default values, CSS classes, FAL objects and link
values. Capture every page that renders one of them before changing the dependency.

## Register a native component collection

Create a collection in the sitepackage and keep the existing namespace where practical:

```php
<?php

declare(strict_types=1);

namespace Vendor\Sitepackage\Components;

use TYPO3Fluid\Fluid\Core\Component\AbstractComponentCollection;

final class ComponentCollection extends AbstractComponentCollection
{
    protected function getTemplateRootPath(): string
    {
        return 'EXT:sitepackage/Resources/Private/Components/';
    }
}
```

Register it from `ext_localconf.php`:

```php
$GLOBALS['TYPO3_CONF_VARS']['SYS']['fluid']['namespaces']['webcon'] = [
    \Vendor\Sitepackage\Components\ComponentCollection::class,
];
```

Adapt the namespace and path to the project; do not introduce a new tag prefix unless there is a
reason to change every caller.

## Translate the component contract

The mechanical mapping is small, but the values passed through it are the compatibility surface:

| fluid-components | Native Fluid component |
|---|---|
| `<fc:component>` / `<fc:renderer>` wrappers | component template file in the collection path |
| `<fc:param name="x" />` | `<f:argument name="x" />` |
| required parameter | `<f:argument name="x" optional="{false}" />` or the native required default |
| optional parameter | `<f:argument name="x" optional="{true}" />` |
| `{component.class}` used as a constant | preserve the old literal class unless callers override it |

Preserve argument names exactly. Content Blocks may pass a `TypolinkParameter` while a page
template passes a string; accept the real mixed input and hand it to `f:link.typolink` rather than
coercing away valid forms. Likewise, keep FAL `FileReference` objects intact for image ViewHelpers.

## Watch for truthiness changes

This migration can reveal output the old abstraction accidentally suppressed. A link object that
evaluated false in an old `f:if` may become a native Fluid value that renders correctly, restoring
missing teaser links. That is a bug fix, but it is still a visible difference:

1. prove the old and new values and count affected records/pages;
2. classify the restored output as a `declared-change` and obtain approval;
3. keep it covered by the before/after evidence instead of normalising the link away.

The same rule applies when Fluid omits a redundant `target="_self"`: it may be browser-equivalent,
but `target` is semantic markup and must remain visible to the comparison and classification flow.

## Removal gate

Remove `fluidtypo3/fluid-components` only when:

- no `fc:` tags, namespace declarations, TypoScript includes or database references remain;
- all component templates compile and every argument variant renders;
- FAL images and every link variant work on representative records;
- visual comparison is green apart from approved declared changes; and
- backend editing and cache warm-up are clean.

Record the replacement in `manifests/extensions.json` as `replaced`, including its evidence and any
declared-change approval.
