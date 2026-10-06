// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { useStore, type IntegrationDataFormat } from '@workflowbuilder/sdk';
import { afterEach, describe, expect, it } from 'vitest';

import {
  globalVariablesKey,
  parseGlobalVariablesKey,
  useHydrateGlobalVariables,
} from './use-hydrate-global-variables';

type GlobalVariables = IntegrationDataFormat['globalVariables'];

/** A fresh object on every call, the way each RSC payload deserialises one. */
function globals(city: string): GlobalVariables {
  return {
    city: {
      id: 'city',
      name: 'city',
      type: 'string',
      defaultValue: city,
      description: '',
    },
  };
}

/** What the owner does in the editor's global-variables modal. */
function editInEditor(city: string): void {
  useStore.setState({ globalVariables: globals(city) });
}

const storeGlobals = () => useStore.getState().globalVariables;

// The REAL SDK store — a module singleton — not a mock: the point is what the
// store holds after each render. Reset between cases so none leaks.
afterEach(() => {
  useStore.setState({ globalVariables: {} });
});

describe('useHydrateGlobalVariables', () => {
  it('hydrates the store on mount', () => {
    renderHook(() => useHydrateGlobalVariables('wf-a', globals('חיפה')));

    expect(storeGlobals()).toEqual(globals('חיפה'));
  });

  it('⚠️ a refresh with identical content does NOT overwrite an unsaved edit', () => {
    const { rerender } = renderHook(
      ({ id, vars }) => useHydrateGlobalVariables(id, vars),
      { initialProps: { id: 'wf-a', vars: globals('חיפה') } },
    );

    editInEditor('ירושלים');
    // A new object with the same content — what router.refresh() delivers.
    rerender({ id: 'wf-a', vars: globals('חיפה') });

    expect(storeGlobals()).toEqual(globals('ירושלים'));
  });

  it('changed server content re-hydrates the store', () => {
    const { rerender } = renderHook(
      ({ id, vars }) => useHydrateGlobalVariables(id, vars),
      { initialProps: { id: 'wf-a', vars: globals('חיפה') } },
    );

    editInEditor('ירושלים');
    rerender({ id: 'wf-a', vars: globals('תל אביב') });

    expect(storeGlobals()).toEqual(globals('תל אביב'));
  });

  it('a changed workflow re-hydrates the store even when the content is identical', () => {
    const { rerender } = renderHook(
      ({ id, vars }) => useHydrateGlobalVariables(id, vars),
      { initialProps: { id: 'wf-a', vars: globals('חיפה') } },
    );

    editInEditor('ירושלים');
    rerender({ id: 'wf-b', vars: globals('חיפה') });

    expect(storeGlobals()).toEqual(globals('חיפה'));
  });

  it('treats a missing prop as no globals', () => {
    editInEditor('ירושלים');
    renderHook(() => useHydrateGlobalVariables('wf-a', undefined));

    expect(storeGlobals()).toEqual({});
    expect(globalVariablesKey(undefined)).toBe(globalVariablesKey({}));
  });

  it('the key round-trips to the same content', () => {
    expect(parseGlobalVariablesKey(globalVariablesKey(globals('חיפה')))).toEqual(
      globals('חיפה'),
    );
  });
});
