import { describe, expect, it, vi } from 'vitest';

import { createMockSupabase } from '@/test/supabase-mock';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/data/console-calls', () => ({
  CONSOLE_DIAL_AUDIT_ACTION: 'console_call.dial_intent',
}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { DISPATCH_PRE_TERMINAL, recordSalesWaDeliveryStatus } from './sales-call-attempts';

// Mirrors call_attempts.PRE_TERMINAL and callback_request_attempts'
// DISPATCH_PRE_TERMINAL exactly — see sales_call_attempts_dispatch_status_valid
// (migration 20260822104725) for the CHECK constraint this must stay in sync
// with.
describe('DISPATCH_PRE_TERMINAL', () => {
  it('matches call_attempts.PRE_TERMINAL exactly', () => {
    expect(DISPATCH_PRE_TERMINAL).toEqual(['queued', 'dialing', 'in_progress']);
  });
});

// Regression for a MEASURED gap (2026-09-01): Meta delivered sent/delivered/
// read for the first sales signup link ever sent, the inbox stored and
// processed all three without error, and wa_status_at stayed NULL — nothing in
// the codebase wrote it. A processed-and-discarded report leaves no trace, so
// only a test that asserts the write itself catches this coming back.
describe('recordSalesWaDeliveryStatus', () => {
  function mockClient() {
    const { client, builder } = createMockSupabase<unknown>({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    return builder;
  }

  it('advances the attempt that owns the wamid, stamped with Meta’s own instant', async () => {
    const builder = mockClient();

    await recordSalesWaDeliveryStatus('wamid.ABC', 'read', null, '2026-08-31T22:24:53+00:00');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        wa_delivery_status: 'read',
        wa_delivery_error_code: null,
        // The event's instant, NOT now() — the screen must show when Meta says
        // it happened, not when we processed it.
        wa_status_at: '2026-08-31T22:24:53+00:00',
      }),
    );
    // Matched on the message id: the status carries no attempt id.
    expect(builder.eq).toHaveBeenCalledWith('wa_message_id', 'wamid.ABC');
  });

  it('keeps the provider error code on a failed delivery', async () => {
    const builder = mockClient();

    await recordSalesWaDeliveryStatus('wamid.ABC', 'failed', '131049', '2026-08-31T22:24:53+00:00');

    expect(builder.update).toHaveBeenCalledWith(
      expect.objectContaining({ wa_delivery_status: 'failed', wa_delivery_error_code: '131049' }),
    );
  });

  it('falls back to now() only when the report carries no timestamp', async () => {
    const builder = mockClient();

    await recordSalesWaDeliveryStatus('wamid.ABC', 'sent', null, null);

    const [update] = builder.update.mock.calls[0] as [{ wa_status_at: string }];
    expect(Number.isNaN(Date.parse(update.wa_status_at))).toBe(false);
  });

  // Most statuses are ordinary guest messages. Matching no sales attempt is the
  // common case and must never surface as an error to the webhook.
  it('never throws when the write fails', async () => {
    vi.mocked(createAdminClient).mockImplementationOnce(() => {
      throw new Error('db down');
    });

    await expect(
      recordSalesWaDeliveryStatus('wamid.ABC', 'sent', null, '2026-08-31T22:24:26+00:00'),
    ).resolves.toBeUndefined();
  });
});
