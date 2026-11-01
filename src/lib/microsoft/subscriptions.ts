import 'server-only';

import { getAppOrigin } from '@/lib/url';

import { graphClient, mailboxPath } from './graph-client';

// Graph change notifications: the business mailbox's intake folder, and each
// console agent's calendar (src/lib/data/console-agent-calendar-presence.ts).
//
// Graph itself is the source of truth for which subscriptions exist — it lists
// the ones this application created — so nothing here needs a table of its own.
// That also means a subscription cannot be orphaned by a lost DB row.
//
// A subscription is a STANDING GRANT to push into our webhook, so it is created
// deliberately and never as a side effect of a request.

/**
 * Graph's ceiling for message subscriptions is 4230 minutes (~2.94 days).
 * Renewing at 24h of remaining life leaves room for a worker outage without
 * ever letting one lapse, which would silently stop all intake.
 *
 * Calendar subscriptions use the same lifetime. Graph refuses a creation whose
 * expiry is past its ceiling for the resource, so a lifetime that were too long
 * for events would fail the first creation loudly, not lapse quietly.
 */
const MAX_MINUTES = 4230;
export const RENEW_WHEN_UNDER_MS = 24 * 60 * 60 * 1000;

export type GraphSubscription = {
  id: string;
  resource: string;
  expirationDateTime: string;
  notificationUrl: string;
};

/** What one kind of subscription watches, and how. */
type SubscriptionSpec = {
  resource: string;
  changeType: string;
  /**
   * Ask Graph for lifecycle notifications (subscriptionRemoved, missed,
   * reauthorizationRequired) on the same route. Only settable at creation —
   * Graph refuses to add it to a live subscription, which would have to be
   * deleted and recreated.
   */
  lifecycle: boolean;
};

export type EnsureSubscriptionResult = {
  action: 'renewed' | 'created' | 'ok';
  id: string;
  expiresAt: string;
};

function expiry(): string {
  // A minute of headroom below the ceiling: Graph rejects the request outright
  // if the requested expiry is even slightly past what it allows, and clock
  // skew between us and the service is enough to cross it.
  return new Date(Date.now() + (MAX_MINUTES - 1) * 60_000).toISOString();
}

export async function notificationUrl(): Promise<string> {
  return `${await getAppOrigin()}/api/webhooks/microsoft-graph`;
}

/** The shared secret echoed back in every notification. */
export function webhookClientState(): string {
  const secret = process.env.MS_GRAPH_WEBHOOK_SECRET ?? '';
  if (!secret) throw new Error('graph_webhook_secret_missing');
  return secret;
}

/** Every subscription this application currently holds. */
export async function listSubscriptions(): Promise<GraphSubscription[]> {
  const res = (await graphClient().api('/subscriptions').get()) as {
    value?: GraphSubscription[];
  };
  return res.value ?? [];
}

/**
 * The folder a mail subscription watches.
 *
 * NOT the inbox, deliberately. The business mailbox is a real human mailbox —
 * it holds newsletters, vendor notifications and system mail, thousands of them
 * — and every message that enters intake becomes an inquiry row, which becomes
 * a drafted reply, which a human can approve into an actual email to someone
 * who never wrote to us. Watching the inbox wholesale would turn that pipeline
 * into a firehose pointed at customers.
 *
 * So intake watches ONE named folder. Anything the owner (or an Outlook rule)
 * files there is a customer inquiry by definition; nothing else can enter. It
 * also gives a manual override that needs no code: drag a message into the
 * folder and it becomes an inquiry.
 *
 * `MS_GRAPH_INTAKE_FOLDER` names it. Set it to `inbox` only if the mailbox is
 * genuinely dedicated to customer mail.
 */
export function intakeFolderName(): string {
  return process.env.MS_GRAPH_INTAKE_FOLDER ?? 'KALFA-Intake';
}

export function intakeResource(mailbox: string, folderId: string): string {
  return `${mailboxPath(mailbox)}/mailFolders/${encodeURIComponent(folderId)}/messages`;
}

function intakeSpec(mailbox: string, folderId: string): SubscriptionSpec {
  // Unchanged since intake shipped: new messages only, and no lifecycle URL —
  // the live subscription was created without one and cannot gain it in place.
  return { resource: intakeResource(mailbox, folderId), changeType: 'created', lifecycle: false };
}

/**
 * Every event in a mailbox's calendars. Not one named calendar: getSchedule
 * (what the presence sync reads) answers for the whole mailbox, so a change in
 * any calendar can move the answer.
 */
export function calendarEventsResource(mailbox: string): string {
  return `${mailboxPath(mailbox)}/events`;
}

function calendarSpec(mailbox: string): SubscriptionSpec {
  // Moved and cancelled meetings matter as much as new ones, and the lifecycle
  // events are what tell us a subscription was dropped or missed changes.
  return { resource: calendarEventsResource(mailbox), changeType: 'created,updated,deleted', lifecycle: true };
}

/**
 * The mailbox a calendar subscription watches, read back from its resource —
 * or null when the subscription is not a calendar one.
 */
export function mailboxOfCalendarSubscription(s: Pick<GraphSubscription, 'resource'>): string | null {
  const match = /^\/?users\/([^/]+)\/events$/i.exec(s.resource ?? '');
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Graph validates every URL in the request synchronously during this call: it
 * POSTs a `validationToken` and requires it echoed back within 10 seconds. So
 * the webhook route must already be DEPLOYED and reachable before this runs — a
 * subscription cannot be created against a route that only exists locally.
 */
async function createSubscription(spec: SubscriptionSpec): Promise<GraphSubscription> {
  const url = await notificationUrl();
  return (await graphClient()
    .api('/subscriptions')
    .post({
      changeType: spec.changeType,
      notificationUrl: url,
      // The same route serves both; it tells them apart by `lifecycleEvent`.
      ...(spec.lifecycle ? { lifecycleNotificationUrl: url } : {}),
      resource: spec.resource,
      expirationDateTime: expiry(),
      clientState: webhookClientState(),
    })) as GraphSubscription;
}

/** Creates the intake-folder subscription. */
export async function createIntakeSubscription(
  mailbox: string,
  folderId: string,
): Promise<GraphSubscription> {
  return createSubscription(intakeSpec(mailbox, folderId));
}

/** Pushes a subscription's expiry back out to the ceiling. */
export async function renewSubscription(id: string): Promise<GraphSubscription> {
  return (await graphClient()
    .api(`/subscriptions/${encodeURIComponent(id)}`)
    .patch({ expirationDateTime: expiry() })) as GraphSubscription;
}

export async function deleteSubscription(id: string): Promise<void> {
  await graphClient().api(`/subscriptions/${encodeURIComponent(id)}`).delete();
}

/**
 * Keeps exactly one live subscription for a spec: renews what is close to
 * expiring, and recreates it if it is gone entirely. Returns what it did so the
 * caller can log a fact rather than an intention.
 *
 * "Mine" is the resource AND this deployment's notification URL: the app
 * identity is tenant-wide, so a subscription another deployment holds on the
 * same resource is not ours to renew or prune.
 */
async function ensureSubscription(
  spec: SubscriptionSpec,
  existing?: GraphSubscription[],
): Promise<EnsureSubscriptionResult> {
  const wanted = spec.resource.toLowerCase();
  const url = await notificationUrl();
  const mine = (existing ?? (await listSubscriptions())).filter(
    (s) => (s.resource ?? '').toLowerCase() === wanted && s.notificationUrl === url,
  );

  if (mine.length === 0) {
    const created = await createSubscription(spec);
    return { action: 'created', id: created.id, expiresAt: created.expirationDateTime };
  }

  // Keep the longest-lived one and drop duplicates, so a retried creation can
  // never leave us processing every notification twice.
  mine.sort((a, b) => Date.parse(b.expirationDateTime) - Date.parse(a.expirationDateTime));
  const [keep, ...extra] = mine;
  for (const s of extra) {
    try {
      await deleteSubscription(s.id);
    } catch {
      // A duplicate that refuses to die is not worth failing the renewal over;
      // the webhook is idempotent by dedupe_key regardless.
    }
  }

  const remaining = Date.parse(keep.expirationDateTime) - Date.now();
  if (remaining > RENEW_WHEN_UNDER_MS) {
    return { action: 'ok', id: keep.id, expiresAt: keep.expirationDateTime };
  }
  const renewed = await renewSubscription(keep.id);
  return { action: 'renewed', id: renewed.id, expiresAt: renewed.expirationDateTime };
}

/** Keeps exactly one live intake-folder subscription. */
export async function ensureIntakeSubscription(
  mailbox: string,
  folderId: string,
): Promise<EnsureSubscriptionResult> {
  return ensureSubscription(intakeSpec(mailbox, folderId));
}

/**
 * Keeps exactly one live calendar subscription for a mailbox. `existing` lets a
 * caller ensuring several mailboxes list the subscriptions once.
 */
export async function ensureCalendarSubscription(
  mailbox: string,
  existing?: GraphSubscription[],
): Promise<EnsureSubscriptionResult> {
  return ensureSubscription(calendarSpec(mailbox), existing);
}
