> מקור: https://www.workflowbuilder.io/docs/api/store/getstoredataforintegration/
> נשמר: 2026-09-09

# getStoreDataForIntegration

**getStoreDataForIntegration**(`params?`): [`IntegrationDataFormat`](https://www.workflowbuilder.io/docs/api/integration/integrationdataformat/)

Snapshot the diagram in the shape expected by the integration layer (`{ name, nodes, edges, layoutDirection }`). Use this to hand a persistable payload to the host — e.g. inside a `props`-strategy `onDataSave` callback or before posting to a custom backend.

Dynamic, runtime-only values (selection, computed avoid-edge points, …) are stripped by default; pass `shouldSkipDynamicValues: false` if you specifically need the live values.

## Parameters

### params?

`GetStoreDataParams` = `{}`

## Returns

[`IntegrationDataFormat`](https://www.workflowbuilder.io/docs/api/integration/integrationdataformat/)
