import { describe, expect, it } from 'vitest';

import { normalizeCallAnalysisWebhook } from './elevenlabs-payloads';

// A realistic post_call_transcription payload with PII stuffed into EVERY
// dangerous field (transcript speech, guest name in dynamic_variables, a
// name-bearing transcript_summary, extracted answers in criteria/collection).
const sample = {
  type: 'post_call_transcription',
  event_timestamp: 1_784_500_000,
  data: {
    agent_id: 'agent_x',
    conversation_id: 'conv_123',
    user_id: 'el_user_1',
    status: 'done',
    transcript: [
      { role: 'user', message: 'GUEST_SPEECH_SECRET yes I am coming', time_in_call_secs: 3 },
    ],
    metadata: {
      call_duration_secs: 62,
      cost: 461,
      termination_reason: 'Client disconnected: 1006',
      feedback: { overall_score: 0.9 },
    },
    analysis: {
      call_successful: 'success',
      transcript_summary: 'ANGELO_SUMMARY_SECRET confirmed he will attend with a guest',
      call_summary_title: 'RSVP confirmed',
      evaluation_criteria_results: { c1: { result: 'success', rationale: 'RATIONALE_SECRET' } },
      data_collection_results: { headcount: { value: 'COLLECTED_SECRET 2' } },
    },
    conversation_initiation_client_data: {
      dynamic_variables: { guest_name: 'ANGELO_NAME_SECRET', event_name: 'Wedding' },
    },
  },
};

const EXPECTED_KEYS = [
  'conversationId',
  'agentId',
  'callSuccessful',
  'status',
  'overallScore',
  'callDurationSecs',
  'costCredits',
  'terminationReason',
  'analysisAt',
  'correlationToken',
  'callSuccessScore',
  'evaluation',
  'dataCollection',
  'agentTurns',
  'userTurns',
  'transcriptSummary',
  'summaryTitle',
  'voicemailDetected',
  'sentimentLabel',
  'frustrationScore',
  'costFiat',
];

describe('normalizeCallAnalysisWebhook', () => {
  it('extracts ONLY the metadata signal from a full payload', () => {
    const { type, analysis } = normalizeCallAnalysisWebhook(sample);
    expect(type).toBe('post_call_transcription');
    expect(analysis).toEqual({
      conversationId: 'conv_123',
      agentId: 'agent_x',
      callSuccessful: 'success',
      status: 'done',
      overallScore: 0.9,
      callDurationSecs: 62,
      costCredits: 461,
      terminationReason: 'Client disconnected: 1006',
      analysisAt: new Date(1_784_500_000 * 1000).toISOString(),
      correlationToken: null, // none injected in this sample
      callSuccessScore: null, // no call_success_score in this sample
      evaluation: { c1: 'success' }, // criterion verdict kept, rationale dropped
      dataCollection: null, // sample's 'headcount' field is not a tracked RSVP field
      // Counted from the transcript, then the transcript itself is dropped: the
      // sample has exactly one user turn and no agent turn.
      agentTurns: 0,
      userTurns: 1,
      // KEPT since 2026-09-01 (owner decision, both personas): a written
      // account of the call, which is what a CRM screen actually needs. Not a
      // transcript — the spoken turns above are still counted and discarded.
      transcriptSummary: 'ANGELO_SUMMARY_SECRET confirmed he will attend with a guest',
      summaryTitle: 'RSVP confirmed',
      // Absent from this sample: no features_usage, no sentiment_analysis, no
      // cost_fiat. All must be null rather than false/0 — "not reported" is a
      // different fact from "reported negative".
      voicemailDetected: null,
      sentimentLabel: null,
      frustrationScore: null,
      costFiat: null,
    });
  });

  describe('voicemail verdict', () => {
    const withFeatures = (voicemail: unknown) => ({
      ...sample,
      data: {
        ...sample.data,
        metadata: { ...sample.data.metadata, features_usage: { voicemail_detection: voicemail } },
      },
    });

    it('reports the detector’s answer when it actually ran', () => {
      expect(
        normalizeCallAnalysisWebhook(withFeatures({ enabled: true, used: true })).analysis
          ?.voicemailDetected,
      ).toBe(true);
      expect(
        normalizeCallAnalysisWebhook(withFeatures({ enabled: true, used: false })).analysis
          ?.voicemailDetected,
      ).toBe(false);
    });

    // The distinction the whole field exists for: `used: false` with the
    // detector OFF establishes nothing. Recording it as "not a voicemail" would
    // be inventing a negative, so it stays null and the caller falls back to
    // the turn-count inference.
    it('reports nothing when the detector was disabled or absent', () => {
      for (const vm of [{ enabled: false, used: false }, {}, undefined, 'nope']) {
        expect(normalizeCallAnalysisWebhook(withFeatures(vm)).analysis?.voicemailDetected).toBeNull();
      }
      expect(normalizeCallAnalysisWebhook(sample).analysis?.voicemailDetected).toBeNull();
    });
  });

  describe('sentiment', () => {
    const withSentiment = (sentiment: unknown) => ({
      ...sample,
      data: {
        ...sample.data,
        analysis: { ...sample.data.analysis, sentiment_analysis: sentiment },
      },
    });

    it('keeps the label and the frustration score', () => {
      const { analysis } = normalizeCallAnalysisWebhook(
        withSentiment({ overall_label: 'positive', overall_frustration_score: 0.25 }),
      );
      expect(analysis).toMatchObject({ sentimentLabel: 'positive', frustrationScore: 0.25 });
    });

    // The column's CHECK accepts three values. Dropping an unknown one here
    // means a future provider value costs us a label — NOT the entire analysis
    // row, which is what a rejected insert would cost.
    it('drops a label outside the closed vocabulary instead of failing the row', () => {
      const { analysis } = normalizeCallAnalysisWebhook(
        withSentiment({ overall_label: 'mixed', overall_frustration_score: 0.4 }),
      );
      expect(analysis?.sentimentLabel).toBeNull();
      expect(analysis?.frustrationScore).toBe(0.4);
      expect(analysis?.conversationId).toBe('conv_123');
    });

    it('clamps a frustration score outside 0..1 to the column’s range', () => {
      expect(
        normalizeCallAnalysisWebhook(withSentiment({ overall_frustration_score: 1.7 })).analysis
          ?.frustrationScore,
      ).toBe(1);
      expect(
        normalizeCallAnalysisWebhook(withSentiment({ overall_frustration_score: -3 })).analysis
          ?.frustrationScore,
      ).toBe(0);
    });
  });

  it('counts turns by role without retaining any spoken text', () => {
    const { analysis } = normalizeCallAnalysisWebhook({
      ...sample,
      data: {
        ...sample.data,
        transcript: [
          { role: 'agent', message: 'hi' },
          { role: 'user', message: 'GUEST_SPEECH_SECRET' },
          { role: 'agent', message: 'how many' },
          { role: 'user', message: 'two' },
          { role: 'weird' }, // unknown roles are ignored, not counted
        ],
      },
    });
    expect(analysis?.agentTurns).toBe(2);
    expect(analysis?.userTurns).toBe(2);
    expect(JSON.stringify(analysis)).not.toContain('GUEST_SPEECH_SECRET');
  });

  it('a voicemail-shaped call (agent spoke, nobody answered) yields zero user turns', () => {
    // This is the signal that separates a reached human from the agent talking
    // at a machine — the whole reason the counters exist.
    const { analysis } = normalizeCallAnalysisWebhook({
      ...sample,
      data: {
        ...sample.data,
        transcript: [
          { role: 'agent', message: 'היי, מבורך?' },
          { role: 'agent', message: 'הלו? שומע אותי?' },
        ],
      },
    });
    expect(analysis?.userTurns).toBe(0);
    expect(analysis?.agentTurns).toBe(2);
  });

  it('a missing or malformed transcript yields 0/0 (stays total)', () => {
    for (const t of [undefined, null, 'not-an-array', 42, {}]) {
      const { analysis } = normalizeCallAnalysisWebhook({
        ...sample,
        data: { ...sample.data, transcript: t },
      });
      expect(analysis?.agentTurns).toBe(0);
      expect(analysis?.userTurns).toBe(0);
    }
  });

  // The summary was on this list until 2026-09-01 and is now deliberately kept
  // (owner decision). Everything else still goes: spoken turns, the guest-name
  // dynamic variable, the free-text rationale attached to each criterion, and
  // the raw collected values.
  it('still drops every OTHER PII-bearing field (transcript, dynamic_variables, rationales)', () => {
    const result = normalizeCallAnalysisWebhook(sample);
    const serialized = JSON.stringify(result);
    for (const secret of [
      'GUEST_SPEECH_SECRET',
      'ANGELO_NAME_SECRET',
      'RATIONALE_SECRET',
      'COLLECTED_SECRET',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // Structural tripwire: no key beyond the declared set ever leaks. This is
    // what catches a future field being added to the normalizer without anyone
    // deciding whether it is safe to persist.
    expect(Object.keys(result.analysis!).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it('reads back ONLY our correlation token — never the sibling guest vars', () => {
    const withToken = {
      ...sample,
      data: {
        ...sample.data,
        conversation_initiation_client_data: {
          dynamic_variables: { kalfa_attempt_token: 'nonce-abc-123', guest_name: 'ANGELO_NAME_SECRET' },
        },
      },
    };
    const { analysis } = normalizeCallAnalysisWebhook(withToken);
    expect(analysis?.correlationToken).toBe('nonce-abc-123');
    // The guest name sitting right next to our token must still be dropped.
    expect(JSON.stringify(analysis)).not.toContain('ANGELO_NAME_SECRET');
  });

  it('extracts QA (score + criterion pass/fail + structured RSVP) — drops all rationale', () => {
    const withQa = {
      ...sample,
      data: {
        ...sample.data,
        analysis: {
          call_successful: 'success',
          call_success_score: 0.82,
          evaluation_criteria_results: {
            rsvp_captured: { result: 'success', rationale: 'GUEST_RATIONALE_SECRET said yes' },
            headcount_correct: { result: 'failure', rationale: 'MORE_SECRET' },
          },
          data_collection_results: {
            rsvp_status: { value: 'attending', rationale: 'SECRET_WHY' },
            adults: { value: 2 },
            children: { value: 1 },
          },
        },
      },
    };
    const { analysis } = normalizeCallAnalysisWebhook(withQa);
    expect(analysis?.callSuccessScore).toBe(0.82);
    expect(analysis?.evaluation).toEqual({ rsvp_captured: 'success', headcount_correct: 'failure' });
    expect(analysis?.dataCollection).toEqual({ status: 'attending', adults: 2, children: 1 });
    // Every rationale / free-text is dropped.
    const s = JSON.stringify(analysis);
    for (const secret of ['GUEST_RATIONALE_SECRET', 'MORE_SECRET', 'SECRET_WHY']) {
      expect(s).not.toContain(secret);
    }
  });

  it('extracts configured sales data-collection fields without rationale', () => {
    const withSalesData = {
      ...sample,
      data: {
        ...sample.data,
        analysis: {
          call_successful: 'success',
          data_collection_results: {
            call_outcome: { value: 'needs_followup', rationale: 'SECRET_REASON' },
            event_type: { value: 'חתונה' },
            estimated_guest_count: { value: '180' },
            whatsapp_consent: { value: 'true' },
            objection_reason: { value: 'יקר לי' },
            untracked_free_text: { value: 'UNTRACKED_SECRET' },
          },
        },
      },
    };
    const { analysis } = normalizeCallAnalysisWebhook(withSalesData);
    expect(analysis?.dataCollection).toEqual({
      call_outcome: 'needs_followup',
      event_type: 'חתונה',
      estimated_guest_count: 180,
      whatsapp_consent: true,
      objection_reason: 'יקר לי',
    });
    const serialized = JSON.stringify(analysis);
    expect(serialized).not.toContain('SECRET_REASON');
    expect(serialized).not.toContain('UNTRACKED_SECRET');
  });

  it('yields NO analysis for a non post_call_transcription type (e.g. post_call_audio)', () => {
    expect(normalizeCallAnalysisWebhook({ type: 'post_call_audio', data: { conversation_id: 'c' } })).toEqual({
      type: 'post_call_audio',
      analysis: null,
    });
  });

  it('yields NO analysis when conversation_id is missing', () => {
    const noId = { ...sample, data: { ...sample.data, conversation_id: undefined } };
    expect(normalizeCallAnalysisWebhook(noId).analysis).toBeNull();
  });

  it('coerces unknown call_successful / status to "unknown"', () => {
    const weird = {
      ...sample,
      data: { ...sample.data, status: 'weird', analysis: { call_successful: 'maybe' } },
    };
    const { analysis } = normalizeCallAnalysisWebhook(weird);
    expect(analysis?.callSuccessful).toBe('unknown');
    expect(analysis?.status).toBe('unknown');
  });

  it('bounds termination_reason to 120 chars', () => {
    const long = {
      ...sample,
      data: { ...sample.data, metadata: { ...sample.data.metadata, termination_reason: 'x'.repeat(500) } },
    };
    expect(normalizeCallAnalysisWebhook(long).analysis?.terminationReason).toHaveLength(120);
  });

  it('returns analysisAt null for an out-of-range event_timestamp (stays total, no throw)', () => {
    const bad = { ...sample, event_timestamp: 1e20 };
    expect(normalizeCallAnalysisWebhook(bad).analysis?.analysisAt).toBeNull();
  });

  it('caps oversized conversation_id / agent_id so the DB key can never overflow', () => {
    const big = {
      ...sample,
      data: { ...sample.data, conversation_id: 'c'.repeat(500), agent_id: 'a'.repeat(500) },
    };
    const { analysis } = normalizeCallAnalysisWebhook(big);
    expect(analysis?.conversationId).toHaveLength(200);
    expect(analysis?.agentId).toHaveLength(128);
  });

  it('survives garbage / empty input', () => {
    expect(normalizeCallAnalysisWebhook(null)).toEqual({ type: null, analysis: null });
    expect(normalizeCallAnalysisWebhook('nope')).toEqual({ type: null, analysis: null });
    expect(normalizeCallAnalysisWebhook({ type: 'post_call_transcription' }).analysis).toBeNull();
  });
});
