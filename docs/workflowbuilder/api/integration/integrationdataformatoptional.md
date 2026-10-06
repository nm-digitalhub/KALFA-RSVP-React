> מקור: https://www.workflowbuilder.io/docs/api/integration/integrationdataformatoptional/
> נשמר: 2026-09-09

# IntegrationDataFormatOptional

**IntegrationDataFormatOptional** = `Partial`<[`IntegrationDataFormat`](https://www.workflowbuilder.io/docs/api/integration/integrationdataformat/)>

Same shape as [IntegrationDataFormat](https://www.workflowbuilder.io/docs/api/integration/integrationdataformat/) but with every field optional — accepted by load callbacks that may only deliver a partial payload (e.g. just nodes + edges, layoutDirection inferred).
