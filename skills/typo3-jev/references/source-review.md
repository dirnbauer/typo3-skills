# Source evidence and verification

Reviewed **2026-09-26**. These are source-level findings for exact versions, not proof that an
arbitrary site or service version works. Original extension source is not vendored by this skill.

| Repository | Reviewed reference |
|---|---|
| [dirnbauer/typo3-webcon-jev](https://github.com/dirnbauer/typo3-webcon-jev) | Tag `v0.2.6`, commit `887692941cd413c9936c93dee77f4d8bc0f9464f` |
| [dirnbauer/powermail_cond](https://github.com/dirnbauer/powermail_cond) | `typo3-v14`, commit `fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1` |
| [dirnbauer/powermail](https://github.com/dirnbauer/powermail) | Tag `14.0.3.4`, commit `f58c5ff2b927f471985c19e6e366216df68cf54d` |

The [public Packagist metadata endpoint](https://repo.packagist.org/p2/webconsulting/webcon-jev.json)
returned HTTP **404** on this review date. The install recipe therefore supplies the scoped
GitHub VCS source; it does not assume public registry publication. Recheck availability when updating.

## Claim-to-source map

- Names, PHP/Core/vault requirements and optional integrations:
  [composer.json](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/composer.json).
- Effective configuration defaults:
  [Settings](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Configuration/Settings.php),
  [configuration template](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/ext_conf_template.txt).
- Vault-first resolution, environment fallback and frontend access:
  [TokenProvider](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Service/TokenProvider.php),
  [token import](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Command/ImportTokenCommand.php),
  [provisioner mutation](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Command/SetupProvisionerCommand.php),
  [ping](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Command/PingCommand.php).
- Module access and live-workspace scope:
  [module registration](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Configuration/Backend/Modules.php).
- Question payloads, outcome mappings and language lookup:
  [Question](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Client/Dto/Question.php),
  [DecisionQuestion](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Domain/Model/DecisionQuestion.php),
  [DecisionRepository](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Domain/Repository/DecisionRepository.php).
- State selection versus full-context output:
  [StateBuilder](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Service/StateBuilder.php),
  [FormStateCollector](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Powermail/FormStateCollector.php),
  [MailStateCollector](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Powermail/MailStateCollector.php).
- Confidence, defaults, caches, modeled failures and approximate call budget:
  [Answer](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Client/Dto/Answer.php),
  [DecisionOutcome](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Service/DecisionOutcome.php),
  [DecisionRunner](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Service/DecisionRunner.php),
  [RunLogger](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Service/RunLogger.php).
- Six operators, numeric thresholds, per-request memo and type-specific gating:
  [JevOperator](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Powermail/JevOperator.php),
  [JevRuleListener](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Powermail/JevRuleListener.php),
  [rule TCA](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Configuration/TCA/Overrides/tx_powermailcond_domain_model_rule.php).
- Start-field dispatch, false-branch inversion and iterative clearing:
  [Rule](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Classes/Domain/Model/Rule.php),
  [Condition](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Classes/Domain/Model/Condition.php),
  [ConditionContainer](https://github.com/dirnbauer/powermail_cond/blob/fc5324f9d22ee1bcd3515d3d2ca51793b5545ec1/Classes/Domain/Model/ConditionContainer.php).
- Recipient replacement, including a valid email default on fallback:
  [MailRoutingListener](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Powermail/MailRoutingListener.php),
  [form TCA](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Configuration/TCA/Overrides/tx_powermail_domain_model_form.php),
  [conditional listener registration](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Configuration/Services.php).
- Persistence/opt-in event boundary and request-local routing state:
  [Powermail FormController](https://github.com/dirnbauer/powermail/blob/f58c5ff2b927f471985c19e6e366216df68cf54d/Classes/Controller/FormController.php),
  [RoutingDecisionStore](https://github.com/dirnbauer/typo3-webcon-jev/blob/887692941cd413c9936c93dee77f4d8bc0f9464f/Classes/Powermail/RoutingDecisionStore.php).

## Documentation conflicts resolved from code

Do not repeat the README/comments' broader claims without checking implementation:

- “Form stays as built” on uncertainty: a rule returns false; the parent condition applies its
  opposite action. Visibility must be designed explicitly.
- “Default receiver always stays” on low confidence: `outcomeFor()` returns `defaultOutcome`;
  a valid email default is parsed and replaces the receiver list.
- “Every answer needs decision confidence”: noul rules use the raw probability answer.
- “Runner never throws”: only specific exception scopes are caught; infrastructure can fail.
- “Environment token is development-only”: no environment restriction is enforced.
- “Safe full form state”: excluded field types do not remove PII from the remaining fields.

## Offline probe

From the collection root, with a trusted checkout or installed package and PHP **8.4+**:

```bash
php -l skills/typo3-jev/examples/SupportDecision.php
php skills/typo3-jev/scripts/check-examples.php /path/to/webcon-jev
```

The probe loads selected original classes directly and constructs synthetic DTOs. It checks
the example's question payloads and state allowlist, choice mappings, exact confidence/score/
probability boundaries, missing/type-mismatched answers, aggregate-versus-question confidence,
and empty/email-valued defaults. Reflection invokes only the listener's pure answer selector,
`usableAnswer()`, for every operator case including the noul exception; it does **not**
instantiate the integration's repositories or runner.

It does not test full event dispatch, recipient delivery, condition inversion in TYPO3,
vault permissions, external API availability or classification quality. The broader source
review supplies the condition/routing interpretation; use a real authorized project fixture
for integration claims. Rerun on each supported source revision and record which was used.

No token or real visitor data is needed. The behavioral cases in `evals/evals.json` remain
**proposed** until human review and are not a claim of executed agent trials.
