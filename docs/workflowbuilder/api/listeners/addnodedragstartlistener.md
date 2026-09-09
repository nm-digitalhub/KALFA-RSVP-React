> מקור: https://www.workflowbuilder.io/docs/api/listeners/addnodedragstartlistener/
> נשמר: 2026-09-09

# addNodeDragStartListener

**addNodeDragStartListener**(`listener`): `void`

Subscribe to “node drag started” events. The listener receives xyflow’s `OnNodeDrag` callback shape `(event, draggedNode, allNodes)` — fires once at the start of every drag interaction, not on subsequent drag frames.

Useful for plugins that need to capture pre-drag state for snapping, visual previews, or undo entries.

The registry is module-global and persists across `<WorkflowBuilder.Root>` remounts — the SDK does not clear it automatically. **Plugins must call [removeNodeDragStartListener](https://www.workflowbuilder.io/docs/api/listeners/removenodedragstartlistener/) themselves in their cleanup** (e.g. `useEffect` teardown) to avoid stacking zombie listeners across mount cycles.

## Parameters

### listener

`OnNodeDrag`

## Returns

`void`
