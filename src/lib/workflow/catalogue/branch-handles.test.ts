// Pins the two condition-branch handle ids to the SDK's own formatter.
//
// `CONDITION_BRANCH_HANDLES` is spelled out as string literals because
// catalogue/types.ts is read by the pg-boss worker and must not import
// @workflowbuilder/sdk. That is the right trade, but it means two things can
// drift apart silently: the literal the worker returns as `nextPort`, and the id
// the editor actually writes on the handle. `isEdgeLive` compares them with
// `===`, so a drift of one character stops every condition node from branching
// while tsc, eslint and the build all stay green — which is exactly what
// happened when the handler returned 'true'.
//
// This test is the join. It runs on the EDITOR's side of the split, where
// importing the SDK is allowed, and asserts the literals equal what
// `getHandleId` produces. If a future SDK changes the handle format, this fails
// instead of the workflow.
import { getHandleId } from '@workflowbuilder/sdk';
import { describe, expect, it } from 'vitest';

import { ACTION_BRANCH_HANDLES, CONDITION_BRANCH_HANDLES, RUNNER_ERROR_PORT } from './types';

describe('condition branch handles', () => {
  it('match what the SDK itself would mint for these inner ids', () => {
    expect(getHandleId({ handleType: 'source', innerId: 'true' })).toBe(
      CONDITION_BRANCH_HANDLES.true,
    );
    expect(getHandleId({ handleType: 'source', innerId: 'false' })).toBe(
      CONDITION_BRANCH_HANDLES.false,
    );
  });

  it('are sub-handles, not the bare outer handle', () => {
    // The distinction that broke: a node drawn with the DEFAULT template has one
    // source handle spelled 'source', and every edge from it carries that. A
    // branch must be a sub-handle or the runner cannot tell two edges apart.
    expect(CONDITION_BRANCH_HANDLES.true).not.toBe('source');
    expect(CONDITION_BRANCH_HANDLES.false).not.toBe('source');
    expect(CONDITION_BRANCH_HANDLES.true).not.toBe(CONDITION_BRANCH_HANDLES.false);
  });

  it('do not collide with the runner’s reserved error handle', () => {
    // `isEdgeLive` tests the error route BEFORE the equality, so a branch id of
    // 'errorRoute' would be routed as an error edge and never as a branch.
    expect(Object.values(CONDITION_BRANCH_HANDLES)).not.toContain('errorRoute');
  });
});

describe('action branch handles', () => {
  it('match what the SDK itself would mint', () => {
    expect(getHandleId({ handleType: 'source', innerId: 'ok' })).toBe(ACTION_BRANCH_HANDLES.ok);
    expect(getHandleId({ handleType: 'source', innerId: 'error' })).toBe(
      ACTION_BRANCH_HANDLES.error,
    );
  });

  it('are NOT the runner’s reserved port — the adapter is what bridges them', () => {
    // The whole reason error routing was thought impossible. The editor cannot
    // mint the bare literal, so the two vocabularies never meet on the canvas;
    // they meet in `to-definition.ts`, which rewrites one into the other. If a
    // future SDK ever DID mint 'errorRoute' directly, this test fails and the
    // rewrite becomes redundant rather than wrong.
    expect(ACTION_BRANCH_HANDLES.error).not.toBe(RUNNER_ERROR_PORT);
    expect(getHandleId({ handleType: 'source', innerId: 'error' })).not.toBe(RUNNER_ERROR_PORT);
  });
});
