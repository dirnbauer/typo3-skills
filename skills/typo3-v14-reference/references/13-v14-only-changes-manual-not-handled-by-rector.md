# 13. v14-Only Changes (Manual — Not Handled by Rector)

Continues `typo3-v14-reference` from [full guide](full-guide.md).

## 13. v14-Only Changes (Manual — Not Handled by Rector)

> The following changes apply **exclusively to TYPO3 v14** and require **manual migration**.
> They are NOT fully covered by `ssch/typo3-rector` (check your installed version; the TYPO3 14 rule set counts **tens** of rules and changes between releases).
> For automated migrations, run `Typo3LevelSetList::UP_TO_TYPO3_14` first, then address these manually.

### Extbase follows fallbackType **[v14.3.6+]**

A **patch update** changes what translated pages show. Where Extbase overlays a record with its
translation, 12.4, 13.4 and 14.3.0–14.3.5 do it the `fallback` way, whatever the site language says;
from **14.3.6** Extbase takes the overlay type from the site language ([Important-88886](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.3.x/Important-88886-ExtbasePersistenceRespectsLanguageOverlayType.html),
[review 66694](https://review.typo3.org/c/Packages/TYPO3.CMS/+/66694)). Rector, Fractor and the
extension scanner do not flag it. A translated language without a `fallbackType` key is `strict`:
`SiteLanguage` defaults to it.

| `fallbackType` | Overlay type (`LanguageAspect::`) | Extbase from 14.3.6 |
|---|---|---|
| `strict`, or not set | `OVERLAYS_ON_WITH_FLOATING` | Only records that exist in that language: translations and records created in it. **Changed** |
| `fallback` | `OVERLAYS_MIXED` | Translations, and the default-language record where none exists. Unchanged |
| `free` | `OVERLAYS_OFF` | Only records stored in that language; `findByUid()` and relations still overlay mixed. Unchanged |

Records with `sys_language_uid = -1` appear in every language; the default language is not affected.
The change sits in the overlay step, not in the SQL of a list. On a `strict` language:

- **Identity lookups** return `null` for a default-language record without a translation, where
  13.4 returned that record: `Repository::findByUid()`, `findByIdentifier()` and every action
  argument mapped from a uid (detail views).
- **Relations** of a translated record lose children without a translation in that language:
  categories, tags, related records.
- **Queries with `setRespectSysLanguage(false)`** drop untranslated default-language rows.
- **Lists with the default query settings keep their items.** Their SQL already left untranslated
  default-language records out on `strict` before 14.3.6; the Core's functional tests for the
  change only changed relation expectations.
- A record an Extbase frontend form creates is stored with `sys_language_uid = 0` and stays
  invisible on a `strict` language until somebody translates it.

Measured on 14.3.7 with EXT:news 14.1.1 (42 news, 22 translated into the probed language): the
`strict` list returned 22 items, the `fallback` list 42; `findByUid()` of an untranslated news
returned `null`; a translated news lost its untranslated category. The listener below restored
the lookup and the category and left the list at 22.

**Who meets it.** Every Extbase plugin with translatable records on a `strict` language.
EXT:news (`georgringer/news`): a detail URL of an untranslated news item that 13.4 rendered in the
default language now answers 404 (news's default `detail.errorHandling`); the selected-list plugin
without `orderBy` and the selected tags of a tag-filtered list lose untranslated records;
translated news lose untranslated categories, tags and related news. News's
`disableLanguageOverlayMode` forces `OVERLAYS_OFF` (`free`), not the old result. powermail loads
the form a plugin selects by uid: an untranslated form is not found, and untranslated pages and
fields drop out of a translated form. Blog, tt_address and custom repositories follow the same
rules.

**Detect.**

```bash
# Translated languages and their fallbackType; a language without the key is strict
grep -nE '^\s*(-\s*)?(languageId|fallbackType):' config/sites/*/config.yaml
# Extbase plugins in content: CType on 14, list_type (with CType 'list') on 12.4/13.4
ddev mysql -e "SELECT CType, COUNT(*) FROM tt_content WHERE deleted=0 GROUP BY CType"
# Visible records per language: own records and translations
ddev mysql -e "SELECT sys_language_uid, COUNT(*), SUM(l10n_parent > 0) FROM tx_news_domain_model_news
  WHERE deleted=0 AND hidden=0 AND t3ver_wsid=0 GROUP BY sys_language_uid"
```

Then request every translated list page and a sample of detail URLs per language, before and after
the update, and compare item counts and HTTP status codes (the [news count check](../../typo3-news-tags/SKILL.md#11-news-in-translated-languages-from-typo3-1436-fallbacktype)).

**Options.** The owner decides per project, before the update reaches production:

1. **Translate the records**, with their categories, tags and related records. `strict` then does
   what the site configuration says. New content needs the same: an untranslated new record does
   not appear on that language.
2. **Keep the 13.4 result in code**, scoped to the plugins that need it. Only queries without the
   language restriction changed, so `OVERLAYS_MIXED` on exactly those restores the old identity
   lookups and relations, and lists stay as they are:

   ```php
   <?php

   declare(strict_types=1);

   namespace Vendor\Sitepackage\EventListener;

   use TYPO3\CMS\Core\Attribute\AsEventListener;
   use TYPO3\CMS\Core\Context\LanguageAspect;
   use TYPO3\CMS\Extbase\Event\Persistence\ModifyQueryBeforeFetchingObjectDataEvent;

   /** Keeps the pre-14.3.6 overlay for EXT:news lookups and relations on strict languages. */
   #[AsEventListener(identifier: 'sitepackage/news-mixed-overlay')]
   final class NewsMixedOverlay
   {
       public function __invoke(ModifyQueryBeforeFetchingObjectDataEvent $event): void
       {
           $query = $event->getQuery();
           $settings = $query->getQuerySettings();
           $aspect = $settings->getLanguageAspect();
           if ($settings->getRespectSysLanguage()
               || $aspect->getOverlayType() !== LanguageAspect::OVERLAYS_ON_WITH_FLOATING
               || !str_starts_with($query->getType(), 'GeorgRinger\\News\\')
           ) {
               return;
           }
           $settings->setLanguageAspect(new LanguageAspect(
               $aspect->getId(),
               $aspect->getContentId(),
               LanguageAspect::OVERLAYS_MIXED,
               $aspect->getFallbackChain(),
           ));
       }
   }
   ```

   The event fires before every Extbase fetch, relations included; a relation query's type is the
   related model (`GeorgRinger\News\Domain\Model\Category`, `Tag`, `News`), so the namespace check
   keeps the listener to one extension. In your own repository, set the same aspect on one query
   (the changelog's snippet). On a list query that keeps the language restriction `OVERLAYS_MIXED`
   is **not** the old result: it adds the untranslated default-language records (`fallback`), and
   so does setting it through news's `ModifyDemandRepositoryEvent`.
3. **Set `fallbackType: fallback`** on that language. Extbase then shows default-language records
   where no translation exists, and **page content falls back the same way**: untranslated content
   elements appear in the default language. That is a visible change for the whole language: owner
   approval and a before/after proof of the affected pages, never a silent edit during an update.

Outside the frontend (backend modules, CLI commands, middlewares) no site language sets the aspect:
Extbase reads only default-language records until code sets one, through
`LanguageAspectFactory::createFromSiteLanguage()` or a constructed `LanguageAspect`.

Sources: [Extbase and Translations: The Full Picture](https://news.typo3.com/article/extbase-and-translations-the-full-picture)
(TYPO3 news, 2026-10-07), [Localization in Extbase: site configuration](https://docs.typo3.org/permalink/t3coreapi:extbase-localisation-site-configuration),
[setting the language per query](https://docs.typo3.org/permalink/t3coreapi:extbase-localisation-query-settings),
[outside the frontend](https://docs.typo3.org/permalink/t3coreapi:extbase-localisation-no-frontend),
[records shared across sites](https://docs.typo3.org/permalink/t3coreapi:extbase-cross-site) (language
IDs are site-specific; match languages by locale).

### Fluid 5.0 Template Changes **[v14 only]**

Rector handles PHP-side ViewHelper declarations (`UseStrictTypesInFluidViewHelpersRector`), but Fluid **template** changes require manual review:

- ViewHelper arguments in `.html` templates must match strict types (e.g., `tabindex` must be int, not string).
- Fluid variable names with **underscore prefix** (`_myVar`) are disallowed — rename in all templates.
- CDATA sections in Fluid templates are **no longer removed** automatically.
- Use `{variable as type}` casting for ambiguous ViewHelper arguments.

### TypoScriptFrontendController Removed **[v14 only]**

Not covered by Rector — context-dependent migration requiring manual analysis:

- `$GLOBALS['TSFE']` and `TypoScriptFrontendController` are fully removed.
- Each usage needs different request attribute replacements:
  ```php
  // ❌ Removed in v14
  $tsfe = $GLOBALS['TSFE'];
  
  // ✅ TYPO3 v14 pattern
  $pageInformation = $request->getAttribute('frontend.page.information');
  $language = $request->getAttribute('language');
  $typoscript = $request->getAttribute('frontend.typoscript');
  ```

### Backend Module Renaming **[v14 only]**

Not a PHP migration — requires manual update to `Configuration/Backend/Modules.php`:

| Old Parent | New Parent |
|------------|------------|
| `web` | `content` |
| `file` | `media` |
| `tools` | `admin` **or** `system` (Core split tools into multiple parents — map each module to its new parent in `Configuration/Backend/Modules.php`) |

### Runtime TCA Modifications Forbidden **[v14 only]**

`$GLOBALS['TCA']` is **read-only after boot** in TYPO3 v14 — stricter than older majors. Static TCA under `Configuration/TCA/` has been the supported approach **since v12**; extensions still mutating TCA from `ext_tables.php`, middleware, or event listeners must be refactored (architectural change, not a one-line replace).

### Plugin Subtypes Removed **[v14 only]**

- **`switchableControllerActions`:** deprecated in **TYPO3 v10.3** ([#89463](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/10.3/Deprecation-89463-SwitchableControllerActions.html)) and removed later — not a v14-only topic, but legacy FlexForm/plugins may still reference it until you split plugins.
- **`list_type` subtypes / plugin list types:** further tightened in **v14** (#105538) — each variant needs its own `configurePlugin()` / registration and TypoScript/FlexForm split.

### EXT:form Hooks → PSR-14 Events **[v14 only]**

Hook-to-event migration requires manual rewrite of hook implementations:
- EXT:form hooks removed across multiple breaking changes (e.g., #107566 for `afterInitializeCurrentPage`, #107518, #107528, #107568, #107569, #107343, #107380, #107382, #107388, #98239): `beforeRendering`, `afterSubmit`, `initializeFormElement`, `beforeFormSave`, `beforeFormDelete`, `beforeFormDuplicate`, `beforeFormCreate`, `afterBuildingFinished`, `beforeRemoveFromParentRenderable`, `afterInitializeCurrentPage`.
- Replace with corresponding PSR-14 events (e.g., `BeforeFormIsSavedEvent`, `BeforeRenderableIsRenderedEvent`).

### Frontend Asset Pipeline **[v14 only]**

Rector removes PHP configuration (`RemoveConcatenateAndCompressHandlerRector`), but the **infrastructure replacement** is manual:
- CSS/JS concatenation and compression removed from TYPO3 Core entirely.
- Must configure web server compression (nginx gzip, Apache mod_deflate) or use build tools (Vite, webpack).
- TypoScript `config.concatenateCss`, `config.compressCss`, `config.concatenateJs`, `config.compressJs` must be removed (handled by Fractor, not Rector).

### New TCA Features **[v14 only]**

New features to adopt (not migrations):
- **New TCA type `country`** (#99911) for country selection fields.
- **New `itemsProcessors`** option (#107889) for dynamic item generation.
- **Type-specific `title` (and `previewRenderer`) in TCA `types`** — [Feature #108027](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Feature-108027-Type-SpecificCtrlPropertiesInTCATypes.html) (not “arbitrary ctrl copies” per type — see changelog).
- **Type-specific TCA defaults** (#107281).

### New Fluid ViewHelpers **[v14 only]**

- `<f:page.meta>` — set page meta tags from Fluid templates.
- `<f:page.title>` — set page title from Fluid templates.
- `<f:page.headerData>` / `<f:page.footerData>` — inject raw HTML into head/footer ([Feature #107056](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Feature-107056-IntroduceHeaderDataAndFooterDataViewHelpers.html)).

### Localization System **[v14 only]**

Rector handles parser class replacement (`ReplaceLocalizationParsersWithLoaders`) and label syntax (`MigrateLabelReferenceToDomainSyntaxRector`), but these features are new:
- **XLIFF 2.x** translation files supported alongside XLIFF 1.2.
- **Translation domain mapping** (#93334) for flexible XLIFF file resolution.

### New DataHandler Features **[v14 only]**

- **`discard` command** (#107519) — discard workspace changes programmatically.
- **ISO8601 date handling improved** — qualified and unqualified ISO8601 dates supported.

### v14.1 Features **[v14.1+ only]**

Verify each item in the [official v14.1 changelog](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog-14.html) for your minor (entries change over time). Examples that have appeared in v14.1 discussions include **default theme “Camino”**, **per-column content restrictions**, **Fluid Components** tuning, and **PHP 8.5** support — confirm before documenting them for a specific project.

### v14.2 Features **[v14.2+ only]**

- **Backend search by frontend URL** — find pages by their frontend URL in page tree and live search.
- **Workspace selector moved to sidebar** with color and description.
- **Extbase identity map language-aware** — identity map now considers language when resolving objects.
- **XLIFF `xml:space` attribute** — whitespace handling respects the attribute.
- **QR Code for frontend preview** — downloadable QR codes (PNG/SVG) for frontend URLs.

### New v14 Deprecations (removed in v15) — Not Yet Handled by Rector

**v14.0 (examples):**

- `ExtensionManagementUtility::addPiFlexFormValue()` ([#107047](https://docs.typo3.org/c/typo3/cms-core/main/en-us/Changelog/14.0/Deprecation-107047-ExtensionManagementUtilityAddPiFlexFormValue.html)) — use direct FlexForm TCA.

**v14.2+ examples:**

- `ExtensionManagementUtility::addFieldsToUserSettings` (#108843) — use TCA for user settings.
- `PageRenderer->addInlineLanguageDomain()` (#108963).
- `FormEngine "additionalHiddenFields"` key (#109102).

---
