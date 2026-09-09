> מקור: https://www.workflowbuilder.io/docs/api/utilities/deeppartial/
> נשמר: 2026-09-09

# DeepPartial

**DeepPartial**<`T`> = `T` *extends* `object` ? `{ [P in keyof T]?: DeepPartial<T[P]> }` : `T`

Recursive `Partial<T>`: every nested object property becomes optional all the way down. Use it when a value is built up incrementally and intermediate states are never fully populated.

## Type Parameters

### T

`T`
