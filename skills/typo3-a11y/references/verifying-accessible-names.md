# Verifying accessible names — measure, do not reason

**When to load:** before claiming that an element has (or lacks) an accessible
name, before shipping an icon-only control, and whenever a Bootstrap tooltip or
popover sits on a page you are making accessible.

Accessible names are the one part of accessibility work where careful reasoning
loses to a five-line measurement. The rules are conditional in ways that read as
arbitrary — `title` is a name here and a description there — and every wrong
guess ends up in a merge request as a claim about users.

## Reading the real accessibility tree

Playwright removed `page.accessibility` in 1.62. Use CDP: resolve nodes through
the DOM domain, then ask the accessibility domain about them.

```python
def ax(cdp, selector, index=0):
    """role / name / description of the nth match, from Chrome's own tree."""
    root = cdp.send("DOM.getDocument", {"depth": -1})["root"]["nodeId"]
    ids = cdp.send("DOM.querySelectorAll", {"nodeId": root, "selector": selector})["nodeIds"]
    if index >= len(ids):
        return None
    n = cdp.send("Accessibility.getPartialAXTree",
                 {"nodeId": ids[index], "fetchRelatives": False})["nodes"][0]
    return {
        "ignored": n.get("ignored"),
        "role": (n.get("role") or {}).get("value"),
        "name": (n.get("name") or {}).get("value"),
        "description": (n.get("description") or {}).get("value"),
        "nameSources": [s.get("type")
                        for s in (n.get("name") or {}).get("sources", [])],
    }

cdp = context.new_cdp_session(page)
cdp.send("Accessibility.enable")
```

`nameSources` is the part worth reading: it lists what Chrome *tried*. When
`title` is missing from that list, no amount of arguing about the accname spec
will put it there.

`ignored: true` with `ignoredReasons: ["notRendered"]` is the normal answer for
an element hidden at the current breakpoint — measure at both widths before
counting how many controls a user meets. A `d-md-none` duplicate and its
`d-none d-md-block` sibling are two DOM nodes and one user-visible control.

## Four rules that surprise people

**1. `title` is not always the name.** On a non-focusable element with role
`generic`, Chrome routes `title` to the *description* and leaves the accessible
name empty. Give the same element `tabindex="0"` — or a naming role such as
`role="img"` — and the same `title` becomes the name. So "it has a title, that
is its name" is true or false depending on whether the element can be focused.

| markup | name | description |
| --- | --- | --- |
| `<i class="fas fa-info-circle" title="…">` | *(empty)* | the title text |
| `<i tabindex="0" title="…">` | the title text | *(none)* |
| `<i role="img" title="…">` | the title text | *(none)* |
| `<button title="…"><i aria-hidden></i></button>` | the title text | *(none)* |

"The text is unreachable" and "the element has no accessible name" are different
claims. An unnamed generic node whose description carries the sentence is still
in the tree — say what you measured, not what you concluded.

**2. Bootstrap's tooltip rewrites the trigger.** `Tooltip._fixTitle()` runs at
construction: on a trigger with no text content and no `aria-label`, it copies
`title` into `aria-label`, removes `title`, and stores the original in
`data-bs-original-title`. That gives an icon-only trigger a name — and then
name-from-contents welds that name into the container:

```text
before init   h3 name = "Downloads by month "
after  init   h3 name = "Downloads by month Packagist downloads are
                         fetched during the day and are not up-to-date."
```

A heading whose name carries a 71-character sentence is unusable for heading
navigation. If a trigger sits inside a heading or a `<dt>`, pin the container's
own name (`aria-label`, wired to the same translation key as the visible text)
or move the trigger out.

**3. Icon fonts leak private-use glyphs into names.** An `<i>` from FontAwesome
renders its glyph through `::before`. Without `aria-hidden="true"` that
character becomes part of the ancestor's name-from-contents — `"Downloads by
month "`. It is invisible in a terminal, and `jq` output swallows it, so
it survives review. Grep your measured names for `\uf0`–`\uf2` ranges.

**4. Focus rings are theme-dependent.** Do not assume a focusable control shows
one. On a Bootstrap theme that sets `--bs-btn-focus-box-shadow`, `.btn:focus-visible`
can resolve to `outline: none` with only an elevation shadow — a keyboard user
sees nothing. Read the computed value:

```python
page.evaluate("() => getComputedStyle(document.activeElement).outline")
# "1px auto rgb(16, 16, 16)"  ← the browser default, present
# "rgb(0, 0, 0) none 0px"     ← themed away
```

## Making an icon-only trigger accessible without changing the rendering

The pattern that measured clean — focusable, named, tooltip on focus, and
**zero differing pixels** against an icon-only original at desktop and mobile
width:

```html
<button type="button"
        class="border-0 bg-transparent p-0 lh-1 align-baseline text-reset"
        data-bs-placement="right" data-bs-toggle="tooltip"
        title="Packagist downloads are fetched during the day and are not up-to-date.">
    <i class="fas fa-info-circle" aria-hidden="true"></i>
    <span class="visually-hidden">More information about the download count</span>
</button>
```

* `border-0 bg-transparent p-0 lh-1 align-baseline text-reset` is the reset that
  keeps a `<button>` looking like the `<i>` it replaced. Do **not** reach for
  `btn btn-link p-0`: `.btn` imposes its own `font-size`, so an icon inside an
  `<h3>` drops from 28px to 19px, recolours, and loses the focus ring.
* The visually hidden label gives a short name; the `title` stays the tooltip
  text and becomes the description. Name and description differ, so nothing is
  announced twice.
* `aria-hidden` on the icon removes the glyph from every ancestor name.
* Bootstrap's default trigger is `hover focus`, so the tooltip opens on focus —
  but verify it, and verify that it closes on blur (`.tooltip` node count 1 → 0).

Prove the rendering did not move rather than eyeballing it: element screenshots
before and after, compared pixel by pixel.

```python
from PIL import Image, ImageChops
d = ImageChops.difference(Image.open("before.png").convert("RGB"),
                          Image.open("after.png").convert("RGB"))
assert d.getbbox() is None, "rendering changed"
```

Different image dimensions mean the box changed size — compare the numbers
first, since `getbbox()` cannot answer at all in that case.

## Bootstrap 5 badges: white text by default

`.badge` sets `--bs-badge-color: #fff` and no background. Three consequences:

* Bootstrap 4 class names (`badge-success`, `badge-danger`) do nothing in
  Bootstrap 5 — the badge keeps white text on the surrounding background. On a
  white table row that is **white on white**, 1:1, text present in the DOM and
  invisible on screen.
* `bg-*` paints the background but leaves the text white. Fine for a dark
  colour, a failure for a light one: white on `#ff9a00` is 2.13:1.
* `text-bg-*` sets both, choosing the foreground per background — white on a
  dark colour, black on a light one.

Which foreground `text-bg-*` picks is decided at build time by
`$min-contrast-ratio` (Bootstrap's default is 4.5; a project that lowers it to
2.4 keeps white text on colours that fail AA). That is a SCSS decision in the
theme, not something a template can fix — when `text-bg-*` leaves a variant
below 4.5:1, the palette owner has to decide, and the template change alone
should not be reported as a fix.
