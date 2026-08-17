import { describe, expect, it } from 'vitest';

import {
  normalizeVoxSession,
  normalizeVoxSessions,
  parseConsoleCallId,
  parseEndReason,
} from './call-history-normalize';
import type { CallHistorySession } from './core';

// The fixtures below are REAL sessions pulled from the live account on
// 2026-08-17, with the phone numbers masked. They are the point of this suite:
// the outcome rules were written against what Voximplant actually sends, and a
// synthetic payload would have let every optimistic assumption survive.

/** A genuine missed call: the system answered, both agent legs failed. */
const MISSED: CallHistorySession = {
  call_session_history_id: 7734244460,
  rule_name: 'incoming',
  start_date: '2026-08-17 14:39:15',
  duration: 32,
  finish_reason: 'Normal termination',
  calls: [
    {
      incoming: true,
      successful: true,
      duration: 29,
      remote_number: '+972539999962',
      remote_number_type: 'pstn',
      local_number: '+97237219347',
      end_reason: { code: 200, details: 'Normal call clearing' },
    },
    {
      incoming: false,
      successful: false,
      duration: 0,
      remote_number: 'agent_1bbe74dc',
      remote_number_type: 'user',
      end_reason: { code: 480, details: 'User offline' },
    },
    {
      incoming: false,
      successful: false,
      duration: 0,
      remote_number: 'agent_1bbe74dc',
      remote_number_type: 'user',
      end_reason: { code: 603, details: '' },
    },
  ],
};

/** Answered, with a consult leg out to a PSTN number afterwards. */
const ANSWERED: CallHistorySession = {
  call_session_history_id: 7734258622,
  rule_name: 'incoming',
  start_date: '2026-08-17 14:39:53',
  duration: 89,
  calls: [
    {
      incoming: true,
      successful: true,
      duration: 86,
      remote_number: '+972539999962',
      remote_number_type: 'pstn',
      end_reason: { code: 200, details: 'Normal call clearing' },
    },
    {
      incoming: false,
      successful: true,
      duration: 72,
      remote_number: 'agent_1bbe74dc',
      remote_number_type: 'user',
      end_reason: { code: 200, details: 'Normal call clearing' },
    },
    {
      incoming: false,
      successful: true,
      duration: 26,
      remote_number: '+972509999921',
      remote_number_type: 'pstn',
      end_reason: { code: 200, details: 'Normal call clearing' },
    },
  ],
};

/** The 1–2 second hang-ups: 668 of 1,912 inbound sessions in the measured week. */
const ABANDONED: CallHistorySession = {
  call_session_history_id: 7726756318,
  rule_name: 'incoming',
  start_date: '2026-08-16 18:59:53',
  duration: 2,
  finish_reason: 'Normal termination',
  calls: [
    {
      incoming: true,
      successful: false,
      duration: 0,
      remote_number: '+972399999943',
      remote_number_type: 'pstn',
      end_reason: { code: 487, details: 'Request Terminated' },
    },
  ],
};

describe('parseEndReason', () => {
  it('reads the documented object shape', () => {
    expect(parseEndReason({ code: 480, details: 'User offline' })).toEqual({
      code: 480,
      details: 'User offline',
    });
  });

  // The reference types end_reason as a string while the wire sends an object.
  // Both are accepted so a payload that matches the docs cannot crash the screen.
  it('reads a string form too', () => {
    expect(parseEndReason('480 User offline')).toEqual({ code: 480, details: 'User offline' });
    expect(parseEndReason('Normal clearing')).toEqual({ code: null, details: 'Normal clearing' });
  });

  it('is total on junk', () => {
    for (const v of [null, undefined, 0, [], {}, '']) {
      expect(parseEndReason(v)).toEqual({ code: null, details: null });
    }
  });
});

describe('parseConsoleCallId', () => {
  const id = '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8';

  it('accepts a bare uuid and a json envelope', () => {
    expect(parseConsoleCallId(id)).toBe(id);
    expect(parseConsoleCallId(JSON.stringify({ console_call_id: id }))).toBe(id);
    expect(parseConsoleCallId(JSON.stringify({ ccid: id }))).toBe(id);
  });

  it('normalizes case', () => {
    expect(parseConsoleCallId(id.toUpperCase())).toBe(id);
  });

  // customData is capped at 200 bytes by the platform, so a JSON envelope can
  // arrive cut in half. Unknown must never become a wrong association.
  it('returns null rather than guessing', () => {
    expect(parseConsoleCallId('{"console_call_id":"3f1a2b4c-5d6e-4f')).toBeNull();
    expect(parseConsoleCallId('not-a-uuid')).toBeNull();
    expect(parseConsoleCallId('')).toBeNull();
    expect(parseConsoleCallId(undefined)).toBeNull();
  });
});

describe('normalizeVoxSession — outcome', () => {
  it('calls a rung-but-unanswered session MISSED', () => {
    const n = normalizeVoxSession(MISSED)!;
    expect(n.outcome).toBe('missed');
    expect(n.agentLegsTried).toBe(2);
    expect(n.agentTalkSec).toBe(0);
    // The LAST agent's failure is what ended the attempt.
    expect(n.endCode).toBe(603);
  });

  it('calls a connected session ANSWERED and reports talk time', () => {
    const n = normalizeVoxSession(ANSWERED)!;
    expect(n.outcome).toBe('answered');
    expect(n.agentLegsTried).toBe(1);
    expect(n.agentTalkSec).toBe(72);
    expect(n.endCode).toBe(200);
  });

  // The distinction the whole change exists for. Our own bookkeeping called
  // MISSED "answered" (the scenario had answered) and buried ABANDONED in with it.
  it('separates ABANDONED from MISSED', () => {
    const n = normalizeVoxSession(ABANDONED)!;
    expect(n.outcome).toBe('abandoned');
    expect(n.agentLegsTried).toBe(0);
  });

  it('does not invent an answer when `successful` is absent', () => {
    const n = normalizeVoxSession({
      call_session_history_id: 1,
      calls: [
        { incoming: true, duration: 10, remote_number_type: 'pstn' },
        { incoming: false, remote_number_type: 'user' },
      ],
    })!;
    expect(n.outcome).toBe('missed');
  });

  it('reports unknown when with_calls was off', () => {
    const n = normalizeVoxSession({ call_session_history_id: 2, duration: 30 })!;
    expect(n.outcome).toBe('unknown');
    expect(n.legs).toEqual([]);
  });

  it('handles an outbound session with no agent leg', () => {
    const ok = normalizeVoxSession({
      call_session_history_id: 3,
      calls: [
        { incoming: false, successful: true, duration: 40, remote_number: '+9725', remote_number_type: 'pstn' },
      ],
    })!;
    expect(ok.direction).toBe('outbound');
    expect(ok.outcome).toBe('answered');

    const bad = normalizeVoxSession({
      call_session_history_id: 4,
      calls: [
        { incoming: false, successful: false, duration: 0, remote_number: '+9725', remote_number_type: 'pstn' },
      ],
    })!;
    expect(bad.outcome).toBe('failed');
  });
});

describe('normalizeVoxSession — identity of the far party', () => {
  it('takes the caller, never an agent leg', () => {
    expect(normalizeVoxSession(MISSED)!.remoteNumber).toBe('+972539999962');
    expect(normalizeVoxSession(ANSWERED)!.remoteNumber).toBe('+972539999962');
  });

  it('keeps the local number', () => {
    expect(normalizeVoxSession(MISSED)!.localNumber).toBe('+97237219347');
  });

  it('reports every leg for the detail view', () => {
    const n = normalizeVoxSession(MISSED)!;
    expect(n.legs).toHaveLength(3);
    expect(n.legs.filter((l) => l.isAgentLeg)).toHaveLength(2);
    expect(n.legs[1].endDetails).toBe('User offline');
  });
});

describe('normalizeVoxSession — records and transcription', () => {
  it('picks the longest recording and carries its transcription', () => {
    const n = normalizeVoxSession({
      call_session_history_id: 5,
      records: [
        { record_id: 1, duration: 2, record_url: 'https://x/short' },
        {
          record_id: 2,
          duration: 80,
          record_url: 'https://x/long',
          transcription_url: 'https://x/t',
          transcription_status: 'Complete',
        },
      ],
    })!;
    expect(n.recordingUrl).toBe('https://x/long');
    expect(n.transcriptionUrl).toBe('https://x/t');
    expect(n.transcriptionStatus).toBe('Complete');
    expect(n.hasRecording).toBe(true);
  });

  it('reports no recording when the branch is absent', () => {
    const n = normalizeVoxSession({ call_session_history_id: 6 })!;
    expect(n.hasRecording).toBe(false);
    expect(n.recordingUrl).toBeNull();
  });

  // `is_removed` and `expiration_date` are in the official response example and
  // in no reference table. Both describe a URL that will not play, and offering
  // one is a feature that fails at the moment of use.
  it('skips a removed recording', () => {
    const n = normalizeVoxSession({
      call_session_history_id: 7,
      records: [
        { record_id: 1, duration: 90, record_url: 'https://x/gone', is_removed: true },
        { record_id: 2, duration: 10, record_url: 'https://x/here' },
      ],
    })!;
    expect(n.recordingUrl).toBe('https://x/here');
  });

  it('skips an expired recording but keeps one expiring today', () => {
    const now = Date.parse('2026-08-17T12:00:00Z');
    const expired = normalizeVoxSession(
      {
        call_session_history_id: 8,
        records: [{ record_id: 1, duration: 90, record_url: 'https://x/old', expiration_date: '2026-08-16' }],
      },
      now,
    )!;
    expect(expired.hasRecording).toBe(false);

    const today = normalizeVoxSession(
      {
        call_session_history_id: 9,
        records: [{ record_id: 1, duration: 90, record_url: 'https://x/today', expiration_date: '2026-08-17' }],
      },
      now,
    )!;
    expect(today.recordingUrl).toBe('https://x/today');
  });

  // The reference publishes a closed list of ten resource_type values and the
  // official example on the same page returns TTS_SMARTSPEECH, which is not one
  // of them. Nothing here may validate against that list.
  it('does not choke on an undocumented payload shape', () => {
    const n = normalizeVoxSession({
      call_session_history_id: 10,
      active: true,
      other_resource_usage: [{ resource_type: 'TTS_SMARTSPEECH', cost: 0.0096 }],
      calls: [
        {
          incoming: true,
          successful: true,
          duration: 6,
          direction: 'in',
          audio_quality: 'Standard',
          remote_number: '+9725',
          remote_number_type: 'pstn',
          end_reason: { code: 200, details: 'Normal call clearing' },
        },
      ],
    } as never)!;
    expect(n.outcome).toBe('abandoned');
    expect(n.remoteNumber).toBe('+9725');
  });
});

describe('normalizeVoxSessions', () => {
  it('drops rows with no session id rather than synthesising one', () => {
    const out = normalizeVoxSessions([MISSED, { duration: 5 }, null, 'x', ANSWERED]);
    expect(out.map((s) => s.sessionId)).toEqual([7734244460, 7734258622]);
  });

  it('is total on a non-array', () => {
    expect(normalizeVoxSessions(null)).toEqual([]);
    expect(normalizeVoxSessions({})).toEqual([]);
  });
});
