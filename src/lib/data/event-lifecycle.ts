import { setup, type AnyStateNode, type SnapshotFrom, type StateValue } from 'xstate';

import { CANCELLABLE_CAMPAIGN_STATUSES, type CampaignStatus } from '@/lib/data/campaign-status';
import type { PaymentState } from '@/lib/payments/status';
import type { Enums } from '@/lib/supabase/types';

// The event's lifecycle as a statechart (openspec separate-event-setup-from-management, D5/D7; owner 28.10.2026).
//
// A DECISION MODEL for the screens, not an authority. The snapshot is resolved from facts the server already read (the
// event row, its live campaign, the package ledger); the screens ask it whether the close may be OFFERED
// (`snapshot.can({ type: 'event.close' })`) and whether the cancellation request is (`hasTag`). Who may close is the
// customer permission system (requireEventAccess 'events'/'close'), and the close itself, its money rules and its
// atomicity are close_event_retiring_setup in the database. The model must never be more permissive than that function:
// event-lifecycle.test.ts pins every combination of campaign status and ledger state against it.
//
// Two regions, both active while the event is open:
//   status  - the event row (R6: draft -> active by the confirm step; draft or active -> closed);
//   service - the RSVP service and its money, in the detail the server distinguishes.
// The close is taken from the service region, from a state where nothing was paid, and leaves the whole parallel
// state for `closed`; no transition crosses from one region into the other.
//
// The event's mode (design D1, owner 28.10.2026) is a tag on the same states, read by eventMode(snapshot): every
// configuration carries exactly one `mode.*` tag. `unavailable` is its own mode and never folds into the other two, so
// a failed read, money support has to look at, or campaigns the viewer cannot see never send anyone to the wrong page.

type EventStatus = Enums<'event_status'>;

export const eventLifecycleMachine = setup({
  types: {
    events: {} as { type: 'event.published' } | { type: 'event.close' },
    tags: {} as 'cancellation.requestable' | 'mode.setup' | 'mode.management' | 'mode.unavailable',
  },
}).createMachine({
  id: 'event',
  initial: 'open',
  states: {
    open: {
      type: 'parallel',
      states: {
        status: {
          initial: 'draft',
          states: {
            draft: { on: { 'event.published': { target: 'active' } } },
            active: {},
          },
        },
        service: {
          initial: 'none',
          states: {
            // No live service.
            none: { tags: ['mode.setup'], on: { 'event.close': { target: '#event.closed' } } },
            // Chosen or approved, nothing paid: the close retires it.
            setup: {
              tags: ['mode.setup'],
              initial: 'unpaid',
              on: { 'event.close': { target: '#event.closed' } },
              states: {
                unpaid: {},
                // Every attempt failed.
                declined: {},
              },
            },
            // A payment the provider has not settled, or one a person must resolve: still the payment step.
            paymentInFlight: {
              tags: ['mode.setup'],
              initial: 'pending',
              states: { pending: {}, review: {} },
            },
            // Paid, not running yet. Test money blocks the close too: resetting a test run is a staff action.
            paid: {
              tags: ['cancellation.requestable', 'mode.management'],
              initial: 'real',
              states: { real: {}, test: {} },
            },
            // Money moved in a way support has to look at: a hold, a released hold, a refund (D6: bad_state).
            moneyMoved: {
              tags: ['mode.unavailable'],
              initial: 'held',
              states: { held: {}, released: {}, refunded: {} },
            },
            // The service runs (or ran and paused) on a paid package.
            running: { tags: ['cancellation.requestable', 'mode.management'] },
            // The service is over; it no longer holds the event open.
            finished: { tags: ['mode.management'], on: { 'event.close': { target: '#event.closed' } } },
            // The ledger could not be read, or the viewer cannot see the event's campaigns: fail closed.
            unavailable: { tags: ['mode.unavailable'] },
          },
        },
      },
    },
    // A closed event shows its summary: never setup.
    closed: { type: 'final', tags: ['mode.management'] },
  },
});

export type EventMode = 'setup' | 'management' | 'unavailable';

const EVENT_MODES = ['setup', 'management', 'unavailable'] as const satisfies readonly EventMode[];

// The event's mode: a projection of the snapshot's one `mode.*` tag, not a second mapping of the campaign stage.
// Which page a viewer sees is the caller's decision (D1: the owner is redirected to /setup, another viewer gets the
// read-only card); this says only what state the event is in.
export function eventMode(snapshot: EventLifecycleSnapshot): EventMode {
  const modes = EVENT_MODES.filter((mode) => snapshot.hasTag(`mode.${mode}`));
  if (modes.length !== 1) {
    throw new Error(`event lifecycle: expected exactly one mode tag, found ${modes.length ? modes.join(', ') : 'none'}`);
  }
  return modes[0];
}

export type EventLifecycleSnapshot = SnapshotFrom<typeof eventLifecycleMachine>;

// Every leaf of the service region, as a value relative to it ('none', { setup: 'unpaid' }, …), in definition order.
// For the tests and the inspector script, which walk every configuration the server can resolve.
export function serviceLeafValues(node: AnyStateNode = eventLifecycleMachine.root.states.open.states.service): StateValue[] {
  return Object.entries(node.states).flatMap(([key, child]): StateValue[] =>
    Object.keys(child.states).length === 0 ? [key] : serviceLeafValues(child).map((leaf) => ({ [key]: leaf })),
  );
}

export type EventLifecycleFacts = {
  eventStatus: EventStatus;
  // False when the viewer may not see the event's campaigns: their absence then means nothing.
  campaignsVisible: boolean;
  // The live (non-cancelled) campaign, or null.
  campaign: { status: CampaignStatus; price?: number | null } | null;
  // packagePaymentOf(campaign): null for a campaign without a package, and for a ledger that could not be read.
  payment: Pick<PaymentState, 'status' | 'committed' | 'testMoney'> | null;
};

const RUNNING_CAMPAIGN_STATUSES: readonly CampaignStatus[] = ['scheduled', 'active', 'paused'];

// The service region's state for the facts.
export function serviceStateValue(facts: Omit<EventLifecycleFacts, 'eventStatus'>): StateValue {
  if (!facts.campaignsVisible) return 'unavailable';
  const { campaign, payment } = facts;
  if (!campaign) return 'none';
  if (RUNNING_CAMPAIGN_STATUSES.includes(campaign.status)) return 'running';
  if (!(CANCELLABLE_CAMPAIGN_STATUSES as readonly CampaignStatus[]).includes(campaign.status)) return 'finished';

  // A setup-stage campaign: the ledger decides.
  if (payment === null) {
    // No package means nothing to pay (the retired pay-per-result model); a package with no readable ledger is unknown.
    return campaign.price == null ? { setup: 'unpaid' } : 'unavailable';
  }
  switch (payment.status) {
    case 'none':
      return { setup: 'unpaid' };
    case 'declined':
      // A declined charge on a hold that DID succeed is still money that moved (the database sees the succeeded hold).
      return payment.committed > 0 ? { moneyMoved: 'held' } : { setup: 'declined' };
    case 'pending':
    case 'review':
      return { paymentInFlight: payment.status };
    case 'collected':
      return { paid: payment.testMoney === true ? 'test' : 'real' };
    case 'committed':
      return { moneyMoved: 'held' };
    case 'released':
    case 'refunded':
      return { moneyMoved: payment.status };
    default: {
      const exhaustive: never = payment.status;
      return exhaustive;
    }
  }
}

export function resolveEventLifecycle(facts: EventLifecycleFacts): EventLifecycleSnapshot {
  if (facts.eventStatus === 'closed') return eventLifecycleMachine.resolveState({ value: 'closed' });
  return eventLifecycleMachine.resolveState({
    value: { open: { status: facts.eventStatus, service: serviceStateValue(facts) } },
  });
}

// The close refusals the customer sees, shared by closeEvent (the database's answer) and the screens (the model's).
export const CLOSE_BLOCKED_PAID_ERROR =
  'לא ניתן לסגור את האירוע כי השירות כבר שולם. לביטול השירות יש לשלוח בקשת ביטול.';
export const CLOSE_BLOCKED_MONEY_ERROR =
  'יש תשלום שעדיין בטיפול, ולכן לא ניתן לסגור את האירוע כרגע. לעזרה יש לפנות לתמיכה.';
const CLOSE_MONEY_MOVED_HINT =
  'באירוע הזה יש תנועת כסף שדורשת בדיקה של התמיכה, ולכן לא ניתן לסגור אותו מכאן. לעזרה יש לפנות לתמיכה.';
const CLOSE_UNAVAILABLE_HINT = 'לא ניתן לבדוק כרגע את מצב התשלום, ולכן אי אפשר לסגור את האירוע. נסו שוב מאוחר יותר.';

// What a screen says in place of its content when the mode is `unavailable` (design D2, task 3.8). Shared by the event
// page and /setup so the two never word it differently: money that support has to look at, or a state that cannot be read.
export function unavailableNoticeOf(snapshot: EventLifecycleSnapshot): string {
  return snapshot.matches({ open: { service: 'moneyMoved' } })
    ? 'יש באישורי ההגעה תנועת כסף שדורשת בדיקה של התמיכה. לעזרה יש לפנות לתמיכה.'
    : 'לא ניתן להציג כרגע את מצב אישורי ההגעה. נסו שוב מאוחר יותר.';
}

export type CloseControl = {
  // The close may be offered now.
  allowed: boolean;
  // Why it is not, in the customer's words; null when allowed (and for a closed event, which shows no control).
  hint: string | null;
  // The cancellation request is the way out instead.
  cancellationRequestable: boolean;
};

export function closeControlOf(snapshot: EventLifecycleSnapshot): CloseControl {
  const allowed = snapshot.can({ type: 'event.close' });
  const cancellationRequestable = snapshot.hasTag('cancellation.requestable');
  if (allowed || snapshot.matches('closed')) return { allowed, hint: null, cancellationRequestable };
  const hint = cancellationRequestable
    ? CLOSE_BLOCKED_PAID_ERROR
    : snapshot.matches({ open: { service: 'paymentInFlight' } })
      ? CLOSE_BLOCKED_MONEY_ERROR
      : snapshot.matches({ open: { service: 'moneyMoved' } })
        ? CLOSE_MONEY_MOVED_HINT
        : CLOSE_UNAVAILABLE_HINT;
  return { allowed, hint, cancellationRequestable };
}
