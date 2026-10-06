> מקור: https://www.workflowbuilder.io/docs/api/listeners/addnodechangedlistener/
> נשמר: 2026-09-09

# addNodeChangedListener

**addNodeChangedListener**(`listener`): `void`

Subscribe to node changes (drag, resize, select, remove). The listener receives xyflow’s raw `NodeChange[]` for every emitted change — useful for analytics, autosave, change-tracking plugins, etc.

The registry is module-global and persists across `<WorkflowBuilder.Root>` remounts — the SDK does not clear it automatically. **Plugins must call [removeNodeChangedListener](https://www.workflowbuilder.io/docs/api/listeners/removenodechangedlistener/) themselves in their cleanup** (e.g. `useEffect` teardown) to avoid stacking zombie listeners across mount cycles. See `apps/demo/src/app/plugins/avoid-nodes-edges/providers/avoid-nodes-edges-provider.tsx` for the canonical pattern.

## Parameters

### listener

[`NodeChangedListener`](https://www.workflowbuilder.io/docs/api/listeners/nodechangedlistener/)

## Returns

`void`

Nothing. Call [removeNodeChangedListener](https://www.workflowbuilder.io/docs/api/listeners/removenodechangedlistener/) with the same reference to unsubscribe.
