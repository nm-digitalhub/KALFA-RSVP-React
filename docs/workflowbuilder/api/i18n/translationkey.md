> מקור: https://www.workflowbuilder.io/docs/api/i18n/translationkey/
> נשמר: 2026-09-09

# TranslationKey

**TranslationKey** = `Parameters`<`TFunction`>[`0`] & `string`

Union of every valid translation key registered in the SDK’s i18next instance — built from the bundled English locale plus the structural shape declared for plugin keys. Use it to type-check `t(...)` calls inside SDK code and inside plugins that consume the SDK’s i18n.
