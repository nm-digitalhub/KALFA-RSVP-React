> מקור: https://www.workflowbuilder.io/docs/api/core/workflowbuilderisvalidconnectionparams/
> נשמר: 2026-09-09

# WorkflowBuilderIsValidConnectionParams

**WorkflowBuilderIsValidConnectionParams** = `object`

Arguments for [WorkflowBuilderIsValidConnection](https://www.workflowbuilder.io/docs/api/core/workflowbuilderisvalidconnection/). Source / target nodes are resolved from the connection’s ids, so a rule can branch on node `data`.

## Properties

### connection

**connection**: `Connection`

The connection candidate (handle ids normalized to `null`).

---

### sourceNode

**sourceNode**: [`WorkflowBuilderNode`](https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/)

Node the connection is dragged from.

---

### targetNode

**targetNode**: [`WorkflowBuilderNode`](https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/)

Node the connection is dragged to.
