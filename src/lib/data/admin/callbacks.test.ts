import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createMockSupabase } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  applyCallOutcome,
  closeCallbackAppointment,
  rescheduleCallbackRequest,
} from '@/lib/data/callback-scheduling';
import {
  cancelCallback,
  getCallbackRequest,
  getCallbackRequestByCalendarItem,
  listCallbackRequests,
  rescheduleCallback,
  updateCallOutcome,
  CALLBACK_COLUMNS,
  type CallbackRequest,
  type CallbackRequestDetail,
} from './callbacks';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/callback-scheduling', () => ({
  applyCallOutcome: vi.fn(),
  closeCallbackAppointment: vi.fn(),
  rescheduleCallbackRequest: vi.fn(),
}));

function adminUser(): User {
  return { id: 'admin-1' } as unknown as User;
}

function row(overrides: Partial<CallbackRequest> = {}): CallbackRequest {
  return {
    id: 'cb-1',
    full_name: 'יוסי',
    phone: '0521112222',
    topic: 'מחירים',
    note: null,
    status: 'new',
    call_outcome: 'pending',
    scheduled_at: null,
    created_at: '2026-06-20T10:00:00.000Z',
    updated_at: '2026-06-20T10:00:00.000Z',
    ...overrides,
  };
}

function detailRow(overrides: Partial<CallbackRequestDetail> = {}): CallbackRequestDetail {
  return {
    ...row(),
    requested_at: null,
    calendar_item_id: null,
    attempt_count: 0,
    scheduling_failure_reason: null,
    consecutive_no_answer_count: 0,
    ...overrides,
  };
}

function chainResult<Row>(result: { data: Row | null; error: { message: string } | null; count?: number | null }) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() => builder),
    then: (onFulfilled: (value: typeof result) => unknown) => onFulfilled(result),
  };
  return builder;
}

// Since 2026-09-01 the AI calls arrive EMBEDDED in a second callback_requests
// select (PostgREST resource embedding + the call_analysis computed
// relationship), not from separate sales_call_attempts / call_analysis
// queries. Both selects therefore hit the same table, so the mock answers the
// first with the callback rows and the second with the embedded shape.
function mockCallbackSalesClient(args: {
  callbacks: CallbackRequest[] | CallbackRequestDetail | null;
  callbackCount?: number;
  /** Rows of `{ id, sales_call_attempts: [...], callback_request_attempts: [...] }`. */
  aiCalls?: unknown[];
}) {
  const callbacksBuilder = chainResult({
    data: args.callbacks,
    error: null,
    count: args.callbackCount ?? (Array.isArray(args.callbacks) ? args.callbacks.length : null),
  });
  const aiCallsBuilder = chainResult({ data: args.aiCalls ?? [], error: null });
  let callbackSelects = 0;
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'callback_requests') {
        callbackSelects += 1;
        return callbackSelects === 1 ? callbacksBuilder : aiCallsBuilder;
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
  return { client, callbacksBuilder, aiCallsBuilder };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue(adminUser());
  vi.mocked(closeCallbackAppointment).mockResolvedValue({ archived: false });
  vi.mocked(applyCallOutcome).mockResolvedValue({ archived: false, requestClosed: false });
});

// The calendar dialog renders a dialable number and a working link from THIS
// lookup rather than from the appointment's description. If it silently
// returned nothing, the dialog would fall back to showing prose with dead
// links — the exact regression this replaced.
describe('getCallbackRequestByCalendarItem', () => {
  function mockClient(data: unknown, error: unknown = null) {
    const { client, builder } = createMockSupabase<unknown>({
      data: data as never,
      error: error as never,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return { client, builder };
  }

  it('is gated on customer-data access before it reads anything', async () => {
    mockClient(null);
    await getCallbackRequestByCalendarItem('item-1');
    expect(requirePlatformPermission).toHaveBeenCalledWith('view_customer_data');
  });

  it('looks the request up by the calendar item the owner clicked', async () => {
    const { client, builder } = mockClient(row());

    await getCallbackRequestByCalendarItem('item-1');

    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.eq).toHaveBeenCalledWith('calendar_item_id', 'item-1');
    // maybeSingle, not single: an ordinary meeting matches no row at all.
    expect(builder.maybeSingle).toHaveBeenCalled();
  });

  it('returns null for an appointment this system never scheduled', async () => {
    mockClient(null);
    await expect(getCallbackRequestByCalendarItem('item-1')).resolves.toBeNull();
  });

  it('raises a safe Hebrew error instead of leaking the database one', async () => {
    mockClient(null, { message: 'relation "callback_requests" does not exist' });
    await expect(getCallbackRequestByCalendarItem('item-1')).rejects.toThrow(
      'טעינת בקשת החזרה נכשלה',
    );
  });
});

describe('listCallbackRequests', () => {
  it('requests the DTO columns from the right table with a count', async () => {
    const { client, builder } = createMockSupabase<CallbackRequest[]>({
      data: [row()],
      error: null,
      count: 1,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    const result = await listCallbackRequests();

    expect(client.from).toHaveBeenCalledWith('callback_requests');
    expect(builder.select).toHaveBeenCalledWith(CALLBACK_COLUMNS, {
      count: 'exact',
    });
    expect(result.total).toBe(1);
  });

  it('does NOT query when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<CallbackRequest[]>({
      data: [],
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(listCallbackRequests()).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws a safe error on failure', async () => {
    const { client } = createMockSupabase<CallbackRequest[]>({
      data: null,
      error: { message: 'boom' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(listCallbackRequests()).rejects.toThrow(
      'טעינת בקשות החזרה נכשלה',
    );
  });

  it('adds the latest sales-call summary without selecting access_token', async () => {
    const attempt = {
      id: 'sales-1',
      callback_request_id: 'cb-1',
      dispatch_status: 'concluded',
      scheduled_at_snapshot: '2026-09-01T08:00:00.000Z',
      created_at: '2026-09-01T08:01:00.000Z',
      updated_at: '2026-09-01T08:02:00.000Z',
      vox_call_session_history_id: 'vox-1',
      finish_reason: 'completed',
      call_duration_sec: 9,
      el_conversation_id: 'conv-sales-1',
      outcome_recorded_at: '2026-09-01T08:03:00.000Z',
      signup_completed_at: null,
      wa_delivery_status: 'sent',
      wa_delivery_error_code: null,
      wa_status_at: '2026-09-01T08:04:00.000Z',
    };
    const analysis = {
      conversation_id: 'conv-sales-1',
      agent_id: 'agent-sales',
      call_successful: 'success',
      status: 'done',
      el_call_score: 92,
      termination_reason: 'end_call tool was called',
      call_duration_secs: 64,
      cost_credits: 120,
      agent_turns: 8,
      user_turns: 4,
      el_eval: { pricing_grounded: 'success' },
      el_data: {
        call_outcome: 'completed',
        event_type: 'חתונה',
        estimated_guest_count: 180,
        whatsapp_consent: true,
        objection_reason: 'יקר לי',
      },
      analysis_at: '2026-09-01T08:05:00.000Z',
    };
    const { aiCallsBuilder } = mockCallbackSalesClient({
      callbacks: [row()],
      aiCalls: [{ id: 'cb-1', sales_call_attempts: [{ ...attempt, call_analysis: analysis }] }],
    });

    const result = await listCallbackRequests();

    // access_token is a live bearer for the agent tool routes — it must never
    // be part of a screen's select, embedded or not.
    expect(aiCallsBuilder.select).toHaveBeenCalledWith(expect.not.stringContaining('access_token'));
    expect(result.items[0].latestSalesCall).toMatchObject({
      attemptId: 'sales-1',
      callbackRequestId: 'cb-1',
      hasAnalysis: true,
      callSuccessful: 'success',
      callSuccessScore: 92,
      callDurationSecs: 64,
      costCredits: 120,
      likelyVoicemail: false,
      evaluation: { pricing_grounded: 'success' },
      dataCollection: {
        callOutcome: 'completed',
        eventType: 'חתונה',
        estimatedGuestCount: 180,
        whatsappConsent: true,
        objectionReason: 'יקר לי',
      },
    });
  });

  it('keeps a sales attempt visible when analysis has not arrived yet', async () => {
    mockCallbackSalesClient({
      callbacks: [row()],
      aiCalls: [{ id: 'cb-1', sales_call_attempts: ([
        {
          id: 'sales-1',
          callback_request_id: 'cb-1',
          dispatch_status: 'concluded',
          scheduled_at_snapshot: '2026-09-01T08:00:00.000Z',
          created_at: '2026-09-01T08:01:00.000Z',
          updated_at: '2026-09-01T08:02:00.000Z',
          vox_call_session_history_id: null,
          finish_reason: null,
          call_duration_sec: 9,
          el_conversation_id: 'conv-missing',
          outcome_recorded_at: null,
          signup_completed_at: null,
          wa_delivery_status: null,
          wa_delivery_error_code: null,
          wa_status_at: null,
        },
      ]).map((a) => ({ ...a, call_analysis: null })) }],    });

    const result = await listCallbackRequests();

    expect(result.items[0].latestSalesCall).toMatchObject({
      hasAnalysis: false,
      callSuccessful: 'unknown',
      status: 'unknown',
      callDurationSecs: 9,
      likelyVoicemail: null,
    });
  });
});

describe('getCallbackRequest', () => {
  it('returns every sales call for the callback and marks voicemail-shaped analysis', async () => {
    mockCallbackSalesClient({
      callbacks: detailRow({ id: 'cb-1' }),
      aiCalls: [{ id: 'cb-1', sales_call_attempts: ([
        {
          id: 'sales-1',
          callback_request_id: 'cb-1',
          dispatch_status: 'concluded',
          scheduled_at_snapshot: '2026-09-01T08:00:00.000Z',
          created_at: '2026-09-01T08:01:00.000Z',
          updated_at: '2026-09-01T08:02:00.000Z',
          vox_call_session_history_id: null,
          finish_reason: null,
          call_duration_sec: null,
          el_conversation_id: 'conv-sales-1',
          outcome_recorded_at: null,
          signup_completed_at: null,
          wa_delivery_status: null,
          wa_delivery_error_code: null,
          wa_status_at: null,
        },
      ]).map((a) => ({ ...a, call_analysis: ([
        {
          conversation_id: 'conv-sales-1',
          agent_id: 'agent-sales',
          call_successful: 'failure',
          status: 'done',
          el_call_score: 50,
          termination_reason: 'voicemail_detection',
          call_duration_secs: 13,
          cost_credits: 51,
          agent_turns: 2,
          user_turns: 0,
          el_eval: { terminal_outcome_recorded: 'success' },
          el_data: { call_outcome: 'needs_followup' },
          analysis_at: '2026-09-01T08:05:00.000Z',
        },
      ])[0] })) }],    });

    const result = await getCallbackRequest('cb-1');

    expect(result?.salesCalls).toHaveLength(1);
    expect(result?.latestSalesCall).toBe(result?.salesCalls[0]);
    expect(result?.salesCalls[0]).toMatchObject({
      hasAnalysis: true,
      userTurns: 0,
      agentTurns: 2,
      likelyVoicemail: true,
    });
  });

  // MEASURED 2026-09-01: the first real sales call concluded with
  // finish_reason 'completed' from the telephony and a signup link Meta had
  // accepted — and the screen showed "סיבת סיום —" and said nothing about the
  // link, because the mapper dropped both whenever the analysis was missing.
  // There is ALWAYS a window before the analysis lands, so this is the normal
  // state of a fresh call, not an edge case.
  it('falls back to the telephony verdict while the analysis is outstanding', async () => {
    mockCallbackSalesClient({
      callbacks: detailRow({ id: 'cb-1' }),
      aiCalls: [{ id: 'cb-1', sales_call_attempts: ([
        {
          id: 'sales-1',
          callback_request_id: 'cb-1',
          dispatch_status: 'concluded',
          scheduled_at_snapshot: '2026-09-01T08:00:00.000Z',
          created_at: '2026-09-01T08:01:00.000Z',
          updated_at: '2026-09-01T08:02:00.000Z',
          vox_call_session_history_id: '8120741400',
          finish_reason: 'completed',
          call_duration_sec: 229,
          el_conversation_id: 'conv-sales-1',
          outcome_recorded_at: '2026-09-01T08:02:00.000Z',
          signup_completed_at: null,
          wa_message_id: 'wamid.ABC',
          wa_delivery_status: null,
          wa_delivery_error_code: null,
          wa_status_at: null,
        },
      ]).map((a) => ({ ...a, call_analysis: null })) }],    });

    const result = await getCallbackRequest('cb-1');

    expect(result?.salesCalls[0]).toMatchObject({
      hasAnalysis: false,
      terminationReason: 'completed',
      callDurationSecs: 229,
      linkSent: true,
      voxCallSessionHistoryId: '8120741400',
    });
  });

  // THE regression this whole design exists for (measured 2026-09-01): a
  // meeting-confirmation call had completed with a full analysis, and the
  // screen said "no AI call has been made" — the owner was one click from
  // phoning a customer who had confirmed seven minutes earlier.
  it('returns meeting-confirmation calls alongside sales calls, newest first', async () => {
    mockCallbackSalesClient({
      callbacks: detailRow({ id: 'cb-1' }),
      aiCalls: [
        {
          id: 'cb-1',
          sales_call_attempts: [
            {
              id: 'sales-1',
              dispatch_status: 'concluded',
              created_at: '2026-09-01T05:20:00.000Z',
              updated_at: '2026-09-01T05:24:00.000Z',
              finish_reason: 'completed',
              call_duration_sec: 229,
              el_conversation_id: 'conv-sales',
              call_analysis: null,
            },
          ],
          callback_request_attempts: [
            {
              id: 'confirm-1',
              dispatch_status: 'concluded',
              created_at: '2026-09-01T08:41:49.000Z',
              updated_at: '2026-09-01T08:42:36.000Z',
              finish_reason: 'completed',
              call_duration_sec: 31,
              el_conversation_id: 'conv-confirm',
              confirmation_call_status: 'confirmed',
              call_analysis: {
                conversation_id: 'conv-confirm',
                agent_id: 'agent-confirm',
                call_successful: 'success',
                status: 'done',
                el_call_score: 100,
                summary_title: 'אישור פגישה חוזרת',
                voicemail_detected: false,
                sentiment_label: 'positive',
                analysis_at: '2026-09-01T08:42:52.000Z',
              },
            },
          ],
        },
      ],
    });

    const result = await getCallbackRequest('cb-1');

    expect(result?.salesCalls).toHaveLength(2);
    // Interleaved by time across BOTH personas — the confirmation call is the
    // newer one, so it leads.
    expect(result?.salesCalls.map((c) => c.source)).toEqual(['meeting_confirm', 'sales']);
    expect(result?.salesCalls[0]).toMatchObject({
      source: 'meeting_confirm',
      confirmationCallStatus: 'confirmed',
      hasAnalysis: true,
      callSuccessScore: 100,
      summaryTitle: 'אישור פגישה חוזרת',
      likelyVoicemail: false,
      // A confirmation call sends no signup link — false because it did not
      // happen, not because the persona's field was dropped.
      linkSent: false,
    });
    expect(result?.salesCalls[1]).toMatchObject({ source: 'sales', hasAnalysis: false });
  });

  // The analysis wins once it exists — the telephony verdict is the stand-in,
  // never a replacement for ElevenLabs' own account of why the call ended.
  it('prefers the analysis termination reason once it arrives', async () => {
    mockCallbackSalesClient({
      callbacks: detailRow({ id: 'cb-1' }),
      aiCalls: [{ id: 'cb-1', sales_call_attempts: ([
        {
          id: 'sales-1',
          callback_request_id: 'cb-1',
          dispatch_status: 'concluded',
          scheduled_at_snapshot: '2026-09-01T08:00:00.000Z',
          created_at: '2026-09-01T08:01:00.000Z',
          updated_at: '2026-09-01T08:02:00.000Z',
          vox_call_session_history_id: null,
          finish_reason: 'completed',
          call_duration_sec: 229,
          el_conversation_id: 'conv-sales-1',
          outcome_recorded_at: null,
          signup_completed_at: null,
          wa_message_id: null,
          wa_delivery_status: null,
          wa_status_at: null,
          wa_delivery_error_code: null,
        },
      ]).map((a) => ({ ...a, call_analysis: ([
        {
          conversation_id: 'conv-sales-1',
          agent_id: 'agent-sales',
          call_successful: 'success',
          status: 'done',
          el_call_score: 100,
          termination_reason: 'end_call tool was called.',
          call_duration_secs: 227,
          cost_credits: 2929,
          agent_turns: 12,
          user_turns: 9,
          el_eval: { terminal_outcome_recorded: 'success' },
          el_data: {},
          analysis_at: '2026-09-01T08:05:00.000Z',
        },
      ])[0] })) }],    });

    const result = await getCallbackRequest('cb-1');

    expect(result?.salesCalls[0]).toMatchObject({
      terminationReason: 'end_call tool was called.',
      callDurationSecs: 227,
      linkSent: false,
    });
  });
});

// Redesigned 2026-08-19/20: this used to be updateCallbackStatus, setting
// `status` to any of new/in_progress/done/cancelled. Cancelling is now the
// ONLY status transition an admin makes directly — see validation/admin.ts.
describe('cancelCallback', () => {
  it('enforces the admin gate and cancels the matching row', async () => {
    const { client, builder } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await cancelCallback('cb-1');

    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledWith('callback_requests');
    // `count: 'exact'` is what lets the terminal filter below be observed —
    // without it a refused UPDATE is indistinguishable from a successful one.
    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' }),
      { count: 'exact' },
    );
    expect(builder.eq).toHaveBeenCalledWith('id', 'cb-1');
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'callback.cancelled' }),
    );
  });

  it('does NOT cancel when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(cancelCallback('cb-1')).rejects.toThrow('NEXT_REDIRECT');
    expect(client.from).not.toHaveBeenCalled();
  });

  it('throws a safe error when the update fails', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: { message: 'nope' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(cancelCallback('cb-1')).rejects.toThrow('ביטול הבקשה נכשל');
  });

  // The request is already over — cancelling it again would rewrite history.
  // 'closed' is the dangerous one: it means the call HAPPENED (completed /
  // closed / no_contact after three no-answers), and cancelling would flip its
  // badge, archive its appointment as cancelled and log a cancellation.
  it.each([
    ['cancelled', 'already_cancelled'],
    ['closed', 'already_closed'],
  ])('refuses to cancel a %s request', async (status, reason) => {
    const { client, builder } = createMockSupabase<CallbackRequest>({
      data: row({ status }),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(cancelCallback('cb-1')).resolves.toEqual({ ok: false, reason });

    expect(builder.update).not.toHaveBeenCalled();
    expect(closeCallbackAppointment).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('reports a request that no longer exists rather than logging a cancellation', async () => {
    const { client, builder } = createMockSupabase<CallbackRequest>({
      data: null,
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(cancelCallback('cb-1')).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(builder.update).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
  });

  // Hiding the button is presentation; this filter is the actual guarantee.
  // Between the read and the write, a post-call webhook can close the request.
  it('repeats the terminal filter in the UPDATE itself', async () => {
    const { client, builder } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await cancelCallback('cb-1');

    expect(builder.not).toHaveBeenCalledWith('status', 'in', '(cancelled,closed)');
  });

  // Regression for a measured gap (2026-08-19): closing a request never used
  // to touch its calendar appointment at all, leaving it to sit there forever.
  // Redesigned 2026-08-20: the appointment is archived (never deleted) and
  // marked distinctly from a completed call — see closeCallbackAppointment.
  it('archives the calendar appointment as cancelled (not deleted)', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.mocked(closeCallbackAppointment).mockResolvedValue({ archived: true });

    await cancelCallback('cb-1');

    expect(closeCallbackAppointment).toHaveBeenCalledWith('cb-1', { reason: 'cancelled' });
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ calendarAppointmentArchived: true }),
      }),
    );
  });
});

// A fully separate dimension from `status` — what the owner recorded after
// making the call. See validation/admin.ts. Redesigned 2026-08-20: the actual
// state machine (archive, retry-vs-close, three-strikes no-contact) now lives
// in applyCallOutcome (callback-scheduling.ts) — updateCallOutcome is a thin
// gate-then-delegate wrapper, same split as rescheduleCallback below wrapping
// rescheduleCallbackRequest. Its own coverage (retry logic, the atomic claim,
// the SMS) lives in callback-scheduling.test.ts.
describe('updateCallOutcome', () => {
  it('enforces the admin gate and delegates to applyCallOutcome', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.mocked(applyCallOutcome).mockResolvedValue({ archived: true, requestClosed: false });

    await updateCallOutcome('cb-1', 'completed');

    expect(requirePlatformPermission).toHaveBeenCalledTimes(1);
    expect(applyCallOutcome).toHaveBeenCalledWith('cb-1', 'completed');
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'callback.outcome_updated',
        meta: expect.objectContaining({
          callbackRequestId: 'cb-1',
          callOutcome: 'completed',
          calendarAppointmentArchived: true,
          requestClosed: false,
        }),
      }),
    );
  });

  it('does NOT delegate when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );

    await expect(updateCallOutcome('cb-1', 'completed')).rejects.toThrow('NEXT_REDIRECT');
    expect(applyCallOutcome).not.toHaveBeenCalled();
  });

  it('throws a safe error when reading the current outcome fails, without delegating', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row(),
      error: { message: 'nope' },
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );

    await expect(updateCallOutcome('cb-1', 'completed')).rejects.toThrow(
      'עדכון תוצאת השיחה נכשל',
    );
    expect(applyCallOutcome).not.toHaveBeenCalled();
  });

  it('records the outcome BEFORE the change, from the row it read first', async () => {
    const { client } = createMockSupabase<CallbackRequest>({
      data: row({ call_outcome: 'no_answer' }),
      error: null,
    });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.mocked(applyCallOutcome).mockResolvedValue({ archived: true, requestClosed: true });

    await updateCallOutcome('cb-1', 'closed');

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ previousOutcome: 'no_answer', callOutcome: 'closed' }),
      }),
    );
  });
});

// Regression for the scenario raised 19.08: the caller answered and asked for
// a different time, or asked to be called again later. rescheduleCallback is
// the only path a browser request can reach rescheduleCallbackRequest through
// — that function lives in the REQUEST-FREE callback-scheduling.ts and
// carries no authorization of its own.
describe('rescheduleCallback', () => {
  const NEW_ISO = '2026-09-01T10:00:00.000Z';

  it('enforces the admin gate before delegating', async () => {
    vi.mocked(rescheduleCallbackRequest).mockResolvedValue({ ok: true });

    await rescheduleCallback('cb-1', NEW_ISO);

    expect(requirePlatformPermission).toHaveBeenCalledWith('view_customer_data');
    expect(rescheduleCallbackRequest).toHaveBeenCalledWith('cb-1', NEW_ISO);
  });

  it('does NOT reschedule when the admin gate redirects', async () => {
    vi.mocked(requirePlatformPermission).mockRejectedValueOnce(
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;' }),
    );

    await expect(rescheduleCallback('cb-1', NEW_ISO)).rejects.toThrow('NEXT_REDIRECT');
    expect(rescheduleCallbackRequest).not.toHaveBeenCalled();
  });

  it('logs the outcome either way', async () => {
    vi.mocked(rescheduleCallbackRequest).mockResolvedValue({
      ok: false,
      reason: 'old_appointment_not_removed',
    });

    await rescheduleCallback('cb-1', NEW_ISO);

    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'callback.rescheduled',
        meta: expect.objectContaining({
          callbackRequestId: 'cb-1',
          ok: false,
          reason: 'old_appointment_not_removed',
        }),
      }),
    );
  });

  it('returns the outcome from rescheduleCallbackRequest unchanged', async () => {
    vi.mocked(rescheduleCallbackRequest).mockResolvedValue({ ok: true });
    await expect(rescheduleCallback('cb-1', NEW_ISO)).resolves.toEqual({ ok: true });
  });
});
