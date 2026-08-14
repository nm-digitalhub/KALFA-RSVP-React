import { z } from 'zod';

// Validation + typed contracts for the native agent-console app's JSON API
// (KALFA-ELEVENLABS). Every shape here is the server-side boundary for a request
// arriving with `Authorization: Bearer <supabase-jwt>` — validated with Zod before
// any authorization or side effect, mirroring the vox-payloads pattern.
//
// The console is READ-mostly. The only writes it drives are: the agent's own
// `agent_status` row, live-call AI-management signaling relayed to the VoxEngine
// bridge, a monitor/takeover attach request, and (later) a human-captured outcome.
// It NEVER writes RSVP outcomes on the AI's behalf.

// ---------------------------------------------------------------------------
// Agent presence — POST /api/agents/status
// ---------------------------------------------------------------------------

// The agent sets ONLY these three. `in_call` is system-managed (set while the
// agent is bridged to a live call), never client-submitted — accepting it here
// would let the app fake presence. Matches the AGENTS.md API contract exactly.
export const agentStatusSchema = z.strictObject({
  status: z.enum(['ready', 'not_ready', 'dnd']),
});
export type AgentStatusBody = z.infer<typeof agentStatusSchema>;

// ---------------------------------------------------------------------------
// Agent "on shift" intent — POST /api/agents/shift (wake-and-answer, 12.8)
// ---------------------------------------------------------------------------

// Deliberately its OWN concept from agentStatusSchema above, not a reuse —
// see console_agent_shift's migration comment (console-calls.ts,
// isShiftActiveAndFresh) for why: agent_status is live SDK/business
// presence; this is a standing, bounded-freshness intent that drives
// auto-connect on app launch and expands the inbound push-wake audience.
export const agentShiftSchema = z.strictObject({
  active: z.boolean(),
});
export type AgentShiftBody = z.infer<typeof agentShiftSchema>;

// ---------------------------------------------------------------------------
// Outbound enqueue — SUPERSEDED by POST /api/events/{eventId}/outreach-call
// ---------------------------------------------------------------------------
//
// The shipped route takes {guest_id} against an eventId in the path and derives
// the destination from our own data (event→campaign, guest→contact→phone). The
// schema below still accepts a client-supplied phone, which the shipped route
// deliberately does not: a console must not be able to name an arbitrary number
// to dial. Kept because the deployed app may still send this shape, not because
// it is the target contract.
//
// The rest of the app contract, as of 2026-07-21:
//   POST /api/agents/status                      LIVE
//   POST /api/calls/{id}/agent-command           LIVE
//   POST /api/calls/{id}/end                     LIVE
//   POST /api/events/{eventId}/outreach-call     LIVE (enqueue-only)
//   POST /api/calls/{id}/monitor                 BUILT, GATED. The route,
//     authorization, leg record, and command envelope all ship; it stays behind
//     app_settings.monitor_enabled (default OFF) and returns 503 until the
//     RSVPAgent scenario carries the supervisor conference handler AND that is
//     verified on a live call. The topology follows the Voximplant supervisor
//     guide 1:1 — VoxEngine.createConference (a mixer, because a Call receives
//     only ONE audio stream) plus VoxEngine.callUser — NOT Conference.add(),
//     which the app's AGENTS.md spec wrongly reaches for and which cannot take
//     an ElevenLabs AgentsClient. Spec: docs/voice-agent/monitor-scenario-topology.md.
//   POST /api/agents/sdk-auth                    LIVE (b77f274). Signs the SDK
//     one-time key so the console agent can log in as its per-agent Voximplant
//     identity — the identity the monitor conference dials via callUser.
//   POST /api/campaigns/{id}/status              LIVE — run state only.
//     Body {action: 'activate' | 'pause'}. This was previously blocked: the
//     lifecycle functions reached authorization through requireAdmin /
//     requireOwnedEvent, which read the COOKIE session, and the console
//     authenticates by Bearer. Resolved by separating the two concerns that had
//     been welded together — WHO is acting (now a CampaignActor value, one
//     variant per authentication path) and WHICH business guards apply (the J5
//     hold, the past-event refusal, the active-event requirement), which now run
//     for every actor. The route calls the same activateCampaign / pauseCampaign
//     the web Server Actions call; it does not reimplement them, and
//     campaign-lifecycle-parity.test.ts fails if a future route tries.
//
//     Authority is `campaigns.runstate` (migration 20260721183855), NOT
//     manage_voice — pausing a campaign also stops its WhatsApp sends, so it is
//     not a call-floor permission. Every transition writes a support_access_log
//     row: staff acting on a customer's asset must be attributable.
//
//     Scope is deliberately narrow (owner decision, 2026-07-21): staff may
//     pause, and may activate ONLY from `paused` — a revival. First activation
//     (approved/scheduled → active) stays with the event owner on the web,
//     because that is the commercial commitment against their card. `paused` is
//     reachable only from `active`, so a revived campaign is provably one the
//     owner already ran.

// The console asks the backend to ENQUEUE an outbound AI call. The request path
// only enqueues (the worker owns dispatch + StartScenarios); it returns the
// created call_attempt id. `event_id` must be a real owned event (not the old
// "default-event" placeholder). Phone is E.164 (+972…), validated server-side.
export const outboundCallSchema = z.strictObject({
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{8,15}$/, 'phone must be E.164, e.g. +9725XXXXXXXX'),
  event_id: z.string().uuid(),
});
export type OutboundCallBody = z.infer<typeof outboundCallSchema>;

// ---------------------------------------------------------------------------
// Monitor / takeover attach — POST /api/calls/{id}/monitor|takeover
// ---------------------------------------------------------------------------

// The participation mode of a human-agent leg. Mirrors human_agent_call_legs.mode
// and the AGENTS.md contract {"mode":"monitor|takeover"}.
export const attachModeSchema = z.strictObject({
  mode: z.enum(['monitor', 'takeover']),
});
export type AttachModeBody = z.infer<typeof attachModeSchema>;

// ---------------------------------------------------------------------------
// Live-call AI-management commands — POST /api/calls/{callAttemptId}/agent-command
// ---------------------------------------------------------------------------

// Signaling commands the console may issue on a LIVE call. These names AND the FLAT
// wire shape are the DEPLOYED app's ACTUAL contract — the schema must accept exactly
// what the app already sends, not an idealized envelope:
//   KALFA-ELEVENLABS: ConsoleViewModel.kt:268-281 calls sendAgentCommand(id, "<name>",
//   {text}); SupabaseImplementations.kt:560-563 serialises `{command, ...fields}`
//   FLAT (text at top level, NOT nested under "payload"); Telephony.kt:35 documents
//   the four commands. Each maps to a VERIFIED ElevenLabs.AgentsClient method
//   (typings voxengine.d.ts:6114-6190), applied by the VoxEngine dispatcher:
//     contextual_update → agent.contextualUpdate({text})  (NON-interrupting whisper)
//     user_message      → agent.userMessage({text})       (injects a user turn; interrupts)
//     clear_buffer      → agent.clearMediaBuffer()         (one-shot barge-in)
//     close_agent       → agent.close()                    (close the AI WS leg)
//
// NOTE: ending the whole call is a SEPARATE route (POST /api/calls/{id}/end), not an
// agent-command — the deployed app sends no end command here.
export const AGENT_COMMANDS = [
  'contextual_update',
  'user_message',
  'clear_buffer',
  'close_agent',
] as const;
export type AgentCommand = (typeof AGENT_COMMANDS)[number];

// Whisper / user-message text — trimmed, capped, non-empty so nothing empty reaches
// the session. FLAT (top-level `text`) to match the app's wire format exactly.
const textField = z.string().trim().min(1).max(1000);

// The request body from the console. `call_attempt_id` is NOT here — it comes from
// the URL path and is resolved + authorized server-side, never trusted from the body
// (same identity rule as the agent-tool routes). Discriminated on `command`;
// strictObject rejects any smuggled field. FLAT shape mirrors the deployed app.
export const agentCommandBodySchema = z.discriminatedUnion('command', [
  z.strictObject({ command: z.literal('contextual_update'), text: textField }),
  z.strictObject({ command: z.literal('user_message'), text: textField }),
  z.strictObject({ command: z.literal('clear_buffer') }),
  z.strictObject({ command: z.literal('close_agent') }),
]);
export type AgentCommandBody = z.infer<typeof agentCommandBodySchema>;

// ---------------------------------------------------------------------------
// Backend → live VoxEngine session (posted to media_session_access_url) and back
// ---------------------------------------------------------------------------

// What the server↔session channel may carry: the four the console can request,
// plus 'call_end'.
//
// call_end is deliberately NOT in AGENT_COMMANDS. The four above act on the AI
// leg; this one hangs up on the guest, and a control that ends a live
// conversation must not sit one typo away from "clear the buffer". It has its own
// route (/api/calls/{id}/end) and its own authority check, and only that route
// may put it on the wire.
// `attach` / `detach` add and remove a human agent's audio leg (monitor or
// takeover). Like call_end, they are NOT in AGENT_COMMANDS: they change the call
// TOPOLOGY (a third leg via VoxEngine.callUser into a mixer conference), not the
// AI conversation, and reach the wire only through /api/calls/{id}/monitor.
//
// The mixer, not manual media routing, is forced by the platform: a Call may
// RECEIVE only one audio stream (Call.sendMediaTo docs, verified live 2026-07-22),
// so a monitor who must hear BOTH the guest and the AI cannot be wired with
// sendMediaTo — the second source replaces the first. VoxEngine.createConference
// mixes, and (unlike Conference.add) needs no video-conference rule flag.
export const SESSION_COMMANDS = [...AGENT_COMMANDS, 'call_end', 'attach', 'detach'] as const;
export type SessionCommand = (typeof SESSION_COMMANDS)[number];

// The signed envelope the backend POSTs to the live session. `call_attempt_id` is
// the SERVER-resolved id (from the URL + ownership check), `request_id` correlates
// the async ack. This is an internal server↔session shape — never exposed to the
// console.
export interface CommandEnvelope {
  command: SessionCommand;
  request_id: string;
  call_attempt_id: string;
  payload: Record<string, unknown>;
}

// The live session's acknowledgement, delivered OUT-OF-BAND (a POST to the call's
// callback endpoint keyed by request_id) — not as an HTTP response.
//
// That is forced, not a design preference: the scenario receives the command as
// AppEvents.HttpRequest, and _HttpRequestEvent (typings voxengine.d.ts) exposes
// only { method, path, content, headers }. There is no response object and no
// reply API anywhere in the namespace, so the session physically cannot answer
// the request it was given. Anything the backend learns beyond "the POST returned
// 200" has to arrive on a separate channel.
//
// `applied` is per-command and deliberately narrow:
//   - contextual_update / user_message: sent into the ElevenLabs session, which
//     returns nothing. applied === "handed to the session", NEVER "the model
//     acted on it". No later signal upgrades this — it is the ceiling.
//   - clear_buffer / close_agent: a real VoxEngine state transition (buffer
//     cleared / agent WS closed), so the ack can assert it.
export const commandAckSchema = z.strictObject({
  ok: z.boolean(),
  request_id: z.string().min(1).max(64),
  command: z.enum(AGENT_COMMANDS).nullish(),
  state: z.string().max(64).nullish(),
  applied: z.boolean(),
  call_attempt_id: z.string().max(64).nullish(),
});
export type CommandAck = z.infer<typeof commandAckSchema>;

// Whether the command took effect, as far as the backend can honestly tell.
//
// Three states, not a boolean, because "we do not know yet" is the ordinary
// outcome — not an error. The ack is out-of-band, so at the moment the route
// answers the console it usually has not arrived. A boolean would have to render
// that as `false`, which reads as "the command failed" and is a lie; rendering it
// as `true` is the worse lie.
//
//   pending    the POST reached the session (delivered) and nothing contradicts
//              it, but no ack has been correlated. The resting state for
//              contextual_update and user_message, permanently — there is no
//              signal that would ever confirm them.
//   confirmed  an ack arrived for this request_id with applied true.
//   rejected   the command definitively did not apply: the attempt was already
//              terminal, the session refused it, or an ack came back applied
//              false. Certain, unlike pending.
export type AppliedState = 'pending' | 'confirmed' | 'rejected';

// What the console receives. HTTP 200 alone NEVER implies effect: `delivered` says
// the command reached and was accepted by the live session; `applied` carries the
// honest state above. The UI must not present a whisper as "the AI acted" on
// `delivered`, and must not present `pending` as failure.
export interface AgentCommandResult {
  delivered: boolean;
  applied: AppliedState;
  command: AgentCommand;
  request_id: string;
  state?: string | null;
}

// ---------------------------------------------------------------------------
// Live device telemetry — POST /api/agents/telemetry
// ---------------------------------------------------------------------------
//
// A diagnostic channel, not a product surface: the native console streams the
// steps of its own call path here so the owner can `tail -f` the resulting log
// over SSH and see which step is the LAST one that happens when a call is routed
// to a phone sitting idle in a pocket. Feature-flagged off at both ends; see
// `src/lib/ops/device-telemetry.ts` for the server half.
//
// The hard rule this file enforces is AGENTS.md's, unqualified: NO PII, ever.
// The app scrubs before sending (KALFA-ELEVENLABS `telemetry/TelemetryEvent.kt`,
// `scrubTelemetryValue`) and the schema below scrubs again and REJECTS rather
// than trusting it. Two independent checks because either alone is a single
// point of failure for a rule whose failure mode is a guest's phone number
// sitting in a log file that someone who should not see customer data is
// reading — which is exactly how this log is expected to be read.

/** Hard cap on events per request. The app's batch size must not exceed this. */
export const DEVICE_TELEMETRY_MAX_EVENTS = 50;

/** Hard cap on `k=v` pairs per event, so one line stays readable in a terminal. */
export const DEVICE_TELEMETRY_MAX_FIELDS = 8;

const TELEMETRY_EVENT_NAME_RE = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;
const TELEMETRY_FIELD_KEY_RE = /^[a-z][a-z0-9_]*$/;
const TELEMETRY_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TELEMETRY_SESSION_ID_RE = /^[pc][0-9a-f]{1,12}$/;

// `_` is in the class on purpose. The app flattens whitespace to `_` before
// sending, so a number that reached its scrub as "(050) 123 4567" would arrive
// here as "(050)_123_4567". The app redacts before flattening so that should
// never happen — but "should never happen" is what this second check exists for.
const PHONE_SHAPED_RE = /^[+()\-. _\d]{7,}$/;
const PHONE_PUNCTUATION_RE = /[+()\-. _]/;
const OPAQUE_TOKEN_RE = /^[A-Za-z0-9_:-]{40,}$/;

/**
 * Whether a telemetry field value looks like something that must never be
 * logged. Deliberately at least as broad as `scrubTelemetryValue` in the Android
 * app, so anything the app would have redacted is something this rejects — a
 * value arriving unredacted means the client is not the client we think it is.
 *
 * Strictly BROADER in one place, on purpose: the phone-shape class here includes
 * `_`, because the app flattens whitespace to `_` before sending and a scrub
 * regression could deliver "(050)_123_4567". The app currently redacts before
 * flattening, so that shape should never arrive — this is the check for when
 * "should never" turns out to be wrong, which on this code path it already has
 * once.
 *
 * Exported for its test. Conservative by design: a false positive costs one
 * rejected diagnostic line, a false negative costs a guest's phone number.
 */
export function looksLikePersonalData(value: string): boolean {
  if (value.includes('@')) return true;
  // Every Supabase access token is a JWT, and every JWT starts with the base64
  // of `{"` — so this catches an accidentally-forwarded auth token exactly.
  if (value.startsWith('eyJ')) return true;
  // Phone-shaped: made of digits and phone punctuation ONLY. Deliberately not
  // "any long digit run anywhere" — a Voximplant call id is a useful,
  // non-identifying field that can legitimately carry one, and redacting it
  // would destroy the field that ties two lines to the same leg.
  //
  // Two thresholds, because one would be wrong in both directions. Punctuation
  // is itself strong evidence of a phone number (no telemetry field contains a
  // `+`, a bracket or a dash), so 7 digits is enough alongside it. A bare run of
  // digits needs 9, so that a millisecond duration — `ms=1234567` is a legitimate
  // 20-minute value — is not mistaken for a number. Nothing this app can hold is
  // a bare phone shorter than 9 digits: it stores E.164 (+972…) and Israeli
  // mobile (05…), which are 13 and 10.
  if (PHONE_SHAPED_RE.test(value)) {
    const digits = (value.match(/\d/g) ?? []).length;
    if (digits >= 9) return true;
    if (digits >= 7 && PHONE_PUNCTUATION_RE.test(value)) return true;
  }
  // FCM registration tokens and Voximplant access/refresh tokens.
  if (OPAQUE_TOKEN_RE.test(value)) return true;
  return false;
}

const telemetryFieldValueSchema = z
  .string()
  .max(64)
  .refine((v) => !looksLikePersonalData(v), { message: 'value rejected' });

export const deviceTelemetryEventSchema = z.strictObject({
  // The DEVICE clock. Recorded, never trusted for ordering — a dozing phone can
  // resync NTP mid-wake and move it backwards. `seq` is the ordering authority
  // and the route stamps its own receive time alongside so skew stays visible.
  at: z.string().regex(TELEMETRY_TIMESTAMP_RE),
  // The trace this line belongs to: `p…` process-scoped, `c…` one call attempt.
  sid: z.string().regex(TELEMETRY_SESSION_ID_RE),
  // Monotonic per device process. A gap proves upload loss; a restart at 1
  // proves the process died. That distinction is the point of the whole channel.
  seq: z.number().int().min(0).max(1_000_000_000),
  name: z.string().max(48).regex(TELEMETRY_EVENT_NAME_RE),
  fields: z
    .record(z.string().max(24).regex(TELEMETRY_FIELD_KEY_RE), telemetryFieldValueSchema)
    .refine((f) => Object.keys(f).length <= DEVICE_TELEMETRY_MAX_FIELDS, {
      message: 'too many fields',
    })
    .optional(),
});
export type DeviceTelemetryEvent = z.infer<typeof deviceTelemetryEventSchema>;

export const deviceTelemetryBatchSchema = z.strictObject({
  events: z.array(deviceTelemetryEventSchema).min(1).max(DEVICE_TELEMETRY_MAX_EVENTS),
});
export type DeviceTelemetryBatch = z.infer<typeof deviceTelemetryBatchSchema>;
