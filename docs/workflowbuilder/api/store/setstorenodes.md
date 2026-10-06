> מקור: https://www.workflowbuilder.io/docs/api/store/setstorenodes/
> נשמר: 2026-09-09

# setStoreNodes

**setStoreNodes**(`nodes`): `void`

Replace all nodes in the store with the given list. Each node is re-validated against its schema before committing — `properties.errors` on the resulting nodes reflects the new validation state.

## Parameters

### nodes

[`WorkflowBuilderNode`](https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/)[]

## Returns

`void`
