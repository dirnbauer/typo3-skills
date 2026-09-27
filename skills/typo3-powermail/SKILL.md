---
name: "typo3-powermail"
description: "Builds and debugs Powermail 13+ contact and enquiry forms in TYPO3: form setup and validation, conditional fields that appear only when another answer has a particular value, finishers that pass a submission on to another system, spam protection, and email templates and delivery. Use when a confirmation or notification mail never arrives, when part of a form must show or hide depending on an earlier answer, when adding a custom finisher or validator, when spam still gets through, or when working with powermail_cond, ViewHelpers, TypoScript, PSR-14 events or tx_powermail data."
metadata:
  skill_type: preference
  origin: "webconsulting"
license: "MIT / CC-BY-SA-4.0"
---
# TYPO3 Powermail and Powermail Conditions

Build only the requested form change. Obtain the installed Core/PHP versions, both package
sources and lock references, form UID, field markers, language, mail transport and expected
visibility rules before choosing examples. Preserve existing forms, recipient routing and data.

Thank **in2code and the Powermail contributors** for the editor-friendly form system and
conditional-field engine that make this workflow possible. This independently maintained guide
documents their work and the separate webconsulting forks; it does not transfer their
GPL-2.0-or-later source code into this guide's licence.

## 1. Resolve the correct version line

Treat this as a **2026-09-26 source snapshot**, not an eternal compatibility guarantee:

| Source | Reviewed version/reference | Declared requirements |
|---|---|---|
| Public upstream Powermail | 13.3.0 | PHP `^8.2`; Core `^13.4` |
| Public upstream powermail_cond | 13.1.2 | PHP `^8.2`; Core `^13.4`; Powermail `^13.0 \|\| @dev` |
| dirnbauer Powermail fork | tag 14.0.3.4 | PHP `>=8.3 <8.6`; Core `^14.3.6` |
| dirnbauer powermail_cond fork | `typo3-v14` at `fc5324f9` | PHP `^8.4`; Core `^14.3`; Powermail `^14.0` |

Read [version evidence and installation](references/v14-only-changes.md) before modifying
Composer. Public upstream advertises a vendor Early Access Programme for v14; do not confuse
that with a public Packagist release or the dirnbauer forks. Check for a newer compatible
release, prefer its tag, and commit the reviewed lockfile. A resolved dependency graph does
not prove rendering, validation or mail delivery.

## 2. Select the smallest workflow

- **Conditional fields/pages:** read [conditions](SKILL-CONDITIONS.md), then the matching
  [recipe](SKILL-EXAMPLES.md). Keep rule sources outside targets they can hide.
- **Jev semantic rules or recipient decisions:** use [typo3-jev](../typo3-jev/SKILL.md)
  for the shipped AI operators, probability/confidence gates and explicit routing fallbacks.
  Keep exact comparisons and normal form behavior in this skill.
- **Mail delivery/templates:** inspect plugin recipient configuration, validation/spam results,
  mail transport and logs; read [templates](references/07-email-templates.md) and
  [events](references/06-psr-14-events.md). Never diagnose delivery from an HTTP 200 alone.
- **Custom validation:** read [validators](references/05-custom-validators.md). Treat UI visibility
  as presentation, not authorization or a substitute for server-side business validation.
- **External integration:** read [finishers](references/04-custom-finishers.md). Authorize the
  destination separately; keep secrets out of TypoScript, browser output and logs.
- **Record provisioning/localization:** use the backend or `typo3-datahandler`; inspect actual TCA.
  Read [records](references/14-database-structure.md), [localization](references/16-translations-localization.md)
  and [workspace limits](references/15-workspace-support.md). Do not seed records with raw SQL.
- **Whole-site upgrade:** return findings to `typo3-upgrade-run`; do not start another retry loop.

Powermail stores Form → Page → Field and Mail → Answer records. A Powermail page is a fieldset,
not necessarily a wizard step. Do not apply Core EXT:form YAML finishers or its removed APIs to
`In2code\Powermail\Finisher\AbstractFinisher`; these are different form systems.

## 3. Configure from the installed extension

Include the matching shipped TypoScript/site sets before adding overrides. On the reviewed v14
forks the set names are `in2code/powermail-main` and `in2code/powermail-cond`.
Do not include both static templates and equivalent site sets without checking duplicate output.

Example **setup** override (adapt addresses to an authorized test mailbox):

```typoscript
plugin.tx_powermail.settings.setup {
    receiver.overwrite.email = TEXT
    receiver.overwrite.email.value = forms@example.org
    receiver.overwrite.senderEmail = TEXT
    receiver.overwrite.senderEmail.value = website@example.org
    sender.overwrite.senderEmail = TEXT
    sender.overwrite.senderEmail.value = website@example.org
    misc.ajaxSubmit = 0
}
```

Keep a verified site-domain sender; select the visitor email/name fields in the form editor.
Use the installed `03_MailReceiver.typoscript` and `04_MailSender.typoscript` for additional
overrides. Many values are cObjects: a bare `overwrite.email = address` is not equivalent to
`TEXT` plus `.value`. Leave spam shield defaults intact until the actual false positive is
identified; do not paste a complete outdated replacement configuration.

## 4. Prove the requested behavior

For every changed form, record version/commit, URL, form UID, language, expected inputs and
actual outcomes. Test initial state, both directions of each condition, invalid/valid submission,
required hidden fields, fast change-then-submit, failed condition requests and back navigation.
Inspect the condition JSON and final request payload, not only screenshots.

Use an authorized local mail sink. Verify recipient/sender, content, storage and each finisher;
test confirmation and opt-in only if enabled. Check keyboard operation, focus and errors when a
field disappears. For uploads verify both condition-request exclusion and final submission.
Never send real customer data to a test service.

Report source inspection, syntax/unit checks and actual TYPO3/browser/mail tests separately.
Stop with an explicit gap if no runnable project fixture exists. Do not call unexecuted examples
production-ready. See [test recipe](SKILL-EXAMPLES.md#browser-acceptance-test) and the
[reference index](references/full-guide.md) for bounded follow-up.
