---
name: xstate-test
description: "Test XState v5 machines: model-based path coverage with createTestModel, plus actor-level unit tests (machine.provide() mocks, getSnapshot, waitFor, fake clocks). Use when you want tests, coverage, or a test plan from a machine."
---
# XState Test (model-based)

Generate model-based tests that walk every path of a machine. v5 uses `@xstate/graph` `createTestModel`; legacy code uses `@xstate/test`. Use when the user wants tests, path coverage, or a test plan from a statechart.

## Why

Describe what each state means (a `test` assertion) and how to trigger each event (an `exec`); the model generates every path and asserts at each visited state — coverage hand-written suites miss.

## Core pattern

```ts
import { createTestModel } from '@xstate/graph';
const model = createTestModel(machine);

for (const path of model.getShortestPaths()) {
  it(path.description, async () => {
    await path.test({ states: { /* assert each state from the snapshot */ }, events: { /* optional: drive an external SUT */ } });
  });
}
// getShortestPaths() reaches every state, so running them all IS the coverage —
// @xstate/graph v5 has no model.testCoverage().
```

Full runnable example (UI/Playwright + pure-logic variants, path limits): `references/example.md`.

> **`createTestModel` cannot traverse `invoke`.** Path generation is synchronous, so a machine with an invoked actor throws *"Invocations on test machines are not supported"*. Model-based testing targets event-driven machines (UI flows, wizards, toggles); test invoke/async machines with the actor-level approach below (`provide()` mocks the actor).

## Actor-level tests (the everyday case)

Model-based suites prove coverage; most day-to-day tests just drive a running actor and assert. Mock async work with `machine.provide()` so `invoke` success/error branches are deterministic — no real I/O:

```ts
import { createActor, waitFor, fromPromise } from 'xstate';

const testMachine = machine.provide({
  actors: { fetchUser: fromPromise(async () => ({ id: '1' })) }, // stub the network
  guards: { canRetry: () => true },
});

const actor = createActor(testMachine).start();
actor.send({ type: 'FETCH' });
await waitFor(actor, (s) => s.matches('success')); // settle async
expect(actor.getSnapshot().context.data).toEqual({ id: '1' });
```

- Test the **error** branch by providing a rejecting actor: `fromPromise(async () => { throw new Error('boom'); })`.
- Time-based (`after`) transitions: inject a `SimulatedClock` and advance it deterministically — no real waiting.

Full actor-test recipes (provide() mocking, error paths, SimulatedClock vs fake timers, waitFor): `references/actor-test.md`.

## Path strategies

- `getShortestPaths()` — minimal path to each state. Default for CI.
- `getSimplePaths()` — every non-looping path. Exhaustive, slower; critical machines.
- `getShortestPaths({ limit })` / `getSimplePaths({ limit })` — cap traversal when the path set explodes (`limit` is an option on these; raw `getPaths` needs a path generator).

## Rules

- `createTestModel` rejects machines with `invoke` ("Invocations on test machines are not supported") — model-test event-driven machines; for invoke/async use actor-level tests (`provide()` mocks).
- State fns receive the **snapshot** (`s.value` / `s.context` / `s.matches`); event fns receive a `{ state, event }` step. The model drives its OWN internal actor — in pure-logic tests you assert in `states` and never manually `send` (the `events` key is only for driving an external SUT, e.g. Playwright `page` from closure).
- Event/SUT handlers must be deterministic — the same event always drives the same SUT action.
- `path.test(...)` is async — `await` it.
- Cyclic transitions that mutate `context` explode the traversal (each cycle = a new snapshot → "Traversal limit exceeded"). Keep model-tested machines' context minimal — assert context in actor-level tests — or pass `{ limit }`.
- The machine MUST be built with `setup()` (serializable) or path generation can't introspect guards.
- Prefer `getShortestPaths` over `getSimplePaths` when the path set is large.
