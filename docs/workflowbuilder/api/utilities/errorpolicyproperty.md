> מקור: https://www.workflowbuilder.io/docs/api/utilities/errorpolicyproperty/
> נשמר: 2026-09-09

# errorPolicyProperty

`const` **errorPolicyProperty**: `object`

Opt-in schema fragment exposing the runner’s `errorPolicy` as a Select. Spread alongside [sharedProperties](https://www.workflowbuilder.io/docs/api/utilities/sharedproperties/) on node types that should surface the choice in the properties panel; omit it elsewhere — the runner defaults to `'fail'` when the field is absent.

## Type Declaration

### errorPolicy

`readonly` **errorPolicy**: `object`

#### errorPolicy.options

`readonly` **options**: `object`[]

#### errorPolicy.type

`readonly` **type**: `"string"` = `'string'`
