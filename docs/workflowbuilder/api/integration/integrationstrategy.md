> מקור: https://www.workflowbuilder.io/docs/api/integration/integrationstrategy/
> נשמר: 2026-09-09

# IntegrationStrategy

**IntegrationStrategy** = `"localStorage"` | `"api"` | `"props"`

Persistence strategy identifier — one of:

- `'localStorage'`: editor reads / writes the diagram under a fixed `'workflowBuilderDiagram'` key in browser `localStorage` (not derived from the instance `name` prop). Default.

- `'api'`: editor performs HTTP load + save against the configured `endpoints.load` / `endpoints.save` URLs.

- `'props'`: editor calls the host-supplied `onDataSave` callback; initial state comes from `initialNodes` / `initialEdges` props.
