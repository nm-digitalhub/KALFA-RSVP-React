// Zod for the diagram as the EDITOR saves it.
//
// `workflows.definition` is a jsonb column whose contents originated in a
// browser, so it is external input at a server boundary and gets parsed, not
// cast. We model the shape ourselves rather than importing the SDK's
// `IntegrationDataFormat`: a TypeScript type asserts nothing at run time, and
// the row may have been written by an older editor, hand-edited, or restored
// from a backup.
//
// Deliberately permissive about what it does NOT need. The editor stores React
// Flow's own bookkeeping (measured sizes, selection flags, z-index, handle
// positions) and future SDK versions will store more; none of it means anything
// to execution, so unknown keys pass through untouched rather than failing a
// save the owner cannot explain.
import { z } from 'zod';

// `data.properties` is whatever the node's JSON Schema produced. It is validated
// per node type by the step handlers, not here — this layer only establishes
// that it is an object.
const propertiesSchema = z.record(z.string(), z.unknown()).default({});

export const editorNodeSchema = z.looseObject({
  id: z.string().min(1),
  // React Flow's renderer type ('node'), not the KALFA node type. The one that
  // matters lives at data.type.
  type: z.string().optional(),
  position: z
    .looseObject({ x: z.number(), y: z.number() })
    .optional(),
  data: z.looseObject({
    // The catalogue key. This is the field the adapter resolves against
    // CATALOGUE; an unknown value is rule 5.
    type: z.string().min(1),
    icon: z.string().optional(),
    properties: propertiesSchema,
  }),
});

export const editorEdgeSchema = z.looseObject({
  // React Flow generates ids of the form `xy-edge__<source>-<target>`, but an
  // imported or hand-written diagram may carry none. Optional here; the adapter
  // synthesises a deterministic one so the runner's required `id` is always
  // satisfiable without inventing anything unstable.
  id: z.string().min(1).optional(),
  source: z.string().min(1),
  target: z.string().min(1),
  type: z.string().optional(),
  // React Flow writes `null` (not undefined) for an unset handle.
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
});

export const editorDiagramSchema = z.looseObject({
  name: z.string().optional(),
  layoutDirection: z.enum(['DOWN', 'RIGHT']).optional(),
  nodes: z.array(editorNodeSchema).default([]),
  edges: z.array(editorEdgeSchema).default([]),
});

export type EditorNode = z.infer<typeof editorNodeSchema>;
export type EditorEdge = z.infer<typeof editorEdgeSchema>;
export type EditorDiagram = z.infer<typeof editorDiagramSchema>;
