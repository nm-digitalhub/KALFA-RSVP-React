> מקור: https://www.workflowbuilder.io/docs/api/utilities/gethandleid/
> נשמר: 2026-09-09

# getHandleId

**getHandleId**(`__namedParameters`): `HandleId`

Build a stable, parseable ID for a node handle. Returns the bare `handleType` for outer handles and `<handleType>:inner:<innerId>` for sub-handles inside compound nodes (e.g. one per decision branch or AI tool). The ID is local to the owning node — xyflow scopes handle IDs by node, so the same string can appear on multiple nodes without clashing.

Use this when authoring a custom node template — pass the returned string to xyflow’s `<Handle id={...}>` so the editor’s edge logic (validation, hover, selection) can find the right handle later.

## Parameters

### __namedParameters

`GetHandleIdOptions`

## Returns

`HandleId`
