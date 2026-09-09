> מקור: https://www.workflowbuilder.io/docs/api/hooks/usekeypress/
> נשמר: 2026-09-09

# useKeyPress

**useKeyPress**(`keyCode`, `options?`): `boolean`

Tracks whether a given key (or key combo) is currently held down.

Defaults to firing only when the diagram canvas (body / `.react-flow__*`) has focus — text inputs are excluded so typing in a property field doesn’t accidentally trigger keyboard shortcuts. Pass `skipTarget: true` to listen globally and `withControlOrMeta: true` to require Ctrl / Cmd to also be down.

## Parameters

### keyCode

`KeyCode`

xyflow `KeyCode` (single key string or combo).

### options?

`Options`

Optional `skipTarget` / `withControlOrMeta` flags.

## Returns

`boolean`

`true` while the key is pressed; `false` otherwise.
