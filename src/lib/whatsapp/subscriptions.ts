import 'server-only';

import { GRAPH_API_VERSION } from './graph-version';

// Is the app still subscribed to WhatsApp webhooks — and if not, put it back.
//
// ⚠️ THIS EXISTS BECAUSE IT ALREADY HAPPENED, AND COST FIVE DAYS.
// MEASURED 2026-09-13: the app's ONLY subscription was a stray `catalog` topic
// with an empty field list. The `whatsapp_business_account` topic — the one that
// carries `messages` — was gone. Meta had delivered nothing since 2026-09-08
// 19:56, so button-RSVP, every guest reply, WhatsApp guest import and every armed
// workflow were silently dead. Nothing noticed: the hourly health check probes
// the TOKEN and the phone-number node, both of which stayed perfectly healthy
// while no message could arrive.
//
// A working credential and a delivered webhook are different claims, and only one
// of them was being checked.
//
// ⚠️ THE DOCS SAY THIS ENDPOINT CANNOT DO THIS. WRONG, MEASURED.
// developers.facebook.com/docs/graph-api/reference/app/subscriptions states, in
// v4.0 through v26.0, "Webhooks for WhatsApp is not supported. WhatsApp webhooks
// must be configured using the App Dashboard", and documents `object` as
// enum{user, page, permissions, payments}. Both are false: a POST with
// `object=whatsapp_business_account` returned HTTP 200 `{"success":true}` on
// 2026-09-13 and the subscription appears in the listing. Recorded here because
// reading the reference alone would send the next person to click through a
// dashboard by hand.

/**
 * The fields we subscribe to — deliberately the ones this codebase HANDLES.
 *
 * `messages` is the whole inbound path (route.ts branches on `field === 'messages'`).
 * `message_template_status_update` feeds template health.
 *
 * The app was once subscribed to 28 fields (§2 of the consolidation plan). Not
 * restored wholesale: a field nobody consumes is a row in webhook_inbox that is
 * claimed, processed to nothing and retained — noise that makes the real traffic
 * harder to read. Add one here when something starts handling it.
 */
export const WHATSAPP_WEBHOOK_FIELDS = [
  'messages',
  'message_template_status_update',
] as const;

export const WHATSAPP_WEBHOOK_TOPIC = 'whatsapp_business_account';

export type AppSubscription = {
  topic: string;
  fields: string[];
  active: boolean;
};

export type SubscriptionState =
  | { kind: 'ok'; fields: string[] }
  | { kind: 'missing_fields'; fields: string[]; missing: string[] }
  | { kind: 'absent' }
  | { kind: 'inactive' };

type GraphSubscriptionRow = {
  object?: string;
  fields?: Array<{ name?: string } | string>;
  active?: boolean;
};

/** `{app-id}|{app-secret}` — the app access token this edge requires. */
function appToken(appId: string, appSecret: string): string {
  return `${appId}|${appSecret}`;
}

// Graph returns `fields` either as objects ({name, version}) or, on some
// versions, as bare strings. Both are normalised rather than one being assumed.
function fieldNames(row: GraphSubscriptionRow): string[] {
  return (row.fields ?? [])
    .map((f) => (typeof f === 'string' ? f : f?.name))
    .filter((n): n is string => typeof n === 'string');
}

export async function getAppSubscriptions(input: {
  appId: string;
  appSecret: string;
}): Promise<AppSubscription[]> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(input.appId)}/subscriptions`,
  );
  url.searchParams.set('access_token', appToken(input.appId, input.appSecret));

  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });

  // STATUS ONLY, the same rule as every other module here: Graph's error body
  // echoes request context, and this string reaches logs and Slack.
  if (!res.ok) throw new Error(`subscriptions fetch failed: HTTP ${res.status}`);

  const body = (await res.json()) as { data?: GraphSubscriptionRow[] };
  return (body.data ?? []).map((row) => ({
    topic: row.object ?? '',
    fields: fieldNames(row),
    active: row.active !== false,
  }));
}

/**
 * What the listing says about the topic we depend on.
 *
 * Four states rather than a boolean, because the repair differs and so does the
 * message: absent needs a full subscribe, missing fields needs the same POST for
 * a different reason, and inactive is Meta having disabled it — worth saying out
 * loud rather than folding into "absent".
 */
export function readWhatsAppSubscription(subs: AppSubscription[]): SubscriptionState {
  const row = subs.find((s) => s.topic === WHATSAPP_WEBHOOK_TOPIC);
  if (!row) return { kind: 'absent' };
  if (!row.active) return { kind: 'inactive' };

  const missing = WHATSAPP_WEBHOOK_FIELDS.filter((f) => !row.fields.includes(f));
  return missing.length === 0
    ? { kind: 'ok', fields: row.fields }
    : { kind: 'missing_fields', fields: row.fields, missing };
}

/**
 * (Re-)subscribe the app to WhatsApp webhooks.
 *
 * IDEMPOTENT AND NON-DESTRUCTIVE. Meta's own reference: "Making a POST request
 * with the callback_url, verify_token, and object fields will reactivate the
 * subscription." Running it against a healthy subscription re-asserts the same
 * state; it does not touch other topics (the stray `catalog` one is left exactly
 * as it is, because removing it is a judgement nobody has made).
 *
 * The verify_token is a parameter and never module state, never logged, and never
 * placed in a thrown message — the same rule debug-token.ts follows.
 */
export async function subscribeWhatsAppWebhook(input: {
  appId: string;
  appSecret: string;
  callbackUrl: string;
  verifyToken: string;
}): Promise<void> {
  const body = new URLSearchParams({
    object: WHATSAPP_WEBHOOK_TOPIC,
    callback_url: input.callbackUrl,
    fields: WHATSAPP_WEBHOOK_FIELDS.join(','),
    include_values: 'true',
    verify_token: input.verifyToken,
    access_token: appToken(input.appId, input.appSecret),
  });

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(input.appId)}/subscriptions`,
    {
      method: 'POST',
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    },
  );

  const json = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: { code?: number };
  };

  if (!res.ok || json.success !== true) {
    // The code, never the message: Meta's error text can echo the callback URL
    // and the parameters we just sent, verify_token among them.
    throw new Error(
      `subscribe failed: HTTP ${res.status}${json.error?.code ? ` (code ${json.error.code})` : ''}`,
    );
  }
}
