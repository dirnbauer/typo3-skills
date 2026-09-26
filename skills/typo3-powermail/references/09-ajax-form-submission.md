# AJAX submission versus condition requests

```typoscript
plugin.tx_powermail.settings.setup.misc.ajaxSubmit = 1
```

This enables Powermail's submit behavior. It does **not** configure the separate typeNum 3132
condition endpoint. Test the two request flows independently, including invalid fields,
rapid change-then-submit, failed requests, duplicate clicks and final mail/storage/finishers.
Preserve form attributes emitted by the validation ViewHelper.

Source: [settings](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Configuration/TypoScript/Main/Configuration/02_Settings.typoscript).
