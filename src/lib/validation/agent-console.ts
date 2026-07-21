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
// Outbound enqueue — POST /api/calls/outbound
// ---------------------------------------------------------------------------

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

// The signed envelope the backend POSTs to the live session. `call_attempt_id` is
// the SERVER-resolved id (from the URL + ownership check), `request_id` correlates
// the async ack. This is an internal server↔session shape — never exposed to the
// console.
export interface CommandEnvelope {
  command: AgentCommand;
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
