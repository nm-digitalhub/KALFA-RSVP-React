> מקור: https://www.workflowbuilder.io/docs/api/plugins/componentdecoratoroptions/
> נשמר: 2026-09-09

# ComponentDecoratorOptions

**ComponentDecoratorOptions**<`Props`> = `DecoratorWithContent`<`Props`> | `DecoratorWithNoContent`<`Props`>

Options accepted by [registerComponentDecorator](https://www.workflowbuilder.io/docs/api/plugins/registercomponentdecorator/). Two shapes:

- With `content`: mount a React component into a named slot — `'before'`, `'after'`, or as a `'wrapper'` around the host component.

- Without `content`: only `modifyProps` runs, transforming props passed to the host component without rendering extra UI.

`priority` controls the relative order when multiple plugins decorate the same slot (higher runs first; default `0`). `name` is used to deduplicate registrations — passing the same `name` twice replaces the earlier entry.

## Type Parameters

### Props

`Props` = `object`
