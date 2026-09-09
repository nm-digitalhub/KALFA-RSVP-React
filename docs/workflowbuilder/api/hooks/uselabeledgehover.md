> מקור: https://www.workflowbuilder.io/docs/api/hooks/uselabeledgehover/
> נשמר: 2026-09-09

# useLabelEdgeHover

**useLabelEdgeHover**(`__namedParameters`): `object`

Tracks hover state for a single edge across both its line and its label (which live in different React subtrees) and returns the resolved style

- handlers a custom edge component should bind.

Suppresses hover while another edge is mid-segment-drag so the visual doesn’t flicker. Reach for it when authoring a custom edge type that wants the same hover feel as the built-in [LabelEdge](https://www.workflowbuilder.io/docs/api/components/labeledge/).

## Parameters

### __namedParameters

`UseLabelEdgeHoverParams`

## Returns

`object`

### hovered

**hovered**: `boolean`

### onMouseEnter

**onMouseEnter**: () => `void` = `handleMouseEnter`

#### Returns

`void`

### onMouseLeave

**onMouseLeave**: () => `void` = `handleMouseLeave`

#### Returns

`void`

### style

**style**: `object`

#### style.stroke

**stroke**: `string`

#### style.strokeWidth

**strokeWidth**: `string`

#### style.transition

**transition**: `string`
