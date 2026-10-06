> מקור: https://www.workflowbuilder.io/docs/api/listeners/usenodedragstartlistener/
> נשמר: 2026-09-09

# useNodeDragStartListener

**useNodeDragStartListener**(`listener`): `void`

React-friendly variant of [addNodeDragStartListener](https://www.workflowbuilder.io/docs/api/listeners/addnodedragstartlistener/) with automatic cleanup on unmount. Preferred over the raw `add` / `remove` pair — the SDK does NOT clear the listener registry on `<WorkflowBuilder.Root>` remounts, so manual cleanup is mandatory and easy to forget.

The hook tolerates inline-arrow callbacks: a `useRef` trampoline keeps a single stable subscription across re-renders while always invoking the latest `listener` you passed. No need to wrap your callback in `useCallback`.

## Parameters

### listener

`OnNodeDrag`

## Returns

`void`
