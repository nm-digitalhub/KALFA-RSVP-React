> מקור: https://www.workflowbuilder.io/docs/api/plugins/workflowbuilderplugin/
> נשמר: 2026-09-09

# WorkflowBuilderPlugin

**WorkflowBuilderPlugin** = () => `void`

Plugin initializer — a synchronous function invoked exactly once on the first mount of `<WorkflowBuilder.Root>`. Inside the body call one of the SDK’s `register*` APIs:

- `registerComponentDecorator` — inject UI / hooks into a known slot

- `registerFunctionDecorator` — intercept a registered function before/after

- `registerPluginTranslation` — add i18next strings under `plugins.<name>`

- `registerCustomRenderers` / `registerCustomCells` — extend JsonForms

Plugins write into module-level registries; they do **not** see the per-Root store. The Root invokes them through a `useRef`-guarded first-render hook, so strict-mode double-render is a no-op and re-renders skip the work.

## Returns

`void`

## Example
```ts
const myPlugin: WorkflowBuilderPlugin = () => {
  registerComponentDecorator('OptionalAppBarTools', {
    content: MyButton,
    name: 'my-plugin',
  });
};
```
