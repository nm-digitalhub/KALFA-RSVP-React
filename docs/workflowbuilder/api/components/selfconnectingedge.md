> מקור: https://www.workflowbuilder.io/docs/api/components/selfconnectingedge/
> נשמר: 2026-09-09

# SelfConnectingEdge

**SelfConnectingEdge**(`__namedParameters`): `Element`

Edge that loops above the source node when source and target are the same node (a “self-connecting” or “back-to-self” edge). Draws a rounded-corner path that arches over the node so the loop stays visible regardless of the node’s size.

Used internally by [LabelEdge](https://www.workflowbuilder.io/docs/api/components/labeledge/); expose only when you author a custom edge type and want to reuse the same loop geometry.

## Parameters

### __namedParameters

`SelfConnectingEdgeProps`

## Returns

`Element`
