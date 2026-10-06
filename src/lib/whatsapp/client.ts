import 'server-only';

import type { GraphErrorBody } from '@/lib/whatsapp/graph-error';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';
import { WhatsAppAPI } from 'whatsapp-api-js';
import {
  Text,
  Template,
  Language,
  BodyComponent,
  BodyParameter,
  HeaderComponent,
  HeaderParameter,
  URLComponent,
  PayloadComponent,
  Image,
} from 'whatsapp-api-js/messages';

// WhatsApp Cloud API send adapter (approved templates only — free text is only
// allowed inside the 24h customer-service window). Thin wrapper over
// whatsapp-api-js. Never log the access token, recipient, or message body.

export class WhatsAppSendError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'WhatsAppSendError';
  }
}

// The PII-free delivery classification the serial-flow worker resolves on (§F.5
// / §12.8.5). Exactly three outcomes:
//   accepted            — the provider returned a message id (queued/sent).
//   definitely_not_sent — our LABEL for a send Meta answered with an error code
//                         and no message id, not marked temporary (see below; a
//                         project rule, not Meta's guarantee). It says nothing
//                         about whether a resend would help — callers must not
//                         retry on it alone.
//   unknown             — timeout / network / a thrown send / a body with no id /
//                         an error Meta marked temporary. Nothing is assumed about
//                         delivery → the worker NEVER resends (advances
//                         at-most-once).
// Both non-accepted outcomes keep Meta's code when there is one.
// Carries only status/code numbers — never phone, name, or body.
export type DeliveryOutcome =
  | { kind: 'accepted'; providerId: string }
  | {
      kind: 'definitely_not_sent';
      reason: string;
      providerStatus?: number;
      providerCode?: string;
    }
  | {
      kind: 'unknown';
      reason: string;
      providerStatus?: number;
      providerCode?: string;
      /** Meta answered with an error marked `is_transient: true` — "the request should be retried". */
      retryable?: true;
    };

// How an error response is labelled. THIS IS A PROJECT RULE, not a Meta
// guarantee — Meta documents no rule that turns a send error into a delivery
// verdict. What the docs do say (read in full 2026-09-28):
//   - the send response only acknowledges the request; delivery is reported by
//     the status webhooks (sent / delivered / read / failed) — send-messages,
//     messages status webhook reference;
//   - an error can come back synchronously, asynchronously through a webhook,
//     or both, and handling should be built on `code` and `details` —
//     support/error-codes;
//   - a failed request "returns an error response instead of a message ID" —
//     image messages → Error handling;
//   - the Graph Error object has `is_transient`, "Indicates whether this error
//     is temporary and the request should be retried" — API reference → Error.
//     The docs do not say that its absence means `false`.
// On that basis we CHOOSE to label a send answered with an error code and no
// message id as `definitely_not_sent` ("Meta refused this request"), unless
// Meta set `is_transient: true`, which we label `unknown`. An absent field is
// treated like `false` — our choice, not documented. The label is not a delivery
// status and proves nothing about delivery either way; what reached the phone
// is only known from the status webhooks. Meta's code is kept in both labels.
//
// Neither label by itself means "send it again". The one documented retry — an
// error Meta marks `is_transient` — happens inside the send call, through
// sendWithMetaRetry below, when the caller gives it a time budget. After that,
// the outreach step advance-skips both labels (outreach/enqueue.ts).

/** The project's label rule (see above): an error not marked `is_transient: true` is labelled a refusal. Not a delivery verdict. */
export function isDefinitelyNotSentError(error: { code: number; isTransient?: unknown }): boolean {
  return error.isTransient !== true;
}

// Classify a RESOLVED sendMessage body. whatsapp-api-js returns the parsed JSON
// (it does NOT throw on an HTTP 4xx/5xx — a Meta error arrives as { error: {…} }
// in the body). A message id ⇒ accepted; an error code not marked temporary ⇒
// definitely_not_sent; anything else ⇒ unknown. The code is kept either way.
function classifyResponse(res: unknown): DeliveryOutcome {
  const r = res as {
    messages?: Array<{ id?: string | null } | null> | null;
  } & GraphErrorBody | null;
  const providerId = r?.messages?.[0]?.id;
  if (providerId) return { kind: 'accepted', providerId };
  const code = r?.error?.code;
  if (typeof code === 'number') {
    return isDefinitelyNotSentError({ code, isTransient: r?.error?.is_transient })
      ? { kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: String(code) }
      : { kind: 'unknown', reason: 'provider_error', providerCode: String(code), retryable: true };
  }
  // No id and no recognizable error code → the send cannot be confirmed.
  return { kind: 'unknown', reason: 'missing_message_id' };
}

// A THROW from the send path is ambiguous about delivery (fetch network/timeout,
// a JSON parse failure on a gateway HTML page, or a library WhatsAppAPIError).
// It is ALWAYS unknown — the verified 'definite' signal is a provider error CODE
// (which arrives in the resolved body, never as a throw), not an HTTP status.
function classifyThrow(e: unknown): DeliveryOutcome {
  const status = (e as { httpStatus?: unknown } | null)?.httpStatus;
  return {
    kind: 'unknown',
    reason: 'send_threw',
    providerStatus: typeof status === 'number' ? status : undefined,
  };
}

// Retrying a send, the way Meta documents it:
//   - the Graph Error field `is_transient`: "Indicates whether this error is
//     temporary and the request should be retried" (API reference → Error);
//   - "if a send request fails, retry after 4^X seconds (starting with X=0 and
//     increasing X by 1 after each failure) until successful" (About the
//     platform → Rate limits).
// So only an outcome Meta marked retryable is sent again, after 1s, 4s, 16s, …
//
// What is NOT retried, also from Meta's docs: a send with no answer at all (a
// timeout, a network failure, a thrown send). Meta's reliability FAQ says such a
// failure shows up "as either error or missed success" (Support → Reliability)
// — the request may have gone through, so a resend could deliver it twice.
//
// "Until successful" is bounded here by the caller's time budget: the loop never
// starts a wait that would end past `budgetMs` from the first attempt. A budget
// of 0 means one attempt, no retry — for request/response contexts (a live voice
// tool call) that cannot wait. The last outcome is returned as is.
export const META_RETRY_BASE_MS = 1_000;
/** A background job's retry budget: room for Meta's first three waits (1s + 4s + 16s). */
export const BACKGROUND_SEND_RETRY_BUDGET_MS = 21_000;

export interface MetaRetryOptions {
  /** Total time the retries may take, from the first attempt. 0 = no retry. */
  budgetMs: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export async function sendWithMetaRetry(
  send: () => Promise<DeliveryOutcome>,
  opts: MetaRetryOptions,
): Promise<DeliveryOutcome> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  let outcome = await send();
  for (let x = 0; outcome.kind === 'unknown' && outcome.retryable === true; x += 1) {
    const wait = META_RETRY_BASE_MS * 4 ** x;
    if (now() - start + wait > opts.budgetMs) break;
    await sleep(wait);
    outcome = await send();
  }
  return outcome;
}

// Fail-safe ops alert for a THROWN send (transport/network/timeout/5xx — an
// infra failure of the provider API call itself). Deliberately NOT fired for
// classifyResponse outcomes: a Meta error CODE (e.g. 131049/131026) is a
// per-recipient business result, not a provider outage. NO PII: only the safe
// reason + optional HTTP status. Fire-and-forget (sendSlackAlert never throws).
export function alertWhatsAppThrow(outcome: DeliveryOutcome): void {
  const status = outcome.kind === 'unknown' ? outcome.providerStatus : undefined;
  void sendSlackAlert({
    level: 'warn',
    title: 'WhatsApp send failed',
    detail: `send_threw${status !== undefined ? ` status=${status}` : ''}`,
    source: 'whatsapp',
    category: 'send_health',
  });
}

// Send-time template inputs shared by BOTH send paths (regular `/messages`
// and MM Lite `/marketing_messages`) — same components, same fail-closed
// rules, different transport.
type TemplateMessageParams = {
  templateName: string;
  language: string;
  // Positional body parameters ({{1}}..{{n}}, in order) for templates that
  // declare body variables — built upstream by buildTemplateParams
  // (template-spec.ts), which guarantees none is empty. Omitted → the
  // template is sent bare, exactly as before (templates with no variables).
  bodyParams?: readonly string[];
  // IMAGE-header templates (e.g. kalfa_event_invite_media_v1): the actual
  // per-event image, as a short-lived signed URL or a WhatsApp media id —
  // resolved upstream; this adapter never touches storage.
  headerImage?: { link: string } | { mediaId: string };
  // URL-button variable — the suffix Meta appends to the template's static
  // button URL (e.g. the event's gift_link_token for kalfa_event_gift_v1).
  urlButtonParam?: string;
  // RSVP quick-reply payloads bound at send time, in button-index order, for
  // templates whose approved layout carries the 3 RSVP QUICK_REPLY buttons.
  // Meta stores NO payload on a QUICK_REPLY button, so a tap returns these (as
  // button.payload) ONLY when injected here; otherwise it echoes the LABEL and
  // the inbound RSVP_BUTTON_MAP misses. One PayloadComponent per payload.
  rsvpButtonPayloads?: readonly string[];
};

// Shared Template-message construction for both send paths (extracted so
// `/messages` and `/marketing_messages` never drift on component-building
// logic). whatsapp-api-js 6.x: Template(name, language, ...components); a
// positional body is one BodyComponent whose BodyParameter order is the {{i}}
// order; button component indexes are assigned by constructor order.
function buildTemplateMessage(params: TemplateMessageParams): Template {
  const components: (
    | HeaderComponent
    | BodyComponent
    | URLComponent
    | PayloadComponent
  )[] = [];
  if (params.headerImage) {
    const image =
      'link' in params.headerImage
        ? new Image(params.headerImage.link)
        : new Image(params.headerImage.mediaId, true);
    components.push(new HeaderComponent(new HeaderParameter(image)));
  }
  if (params.bodyParams && params.bodyParams.length > 0) {
    components.push(
      new BodyComponent(
        new BodyParameter(params.bodyParams[0]),
        ...params.bodyParams.slice(1).map((p) => new BodyParameter(p)),
      ),
    );
  }
  if (params.urlButtonParam) {
    components.push(new URLComponent(params.urlButtonParam));
  }
  // Quick-reply RSVP buttons: one PayloadComponent per payload, in order. The
  // library assigns each button its index by constructor order (button_counter),
  // so with no URL button these land at button indices 0..n matching the approved
  // template layout (מגיע/ה=0, לא מגיע/ה=1, אולי=2).
  if (params.rsvpButtonPayloads) {
    for (const payload of params.rsvpButtonPayloads) {
      components.push(new PayloadComponent(payload));
    }
  }
  return components.length > 0
    ? new Template(
        params.templateName,
        new Language(params.language),
        ...(components as [
          HeaderComponent | BodyComponent | URLComponent | PayloadComponent,
        ]),
      )
    : new Template(params.templateName, new Language(params.language));
}

/** Per-call send options. `retryBudgetMs` > 0 turns on Meta's documented retry (sendWithMetaRetry). */
export interface SendOptions {
  retryBudgetMs?: number;
}

export async function sendWhatsAppTemplate(
  cfg: { phoneNumberId: string; accessToken: string; appSecret: string | null },
  params: TemplateMessageParams & { to: string },
  opts: SendOptions = {},
): Promise<DeliveryOutcome> {
  // Fail-closed: a URL button and RSVP quick-reply payloads share the SAME
  // button-index space, so injecting both would misalign the indices and Meta
  // would reject or mis-route the tap. A template is EITHER a URL-button type OR
  // a quick-reply type here — never both. Refuse rather than send a broken message.
  if (params.urlButtonParam && params.rsvpButtonPayloads) {
    return { kind: 'unknown', reason: 'url_and_rsvp_buttons_conflict' };
  }
  // secure:false avoids requiring the appSecret for SENDING (the secret is only
  // needed to verify INBOUND webhooks, in api/webhooks/whatsapp/route.ts). v pinned explicitly —
  // same reasoning as sendWhatsAppMarketingTemplate below (never ride the
  // library's own default silently).
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false, v: GRAPH_API_VERSION });
  const message = buildTemplateMessage(params);

  return sendWithMetaRetry(async () => {
    try {
      const res = await api.sendMessage(cfg.phoneNumberId, params.to, message);
      return classifyResponse(res);
    } catch (e) {
      const outcome = classifyThrow(e);
      alertWhatsAppThrow(outcome);
      return outcome;
    }
  }, { budgetMs: opts.retryBudgetMs ?? 0 });
}

// MM Lite — MARKETING-category templates only (message_key ∈
// MARKETING_MESSAGE_KEYS, template-spec.ts). Meta requires MARKETING template
// sends to route through `/marketing_messages` rather than `/messages` for
// the routing/timing optimization MM Lite provides (a non-MARKETING template
// here would come back as error 131055). whatsapp-api-js has NO native
// support for this endpoint (verified across the 6.x line) — it is reached
// via the library's documented escape hatch, `$$apiFetch$$` (lib/index.js,
// "for a specific API operation which is not implemented by the library"),
// which authenticates with the SAME token/version/fetch as every other call.
// Deliberately NOT a raw fetch or a fetch ponyfill — either would risk
// diverging from the instance's own transport (e.g. re-pointing markAsRead,
// which also posts to `/messages`, is a needless hazard `$$apiFetch$$` avoids.
export async function sendWhatsAppMarketingTemplate(
  cfg: { phoneNumberId: string; accessToken: string; appSecret: string | null },
  params: TemplateMessageParams & { to: string },
  opts: SendOptions = {},
): Promise<DeliveryOutcome> {
  // Same fail-closed button-index guard as sendWhatsAppTemplate.
  if (params.urlButtonParam && params.rsvpButtonPayloads) {
    return { kind: 'unknown', reason: 'url_and_rsvp_buttons_conflict' };
  }
  // `v` is a private field on WhatsAppAPI (unlike sendMessage, we build the
  // URL ourselves) — pin the SAME version explicitly here, both for the
  // constructor and the URL, rather than reading a private property.
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false, v: GRAPH_API_VERSION });
  const message = buildTemplateMessage(params);
  // Same request shape as `/messages` (messaging_product/recipient_type/to/
  // type/[type]) plus `product_policy` — verified against Meta's Marketing
  // Messages docs. CLOUD_API_FALLBACK (the default) falls back to ordinary
  // Cloud API routing if the WABA isn't (yet) eligible for MM Lite, so this is
  // written explicitly rather than omitted. message_activity_sharing is left
  // unset on purpose — it inherits the WABA-level default (per the plan).
  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: params.to,
    type: message._type,
    [message._type]: message,
    product_policy: 'CLOUD_API_FALLBACK',
  };
  return sendWithMetaRetry(async () => {
    try {
      const res = await api.$$apiFetch$$(
        `https://graph.facebook.com/${GRAPH_API_VERSION}/${cfg.phoneNumberId}/marketing_messages`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      // $$apiFetch$$ returns the RAW fetch Response (unlike sendMessage, which
      // resolves the parsed body) — parse it ourselves before classifying.
      return classifyResponse(await res.json());
    } catch (e) {
      const outcome = classifyThrow(e);
      alertWhatsAppThrow(outcome);
      return outcome;
    }
  }, { budgetMs: opts.retryBudgetMs ?? 0 });
}

// Free-form session message — allowed ONLY inside the 24h customer-service
// window a guest opened by replying (e.g. the headcount question right after
// an RSVP button press). No template, no marketing cap. Same logging rules:
// never log token/recipient/body.
export async function sendWhatsAppText(
  cfg: { phoneNumberId: string; accessToken: string; appSecret: string | null },
  params: { to: string; body: string },
  opts: SendOptions = {},
): Promise<DeliveryOutcome> {
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false, v: GRAPH_API_VERSION });
  return sendWithMetaRetry(async () => {
    try {
      const res = await api.sendMessage(cfg.phoneNumberId, params.to, new Text(params.body));
      return classifyResponse(res);
    } catch (e) {
      const outcome = classifyThrow(e);
      alertWhatsAppThrow(outcome);
      return outcome;
    }
  }, { budgetMs: opts.retryBudgetMs ?? 0 });
}
