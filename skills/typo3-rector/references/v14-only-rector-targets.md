# v14-only Rector targets

Continues `typo3-rector` from [full guide](full-guide.md).

## v14-only Rector targets

> The following patterns are **v14-focused** migration targets. Prefer `Typo3LevelSetList::UP_TO_TYPO3_14`; apply remaining items manually if Rector skips them.

### New Rector Migration Targets **[v14 only]**

| Removed/Changed | Migration |
|-----------------|-----------|
| `TypoScriptFrontendController` | Use request attributes (`frontend.page.information`, `language`) |
| Extbase annotation classes `TYPO3\CMS\Extbase\Annotation\*` | Use the PHP attributes `TYPO3\CMS\Extbase\Attribute\*` (`#[Validate]`, `#[IgnoreValidation]`) |
| `FlexFormService` class | Merged into `FlexFormTools` (#107945) |
| Various `BackendUtility` helpers (#106393) | Deprecated in v14, removal planned for v15 — migrate per changelog for each method |
| `GeneralUtility::createVersionNumberedFilename()` | Use System Resource API |
| `PathUtility::getPublicResourceWebPath()` | Use System Resource API |
| `PathUtility::getRelativePath()` / `getRelativePathTo()` | Use new path resolution |
| `AbstractTypolinkBuilder->build()` | Use `TypolinkBuilderInterface` |
| `DataHandler->userid` / `->admin` / `->storeLogMessages` | Removed, no replacement |

### v14.0 Deprecation Targets (prepare for v15 removal)

| Deprecated | Migration |
|------------|-----------|
| `ButtonBar`/`Menu`/`MenuRegistry` `make*` methods (#107823) | Use `ComponentFactory` |
| Scheduler task registration via `SC_OPTIONS`, `AdditionalFieldProviderInterface` and `AbstractAdditionalFieldProvider` (#98453, changelog 14.0) | Use native task types with additional fields in TCA |
| `Localization parsers` (XliffParser, etc.) (#107436) | Symfony Translation Component |

### v14.2 Deprecation Targets (prepare for v15 removal)

| Deprecated | Migration |
|------------|-----------|
| `PageDoktypeRegistry` config methods | Migrate to TCA `allowedRecordTypes` |
| `PageRenderer->addInlineLanguageDomain()` (#108963; the method only existed since 14.1) | Remove the call and import the labels in the JavaScript module: `import labels from '~labels/<domain>'`, then `labels.get('key')` (#108941) |
| `ExtensionManagementUtility::addFieldsToUserSettings()` (#108843) | `ExtensionManagementUtility::addUserSetting($fieldName, $fieldConfiguration, $insertionPosition)` |
| `FormEngine "additionalHiddenFields"` key (#109102) | Removed in v15 |

---
