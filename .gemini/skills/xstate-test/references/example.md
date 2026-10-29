# Model-based test — full examples

`createTestModel` walks an **event-driven** machine (no `invoke` — those throw "Invocations on test machines are not supported"; test them with `actor-test.md`). The machine below is a wizard with no async, the ideal model-based target:

```ts
// wizard.machine.ts — no invoke; pure event-driven navigation
import { setup } from 'xstate';

export const wizard = setup({
  types: { events: {} as { type: 'NEXT' } | { type: 'BACK' } | { type: 'SUBMIT' } },
}).createMachine({
  id: 'wizard',
  initial: 'cart',
  states: {
    cart:      { on: { NEXT: 'shipping' } },
    shipping:  { on: { NEXT: 'payment', BACK: 'cart' } },
    payment:   { on: { SUBMIT: 'confirmed', BACK: 'shipping' } },
    confirmed: { type: 'final' },
  },
});
```

> No `context` here on purpose. Model-based testing covers **state + event reachability**; if a transition mutates `context` on a cyclic path (e.g. `BACK`→`NEXT`), every cycle produces a new snapshot and traversal explodes (`"Traversal limit exceeded"`). Keep model-tested machines' context minimal and assert context values in actor-level tests instead — or pass `{ limit }`.

## UI / Playwright variant (@xstate/graph v5)

The model drives its own internal actor along each path; your `states` functions assert the **real UI** matches the expected state, and your `events` functions perform the real action (`page` comes from closure — it is NOT injected). Event functions receive a `{ state, event }` step if you need it.

```ts
import { createTestModel } from '@xstate/graph';
import { wizard } from './wizard.machine';

const model = createTestModel(wizard);

describe('wizard', () => {
  it.each(model.getShortestPaths().map((p) => [p.description, p]))(
    '%s',
    async (_desc, path) => {
      const page = await browser.newPage();          // the external SUT
      await page.goto('/checkout');
      await path.test({
        states: {
          cart:      () => expect(page.getByTestId('cart')).toBeVisible(),
          shipping:  () => expect(page.getByTestId('shipping')).toBeVisible(),
          payment:   () => expect(page.getByTestId('payment')).toBeVisible(),
          confirmed: () => expect(page.getByText('Order confirmed')).toBeVisible(),
        },
        events: {
          NEXT:   () => page.getByRole('button', { name: 'Next' }).click(),
          BACK:   () => page.getByRole('button', { name: 'Back' }).click(),
          SUBMIT: () => page.getByRole('button', { name: 'Place order' }).click(),
        },
      });
    },
  );
});
// getShortestPaths() reaches every state, so running them all IS the coverage.
// @xstate/graph v5 has no model.testCoverage().
```

## Pure-logic variant (no UI)

When the machine itself is the system under test, the model's internal actor IS the SUT. Assert on the snapshot in `states`; you do NOT manually `send` and you do NOT need an `events` key — the model drives every transition for you.

```ts
import { createTestModel } from '@xstate/graph';
import { wizard } from './wizard.machine';

const model = createTestModel(wizard);

for (const path of model.getShortestPaths()) {
  test(path.description, async () => {
    await path.test({
      states: {
        cart:      (s) => expect(s.value).toBe('cart'),
        shipping:  (s) => expect(s.matches('shipping')).toBe(true),
        confirmed: (s) => expect(s.status).toBe('done'),
      },
      // no `events` key needed — the model advances its own actor
    });
  });
}
```

## Limiting path explosion

```ts
// `limit` is a traversal option on the path getters (raw getPaths needs a path generator):
model.getShortestPaths({ limit: 50 }); // or model.getSimplePaths({ limit: 50 })
```

## Testing a machine that HAS `invoke`?

`createTestModel` can't walk it. Either (a) extract the pure transition logic into an invoke-free machine and model-test that, or (b) test the real machine with actor-level tests that mock the invoked actor via `provide()` — see `actor-test.md`.
