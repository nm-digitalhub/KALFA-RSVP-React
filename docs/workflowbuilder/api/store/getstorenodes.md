> מקור: https://www.workflowbuilder.io/docs/api/store/getstorenodes/
> נשמר: 2026-09-09

# getStoreNodes

**getStoreNodes**(): [`WorkflowBuilderNode`](https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/)[]

One-shot read of the current nodes from the store (outside React). Inside a component prefer `useStore((s) => s.nodes)` so the component re-renders when nodes change.

## Returns

[`WorkflowBuilderNode`](https://www.workflowbuilder.io/docs/api/types/workflowbuildernode/)[]
