import { z } from 'zod';

// Validation for the browser call-center's server surfaces (plan stage 4/5):
//   1. POST /api/console-calls/dial-intent          — browser (Bearer), dialIntentBodySchema
//   2. POST /api/voximplant/console/authorize        — ConsoleDial scenario, consoleAuthorizeBodySchema
//   3. POST /api/voximplant/console/event            — both scenarios, consoleEventBodySchema
//   4. POST /api/voximplant/console/route-inbound    — ConsoleInbound scenario, routeInboundBodySchema
//
// Shapes 2-4 are verified against voxfiles/scenarios/src/ConsoleDial.voxengine.js
// and ConsoleInbound.voxengine.js VERBATIM (the exact Net.httpRequestAsync
// postData bodies) — a parse failure here must mean the scenario sent something
// unexpected, not that the schema drifted from what was actually shipped.

// ---------------------------------------------------------------------------
// 1. POST /api/console-calls/dial-intent
// ---------------------------------------------------------------------------

// The decided consent matrix (decide-consent, GO/NO-GO table) recognizes
// EXACTLY two dial-target shapes. A cold-call (freeform phone / arbitrary
// contact with no event/callback provenance) has NO representation here on
// purpose — the union itself is the enforcement of "no code path exists for
// scenario ג", not a runtime check elsewhere.
export const dialIntentBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('callback'), id: z.string().uuid() }),
  z.strictObject({
    kind: z.literal('guest_service'),
    eventId: z.string().uuid(),
    contactId: z.string().uuid(),
  }),
]);
export type DialIntentBody = z.infer<typeof dialIntentBodySchema>;

// ---------------------------------------------------------------------------
// 2. POST /api/voximplant/console/authorize  (ConsoleDial.voxengine.js:563-566)
// ---------------------------------------------------------------------------

// `postData: safeStringify({ secret: CONSOLE_SECRET, token: token })`
//
// authorize/route.ts (ConsoleDial) and widget-authorize/route.ts (the future
// ConsoleWidgetIn, capability A, 12.8) share the same body SHAPE and the same
// mintDialToken/verifyDialToken machinery underneath (see console-calls.ts's
// DIAL_TOKEN_PREFIXES), but each gets its OWN schema with a prefix-narrowed
// token regex — NOT one shared (ct|wt) pattern. A shared pattern would let a
// token minted for one flow parse successfully in the other route's body
// validation; verifyDialToken's own expectedPrefix check would still catch
// it, but a wrong-flow token should fail as early and as legibly as possible
// (400 from schema, not a 200-with-ok:false from a deeper gate), and two
// routes accepting each other's tokens at the parsing layer is exactly the
// kind of quiet coupling this project's schemas are meant to rule out by
// construction.
// session_id — added alongside linkConsoleCallSession (full telephony audit,
// 13.8): _StartedEvent.sessionId is present on every VoxEngine session
// (typings/voxengine.d.ts:1291-1299, same field ConsoleDial's own 'started'
// /event report already carries), and the scenario already holds it by the
// time it calls this route. Linking directly here — the route already knows
// the exact call_id from verifyDialToken — closes the gap where a lost
// 'started' /event report leaves the row unlinkable via any later tier. See
// console-calls.ts's linkConsoleCallSession header for the full reasoning.
// OPTIONAL, deliberately — expand-then-contract, NOT an oversight. These
// schemas are strictObject, and the scenario and this route deploy through two
// DIFFERENT systems (voxengine-ci upload vs the Next deploy) that cannot be
// made atomic. With session_id REQUIRED there is no safe ordering: routes
// first ⇒ the still-old scenario omits it ⇒ 400; scenarios first ⇒ the still-old
// strict schema rejects the extra key ⇒ 400. Either way live calls break in
// the gap, and call-me-now is live. Optional accepts BOTH shapes, so each side
// can ship independently. Tighten to required only after the scenarios are
// confirmed deployed AND a call has been observed carrying it — and treat that
// as its own change, not a cleanup.
export const consoleAuthorizeBodySchema = z.strictObject({
  secret: z.string().min(1).max(256),
  // ct + 64 lowercase hex chars (mintDialToken: randomBytes(32).toString('hex')).
  token: z
    .string()
    .trim()
    .regex(/^ct[0-9a-f]{64}$/, 'token has unexpected shape'),
  session_id: z.number().int().nonnegative().optional(),
});
export type ConsoleAuthorizeBody = z.infer<typeof consoleAuthorizeBodySchema>;

// widget-authorize/route.ts (the future ConsoleWidgetIn scenario) — same
// shape as consoleAuthorizeBodySchema above, narrowed to 'wt'-prefixed
// tokens only. See the comment above for why this is a sibling schema, not a
// shared regex.
export const widgetAuthorizeBodySchema = z.strictObject({
  secret: z.string().min(1).max(256),
  token: z
    .string()
    .trim()
    .regex(/^wt[0-9a-f]{64}$/, 'token has unexpected shape'),
});
export type WidgetAuthorizeBody = z.infer<typeof widgetAuthorizeBodySchema>;

// call-me-now-authorize/route.ts (the future ConsoleCallMeNow scenario,
// capability A, THIRD design, 12.8) — same shape again, narrowed to
// 'cn'-prefixed tokens only. Unlike ct/wt, this token is never dialed as a
// destination — it arrives via StartScenarios' script_custom_data and is
// POSTed here by the scenario after the visitor leg's disclosure finishes
// (see console-calls.ts's DIAL_TOKEN_PREFIXES header). Still a sibling
// schema, not a shared regex — same reasoning as widgetAuthorizeBodySchema
// above.
// session_id — same reasoning and same fix as consoleAuthorizeBodySchema's
// own comment above; MORE load-bearing here, since this call kind has no
// Tier-3 FIFO fallback to fall back on at all once 'started' is lost (see
// linkConsoleCallSession's header in console-calls.ts).
// OPTIONAL for the deploy-ordering reason spelled out on
// consoleAuthorizeBodySchema above — and it matters MOST here, because this is
// the one live customer-facing flow of the three.
export const callMeNowAuthorizeBodySchema = z.strictObject({
  secret: z.string().min(1).max(256),
  token: z
    .string()
    .trim()
    .regex(/^cn[0-9a-f]{64}$/, 'token has unexpected shape'),
  session_id: z.number().int().nonnegative().optional(),
});
export type CallMeNowAuthorizeBody = z.infer<typeof callMeNowAuthorizeBodySchema>;

// ---------------------------------------------------------------------------
// 3. POST /api/voximplant/console/event
// ---------------------------------------------------------------------------
//
// Both scenarios' reportEvent() sends `{ secret, session_id, call_kind, event,
// ...extra }` plus a call_kind-specific identity field: ConsoleDial sends
// `token` (agent_<uuid> or ct<hex>); ConsoleInbound sends `called` (the DID,
// never PII). Both fields are accepted as optional at the top level — which
// one is actually present is a function of call_kind, enforced in the route
// handler (a schema-level cross-field requirement here would either reject a
// legitimate inbound body for lacking `token` or vice versa).

const secretField = z.string().min(1).max(256);
const sessionIdField = z.number().int().nonnegative();
const callKindField = z.enum(['internal', 'outbound', 'inbound']);
const requestIdField = z.string().trim().min(1).max(128);

const eventEnvelopeBase = {
  secret: secretField,
  session_id: sessionIdField,
  call_kind: callKindField,
  // ConsoleDial only (internal + outbound branches) — agent_<uuid> or ct<hex>.
  token: z.string().trim().max(128).optional(),
  // ConsoleInbound only — the dialed DID (97237219347), not PII.
  called: z.string().trim().max(32).optional(),
  // ConsoleInbound only — the console_calls row route-inbound created for
  // THIS call, echoed by the scenario on every report (stage 7). Nullable:
  // the scenario sends `null` when route-inbound's accept response carried
  // none (should not happen on a healthy admission, but the scenario must
  // never omit the key silently — see findConsoleCallForEvent's Tier 0).
  call_id: z.string().uuid().nullable().optional(),
};

export const consoleEventBodySchema = z.discriminatedUnion('event', [
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('started'),
    // _StartedEvent.accessURL/accessSecureURL (typings/voxengine.d.ts:1291-1299) —
    // present on every session, unlike RSVPAgent's media_session_access_url
    // (StartScenarios-only). This is the ONLY way the backend ever learns a
    // command channel for a CallAlerting-triggered console session; persisted to
    // console_call_pii.session_url/secure_session_url for the transfer route.
    access_url: z.string().trim().url().max(2048).optional(),
    access_secure_url: z.string().trim().url().max(2048).optional(),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('ringing'),
    // ConsoleInbound only, sent once ringNext begins.
    ring_order_len: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('connected'),
    // ConsoleInbound only — which agent's vox_username won the serial ring.
    agent: z.string().trim().max(128).optional(),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('ended'),
    reason: z.string().trim().min(1).max(64),
    duration_s: z.number().int().min(0).max(24 * 3600),
    recording_url: z.string().trim().url().max(2048).nullable(),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('transfer_started'),
    request_id: requestIdField,
    target: z.string().trim().min(1).max(128),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('transferred'),
    request_id: requestIdField,
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('transfer_failed'),
    request_id: requestIdField,
    reason: z.string().trim().min(1).max(64),
  }),
  // ── Stage 2 (consult-before-transfer + conference) ──────────────────────
  // `target` is carried on BOTH consult_started and consult_completed (not
  // resolved once and reused) so a lost/reordered report never leaves the
  // server guessing who the consult was with — same reasoning as
  // ConsoleInbound's call_id echo (findConsoleCallForEvent's Tier 0).
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('consult_started'),
    request_id: requestIdField,
    target: z.string().trim().min(1).max(128),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('consult_cancelled'),
    request_id: requestIdField,
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('consult_failed'),
    request_id: requestIdField,
    reason: z.string().trim().min(1).max(64),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('consult_completed'),
    request_id: requestIdField,
    target: z.string().trim().min(1).max(128),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('conference_joined'),
    request_id: requestIdField,
    target: z.string().trim().min(1).max(128),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('conference_failed'),
    request_id: requestIdField,
    reason: z.string().trim().min(1).max(64),
  }),
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('conference_ended'),
    reason: z.string().trim().min(1).max(64),
  }),
]);
export type ConsoleEventBody = z.infer<typeof consoleEventBodySchema>;

// ---------------------------------------------------------------------------
// 4. POST /api/voximplant/console/route-inbound
// ---------------------------------------------------------------------------
//
// `postData: safeStringify({ secret: CONSOLE_SECRET, cli: cli, called: called })`
// cli may legitimately be '' (e.dot.callerid || '' in the scenario) — an
// unparsable/withheld CLI is a real caller-id state, not a malformed request;
// the gate treats an unnormalizable CLI as fail-closed at the DAL layer, not
// as a 400 here.
export const routeInboundBodySchema = z.strictObject({
  secret: secretField,
  cli: z.string().trim().max(32),
  called: z.string().trim().max(32),
});
export type RouteInboundBody = z.infer<typeof routeInboundBodySchema>;

// ---------------------------------------------------------------------------
// 4b. POST /api/voximplant/console/route-inbound-retry (wake-and-answer, 12.8)
// ---------------------------------------------------------------------------
//
// Called BY ConsoleInbound.voxengine.js's ringNext, ONCE, only after the
// original server-computed ring_order is exhausted — never per ring
// attempt (this project's Net.httpRequestAsync per-session budget
// discipline; see the scenario's own reportEvent comment). already_tried
// is exactly the ring_order the scenario was given, echoed back so the
// retry never re-offers an agent already ruled out for this call. Capped
// small: a real ring is a handful of agents, not dozens.
export const routeInboundRetryBodySchema = z.strictObject({
  secret: secretField,
  call_id: z.string().uuid(),
  already_tried: z.array(z.string().trim().min(1).max(64)).max(20),
});
export type RouteInboundRetryBody = z.infer<typeof routeInboundRetryBodySchema>;

// ---------------------------------------------------------------------------
// 5. POST /api/console-calls/[id]/transfer   (plan stage 7)
// ---------------------------------------------------------------------------
//
// The browser names the TARGET AGENT only — never a vox_username or session
// detail. The route resolves to_agent_id -> console_agents.vox_username itself
// (never trusts a browser-supplied Voximplant identity), matching dial-intent's
// "never trust submitted identifiers as authorization" discipline.
export const consoleTransferBodySchema = z.strictObject({
  to_agent_id: z.string().uuid(),
});
export type ConsoleTransferBody = z.infer<typeof consoleTransferBodySchema>;

// ---------------------------------------------------------------------------
// 6. POST /api/console-calls/[id]/consult              (plan stage 2)
//    POST /api/console-calls/[id]/conference            (plan stage 2)
// ---------------------------------------------------------------------------
//
// Same shape and same "browser names the target agent only" discipline as
// consoleTransferBodySchema above — kept as its own named schema (not a
// reused alias) so each route's contract is independently documented, matching
// this file's own per-route numbering convention.
export const consoleConsultBodySchema = z.strictObject({
  to_agent_id: z.string().uuid(),
});
export type ConsoleConsultBody = z.infer<typeof consoleConsultBodySchema>;

export const consoleConferenceBodySchema = z.strictObject({
  to_agent_id: z.string().uuid(),
});
export type ConsoleConferenceBody = z.infer<typeof consoleConferenceBodySchema>;

// ---------------------------------------------------------------------------
// 7. POST /api/console-calls/[id]/consult/cancel        (plan stage 2)
//    POST /api/console-calls/[id]/consult/complete      (plan stage 2)
// ---------------------------------------------------------------------------
//
// No parameters — both act on whichever consult is already in flight for the
// call (resolved server-side from the call id in the URL, never from the
// body). z.strictObject({}) rather than skipping validation entirely so a
// smuggled field still gets a clean 400, same as every other body schema
// here.
export const consoleEmptyActionBodySchema = z.strictObject({});
export type ConsoleEmptyActionBody = z.infer<typeof consoleEmptyActionBodySchema>;
