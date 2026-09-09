> מקור: https://www.workflowbuilder.io/docs/api/hooks/usefitview/
> נשמר: 2026-09-09

# useFitView

**useFitView**(): () => `void`

Returns a callback that animates the diagram view to fit all nodes, accounting for the editor’s app bar / palette / property panel bounds.

Common triggers: after auto-layout, after loading a new diagram, after a “fit view” toolbar button click. Uses a single `requestAnimationFrame` so the call is safe to issue from a render path.

## Returns

A `() => void` callback. Stable across renders unless the ReactFlow instance changes.

() => `void`
