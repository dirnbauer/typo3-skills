# CKEditor 5 Architecture Gotchas

The public CKEditor 5 docs cover MVC architecture, schema syntax, conversion,
commands, events, widgets, and the data pipeline in full -- consult the
[official CKEditor 5 framework docs](https://ckeditor.com/docs/ckeditor5/latest/framework/architecture/intro.html)
for that reference material. This file only covers behavior that diverges
from what those docs suggest, found while building TYPO3 CKE5 plugins.

## figcaption Content Model Limitations

CKEditor 5's `ImageCaption` plugin registers `caption` with `allowContentOf: '$block'`, which includes inline text and inline elements but **NOT** `softBreak` (the internal model for `<br>`).

**Consequences:**
- `<br>` tags inside `<figcaption>` are stripped on save — both Shift+Enter and source-mode `<br>` fail
- This is a CKEditor 5 core limitation, not an extension bug
- Captions only wrap naturally based on container width

**CSS scoping:** Use `figure.image figcaption` (not bare `figure figcaption`) to target only CKEditor-generated figures and avoid affecting other `<figcaption>` elements on the page.

## Pitfall: View Elements Are Not DOM Elements

Inside upcast/downcast converter callbacks, the element you receive is a
**CKEditor 5 view element**, not a DOM element. View elements expose a
`getAttribute(key)` method that *mirrors the DOM API by name only* — it
reads from an internal attribute map. Crucially, view elements have:

- `getAttribute(key)` / `hasAttribute(key)` (returns strings / booleans)
- NO `.dataset` property
- NO `.classList` (use `hasClass()` / `getClasses()`, or use the
  view writer's `addClass` / `removeClass` for downcast)

Do NOT apply DOM-targeted lint rules (e.g. SonarCloud's
`javascript:S7761` "prefer `.dataset` over `getAttribute('data-*')`")
to converter callbacks. The auto-suggested transformation will silently
return `undefined` and drop every `data-*` attribute on upcast — the
failure is invisible to tests that mock the view tree.

### Identifying view-element callsites

When reviewing `getAttribute('data-*')` calls, look at sibling calls in
the same block:

| Sibling call | Context |
|---|---|
| `consumable.consume(el, { name: true })` | Upcast converter |
| `el.is('element', 'img')` | View tree pattern matching |
| `el.getChildren()` / `getChild(i)` | View tree traversal |
| `writer.setAttribute(...)` (with view writer) | Downcast converter |
| `editor.conversion.for('upcast')...` | Definitely view |

If any of these appear nearby, you're operating on a view element —
keep `getAttribute()`, do not introduce `.dataset`.

### When `.dataset` IS appropriate

Only convert when the receiver is a real DOM element. Examples in a
plugin context:

- `targetDoc.createElement('input')` then setting attributes
- `editor.editing.view.getDomRoot()` followed by DOM access
- Anything inside `editor.ui.componentFactory` callbacks that touches
  `<button>`, `<input>`, etc. directly via `domConverter.viewToDom(...)`

### Real-world case

In the t3x-rte_ckeditor_image SonarCloud evaluation (2026-05, PR #813),
53 of 54 `javascript:S7761` instances on `typo3image.js` were exactly
this false-positive class. The single true-DOM call (`hiddenInput` from
`createElement('input')`) was converted; the rest were left and bulk
marked won't-fix.
