import { describe, expect, it } from 'vitest';
import { createTestModel } from 'xstate/graph';

import { eventLifecycleMachine, serviceLeafValues, type EventLifecycleSnapshot } from '@/lib/data/event-lifecycle';

// Model-based coverage of the event lifecycle (xstate/graph). The service region has no events of its own: its state is
// resolved from what the server read. So the paths are generated FROM every configuration the server can resolve — each
// event status × each service leaf — and the graph shows, beyond a single `can()`, that NO sequence of events from a
// state that holds money ever reaches `closed`. event-lifecycle.test.ts pins the same rule against the database function.

const model = createTestModel(eventLifecycleMachine);

// The service leaves where nothing was paid: only these may close (spec event-closure, "Money in flight or paid keeps the
// event open"). Written out here, from the spec, rather than read back from the machine.
const CLOSE_ALLOWED_FROM = ['none', 'setup', 'finished'];
const REQUESTABLE_IN = ['paid', 'running'];

// Every leaf of the service region, with the name of its top-level state ('setup' for { setup: 'unpaid' }).
const SERVICE_LEAVES = serviceLeafValues().map((value) => ({
  value,
  top: typeof value === 'string' ? value : Object.keys(value)[0],
}));

// Every state a set of paths passes through. getShortestPaths drops a path another one already contains, so the
// intermediate states are read from the steps, not only from where each path ends.
function visited(paths: ReturnType<typeof model.getShortestPaths>): EventLifecycleSnapshot[] {
  return paths.flatMap((p) => [...p.steps.map((s) => s.state), p.state]);
}

const STATE_CHECKS = {
  closed: (s: EventLifecycleSnapshot) => {
    expect(s.status).toBe('done');
    expect(s.can({ type: 'event.close' })).toBe(false);
  },
  ...Object.fromEntries(
    ['none', 'setup', 'paymentInFlight', 'paid', 'moneyMoved', 'running', 'finished', 'unavailable'].map((top) => [
      `open.service.${top}`,
      (s: EventLifecycleSnapshot) => {
        expect(s.can({ type: 'event.close' })).toBe(CLOSE_ALLOWED_FROM.includes(top));
        expect(s.hasTag('cancellation.requestable')).toBe(REQUESTABLE_IN.includes(top));
      },
    ]),
  ),
  'open.status.draft': (s: EventLifecycleSnapshot) => expect(s.can({ type: 'event.published' })).toBe(true),
  'open.status.active': (s: EventLifecycleSnapshot) => expect(s.can({ type: 'event.published' })).toBe(false),
};

describe('the service region covers every state the server distinguishes', () => {
  it('has exactly these leaves', () => {
    expect(SERVICE_LEAVES.map((l) => l.value)).toEqual([
      'none',
      { setup: 'unpaid' },
      { setup: 'declined' },
      { paymentInFlight: 'pending' },
      { paymentInFlight: 'review' },
      { paid: 'real' },
      { paid: 'test' },
      { moneyMoved: 'held' },
      { moneyMoved: 'released' },
      { moneyMoved: 'refunded' },
      'running',
      'finished',
      'unavailable',
    ]);
  });
});

describe('from the initial state (a new draft, no service)', () => {
  const paths = model.getShortestPaths();

  it('reaches the confirmed event and the closed event, and nothing else', () => {
    expect([...new Set(visited(paths).map((s) => JSON.stringify(s.value)))].sort()).toEqual(
      [
        JSON.stringify({ open: { status: 'draft', service: 'none' } }),
        JSON.stringify({ open: { status: 'active', service: 'none' } }),
        JSON.stringify('closed'),
      ].sort(),
    );
  });

  for (const path of paths) {
    it(path.description, async () => {
      await path.test({ states: STATE_CHECKS });
    });
  }
});

describe('from every configuration the server can resolve', () => {
  for (const status of ['draft', 'active'] as const) {
    for (const leaf of SERVICE_LEAVES) {
      const fromState = eventLifecycleMachine.resolveState({ value: { open: { status, service: leaf.value } } });
      const paths = model.getShortestPaths({ fromState });
      const label = `${status} · ${JSON.stringify(leaf.value)}`;

      it(`${label}: closed is reachable only where nothing was paid`, () => {
        expect(visited(paths).some((s) => s.matches('closed'))).toBe(CLOSE_ALLOWED_FROM.includes(leaf.top));
      });

      it(`${label}: no event moves the service out of the state it was resolved to, except into closed`, () => {
        for (const s of visited(paths)) {
          if (s.matches('closed')) continue;
          expect(s.matches({ open: { service: leaf.value } } as never)).toBe(true);
        }
      });

      for (const path of paths) {
        it(`${label}: ${path.description}`, async () => {
          await path.test({ states: STATE_CHECKS });
        });
      }
    }
  }
});
