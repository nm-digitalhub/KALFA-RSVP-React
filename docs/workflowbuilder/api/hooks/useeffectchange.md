> מקור: https://www.workflowbuilder.io/docs/api/hooks/useeffectchange/
> נשמר: 2026-09-09

# useEffectChange

**useEffectChange**(`callback`, `dependencies`): `void`

Like `useEffect`, but skips the **first** run — the callback fires only when one of the dependencies actually changes after the initial render.

Useful when you want to react to user-driven changes without firing on the initial mount (e.g. saving form edits to the server, but not the initial seeded values).

## Parameters

### callback

() => `void`

Effect to run on dependency changes (post-mount).

### dependencies

`unknown`[]

Dependency array, identical semantics to `useEffect`.

## Returns

`void`
