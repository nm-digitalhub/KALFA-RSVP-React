import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// One admin client double for both halves of the path: submit_rsvp's RPC
// (src/lib/data/rsvp.ts) and the webhook_inbox update that records the failure.
const rpc = vi.fn();
const updates: Array<Record<string, unknown>> = [];
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({
      update: (values: Record<string, unknown>) => {
        updates.push(values);
        return { eq: async () => ({ error: null }) };
      },
    }),
  }),
}));
vi.mock('@/lib/queue/web-sender', () => ({ getWebJobSender: vi.fn() }));

import { submitRsvp } from './rsvp';
import { recordWebhookEventFailure } from './webhooks';

// A worker path that writes an RSVP (a WhatsApp button, a call result) and fails
// in submit_rsvp: the row's last_error and the worker log carry the Supabase
// cause behind the data layer's Hebrew message — never the token or the answers.
const TOKEN = 'rsvp-token-secret-abc123';
const ANSWERS = { status: 'attending' as const, headcount: 3, meal_pref: 'צמחוני', note: 'הערה פרטית של האורח' };
const ROW = { id: 'row-1', attempts: 0 };

async function failingSubmit(error: Record<string, unknown>): Promise<unknown> {
  rpc.mockResolvedValueOnce({ data: null, error });
  try {
    await submitRsvp(TOKEN, ANSWERS);
  } catch (thrown) {
    return thrown;
  }
  throw new Error('submitRsvp was expected to throw');
}

let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  log = vi.spyOn(console, 'error').mockImplementation(() => {});
});

function expectNoGuestData(text: string) {
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(ANSWERS.note);
  expect(text).not.toContain(ANSWERS.meal_pref);
}

describe('recordWebhookEventFailure — an RSVP write that failed in the worker', () => {
  it('a database error: last_error and the log line carry its code and its own message', async () => {
    const thrown = await failingSubmit({
      code: '57014',
      message: 'canceling statement due to statement timeout',
      // PostgREST's details can quote values — errorDetail never reads them.
      details: `Key (rsvp_token)=(${TOKEN})`,
      hint: null,
    });

    await recordWebhookEventFailure(ROW, thrown);

    const expected = 'שליחת אישור ההגעה נכשלה — [57014] canceling statement due to statement timeout';
    expect(updates).toEqual([{ attempts: 1, last_error: expected }]);
    const line = String(log.mock.calls[0][0]);
    expect(line).toBe(`[webhook] row row-1 failed (attempt 1): ${expected}`);
    expectNoGuestData(line);
    expectNoGuestData(String(updates[0].last_error));
  });

  it('a connection failure (supabase-js reports it with an empty code): no code, the original message kept', async () => {
    const thrown = await failingSubmit({ code: '', message: 'TypeError: fetch failed', details: '', hint: '' });

    await recordWebhookEventFailure(ROW, thrown);

    // No "[code]" after the dash: there is no database code to show.
    const expected = 'שליחת אישור ההגעה נכשלה — TypeError: fetch failed';
    expect(updates).toEqual([{ attempts: 1, last_error: expected }]);
    const line = String(log.mock.calls[0][0]);
    expect(line).toBe(`[webhook] row row-1 failed (attempt 1): ${expected}`);
    expectNoGuestData(line);
  });
});
