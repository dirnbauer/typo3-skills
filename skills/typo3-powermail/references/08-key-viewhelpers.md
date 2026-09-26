# ViewHelper verification

Use the namespace and arguments from the installed partial you are extending.
Do not infer signatures from ViewHelper names or copy older parameter lists.

```bash
rg --files vendor/in2code/powermail/Classes/ViewHelpers
rg -n 'registerArgument|function render' vendor/in2code/powermail/Classes/ViewHelpers
```

For conditional forms, preserve `validation.enableJavascriptValidationAndAjax` on the form.
Read [conditions](../SKILL-CONDITIONS.md) for the upload-exclusion attribute and optional
ConditionsViewHelper prerendering. The latter belongs to PowermailCond, not Powermail.

Source: [ViewHelpers](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/ViewHelpers).
