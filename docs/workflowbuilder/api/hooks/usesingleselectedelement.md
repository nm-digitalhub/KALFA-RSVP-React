> מקור: https://www.workflowbuilder.io/docs/api/hooks/usesingleselectedelement/
> נשמר: 2026-09-09

# useSingleSelectedElement

**useSingleSelectedElement**(): `SingleSelectedElement` | `null`

Returns the currently-selected node + edge **only when exactly one element is selected**, and `null` otherwise (zero selection or multi-selection). Designed for the properties sidebar’s “edit one thing at a time” UI; the equality check tolerates stable references on `node.data` / `edge.data` so the hook doesn’t spam re-renders.

## Returns

`SingleSelectedElement` | `null`

The selected element wrapped in `{ node, edge }` (each independently nullable), or `null` when selection isn’t a single item.
