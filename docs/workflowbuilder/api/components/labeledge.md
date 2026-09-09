> מקור: https://www.workflowbuilder.io/docs/api/components/labeledge/
> נשמר: 2026-09-09

# LabelEdge

**LabelEdge**(`__namedParameters`): `Element`

Default edge component for the diagram. Renders a smooth-step path between two nodes, mounts an [EdgeLabel](https://www.workflowbuilder.io/docs/api/components/edgelabel/) at the midpoint when `data.label` or `data.icon` is set, and degrades to a self-connecting loop when source and target are the same node.

Registered automatically as the `'labelEdge'` type — to use it in your own diagrams, set `edge.type = 'labelEdge'` and put a label / icon in `edge.data`.

## Parameters

### __namedParameters

`EdgeProps`<[`WorkflowBuilderEdge`](https://www.workflowbuilder.io/docs/api/types/workflowbuilderedge/)>

## Returns

`Element`
