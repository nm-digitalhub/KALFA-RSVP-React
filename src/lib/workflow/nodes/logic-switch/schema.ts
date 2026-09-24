'use client';

// `logic.switch` — the JSON schema of its properties panel. Editor side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import { identityProperties, statusProperty } from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

// N OWNER-DEFINED BRANCHES, on the SDK's own `DecisionBranches` control.
//
// REBUILT 2026-09-13, replacing a fixed `case1/case2/case3`. The old note here
// said the branches were "NOT exposed in the uischema" because the worker named
// the ports from `SWITCH_CASE_HANDLES` without reading the diagram. That was a
// self-imposed ceiling: the handler now reads the branch the conditions selected,
// so the port list may be anything the owner builds.
//
// `conditions` is a NESTED array inside each branch — `FieldSchema` admits an
// `ArrayFieldSchema`, so this type-checks — and it must be declared, or the
// control has nowhere to persist its rows and validation strips them on save.
// Its four fields are the SDK's `DynamicCondition` exactly.
export const switchSchema = {
  type: 'object',
  // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
  // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
  required: requiredFields,
  properties: {
    ...identityProperties,
    ...statusProperty,
    left: { type: 'string' },
    decisionBranches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          sourceHandle: { type: 'string' },
          label: { type: 'string' },
          conditions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                x: { type: 'string' },
                comparisonOperator: { type: 'string' },
                y: { type: 'string' },
                logicalOperator: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} satisfies NodeSchema;

export type SwitchSchema = typeof switchSchema;
