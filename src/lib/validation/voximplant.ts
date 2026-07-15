import { z } from 'zod';

// Zod schema for the Voximplant RSVP scenario's callback (cb) POST body. Shapes
// verified against voxfiles/scenarios/src/RSVP.voxengine.js (the emitted payloads
// at lines 197-207, 384-389, 420-428, 436-442). Validated at the server boundary
// before any persistence; a parse failure → 400, nothing stored.
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
    ]),
    call_duration: z
      .number()
      .int()
      .min(0)
      .max(24 * 3600)
      .nullish(),
    rsvp_digit: z.enum(['1', '2']).nullish(),
    rsvp_method: z.enum(['dtmf', 'voice_asr']).nullish(),
    invitation_id: z.string().max(128).nullish(), // NEVER trusted for lookup
    recording_url: z.string().url().max(2048).nullish(),
    // The scenario sends an array of turns, or (legacy) a plain string.
    transcript: z.union([z.array(transcriptTurn).max(200), z.string().max(20000)]).nullish(),
    error_reason: z.string().max(256).nullish(),
  })
  .refine(
    (v) => v.call_status !== 'completed' || v.rsvp_digit === '1' || v.rsvp_digit === '2',
    { message: 'completed call is missing a valid rsvp_digit', path: ['rsvp_digit'] },
  );

export type VoxCallback = z.infer<typeof voxCallbackSchema>;

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
