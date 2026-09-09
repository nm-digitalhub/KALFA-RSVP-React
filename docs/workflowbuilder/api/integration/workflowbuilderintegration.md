> מקור: https://www.workflowbuilder.io/docs/api/integration/workflowbuilderintegration/
> נשמר: 2026-09-09

# WorkflowBuilderIntegration

**WorkflowBuilderIntegration** = { `strategy?`: `"localStorage"`; } | { `endpoints`: { `load`: `string`; `save`: `string`; }; `strategy`: `"api"`; } | { `onDataSave`: [`OnSaveExternal`](https://www.workflowbuilder.io/docs/api/integration/onsaveexternal/); `strategy`: `"props"`; }

Persistence strategy for a `<WorkflowBuilder.Root>` instance. Exactly one variant applies. `integration` is itself optional — omitting it picks the `localStorage` default.

## Union Members

### Type Literal

{ `strategy?`: `"localStorage"`; }

Default — save to browser localStorage under `'workflowBuilderDiagram'`. Selected when `integration` is omitted entirely or set to `{}`.

---

### Type Literal

{ `endpoints`: { `load`: `string`; `save`: `string`; }; `strategy`: `"api"`; }

REST persistence — SDK issues `GET endpoints.load` and `POST endpoints.save` on every save event.

---

### Type Literal

{ `onDataSave`: [`OnSaveExternal`](https://www.workflowbuilder.io/docs/api/integration/onsaveexternal/); `strategy`: `"props"`; }

Host-managed — SDK invokes `onDataSave` with the diagram payload on every save event; the host owns where it lands.
