import { describe, expect, it } from 'vitest';

import { voxCallbackSchema } from './voximplant';

// The completed↔rsvp_digit refine is the contract between BOTH scenarios and
// the drain: DTMF (RSVP.voxengine.js) must carry a digit on completed; the
// ElevenLabs bridge (RSVPAgent.voxengine.js) completes with rsvp_method
// 'agent' and NO digit (its RSVP was written in-call by save_rsvp).
describe('voxCallbackSchema — completed/rsvp_digit refine per rsvp_method', () => {
  it('DTMF completed with a digit passes (unchanged contract)', () => {
    expect(
      voxCallbackSchema.safeParse({
        call_status: 'completed',
        rsvp_digit: '1',
        rsvp_method: 'dtmf',
        call_duration: 30,
      }).success,
    ).toBe(true);
  });

  it('completed WITHOUT a digit is still rejected for non-agent methods', () => {
    expect(voxCallbackSchema.safeParse({ call_status: 'completed' }).success).toBe(false);
    expect(
      voxCallbackSchema.safeParse({ call_status: 'completed', rsvp_method: 'voice_asr' })
        .success,
    ).toBe(false);
  });

  it("agent completed WITHOUT a digit passes (bridge terminal callback)", () => {
    expect(
      voxCallbackSchema.safeParse({
        call_status: 'completed',
        rsvp_method: 'agent',
        call_duration: 42,
        el_conversation_id: 'conv_123',
        recording_url: 'https://storage-gw-us-01.voximplant.com/rec.mp3',
      }).success,
    ).toBe(true);
  });

  it('agent non-completed terminal statuses pass without a digit', () => {
    for (const call_status of ['failed', 'no_answer', 'no_response', 'handed_off'] as const) {
      expect(
        voxCallbackSchema.safeParse({ call_status, rsvp_method: 'agent', call_duration: 0 })
          .success,
      ).toBe(true);
    }
  });

  // Stage 6: 'handed_off' is the new terminal status RSVPAgent.voxengine.js's
  // terminalStatus() posts once a human takeover connected but the AI never
  // carried the conversation. Accepted BEFORE the scenario deploy (hard
  // ordering constraint) — see call-attempts.ts TERMINAL_STATUSES and
  // call-result-processing.ts's billing branch.
  it('handed_off is accepted as a terminal call_status, with or without a recording', () => {
    expect(
      voxCallbackSchema.safeParse({
        call_status: 'handed_off',
        rsvp_method: 'agent',
        call_duration: 90,
        recording_url: 'https://storage-gw-us-01.voximplant.com/rec.mp3',
      }).success,
    ).toBe(true);
  });

  it('strictObject still rejects unknown fields on the agent path', () => {
    expect(
      voxCallbackSchema.safeParse({
        call_status: 'completed',
        rsvp_method: 'agent',
        surprise: true,
      }).success,
    ).toBe(false);
  });
});
