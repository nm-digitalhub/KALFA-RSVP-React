// Shows the event lifecycle statechart (src/lib/data/event-lifecycle.ts) running in the Stately inspector, over the
// tailnet. A development tool: never run by CI, never deployed, touches no database.
//
//   npm run inspect:lifecycle
//   # once, by the owner (tailnet only, HTTPS, the server stays on 127.0.0.1):
//   tailscale serve --bg --https=18443 http://127.0.0.1:18080
//   # then open https://nm-digitalhub.tail703115.ts.net:18443 on a device in the tailnet
//
// The package's own flow (README, "Node.js (WebSocket)"): createInspectorServer serves a page that embeds
// https://stately.ai/inspect and relays what createWebSocketInspector sends. One local patch
// (patches/@statelyai/inspect@0.7.2.patch, applied by npm on every install) makes it work behind tailscale serve:
//   - the page connects to the origin it was loaded from, not to 'ws://localhost:<port>' — the VIEWER's own machine
//     (measured 28.10.2026 on a phone: ERR_CONNECTION_REFUSED);
//   - a `host` option, so the server listens on 127.0.0.1 only instead of every interface of the VPS.
//
// What leaves the machine: the statechart definition and state/event names. The embedded stately.ai page POSTs the
// definitions to stately.ai's own API (machines.getDigraphConfigs, analyze — measured 28.10.2026 in Chrome DevTools) and
// loads Sentry, Stripe, Plausible and Featurebase. This machine has no context, so no personal data goes with them;
// never inspect a machine whose context or events carry personal data this way.

import { createWebSocketInspector } from '@statelyai/inspect';
import { createInspectorServer } from '@statelyai/inspect/server';
import { createActor, createMachine, type StateValue } from 'xstate';

import { eventLifecycleMachine as domainMachine, serviceLeafValues } from '../src/lib/data/event-lifecycle';

// The diagram's colours (Stately's state colours, stately.ai/docs/colors), by what each service state means for the
// close. Added to a COPY of the definition, for this view only; the domain machine carries no presentation.
type Color = 'green' | 'yellow' | 'blue' | 'orange' | 'red' | 'purple';
const SERVICE_COLORS: Record<string, Color> = {
  none: 'green', // the close is offered
  setup: 'green',
  finished: 'green',
  paymentInFlight: 'yellow', // contact support
  paid: 'blue', // the cancellation request
  running: 'blue',
  moneyMoved: 'orange', // support has to look
  unavailable: 'red', // fail closed
};

// The transitions (the event labels on the arrows): the close in red, the confirmation in blue.
const EVENT_COLORS: Record<string, Color> = { 'event.close': 'red', 'event.published': 'blue' };

type Painted = { meta?: Record<string, unknown> };
type StateConfig = Painted & { states?: Record<string, StateConfig>; on?: Record<string, Painted> };

function colored(config: typeof domainMachine.config): typeof domainMachine.config {
  const copy = structuredClone(config) as typeof domainMachine.config & StateConfig;
  const paint = (node: Painted | undefined, color: Color) => {
    if (node) node.meta = { ...node.meta, '@statelyai.color': color };
  };
  const open = copy.states?.open as StateConfig | undefined;
  for (const [key, color] of Object.entries(SERVICE_COLORS)) paint(open?.states?.service?.states?.[key], color);
  paint(copy.states?.closed as StateConfig | undefined, 'purple');
  const paintTransitions = (node: StateConfig) => {
    for (const [event, transition] of Object.entries(node.on ?? {})) {
      if (EVENT_COLORS[event]) paint(transition, EVENT_COLORS[event]);
    }
    for (const child of Object.values(node.states ?? {})) paintTransitions(child);
  };
  paintTransitions(copy);
  return copy;
}

const eventLifecycleMachine = createMachine(colored(domainMachine.config));

const HOST = '127.0.0.1';
const PORT = Number(process.env.INSPECT_PORT ?? 18080);
const STEP_MS = Number(process.env.INSPECT_STEP_MS ?? 700);

const server = createInspectorServer({ port: PORT, host: HOST, autoOpen: false });
const inspector = createWebSocketInspector({ url: `ws://${HOST}:${PORT}` });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 'paid.test' for { paid: 'test' }: the actor's name in the inspector's actor list.
const label = (value: StateValue): string =>
  typeof value === 'string' ? value : Object.entries(value).map(([k, v]) => `${k}.${label(v as StateValue)}`).join(',');

// Each run is an actor of its own, named for its starting configuration, and it is NOT stopped: a stopped actor
// leaves the inspector's view, which made the diagram vanish run after run. They all stay in the actor list.
async function run(status: 'draft' | 'active', service: StateValue, events: Array<'event.published' | 'event.close'>) {
  const resolved = eventLifecycleMachine.resolveState({ value: { open: { status, service } } });
  const actor = createActor(eventLifecycleMachine, {
    id: `${status} · ${label(service)}`,
    snapshot: eventLifecycleMachine.getPersistedSnapshot(resolved),
    inspect: inspector.inspect,
  });
  actor.start();
  for (const type of events) {
    await sleep(STEP_MS);
    actor.send({ type });
  }
  console.log(`${actor.id} → ${events.join(', ')} → ${JSON.stringify(actor.getSnapshot().value)}`);
}

async function main() {
  console.log(`inspector server on http://${HOST}:${PORT} (local only; reach it through tailscale serve)`);
  for (const service of serviceLeafValues()) {
    // The close is offered only where nothing was paid; elsewhere the event is ignored and the state stays.
    await run('active', service, ['event.close']);
    // A draft is confirmed first, then closed.
    await run('draft', service, ['event.published', 'event.close']);
  }
  console.log('done. A page opened later gets the last 200 inspection events; Ctrl+C to stop.');
}

process.on('SIGINT', () => {
  inspector.stop();
  server.stop();
  process.exit(0);
});

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
