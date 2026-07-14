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
