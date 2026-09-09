> מקור: https://www.workflowbuilder.io/docs/api/store/usestore/
> נשמר: 2026-09-09

# useStore

`const` **useStore**: `UseBoundStoreWithEqualityFn`<`WithDevtools`<`StoreApi`<`WorkflowEditorState`>>>

The SDK’s Zustand store — a module-level **global singleton**.

## Why global (not per-Root)

The SDK is single-instance by contract: mount one `<WorkflowBuilder.Root>` per page (see README → “Single-instance constraint”). The plugin / i18n registries and the palette/template config holders are already module-level singletons, so the store is one too — a single, consistent lifetime model instead of a per-Root store threaded through React context plus a module-level “current” pointer kept in sync from a layout effect.

This removes an entire bug class. Imperative reads (`useStore.getState()` and the `getStore*` / `setStore*` action helpers built on it) used to throw “store access before mount” when called during a descendant’s render or layout effect — i.e. before the Root’s `useLayoutEffect` had a chance to register the per-Root store. The store now exists from module load, so those reads always resolve to a real (initially empty) state.

`createWithEqualityFn` returns a hook that doubles as the store API:

- subscribe with a selector — `const nodes = useStore((s) => s.nodes);`

- read once, outside React — `useStore.getState()`

- write / observe imperatively — `useStore.setState(...)`, `useStore.subscribe(...)`

Equality is `shallow` by default, so selecting an object or array is safe.

Sequential workflows (mount → save → unmount → mount next) get a clean slate via resetWorkflowStore, which `<WorkflowBuilder.Root>` calls on mount — the persistent global store would otherwise carry the previous diagram’s state into the next Root.
