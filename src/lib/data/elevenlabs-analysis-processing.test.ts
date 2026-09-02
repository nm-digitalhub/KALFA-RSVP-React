import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tables } from '@/lib/supabase/types';

vi.mock('server-only', () => ({}));
const { storeRsvpMock, storeSalesMock, lookupMock, setConversationMock, claimMock, applyOutcomeMock } = vi.hoisted(
  () => ({
    storeRsvpMock: vi.fn(),
    storeSalesMock: vi.fn(),
    lookupMock: vi.fn(),
    setConversationMock: vi.fn(),
    claimMock: vi.fn(),
    applyOutcomeMock: vi.fn(),
  }),
);
vi.mock('@/lib/data/elevenlabs-analysis', () => ({
  storeCallAnalysis: storeRsvpMock,
  storeSalesCallAnalysis: storeSalesMock,
}));
vi.mock('@/lib/data/sales-call-attempts', () => ({
  getSalesAttemptIdByConversationId: lookupMock,
  setSalesAttemptElConversationId: setConversationMock,
  claimSalesOutcome: claimMock,
}));
vi.mock('@/lib/data/callback-scheduling', () => ({ applyCallOutcome: applyOutcomeMock }));

import {
  processElevenLabsRsvpAnalysisRow,
  processElevenLabsSalesAnalysisRow,
} from './elevenlabs-analysis-processing';

// The processing these two functions took over from the HTTP routes on
// 2026-09-01, now retried locally instead of depending on a provider retry that
// never fires after a 4xx (and is switched off entirely on the RSVP webhook).
function row(overrides: Record<string, unknown> = {}): Tables<'webhook_inbox'> {
  return {
    id: 'row-1',
    provider: 'elevenlabs',
    event_kind: 'el_analysis_sales',
    dedupe_key: 'conv_1:1784500000',
    message_id: 'conv_1',
    context_message_id: null,
    phone_number_id: null,
    event_at: '2026-07-19T22:26:40.000Z',
    received_at: '2026-07-19T22:26:41.000Z',
    processed_at: null,
    attempts: 0,
    last_error: null,
    payload: {
      type: 'post_call_transcription',
      event_timestamp: 1_784_500_000,
      data: {
        conversation_id: 'conv_1',
        agent_id: 'a',
        status: 'done',
        transcript: [{ role: 'user', message: 'SECRET_SPEECH' }],
        metadata: { call_duration_secs: 10, cost: 5 },
        analysis: { call_successful: 'success' },
      },
    },
    ...overrides,
  } as Tables<'webhook_inbox'>;
}

beforeEach(() => {
  storeRsvpMock.mockReset().mockResolvedValue('stored');
  storeSalesMock.mockReset().mockResolvedValue('stored');
  lookupMock.mockReset().mockResolvedValue(null);
  setConversationMock.mockReset().mockResolvedValue({ applied: true });
  claimMock.mockReset().mockResolvedValue(null);
  applyOutcomeMock.mockReset().mockResolvedValue({ archived: false, requestClosed: false });
});
afterEach(() => vi.clearAllMocks());

describe('processElevenLabsRsvpAnalysisRow', () => {
  it('stores the analysis without the transcript speech', async () => {
    await processElevenLabsRsvpAnalysisRow(row({ event_kind: 'el_analysis_rsvp' }));
    expect(storeRsvpMock).toHaveBeenCalledOnce();
    expect(storeRsvpMock).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv_1', callSuccessful: 'success' }),
    );
    expect(JSON.stringify(storeRsvpMock.mock.calls[0][0])).not.toContain('SECRET_SPEECH');
  });

  // Throwing is the whole reason this moved off the request: the worker records
  // the attempt and retries, and the row lands in /admin/webhooks with its
  // error instead of the delivery being gone.
  it('throws so the worker retries when the store fails', async () => {
    storeRsvpMock.mockResolvedValue('error');
    await expect(processElevenLabsRsvpAnalysisRow(row())).rejects.toThrow('conv_1');
  });

  it('never leaks payload text into the thrown message', async () => {
    storeRsvpMock.mockResolvedValue('error');
    await expect(processElevenLabsRsvpAnalysisRow(row())).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('SECRET_SPEECH') }),
    );
  });
});

describe('processElevenLabsSalesAnalysisRow', () => {
  it('stores the analysis and resolves a matched, unclaimed attempt as needs_followup', async () => {
    lookupMock.mockResolvedValue({ id: 'attempt-1', callbackRequestId: 'req-1' });
    claimMock.mockResolvedValue({ callbackRequestId: 'req-1' });

    await processElevenLabsSalesAnalysisRow(row());

    expect(storeSalesMock).toHaveBeenCalledOnce();
    expect(lookupMock).toHaveBeenCalledWith('conv_1', null);
    expect(setConversationMock).toHaveBeenCalledWith('attempt-1', 'conv_1');
    expect(claimMock).toHaveBeenCalledWith('attempt-1');
    expect(applyOutcomeMock).toHaveBeenCalledWith('req-1', 'needs_followup');
  });

  it('no-ops when the conversation belongs to another persona', async () => {
    lookupMock.mockResolvedValue(null);
    await processElevenLabsSalesAnalysisRow(row());
    expect(storeSalesMock).toHaveBeenCalledOnce();
    expect(claimMock).not.toHaveBeenCalled();
    expect(applyOutcomeMock).not.toHaveBeenCalled();
  });

  it('passes the injected sales attempt correlation token to the lookup', async () => {
    const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    lookupMock.mockResolvedValue({ id: attemptId, callbackRequestId: 'req-1' });

    await processElevenLabsSalesAnalysisRow(
      row({
        payload: {
          type: 'post_call_transcription',
          event_timestamp: 1_784_500_000,
          data: {
            conversation_id: 'conv_1',
            agent_id: 'a',
            status: 'done',
            transcript: [],
            metadata: { call_duration_secs: 10, cost: 5 },
            conversation_initiation_client_data: {
              dynamic_variables: { kalfa_attempt_token: attemptId },
            },
            analysis: { call_successful: 'success' },
          },
        },
      }),
    );

    expect(lookupMock).toHaveBeenCalledWith('conv_1', attemptId);
  });

  it('writes no outcome when another path already claimed the attempt', async () => {
    lookupMock.mockResolvedValue({ id: 'attempt-1', callbackRequestId: 'req-1' });
    claimMock.mockResolvedValue(null);
    await processElevenLabsSalesAnalysisRow(row());
    expect(applyOutcomeMock).not.toHaveBeenCalled();
  });

  // Order matters: if the analysis write fails, the one-shot claim must still be
  // available to the retry. Claiming first would burn it on a run that stored
  // nothing.
  it('does not touch the claim when storing the analysis fails', async () => {
    storeSalesMock.mockResolvedValue('error');
    await expect(processElevenLabsSalesAnalysisRow(row())).rejects.toThrow('conv_1');
    expect(lookupMock).not.toHaveBeenCalled();
    expect(claimMock).not.toHaveBeenCalled();
  });

  it('propagates a lookup failure so the row is retried', async () => {
    lookupMock.mockRejectedValue(new Error('db down'));
    await expect(processElevenLabsSalesAnalysisRow(row())).rejects.toThrow('db down');
  });

  // Only the routes insert these rows and they only insert post_call_transcription
  // — so a mismatch here is a malformed or hand-edited payload, which no retry
  // can fix. Return quietly rather than burning the retry budget.
  it('ignores a row whose payload is not a post-call transcription', async () => {
    await processElevenLabsSalesAnalysisRow(
      row({ payload: { type: 'post_call_audio', data: { conversation_id: 'conv_1' } } }),
    );
    expect(storeSalesMock).not.toHaveBeenCalled();
  });

  it('ignores a row with an unusable payload', async () => {
    await processElevenLabsSalesAnalysisRow(row({ payload: null }));
    expect(storeSalesMock).not.toHaveBeenCalled();
  });
});
