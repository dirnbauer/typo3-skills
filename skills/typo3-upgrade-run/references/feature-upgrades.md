# Feature upgrades and post-invariance security headers

Phase P10, loops 200–220. Each runs **after** the core upgrade and **before** invariance closure,
and each is a declared-change loop: re-shoot the affected sample pages afterwards, and any rendering
change needs an approval per difference class or it is a `regression`.

## Mandatory Core Redirects baseline

Every whole-site upgrade includes the Core Redirects module. During P05, prove whether
`typo3/cms-redirects` is present with `ddev composer show typo3/cms-redirects`. If absent, add
`typo3/cms-redirects:^14.3` to the planned Core Composer transaction. Do not install `^14.0`, run a
broad unrelated update, or silently change automatic-redirect settings.

After Composer resolves the target, take the operation snapshot required for stateful setup and run:

```bash
ddev typo3 extension:setup --extension redirects
ddev typo3 extension:list --all
ddev typo3 redirects:checkintegrity
```

Require extension key `redirects`, the `sys_redirect` schema, and zero unresolved integrity errors.
Resolve backend identifiers from the v14 runtime `ModuleRegistry`; the v14.3 module identifier is
`redirects`, while `site_redirects` is a compatibility alias and must not be persisted in new group
configuration.

Use `typo3-backend-rights` to grant the capability through the audited main editor group for the
named trusted editors, never directly to users:

- add module `redirects`;
- add `sys_redirect` to both `tables_select` and `tables_modify`;
- add every runtime editor-editable `sys_redirect` exclude field, but not read-only, passthrough,
  generated, hit-count or other system-managed fields;
- preserve existing user memberships unless replacement was explicitly approved;
- do not add `qrcodes` or `short_urls` unless separately requested.

This permission is installation-wide. TYPO3 explicitly warns that an editor with it can affect all
redirects, so do not infer that every non-admin group should receive it. If no trusted target group
or user is named, installation may proceed but Contract A closure is blocked on the permission
decision rather than granting access broadly.

Verify with a real non-admin session: open **Link Management > Redirects**, list records, create a
DDEV-only test source path to an accessible local target, request it, edit/disable/delete it, and
prove cleanup. Then rerun `redirects:checkintegrity` and request a representative sample of existing
source paths before and after the update. See the official [Redirects 14.3 setup](https://docs.typo3.org/c/typo3/cms-redirects/14.3/en-us/Setup/Index.html).

## Loop 200 — Solr

Only when the site uses `EXT:solr`.

### Isolation gate before any mutation

A core called `core_de` is not an identity. Before clear, delete, configset replacement, reload or
full reindex, record the DDEV project, Solr container/service, origin reached **from that project**,
TYPO3 site/language core name and current document count. List the cores from that origin and
require the configured core to match exactly. A host port, `localhost`, generic container or
ambiguous core is exit 5; do not probe by clearing it.

Create and checksum a rollback archive of the exact core/configset, then re-resolve all identity
fields immediately before the destructive request. A DDEV database snapshot is not a Solr backup.
Afterwards prove queue errors are zero, expected document classes/counts exist, and a seeded query
has the expected ordering, empty result and pagination behavior. This gate exists because a local
run once emptied another project's `core_de` through a generic endpoint.

1. Read the [EXT:solr version matrix](https://docs.typo3.org/p/apache-solr-for-typo3/solr/main/en-us/Appendix/VersionMatrix.html)
   for the row matching TYPO3 14.3.
2. Update the local DDEV Solr service through the official `ddev/ddev-solr` add-on to that Apache
   Solr version, with the matching configset.
3. Update EXT:solr, search templates and configuration following the `typo3-solr` skill.

Require the 14 line with a **per-package stability flag**:

```bash
ddev composer require apache-solr-for-typo3/solr:"^14.0@RC"
```

That line is currently a release candidate. The flag loosens stability for this one package while
leaving the project's global `minimum-stability: stable` and `prefer-stable: true` intact, and it
needs no later edit — Composer prefers the stable 14.0.0 automatically once it ships.

**Never loosen global stability to install a single package.** Verify the resolved version and its
TYPO3 requirement before continuing.

Exit: index queue rebuilt and fully reindexed; the backend Info module shows the site as active;
frontend search verified including empty and paginated results.

## Loop 210 — Visual Editor

Require the latest v14-compatible `friendsoftypo3/visual-editor`, verified on Packagist at execution
time. Migrate the Fluid templates with the `typo3-visual-editor` skill — `f:render.text`, content
areas, colPos migration.

Content Blocks need a `record-transformation` data processor that runs before their priority-10
rendering processor (for example at key `5`) so `f:render.text` receives a Record object. Adjacent
editable content areas must not share the same parent element; add separate, edit-mode-only wrappers
when the normal frontend structure places them next to each other, then prove normal-mode DOM and
pixels remain unchanged.

Exit: inline editing verified on a representative page in the backend, **and frontend rendering
unchanged** — the visual sample is what proves the second half.

## Loop 220 — CKEditor RTE

Migrate old RTE presets into the current v14 `rte_ckeditor` YAML: import the old settings, drop
obsolete keys, and verify every option against the installed version.

Enable **text part language** so editors can mark passages with `<span lang="…">` for the site's
configured languages, and add **abbreviation support** through a maintained CKEditor 5 plugin
extension found on TER or Packagist and verified against v14 — never guess plugin package names.

Prefer standalone presets during a major migration. Merging inherited heading arrays can register
duplicate CKEditor model names and break editor boot without an obvious YAML error. Custom v14 ESM
plugins import UI icons such as check/cancel from `@ckeditor/ckeditor5-icons`, not
`@ckeditor/ckeditor5-core`; verify the installed exports and version the module URL after changing a
failed import so the browser cannot retain the old graph.

Align the editor's content styles with the frontend, but scale down oversized elements (a very large
`h2`, for example) for editing ergonomics.

### Both features need styling on both sides

Semantic markup nobody can see does not survive the next editing round.

**Backend**, via `editor.config.contentsCss` in the preset: give `abbr[title]` and `span[lang]` a
visible affordance in the editing area — a dotted underline plus `cursor: help` for abbreviations, a
subtle marker for language spans — so editors can find, verify and maintain what they inserted.

TYPO3 v14 renders CKEditor inline and auto-prefixes this file client-side, so `:root` and `body`
rules work and resolve to the `.ck-content` scope. The file is browser-cached: append a `?v=`
parameter to the path and bump it after every change, or edits appear to do nothing.

**Frontend**, via the Vite/SCSS pipeline: give `abbr[title]` a consistent affordance across browsers,
whose native rendering is inconsistent, and keep the expansion understandable without hover — touch
and keyboard users cannot hover. Leave `span[lang]` visually **undecorated**: it is semantic markup
for assistive technology, not decoration for readers. Let the attribute do its typographic work
through `:lang()` rules for hyphenation, quotation marks and font stack.

Frontend CSS changes rendering, so this loop follows the re-shoot and approval rule.

Exit: open a rich-text element and confirm the preset loads with language and abbreviation controls,
applies the intended styling, and shows the affordances on marked-up text; confirm the same markup
renders correctly in the frontend; confirm the accessibility re-check stays green.

## Contract B loop 530 — Security headers

This is a post-invariance elevation loop. It may begin only after Contract A is closed, with a
recorded intent approval and a derived Contract B baseline. Header differences are expected output
of this loop and therefore cannot be introduced while proving the original rendering contract.

Apply the `typo3-security` checklist: HSTS, `X-Content-Type-Options`, `X-Frame-Options` /
`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, `trustedHostsPattern`, backend hardening,
and CSP through the TYPO3 v14 CSP API — configured at **a single layer without conflicting
duplicates**.

Verify the header values on DDEV responses. Differences that exist only on production layers (proxy,
CDN) belong in the deployment handover and are **never** applied to live from here.

Note honestly what DDEV cannot prove: DDEV terminates its own TLS, so HSTS is *present* locally but
only *meaningful* on the production layer; third-party embeds that exist only on live can hide CSP
violations that would appear in production. Both go into the handover as named gaps.

Exit: headers verified on DDEV responses at a single layer, no duplicates, and a Playwright walk of
the sample plus the backend module sweep records zero CSP violations.
