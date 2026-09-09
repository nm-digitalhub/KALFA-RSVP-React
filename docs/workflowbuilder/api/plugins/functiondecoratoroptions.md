> מקור: https://www.workflowbuilder.io/docs/api/plugins/functiondecoratoroptions/
> נשמר: 2026-09-09

# FunctionDecoratorOptions

**FunctionDecoratorOptions** = `DecoratorOptionsBefore` | `DecoratorOptionsAfter`

Options accepted by [registerFunctionDecorator](https://www.workflowbuilder.io/docs/api/plugins/registerfunctiondecorator/).

`place: 'before'` callbacks run before the wrapped function and may replace its arguments. `place: 'after'` callbacks run after the wrapped function and may replace its return value. `priority` controls relative order when multiple plugins decorate the same function (higher runs first; default `0`); `name` deduplicates registrations.
