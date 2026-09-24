// Pins the two condition-branch handle ids to the SDK's own formatter.
//
// `CONDITION_BRANCH_HANDLES` (and the switch's `SWITCH_DEFAULT_HANDLE` and
// `switchBranchHandle`) are spelled out as string literals because they live in
// nodes/logic-condition/definition.ts and nodes/logic-switch/definition.ts,
// which the pg-boss worker reads and which must not import @workflowbuilder/sdk;
// catalogue/types.ts only re-exports them, and this test imports that
// re-export. That is the right trade, but it means two things can
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

import {
  ACTION_BRANCH_HANDLES,
  CONDITION_BRANCH_HANDLES,
  RUNNER_ERROR_PORT,
  SWITCH_DEFAULT_BRANCH_ID,
  switchBranchHandle,
  SWITCH_DEFAULT_HANDLE,
} from './types';

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

describe('switch branch handles', () => {
  // REWRITTEN 2026-09-13. `SWITCH_CASE_HANDLES` was a fixed tuple of three; the
  // switch now carries N owner-defined branches, so what has to be pinned is the
  // FORMATTER, not a list of literals.
  it('switchBranchHandle is exactly what the SDK mints for that innerId', () => {
    // The same pin as the condition's, for the same failure: the handler returns
    // this string and `isEdgeLive` compares it to the edge's sourceHandle with
    // `===`. A change to the SDK's format must fail HERE, not by routing every
    // switch into a dead end on a live guest.
    //
    // The ids below are the ones WE seed — the palette's first branch, the
    // template's three, and the default. Ids the owner creates go through the
    // control's own call to the same function, so pinning the formatter covers
    // every branch that will ever exist.
    for (const id of ['branch-1', 'attending', 'declined', 'maybe', SWITCH_DEFAULT_BRANCH_ID]) {
      expect(switchBranchHandle(id)).toBe(getHandleId({ handleType: 'source', innerId: id }));
    }
  });

  it('the default handle is the formatter applied to the default branch id', () => {
    // Two constants that must agree: the handler falls back to
    // SWITCH_DEFAULT_HANDLE by name, and the palette seeds a branch whose id is
    // SWITCH_DEFAULT_BRANCH_ID. If they ever disagreed, the fallback would name a
    // port the seeded card does not draw.
    expect(SWITCH_DEFAULT_HANDLE).toBe(switchBranchHandle(SWITCH_DEFAULT_BRANCH_ID));
  });

  it('no branch handle is the bare "source"', () => {
    // A bare 'source' is what an un-branched node emits; a port equal to it would
    // make every branch fire instead of one.
    for (const id of ['branch-1', 'attending', SWITCH_DEFAULT_BRANCH_ID]) {
      expect(switchBranchHandle(id)).not.toBe('source');
    }
  });

  it('distinct branch ids produce distinct ports', () => {
    // A duplicate would fire two branches. The control keys its cards by id, so
    // this holds as long as the formatter is injective.
    const ids = ['a', 'b', 'attending', 'declined', 'maybe', SWITCH_DEFAULT_BRANCH_ID];
    expect(new Set(ids.map(switchBranchHandle)).size).toBe(ids.length);
  });

  it('is NOT the runner’s reserved error port', () => {
    // An owner is free to name a branch "error". It must still not collide with
    // the port the adapter rewrites ACTION_BRANCH_HANDLES.error into.
    expect(switchBranchHandle('error')).not.toBe(RUNNER_ERROR_PORT);
  });
});
