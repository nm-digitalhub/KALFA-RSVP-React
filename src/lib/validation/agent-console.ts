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

// Signaling commands the console may issue on a LIVE call. Each maps to a VERIFIED
// ElevenLabs.AgentsClient method inside the RSVPAgent VoxEngine bridge (typings
// voxengine.d.ts:6114-6190). The backend relays the command to the live session
// via that call's `media_session_access_url` (server-side only) and returns a
// TRUTHFUL ack (see CommandAck — delivery vs effect).
//
// Deliberately EXCLUDED for v1:
//   - ai_suspend / ai_resume: return-to-AI is deferred (v1 closes the AI instead),
//     so we do not accept a command we cannot honor end-to-end.
//   - monitor/takeover attach: those have their own dedicated routes (above +
//     the Conference redesign), not this signaling channel.
export const AGENT_COMMANDS = [
  'agent_context_update', // whisper — NON-interrupting; agent.contextualUpdate({text})
  'ai_clear_buffer', // one-shot barge-in (clears buffered TTS); agent.clearMediaBuffer()
  'ai_close', // close the AI WebSocket leg; agent.close()
  'call_end', // end the whole call and emit exactly ONE terminal callback
] as const;
export type AgentCommand = (typeof AGENT_COMMANDS)[number];

// Whisper text: injected as NON-interrupting background context (contextual_update
// is incorporated into conversation history, NOT spoken to the guest). Trimmed +
// capped; must be non-empty so an empty whisper never reaches the session.
const contextUpdatePayloadSchema = z.strictObject({
  text: z.string().trim().min(1).max(1000),
});

// call_end carries an optional internal reason for the terminal callback — never
// voiced to the guest. Absent payload is valid.
const callEndPayloadSchema = z
  .strictObject({
    reason: z.string().trim().max(128).nullish(),
  })
  .nullish();

// ai_clear_buffer / ai_close take no parameters. An absent or empty payload is
// valid; strictObject rejects any smuggled field.
const emptyPayloadSchema = z.strictObject({}).nullish();

// The request body from the console. `call_attempt_id` is NOT here — it comes from
// the URL path and is resolved + authorized server-side, never trusted from the
// body (same identity rule as the agent-tool routes). Discriminated on `command`
// so each command validates only its own payload.
export const agentCommandBodySchema = z.discriminatedUnion('command', [
  z.strictObject({
    command: z.literal('agent_context_update'),
    payload: contextUpdatePayloadSchema,
  }),
  z.strictObject({ command: z.literal('ai_clear_buffer'), payload: emptyPayloadSchema }),
  z.strictObject({ command: z.literal('ai_close'), payload: emptyPayloadSchema }),
  z.strictObject({ command: z.literal('call_end'), payload: callEndPayloadSchema }),
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
