> מקור: https://www.workflowbuilder.io/docs/api/hooks/layoutchangeoptions/
> נשמר: 2026-09-09

# LayoutChangeOptions

**LayoutChangeOptions** = `object`

Optional side effects for a layout-direction *toggle*.

## Properties

### fitView?

`optional` **fitView?**: `boolean`

Animate the view to fit all nodes after the change. Defaults to `false`.

---

### flipPositions?

`optional` **flipPositions?**: `boolean`

Also reflow node positions by swapping each node’s `x`/`y`, so the diagram visually re-lays-out along the new axis. Defaults to `false` (handles and edges re-orient, coordinates stay put). This is a naive mirror, not a layout algorithm: it ignores node dimensions, so non-square nodes shift relative to their neighbours. Pair it with `fitView` and treat it as a quick approximation, not production auto-layout.
