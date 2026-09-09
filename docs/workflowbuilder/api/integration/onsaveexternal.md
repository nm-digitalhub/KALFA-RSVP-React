> מקור: https://www.workflowbuilder.io/docs/api/integration/onsaveexternal/
> נשמר: 2026-09-09

# OnSaveExternal

**OnSaveExternal** = (`data`, `savingParams?`) => `Promise`<[`DidSaveStatus`](https://www.workflowbuilder.io/docs/api/integration/didsavestatus/)>

Save callback shape the host supplies under the `'props'` integration strategy. The editor calls it with the current diagram payload and expects a [DidSaveStatus](https://www.workflowbuilder.io/docs/api/integration/didsavestatus/) resolution.

## Parameters

### data

[`IntegrationDataFormat`](https://www.workflowbuilder.io/docs/api/integration/integrationdataformat/)

### savingParams?

[`OnSaveParams`](https://www.workflowbuilder.io/docs/api/integration/onsaveparams/)

## Returns

`Promise`<[`DidSaveStatus`](https://www.workflowbuilder.io/docs/api/integration/didsavestatus/)>
