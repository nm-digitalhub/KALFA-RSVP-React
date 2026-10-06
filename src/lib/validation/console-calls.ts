import { z } from 'zod';

// Validation for the browser call-center's server surfaces:
//   1. POST /api/console-calls/dial-intent          — browser (Bearer), dialIntentBodySchema
//   2. POST /api/voximplant/console/authorize        — ConsoleDial scenario, consoleAuthorizeBodySchema
//   3. POST /api/voximplant/console/event            — the console scenarios, consoleEventBodySchema
//   4. POST /api/voximplant/console/route-inbound    — ConsoleInbound scenario, routeInboundBodySchema
//
// Shapes 2-4 are verified against voxfiles/applications/<app>/scenarios/src/ConsoleDial.voxengine.js,
// ConsoleInbound.voxengine.js and ConsoleCallMeNow.voxengine.js VERBATIM (the exact
// Net.httpRequestAsync postData bodies) — a parse failure here must mean the scenario
// sent something unexpected, not that the schema drifted from what was actually shipped.

// ---------------------------------------------------------------------------
// 1. POST /api/console-calls/dial-intent
// ---------------------------------------------------------------------------

// FOUR dial shapes, each with its own gate row in DIAL_GATE_POLICY.
//
// The AI CAMPAIGN must never be able to ring a stranger — an automated system —
// but a human at the console dialling their own business's phone is the opposite
// situation, and enforcing both with one union made the console refuse the owner.
//
// So the enforcement lives where the difference does: each shape declares which
// gates apply to it. DNC holds for every one of them, because "never call me" is a
// standing instruction regardless of who dials. The automated shapes keep the
// timing and event gates; the human ones do not.
//
// `confirm_outside_hours` waives ONE gate — the daily business-hours window — and
// only because a human said so for this dial. It cannot reach DNC, opt-out,
// Shabbat/Yom-Tov, a caller's own stated hours, the attempt cap or the event gates:
// those return before the window is ever evaluated. It exists because an agent could
// not return a missed call at 20:15 and the refusal was indistinguishable, on
// screen, from "this number is blocked".
//
// Optional and defaulting to false, so an old client that never sends it keeps
// today's exact behaviour.
export const dialIntentBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('callback'),
    id: z.uuid(),
    confirm_outside_hours: z.boolean().optional(),
  }),
  z.strictObject({
    kind: z.literal('guest_service'),
    eventId: z.uuid(),
    contactId: z.uuid(),
    confirm_outside_hours: z.boolean().optional(),
  }),
  // A number a human typed: an owner dialling from their own console is not an
  // automated system ringing strangers. Loosely validated here (length and charset only)
  // because the SERVER normalizes with libphonenumber; a strict E.164 pattern here
  // would refuse 0536212562, which is how the number is actually written.
  z.strictObject({
    kind: z.literal('manual'),
    phone: z.string().min(7).max(20).regex(/^[+0-9][0-9\-\s()]*$/),
    confirm_outside_hours: z.boolean().optional(),
  }),
  // A VOXIMPLANT session id — digits, not a uuid of ours. The server reads the
  // number back from Voximplant's own record of that session, so this widens what
  // an agent may RETURN without widening what anyone may DIAL, and it works for
  // every call in the log rather than only the ones our tables happen to know.
  //
  // It is its own shape rather than a flag on 'callback' because the gates that
  // apply to it genuinely differ (see DIAL_GATE_POLICY in data/console-calls.ts).
  // One shape serving several scenarios is what let rules written for the AI
  // ringing a guest silently govern an agent ringing back a caller.
  z.strictObject({
    kind: z.literal('returned_call'),
    // Length-bounded rather than free digits: this value is sent upstream, and an
    // unbounded numeric string is a URL-length problem waiting to happen.
    sessionId: z.string().regex(/^[1-9]\d{0,17}$/),
    confirm_outside_hours: z.boolean().optional(),
  }),
]);
export type DialIntentBody = z.infer<typeof dialIntentBodySchema>;

// ---------------------------------------------------------------------------
// 2. POST /api/voximplant/console/authorize  (ConsoleDial.voxengine.js)
// ---------------------------------------------------------------------------

// `postData: safeStringify({ secret: CONSOLE_SECRET, token: token, session_id: state.sessionId })`
//
// authorize/route.ts (ConsoleDial) and widget-authorize/route.ts (the superseded
// widget flow — no scenario calls it) share the same body SHAPE and the same
// mintDialToken/verifyDialToken machinery underneath (see data/console-calls.ts's
// DIAL_TOKEN_PREFIXES), but each gets its OWN schema with a prefix-narrowed
// token regex — NOT one shared (ct|wt) pattern. A shared pattern would let a
// token minted for one flow parse successfully in the other route's body
// validation; verifyDialToken's own expectedPrefix check would still catch
// it, but a wrong-flow token should fail as early and as legibly as possible
// (400 from schema, not a 200-with-ok:false from a deeper gate), and two
// routes accepting each other's tokens at the parsing layer is exactly the
// kind of quiet coupling this project's schemas are meant to rule out by
// construction.
// session_id — read by linkConsoleCallSession: _StartedEvent.sessionId is present
// on every VoxEngine session (typings/voxengine.d.ts, _StartedEvent; the same field
// ConsoleDial's own 'started' /event report carries), and the scenario already
// holds it by the time it calls this route. Linking directly here — the route
// already knows the exact call_id from verifyDialToken — closes the gap where a
// lost 'started' /event report leaves the row unlinkable via any later tier. See
// data/console-calls.ts's linkConsoleCallSession header for the full reasoning.
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

// widget-authorize/route.ts (the superseded widget flow; no scenario calls it) — same
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

// call-me-now-authorize/route.ts (called by the ConsoleCallMeNow scenario,
// capability A, THIRD design) — same shape again, narrowed to
// 'cn'-prefixed tokens only. Unlike ct/wt, this token is never dialed as a
// destination — it arrives via StartScenarios' script_custom_data and is
// POSTed here by the scenario after the visitor leg's disclosure finishes
// (see data/console-calls.ts's DIAL_TOKEN_PREFIXES header). Still a sibling
// schema, not a shared regex — same reasoning as widgetAuthorizeBodySchema
// above.
// session_id — same reasoning and same fix as consoleAuthorizeBodySchema's
// own comment above; MORE load-bearing here, since this call kind has no
// Tier-3 FIFO fallback to fall back on at all once 'started' is lost (see
// linkConsoleCallSession's header in data/console-calls.ts).
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
// Each console scenario's reportEvent() sends `{ secret, session_id, call_kind, event,
// ...extra }` plus a call_kind-specific identity field: ConsoleDial sends
// `token` (agent_<uuid> or ct<hex>), ConsoleCallMeNow its cn<hex> `token`;
// ConsoleInbound sends `called` (the DID,
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
  // ConsoleDial (internal + outbound branches) — agent_<uuid> or ct<hex>; ConsoleCallMeNow — cn<hex>.
  token: z.string().trim().max(128).optional(),
  // ConsoleInbound only — the dialed DID (97237219347), not PII.
  called: z.string().trim().max(32).optional(),
  // ConsoleInbound only — the console_calls row route-inbound created for
  // THIS call, echoed by the scenario on every report. Nullable:
  // the scenario sends `null` when route-inbound's accept response carried
  // none (should not happen on a healthy admission, but the scenario must
  // never omit the key silently — see findConsoleCallForEvent's Tier 0).
  call_id: z.uuid().nullable().optional(),
};

export const consoleEventBodySchema = z.discriminatedUnion('event', [
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('started'),
    // _StartedEvent.accessURL/accessSecureURL (typings/voxengine.d.ts, _StartedEvent) —
    // present on every session, unlike RSVPAgent's media_session_access_url
    // (StartScenarios-only). This is the ONLY way the backend ever learns a
    // command channel for a CallAlerting-triggered console session; persisted to
    // console_call_pii.session_url/secure_session_url for the in-call command
    // routes (transfer, consult, conference).
    access_url: z.string().trim().pipe(z.url().max(2048)).optional(),
    access_secure_url: z.string().trim().pipe(z.url().max(2048)).optional(),
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
    duration_s: z.int().min(0).max(24 * 3600),
    recording_url: z.string().trim().pipe(z.url().max(2048)).nullable(),
    // The PLATFORM's own status code for the leg that ended — CallEvents
    // .Disconnected/.Failed's `internalCode` ("Status code of the call (i.e., 486)",
    // live reference references.voxengine.callevents.disconnected, 17.8).
    //
    // OPTIONAL, and for the deploy-ordering reason spelled out on
    // consoleAuthorizeBodySchema: these schemas are strictObject and the scenario
    // ships through voxengine-ci while this route ships through the Next deploy,
    // which cannot be made atomic. Required here would break live calls in whichever
    // gap opened first.
    //
    // Bounded to the SIP response range rather than left open: a value outside it is
    // not a status code, and accepting one would put noise in the column that exists
    // to make failures legible.
    end_code: z.number().int().min(100).max(699).optional(),
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
  // ── Consult-before-transfer + conference ────────────────────────────────
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
  // consult_connected — the moment the consult target actually answers and
  // the PRIVATE operator<->target bridge goes live (ConsoleDial and ConsoleInbound
  // send `reportEvent('consult_connected', {request_id: requestId})` — no
  // `target`, unlike consult_started/completed, since the scenario has nothing
  // new to attribute here). It must stay in this union: a discriminatedUnion with
  // no matching literal fails validation, not routing — a 400 before the secret
  // check ever runs — so a live, well-formed report would be silently dropped.
  // event/route.ts stamps it on the row as consultConnected.
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('consult_connected'),
    request_id: requestIdField,
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
  // conference_started — dialing the 3rd participant has begun (ConsoleDial and
  // ConsoleInbound send `reportEvent('conference_started', {request_id, target})`).
  // Same reason as consult_connected above: without a matching literal every
  // report fails validation with a 400. Nothing in console_calls or the UI keys
  // off this event (the "בוועידה" badge only ever reads conference_agent_ids,
  // written on conference_joined) — it is recognized here purely so a live,
  // well-formed report does not fail validation; event/route.ts's handler is
  // a no-op.
  z.strictObject({
    ...eventEnvelopeBase,
    event: z.literal('conference_started'),
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
// `postData: safeStringify({ secret: CONSOLE_SECRET, cli: cli, called: called, channel: channel })`
// cli may legitimately be '' (e.callerid || '' in the scenario) — an
// unparsable/withheld CLI is a real caller-id state, not a malformed request;
// the gate treats an unnormalizable CLI as fail-closed at the DAL layer, not
// as a 400 here.
export const routeInboundBodySchema = z.strictObject({
  secret: secretField,
  cli: z.string().trim().max(32),
  called: z.string().trim().max(32),
  /**
   * Which channel the call arrived on, as the scenario classified it.
   *
   * ⚠️ OPTIONAL, AND THE ORDER OF DEPLOYMENT DEPENDS ON IT. This is a
   * `strictObject`: an unknown key is a 400, and a 400 is a `rejectFailClosed`
   * in the scenario — every inbound call dropped. So the SERVER must accept the
   * field BEFORE the scenario starts sending it, and optional is what makes the
   * window safe in both directions: a new server with the old scenario is fine,
   * and a rollback of either side is fine too.
   *
   * ⚠️ AND IT IS A LABEL, NOT AN AUTHORIZATION. Every consent, rate and routing
   * decision below is made from `cli` and `called` exactly as before — a caller
   * cannot widen anything by claiming a channel, because the scenario derives
   * this from SIP markers the caller does not control.
   */
  channel: z.enum(['pstn', 'whatsapp']).optional(),
});
export type RouteInboundBody = z.infer<typeof routeInboundBodySchema>;

// ---------------------------------------------------------------------------
// 4b. POST /api/voximplant/console/route-inbound-retry (wake-and-answer)
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
  call_id: z.uuid(),
  already_tried: z.array(z.string().trim().min(1).max(64)).max(20),
});
export type RouteInboundRetryBody = z.infer<typeof routeInboundRetryBodySchema>;

// ---------------------------------------------------------------------------
// 5. POST /api/console-calls/[id]/transfer
// ---------------------------------------------------------------------------
//
// The browser names the TARGET AGENT only — never a vox_username or session
// detail. The route resolves to_agent_id -> console_agents.vox_username itself
// (never trusts a browser-supplied Voximplant identity), matching dial-intent's
// "never trust submitted identifiers as authorization" discipline.
export const consoleTransferBodySchema = z.strictObject({
  to_agent_id: z.uuid(),
});
export type ConsoleTransferBody = z.infer<typeof consoleTransferBodySchema>;

// ---------------------------------------------------------------------------
// 6. POST /api/console-calls/[id]/consult
//    POST /api/console-calls/[id]/conference
// ---------------------------------------------------------------------------
//
// A UNION, unlike transfer above: consult and conference may reach an agent OR an
// outside phone number. The person an agent needs mid-call is often not on the
// console at all: a manager, a supplier, the event owner.
//
// `to_phone` is, with dial-intent's 'manual' shape, one of only two places in this
// file where the client names a raw phone number, and it is a deliberate, narrow
// exception to dial-intent's "the browser never names a guest's number" rule
// rather than an oversight of it. That rule protects
// GUEST data — dial-intent resolves a guest record server-side so a browser can
// never enumerate guest phones. Here the number is the caller's own input about a
// third party we hold no record of, so there is nothing to resolve it FROM; the
// rule cannot apply, and pretending otherwise would just mean the feature does not
// exist.
//
// What replaces it is resolveExternalDialTarget (data/console-calls.ts), which every
// route using this schema must run: E.164 validation, a region gate, a DNC check
// and a per-agent rate limit. Zod's job here stops at "this is a plausible dialable
// string of sane length" — the authority is that function, never this shape.
//
// Blind TRANSFER deliberately keeps agents only. Transfer hands the customer over
// and drops this agent from the call entirely; doing that to an unverified outside
// number would leave a KALFA customer alone on a line with someone the platform
// has no record of, and nobody left who could take the call back.
const externalPhoneField = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^\+?[0-9\-\s()]+$/, 'phone_shape');

export const consoleConsultBodySchema = z.union([
  z.strictObject({ to_agent_id: z.uuid() }),
  z.strictObject({ to_phone: externalPhoneField }),
]);
export type ConsoleConsultBody = z.infer<typeof consoleConsultBodySchema>;

export const consoleConferenceBodySchema = z.union([
  z.strictObject({ to_agent_id: z.uuid() }),
  z.strictObject({ to_phone: externalPhoneField }),
]);
export type ConsoleConferenceBody = z.infer<typeof consoleConferenceBodySchema>;

// ---------------------------------------------------------------------------
// 7. POST /api/console-calls/[id]/consult/cancel
//    POST /api/console-calls/[id]/consult/complete
//    POST /api/console-calls/[id]/conference/remove
// ---------------------------------------------------------------------------
//
// No parameters — each acts on whichever consult or conference is already in
// flight for the call (resolved server-side from the call id in the URL, never
// from the body). z.strictObject({}) rather than skipping validation entirely so a
// smuggled field still gets a clean 400, same as every other body schema
// here.
export const consoleEmptyActionBodySchema = z.strictObject({});
export type ConsoleEmptyActionBody = z.infer<typeof consoleEmptyActionBodySchema>;
