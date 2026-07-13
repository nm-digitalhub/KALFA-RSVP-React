import 'server-only';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { WhatsAppAPI } from 'whatsapp-api-js';
import { DEFAULT_API_VERSION } from 'whatsapp-api-js/types';
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
//   definitely_not_sent — a VERIFIED synchronous provider rejection (invalid
//                         recipient/template/params, closed 24h window). KNOWN
//                         not delivered → the worker may release + retry.
//   unknown             — timeout / network / 5xx / throttle / unmapped code /
//                         missing id. Delivery UNCERTAIN → the worker NEVER
//                         resends (advances at-most-once).
// Carries only status/code numbers — never phone, name, or body.
export type DeliveryOutcome =
  | { kind: 'accepted'; providerId: string }
  | {
      kind: 'definitely_not_sent';
      reason: string;
      providerStatus?: number;
      providerCode?: string;
    }
  | { kind: 'unknown'; reason: string; providerStatus?: number; providerCode?: string };

// Meta Cloud API error codes that are SYNCHRONOUS pre-queue rejections — the
// message was KNOWN not delivered. ONLY these map to definitely_not_sent (safe
// to retry). Everything else — 5xx, network, timeout, throttling, account state,
// unmapped codes — classifies as unknown (never resends). Conservative by
// design: an unmapped code costs one advance-skip (the multi-touchpoint schedule
// self-covers); a wrong 'definite' would cost a resend.
// https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const DEFINITELY_NOT_SENT_CODES = new Set<number>([
  100, // invalid parameter / unsupported field
  131008, // required parameter is missing
  131009, // parameter value is not valid
  131026, // message undeliverable (recipient cannot receive / not on WhatsApp)
  131047, // re-engagement required (outside the 24h customer-service window)
  131051, // unsupported message type
  132000, // template param count mismatch
  132001, // template does not exist / not approved for the language
  132005, // template hydrated text too long
  132007, // template content violates policy
  132012, // template parameter format mismatch
  132015, // template is paused
  132016, // template is disabled
  // 131055 (MM Lite: WABA not eligible for /marketing_messages, or ad-sync
  // still in progress) is DELIBERATELY NOT here — it classifies as `unknown`,
  // not `definitely_not_sent`. `product_policy: 'CLOUD_API_FALLBACK'` should
  // already prevent it from ever reaching the caller as a hard rejection, and
  // a false 'definite' here would cost a real resend; the conservative
  // `unknown` (one advance-skip) is the safe default per the file-header policy.
]);

// Classify a RESOLVED sendMessage body. whatsapp-api-js returns the parsed JSON
// (it does NOT throw on an HTTP 4xx/5xx — a Meta error arrives as { error: {…} }
// in the body). A message id ⇒ accepted; a mapped error code ⇒ definitely_not_sent;
// anything else ⇒ unknown.
function classifyResponse(res: unknown): DeliveryOutcome {
  const r = res as {
    messages?: Array<{ id?: string | null } | null> | null;
    error?: { code?: number } | null;
  } | null;
  const providerId = r?.messages?.[0]?.id;
  if (providerId) return { kind: 'accepted', providerId };
  const code = r?.error?.code;
  if (typeof code === 'number') {
    return DEFINITELY_NOT_SENT_CODES.has(code)
      ? { kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: String(code) }
      : { kind: 'unknown', reason: 'provider_error', providerCode: String(code) };
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

// Fail-safe ops alert for a THROWN send (transport/network/timeout/5xx — an
// infra failure of the provider API call itself). Deliberately NOT fired for
// classifyResponse outcomes: a Meta error CODE (e.g. 131049/131026) is a
// per-recipient business result, not a provider outage. NO PII: only the safe
// reason + optional HTTP status. Fire-and-forget (sendSlackAlert never throws).
function alertWhatsAppThrow(outcome: DeliveryOutcome): void {
  const status = outcome.kind === 'unknown' ? outcome.providerStatus : undefined;
  void sendSlackAlert({
    level: 'warn',
    title: 'WhatsApp send failed',
    detail: `send_threw${status !== undefined ? ` status=${status}` : ''}`,
    source: 'whatsapp',
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

export async function sendWhatsAppTemplate(
  cfg: { phoneNumberId: string; accessToken: string; appSecret: string | null },
  params: TemplateMessageParams & { to: string },
): Promise<DeliveryOutcome> {
  // Fail-closed: a URL button and RSVP quick-reply payloads share the SAME
  // button-index space, so injecting both would misalign the indices and Meta
  // would reject or mis-route the tap. A template is EITHER a URL-button type OR
  // a quick-reply type here — never both. Refuse rather than send a broken message.
  if (params.urlButtonParam && params.rsvpButtonPayloads) {
    return { kind: 'unknown', reason: 'url_and_rsvp_buttons_conflict' };
  }
  // secure:false avoids requiring the appSecret for SENDING (the secret is only
  // needed to verify INBOUND webhooks, handled in B2).
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false });
  const message = buildTemplateMessage(params);

  try {
    const res = await api.sendMessage(cfg.phoneNumberId, params.to, message);
    return classifyResponse(res);
  } catch (e) {
    const outcome = classifyThrow(e);
    alertWhatsAppThrow(outcome);
    return outcome;
  }
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
): Promise<DeliveryOutcome> {
  // Same fail-closed button-index guard as sendWhatsAppTemplate.
  if (params.urlButtonParam && params.rsvpButtonPayloads) {
    return { kind: 'unknown', reason: 'url_and_rsvp_buttons_conflict' };
  }
  // `v` is a private field on WhatsAppAPI (unlike sendMessage, we build the
  // URL ourselves) — pin the SAME version explicitly here, both for the
  // constructor and the URL, rather than reading a private property.
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false, v: DEFAULT_API_VERSION });
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
  try {
    const res = await api.$$apiFetch$$(
      `https://graph.facebook.com/${DEFAULT_API_VERSION}/${cfg.phoneNumberId}/marketing_messages`,
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
}

// Free-form session message — allowed ONLY inside the 24h customer-service
// window a guest opened by replying (e.g. the headcount question right after
// an RSVP button press). No template, no marketing cap. Same logging rules:
// never log token/recipient/body.
export async function sendWhatsAppText(
  cfg: { phoneNumberId: string; accessToken: string; appSecret: string | null },
  params: { to: string; body: string },
): Promise<DeliveryOutcome> {
  const api = new WhatsAppAPI({ token: cfg.accessToken, secure: false });
  try {
    const res = await api.sendMessage(cfg.phoneNumberId, params.to, new Text(params.body));
    return classifyResponse(res);
  } catch (e) {
    const outcome = classifyThrow(e);
    alertWhatsAppThrow(outcome);
    return outcome;
  }
}
