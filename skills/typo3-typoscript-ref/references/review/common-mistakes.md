# Common TypoScript/TSconfig/Fluid Mistakes

## TypoScript Mistakes

### stdWrap Nesting Error

Wrong: property.stdWrap.wrap = |
Right: property.wrap = | (stdWrap properties apply directly)

### optionSplit Syntax

Wrong: wrap = <li>|</li> (same for all items)
Right: wrap = <li class="first">|</li> |*| <li>|</li> |*| <li class="last">|</li>

### Condition Syntax (v12+)

Wrong: [globalVar = GP:L=1]
Right: [siteLanguage("languageId") == 1]

### getTSFE() in Conditions (removed in v14)

Wrong: [getTSFE() && getTSFE().id == 42]
Right: [page["uid"] == 42] or [request?.getPageArguments()?.getPageId() == 42]
(getTSFE() was removed in v14 (#107473) — use page, request, site, siteLanguage)

### File Includes (v14)

Wrong: <INCLUDE_TYPOSCRIPT: source="FILE:EXT:my_ext/Configuration/TypoScript/setup.typoscript">
Right: @import 'EXT:my_ext/Configuration/TypoScript/setup.typoscript'
(INCLUDE_TYPOSCRIPT was removed in v14; deprecated since v13.4)

### userFunc Without Opt-In Registration (v14)

Problem: TypoScript/TSconfig callables (userFunc, postUserFunc, ...) are no longer executed unless explicitly registered (#108054)
Solution: Register the callable for TypoScript usage in the extension (opt-in allow-list); silent non-execution is the typical symptom

### Copy vs Reference

Wrong: lib.footer < lib.header (independent copy — changes to lib.header won't reflect)
When you want: lib.footer =< lib.header (reference — follows changes)
When to use copy: When you want to modify the copy without affecting original

### Override Order Pitfall

Problem: TypoScript from Site Set may be overridden by sys_template records
Solution: Check sys_template include order; Site Set TypoScript loads first

### Missing stdWrap Level

Wrong: 10.wrap = <div>|</div> (may not work if 10 is a cObject)
Right: 10.stdWrap.wrap = <div>|</div>

## TSconfig Mistakes

### TCEFORM Wrong Path

Wrong: TCEFORM.tt_content.header_layout =
Right: TCEFORM.tt_content.header_layout.removeItems = 1,2
(empty assignment doesn't remove items)

### Wrong Scope

Wrong: User TSconfig for page-level settings
Right: Page TSconfig for TCEFORM, mod.*, TCEMAIN

## Fluid Mistakes

### XSS via f:format.raw

Wrong: {userInput -> f:format.raw()} — XSS vulnerability
Right: {userInput} (auto-escaped) or use f:sanitize.html

### f:translate Key Format

Wrong: <f:translate key="myLabel" />
Right: <f:translate key="LLL:EXT:myext/Resources/Private/Language/locallang.xlf:myLabel" />
Or: <f:translate key="myLabel" extensionName="myext" />

### Missing Required Arguments

Wrong: <f:link.typolink parameter="{data.uid}">Link</f:link.typolink>
Right: <f:link.typolink parameter="{data.header_link}">Link</f:link.typolink>

### Logic in Templates

Wrong: Complex conditions and loops in Fluid templates
Right: Move logic to DataProcessors; template only renders data

## Inheritance Pitfalls

- Site Set settings override constants but not setup
- Extension TypoScript loads before page-specific TypoScript
- TSconfig: User TSconfig can override Page TSconfig for some settings
