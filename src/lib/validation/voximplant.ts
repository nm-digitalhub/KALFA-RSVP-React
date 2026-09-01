import { z } from 'zod';

// Zod schema for the Voximplant RSVP scenario's callback (cb) POST body. Shapes
// verified against voxfiles/scenarios/src/RSVP.voxengine.js (the emitted payloads
// at lines 197-207, 384-389, 420-428, 436-442) AND the ElevenLabs bridge
// RSVPAgent.voxengine.js terminal callbacks (rsvp_method 'agent', no digit).
// Validated at the server boundary before any persistence; a parse failure →
// 400, nothing stored.
//
// NOTE: `invitation_id` is accepted but MUST NOT be trusted for identity — the cb
// route resolves the call only from the URL-path access_token. It is kept for a
// sanity/anomaly log at most.

const transcriptTurn = z.object({
  speaker: z.enum(['agent', 'guest']),
  text: z.string().max(4000),
  at: z.string().max(64),
});

// strictObject (Zod v4): reject any field NOT in the verified contract — the
// callback must match the scenario's payload exactly (requirement C).
export const voxCallbackSchema = z
  .strictObject({
    call_status: z.enum([
      'recording_started',
      'completed',
      'failed',
      'no_answer',
      'no_response',
      'cancelled',
      // Stage 6 (AI→human handoff): a KALFA console agent took over the call
      // via attachSupervisor(mode:'takeover') and RSVPAgent.voxengine.js's
      // terminalStatus() latched handoffWasActive. Terminal, billed like
      // 'completed' (see call-result-processing.ts) — MUST be accepted here
      // BEFORE the scenario can post it, or the terminal callback 400s and
      // the attempt row sticks pre-terminal (the 2026-07-21 stale-row class).
      'handed_off',
    ]),
    call_duration: z
      .number()
      .int()
      .min(0)
      .max(24 * 3600)
      .nullish(),
    rsvp_digit: z.enum(['1', '2']).nullish(),
    // 'agent' = the ElevenLabs conversational bridge (RSVPAgent). Its RSVP is
    // written in-call by the save_rsvp client tool with REAL counts, so its
    // terminal 'completed' carries NO digit — the drain then bills the reach
    // and deliberately skips the digit-RSVP path (which would overwrite the
    // real counts with 1/0 defaults).
    rsvp_method: z.enum(['dtmf', 'voice_asr', 'agent']).nullish(),
    invitation_id: z.string().max(128).nullish(), // NEVER trusted for lookup
    recording_url: z.string().url().max(2048).nullish(),
    // The scenario sends an array of turns, or (legacy) a plain string.
    transcript: z.union([z.array(transcriptTurn).max(200), z.string().max(20000)]).nullish(),
    error_reason: z.string().max(256).nullish(),
    // ADDITIVE (item-2 second link vector): the ElevenLabs conversation_id, sent by
    // the bridge scenario (VoiceAgentTest) on its recording_started callback. Branch
    // B's RSVP.voxengine.js never sends it (nullish → no effect on the DTMF path).
    el_conversation_id: z.string().max(128).nullish(),
  })
  .refine(
    (v) =>
      v.call_status !== 'completed' ||
      v.rsvp_digit === '1' ||
      v.rsvp_digit === '2' ||
      v.rsvp_method === 'agent',
    { message: 'completed call is missing a valid rsvp_digit', path: ['rsvp_digit'] },
  );

export type VoxCallback = z.infer<typeof voxCallbackSchema>;

// schedule_callback (combination feature): the ElevenLabs bridge agent's callback
// request, POSTed to the SAME cb endpoint but handled OUT-OF-BAND (never persisted
// to webhook_inbox / the drain, so it can never become a call_attempts.status —
// processCallResult would otherwise write status:'callback_requested'). It is a
// SEPARATE strict schema so the shared voxCallbackSchema (reused verbatim by the
// drain's processCallResult) stays byte-for-byte unchanged. Branch B never sends it.
export const voxCallbackRequestSchema = z.strictObject({
  call_status: z.literal('callback_requested'),
  callback_when_text: z.string().trim().min(1).max(200),
  callback_iso: z.string().max(40).nullish(),
});
export type VoxCallbackRequest = z.infer<typeof voxCallbackRequestSchema>;

// Human-agent supervisor leg status (monitor / takeover), posted OUT-OF-BAND by
// the RSVPAgent scenario as the leg dials / connects / drops (kind:'human_leg').
// Like schedule_callback it is a SEPARATE strict schema, tried before the shared
// voxCallbackSchema so a normal cb body is untouched. request_id correlates to the
// human_agent_call_legs row KALFA created; identity stays the token-resolved
// attempt, never the body. failure_code is coerced (the scenario sends a numeric
// CallEvents.Failed code; the column is text).
export const voxLegStatusSchema = z.strictObject({
  kind: z.literal('human_leg'),
  request_id: z.string().min(1).max(64),
  leg_status: z.enum(['dialing', 'ringing', 'connected', 'disconnected', 'failed']),
  failure_code: z.coerce.string().max(64).optional(),
});
export type VoxLegStatus = z.infer<typeof voxLegStatusSchema>;

// Body of the `save_rsvp` client-tool POST (Tier 2). The ElevenLabs conversational
// agent extracts REAL adult + child counts from natural speech (richer than the
// binary rsvp_digit path) and calls this tool AFTER an explicit read-back confirm.
// The Voximplant scenario forwards it to POST /api/voximplant/agent-tool/rsvp/{token}
// (auth = the same opaque per-call access_token as cb; identity = the resolved row,
// never the body). strictObject rejects any field outside the contract.
//
// Conversation-design §4.2: `status` is the canonical field (attending/declined/
// maybe — the full RSVP_STATUSES set submit_rsvp supports). The legacy boolean
// `attending` is still accepted (deployed scenario compatibility); exactly one of
// the two must be present. Effective status: status ?? (attending → attending/declined).
export const voxSaveRsvpSchema = z
  .strictObject({
    status: z.enum(['attending', 'declined', 'maybe']).nullish(),
    attending: z.boolean().nullish(), // legacy boolean form
    adults: z.number().int().min(0).max(50),
    children: z.number().int().min(0).max(50),
    tool_call_id: z.string().max(128).nullish(), // echoed back to the agent; NEVER trusted for identity
  })
  .refine((v) => v.status != null || v.attending != null, {
    message: 'either status or attending is required',
    path: ['status'],
  })
  .refine(
    (v) => {
      const status = v.status ?? (v.attending ? 'attending' : 'declined');
      return status !== 'attending' || v.adults + v.children >= 1;
    },
    { message: 'attending requires at least one person', path: ['adults'] },
  );

export type VoxSaveRsvp = z.infer<typeof voxSaveRsvpSchema>;

// Effective status of a validated save_rsvp body (single source of truth for the
// route + processor — never re-derive ad-hoc).
export function voxSaveRsvpStatus(body: VoxSaveRsvp): 'attending' | 'declined' | 'maybe' {
  return body.status ?? (body.attending ? 'attending' : 'declined');
}

// `mark_dnc` client tool (conversation-design §4.2, legally critical): the guest
// asked not to be called again. No parameters — identity comes ONLY from the
// URL-path access token; the server resolves attempt → contact → normalized phone.
export const voxMarkDncSchema = z.strictObject({
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxMarkDnc = z.infer<typeof voxMarkDncSchema>;

// `notify_owner` client tool (conversation-design §4.2): relay a guest question /
// message / flag to the event owner. Free text is guest-supplied and capped.
export const voxNotifyOwnerSchema = z.strictObject({
  kind: z.enum(['question', 'message', 'flag']),
  text: z.string().trim().min(1).max(500),
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxNotifyOwner = z.infer<typeof voxNotifyOwnerSchema>;

// --- Meeting-booking agent tools (mtg/cb/*, docs/voice-agent/plans/
// 2026-08-22-meeting-booking-agent-plan.md §4) ---
//
// Unlike the RSVP agent's tools (one shared `cb/[token]` endpoint that
// discriminates on a field already present in the payload, e.g.
// call_status/kind), these 4 tools have no naturally-distinguishing shared
// field — two of them (`confirm_meeting`, `mark_opt_out`) take no
// conversational parameters at all, so a body-only discriminator would be
// ambiguous. Each tool therefore gets its OWN URL
// (mtg/cb/{confirm,reschedule,dnc,escalate}/[token]), mirroring the proven
// agent-tool/{rsvp,dnc,note}/[token] convention exactly — no new ElevenLabs
// mechanism required (verified live against the server-tools docs 2026-08-22:
// no documented constant/non-LLM body-field type exists to discriminate a
// single shared URL safely).

// `confirm_meeting`: no conversational parameters. Log-only (§4: "לא נוגע
// ביומן") — identity/effect come entirely from the URL-path access token.
export const voxConfirmMeetingSchema = z.strictObject({
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxConfirmMeeting = z.infer<typeof voxConfirmMeetingSchema>;

// `request_reschedule`: same two fields as the existing schedule_callback
// contract (voxCallbackRequestSchema) by design (§4: "אותה סכמת strictObject
// ... לא פונקציה חדשה"), kept as a separate type so this table's tools never
// share a schema object with call_attempts' — a name collision on the
// underlying literal would be a silent, hard-to-notice coupling.
export const voxRequestRescheduleSchema = z.strictObject({
  callback_when_text: z.string().trim().min(1).max(200),
  callback_iso: z.string().max(40).nullish(),
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxRequestReschedule = z.infer<typeof voxRequestRescheduleSchema>;

// `mark_opt_out`: no conversational parameters — same shape as voxMarkDncSchema
// on purpose (§4: upserts into the SAME call_dnc_list, by normalized phone).
export const voxMeetingOptOutSchema = z.strictObject({
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxMeetingOptOut = z.infer<typeof voxMeetingOptOutSchema>;

// `escalate_to_queue`: reason is a closed vocabulary (§4's exact enum) so the
// admin queue always shows a triageable label even when note_he is empty.
// The meeting-booking scenario's OWN terminal lifecycle report (mtg/cb/[token]
// — distinct from the 4 mtg/tool/* agent-tool schemas above). Mirrors
// voxCallbackSchema's call_status vocabulary minus 'handed_off' /
// 'recording_started' / rsvp_digit / rsvp_method / transcript — this persona
// has no handoff/DTMF/RSVP concepts (plan's own non-goals). Deliberately its
// OWN strictObject, never voxCallbackSchema itself, so a change to the RSVP
// contract can never silently reshape this one.
export const voxMeetingCallbackSchema = z.strictObject({
  call_status: z.enum(['completed', 'no_answer', 'no_response', 'failed']),
  call_duration: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600)
    .nullish(),
  error_reason: z.string().max(256).nullish(),
  // ADDITIVE (same pattern as voxCallbackSchema's el_conversation_id).
  el_conversation_id: z.string().max(128).nullish(),
});
export type VoxMeetingCallback = z.infer<typeof voxMeetingCallbackSchema>;

export const voxMeetingEscalateSchema = z.strictObject({
  reason: z.enum([
    'wrong_person',
    'substantive_question',
    'unclear_reschedule',
    'bad_line',
    'other',
  ]),
  note_he: z.string().trim().max(300).nullish(),
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxMeetingEscalate = z.infer<typeof voxMeetingEscalateSchema>;

// The sales-closing scenario's OWN terminal lifecycle report (sls/cb) —
// same vocabulary as voxMeetingCallbackSchema, its own strictObject for the
// identical "never let another persona's contract change reshape this one"
// reason.
export const voxSalesCallbackSchema = z.strictObject({
  call_status: z.enum(['completed', 'no_answer', 'no_response', 'failed']),
  call_duration: z
    .number()
    .int()
    .min(0)
    .max(24 * 3600)
    .nullish(),
  error_reason: z.string().max(256).nullish(),
  el_conversation_id: z.string().max(128).nullish(),
});
export type VoxSalesCallback = z.infer<typeof voxSalesCallbackSchema>;

// apply_discount_tier — sales-closing-agent-script-draft.md §3.
//
// tool_call_id is required here (verified live 2026-08-31, a real call):
// SalesCloseAgent.voxengine.js's ClientToolCall handler unconditionally
// appends tool_call_id to EVERY tool POST body, for all 8 client tools, with
// no opt-out. Without it in the strictObject, Zod's unrecognized_keys check
// rejects the real payload outright (400) before this tool ever runs —
// confirmed by parsing the actual request body captured from a live call.
export const voxSalesDiscountSchema = z.strictObject({
  objection_reason: z.string().trim().min(1).max(300),
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxSalesDiscount = z.infer<typeof voxSalesDiscountSchema>;

// send_signup_link — §3. wa_consent gates the WhatsApp attempt only;
// SMS is always the fallback (never gated on consent — see no-contact-sms.ts).
// Field renamed from whatsapp_consent -> wa_consent (31.8) to match the live
// ElevenLabs tool's own parameter identifier (owner renamed it in the
// Dashboard to match update_state's wa_consent dynamic variable) — the two
// had silently drifted apart, and the VoxEngine bridge blindly forwards
// whatever the tool call's argument key is, so keeping this schema in sync
// with the LIVE tool identifier is load-bearing, not cosmetic.
// tool_call_id — same reason as voxSalesDiscountSchema above.
export const voxSalesSignupLinkSchema = z.strictObject({
  wa_consent: z.boolean(),
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxSalesSignupLink = z.infer<typeof voxSalesSignupLinkSchema>;

// escalate_to_human — §3. tool_call_id — same reason as voxSalesDiscountSchema above.
export const voxSalesEscalateSchema = z.strictObject({
  reason: z.string().trim().min(1).max(300),
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxSalesEscalate = z.infer<typeof voxSalesEscalateSchema>;

// log_outcome — §3. The enum deliberately excludes 'completed'/'no_answer'
// (architectural-fix note, §3): those are server-computed, never agent-
// asserted. 'escalated_to_human' is accepted here but is NOT a
// callback_requests.call_outcome value (see the route's own comment) — it is
// translated to 'needs_followup' before applyCallOutcome.
// tool_call_id — same reason as voxSalesDiscountSchema above (this is the
// exact tool that surfaced the bug live: callback_request_id 35eab495…,
// 2026-08-31, 400 on every real call, verified against the actual payload).
export const voxSalesLogOutcomeSchema = z.strictObject({
  outcome: z.enum(['needs_followup', 'closed', 'escalated_to_human']),
  discount_tier_applied: z.string().max(64).nullish(),
  tool_call_id: z.string().max(128).nullish(),
});
export type VoxSalesLogOutcome = z.infer<typeof voxSalesLogOutcomeSchema>;
