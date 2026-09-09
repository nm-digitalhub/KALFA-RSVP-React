> מקור: https://www.workflowbuilder.io/docs/api/listeners/usenodechangedlistener/
> נשמר: 2026-09-09

# useNodeChangedListener

**useNodeChangedListener**(`listener`): `void`

React-friendly variant of [addNodeChangedListener](https://www.workflowbuilder.io/docs/api/listeners/addnodechangedlistener/) with automatic cleanup on unmount. Preferred over the raw `add` / `remove` pair for components and providers — the SDK does NOT clear the listener registry on `<WorkflowBuilder.Root>` remounts, so manual cleanup is mandatory and easy to forget.

The hook tolerates inline-arrow callbacks: a `useRef` trampoline keeps a single stable subscription across re-renders while always invoking the latest `listener` you passed. No need to wrap your callback in `useCallback`.

## Parameters

### listener

[`NodeChangedListener`](https://www.workflowbuilder.io/docs/api/listeners/nodechangedlistener/)

## Returns

`void`

## Example
```tsx
function MyProvider() {
  useNodeChangedListener((changes) => {
    console.log('changes', changes);
  });
  return null;
}
```
