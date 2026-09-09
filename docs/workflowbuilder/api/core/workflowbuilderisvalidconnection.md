> מקור: https://www.workflowbuilder.io/docs/api/core/workflowbuilderisvalidconnection/
> נשמר: 2026-09-09

# WorkflowBuilderIsValidConnection

**WorkflowBuilderIsValidConnection** = (`params`) => `boolean`

Decides whether a dragged connection is allowed. Return `false` to block the drop (no edge created, no flicker). Fail-open: if an endpoint can’t be resolved to a node, the connection is allowed and this is not invoked.

## Parameters

### params

[`WorkflowBuilderIsValidConnectionParams`](https://www.workflowbuilder.io/docs/api/core/workflowbuilderisvalidconnectionparams/)

## Returns

`boolean`
