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

// The live session's acknowledgement. Because AppEvents.HttpRequest cannot return
// an HTTP response body, the bridge delivers this ack OUT-OF-BAND (a POST to the
// call's callback endpoint keyed by request_id). `applied` is DELIBERATELY honest
// and per-command:
//   - agent_context_update: contextual_update is async with NO ElevenLabs server
//     response, so applied === "delivered to the ElevenLabs session", NOT "the
//     model acted on it".
//   - ai_clear_buffer / ai_close / call_end: applied is a real VoxEngine state
//     transition (buffer cleared / WS closed / call terminating).
export const commandAckSchema = z.strictObject({
  ok: z.boolean(),
  request_id: z.string().min(1).max(64),
  command: z.enum(AGENT_COMMANDS).nullish(),
  state: z.string().max(64).nullish(),
  applied: z.boolean(),
  call_attempt_id: z.string().max(64).nullish(),
});
export type CommandAck = z.infer<typeof commandAckSchema>;

// What the console receives. HTTP 200 alone NEVER implies effect: `delivered` = the
// command reached and was accepted by the live session; `applied` carries the
// honest per-command effect flag from the ack above. The UI must not present a
// whisper as "the AI acted" on `applied` alone.
export interface AgentCommandResult {
  delivered: boolean;
  applied: boolean;
  command: AgentCommand;
  request_id: string;
  state?: string | null;
}
