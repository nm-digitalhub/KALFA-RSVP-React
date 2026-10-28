# Actor-level testing — provide(), error paths, clocks

Model-based tests (`createTestModel`) prove path coverage. Actor-level tests are the everyday complement: start an actor, drive it, assert on `getSnapshot()`. The key is mocking implementations so async and time are deterministic.

## Mock implementations with `machine.provide()`

`provide()` returns a new machine with overridden actors/actions/guards/delays — the structure stays identical, so behavior is unchanged but I/O is stubbed:

```ts
import { createActor, waitFor, fromPromise } from 'xstate';
import { fetcher } from './fetcher.machine';

test('success path', async () => {
  const m = fetcher.provide({
    actors: { fetchUser: fromPromise(async () => ({ id: '1', name: 'Ada' })) },
  });
  const actor = createActor(m).start();
  actor.send({ type: 'FETCH' });
  await waitFor(actor, (s) => s.matches('success'));
  expect(actor.getSnapshot().context.data).toEqual({ id: '1', name: 'Ada' });
});
```

## Test the error branch

Override the same actor with a rejecting promise to exercise `onError`:

```ts
test('error path → failure, retries bumped', async () => {
  const m = fetcher.provide({
    actors: { fetchUser: fromPromise(async () => { throw new Error('network'); }) },
  });
  const actor = createActor(m).start();
  actor.send({ type: 'FETCH' });
  await waitFor(actor, (s) => s.matches('failure'));
  expect(actor.getSnapshot().context.retries).toBeGreaterThan(0);
});
```

## Deterministic time — `SimulatedClock`

For `after` / delayed transitions, inject a clock instead of waiting real milliseconds:

```ts
import { createActor } from 'xstate';
import { SimulatedClock } from 'xstate';

const clock = new SimulatedClock();
const actor = createActor(machine, { clock }).start();

actor.send({ type: 'RETRY' });           // enters a state with after: { 1000: ... }
expect(actor.getSnapshot().value).toBe('failure');
clock.increment(1000);                    // fast-forward the delay
expect(actor.getSnapshot().value).toBe('loading');
```

`SimulatedClock` is the framework-native option and needs no test-runner support. Alternatively use the runner's fake timers (`vi.useFakeTimers()` / `jest.useFakeTimers()` + `advanceTimersByTime`) when other timers in the SUT also need faking.

## `waitFor` — settle async without arbitrary sleeps

```ts
import { waitFor } from 'xstate';
const snap = await waitFor(actor, (s) => s.status === 'done', { timeout: 1000 });
```

Resolves with the snapshot once the predicate holds (or rejects on timeout) — the correct way to await an invoked promise instead of `setTimeout`.

## Asserting & driving

- Read state: `actor.getSnapshot().value`, `.context`, `.status` (`'active' | 'done' | 'error' | 'stopped'`), `.matches('x')`, `.can({ type: 'E' })`, `.hasTag('t')`.
- Subscribe to record transitions: `const values = []; actor.subscribe((s) => values.push(s.value));`
- Always `actor.stop()` in teardown for actors with running invoked/spawned children, to avoid leaks across tests.

## When to use which

- **Coverage that every state/event is reachable & asserted** → `createTestModel` (see `references/example.md`).
- **A specific behavior, branch, or regression** → actor-level test with `provide()` (this file).
- Use both: model-based for the safety net, actor-level for targeted cases and async/error branches the model can't stub.
