# Email and form templates

Copy only the needed installed template/partial into the sitepackage; leave vendor files intact.
Use additional root paths and preserve inherited defaults:

```typoscript
plugin.tx_powermail.view {
    templateRootPaths.10 = EXT:sitepackage/Resources/Private/Templates/Powermail/
    partialRootPaths.10 = EXT:sitepackage/Resources/Private/Partials/Powermail/
    layoutRootPaths.10 = EXT:sitepackage/Resources/Private/Layouts/Powermail/
}
```

Mail templates include `Mail/ReceiverMail.html`, `Mail/SenderMail.html` and
`Mail/OptinMail.html`; form templates include `Form/Form.html`, `Form/Create.html`
and `Form/Confirmation.html`. Inspect the exact installed file and assigned variables.
Do not print every answer with a generic string loop: arrays/uploads/passwords require the
shipped formatting and exclusion rules. Never output user values with `f:format.raw`.

For conditions, preserve field names, wrapper marker classes, form UID, AJAX attributes and
multistep controls. Test overrides against the installed frontend JS, not just rendered HTML.

Sources: [templates](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Resources/Private/Templates),
[partials](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Resources/Private/Partials).
