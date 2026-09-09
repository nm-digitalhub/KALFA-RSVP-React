> מקור: https://www.workflowbuilder.io/docs/api/plugins/registerplugintranslation/
> נשמר: 2026-09-09

# registerPluginTranslation

**registerPluginTranslation**(`pluginResourceToAdd`): `void`

Merge plugin translations into the SDK’s i18next instance.

Resources follow the i18next shape `{ [lang]: { translation: { plugins: {...} } } }` — every plugin’s strings live under the `plugins` namespace, scoped by plugin name to avoid key collisions.

Safe to call more than once and at any time relative to i18next init: each call also issues `i18n.addResourceBundle(...)` so newly registered strings surface live, even when the plugin registers after the SDK has already initialised i18next.

## Parameters

### pluginResourceToAdd

`Resource`

## Returns

`void`

## Example
```ts
registerPluginTranslation({
  en: { translation: { plugins: { myPlugin: { hello: 'Hello' } } } },
  pl: { translation: { plugins: { myPlugin: { hello: 'Cześć' } } } },
});
```
