import { beforeEach, describe, expect, it, vi } from 'vitest';

// `apply_discount_tier` (task 6.2): the route's own contract — identity from the token guard, the
// phone from the callback request (never the body), the decision in the agent-benefits module,
// and the two response shapes the VoxEngine mapper understands. A caller-sent price, value or
// package is REJECTED by the strict schema before anything runs.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/voximplant/agent-tool-guard', () => ({ guardSalesToolRequest: vi.fn() }));
vi.mock('@/lib/data/agent-benefits', () => ({ applyAgentDiscount: vi.fn() }));
vi.mock('@/lib/data/sales-call-attempts', () => ({ getSalesRequestForAttempt: vi.fn() }));

import { POST } from './route';
import { applyAgentDiscount } from '@/lib/data/agent-benefits';
import { getSalesRequestForAttempt } from '@/lib/data/sales-call-attempts';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';

const TOKEN = '0123456789abcdef0123456789abcdef';

function call(body: unknown) {
  const raw = JSON.stringify(body);
  vi.mocked(guardSalesToolRequest).mockResolvedValue({ ok: true, attemptId: 'attempt-1', raw });
  const req = new Request(`https://beta.kalfa.me/api/voximplant/sls/tool/discount/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw,
  });
  return POST(req, { params: Promise.resolve({ token: TOKEN }) });
}

const REQUEST_ROW = {
  callbackRequestId: 'cb-1',
  fullName: 'דנה כהן',
  phone: '0501234567',
  topic: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSalesRequestForAttempt).mockResolvedValue(REQUEST_ROW);
});

describe('sls tool discount POST', () => {
  it('passes the attempt identity and the NORMALIZED callback phone to the decision module', async () => {
    vi.mocked(applyAgentDiscount).mockResolvedValue({
      status: 'offer',
      offer: { id: 'o-1', title: 'הנחה' },
      options: [{ package_id: 'p-1', package_name: 'בסיס', list_price: 200, final_price: 190 }],
      expiresAt: '2030-01-01T00:00:00.000Z',
    });

    const res = await call({ objection_reason: 'יקר לי' });

    expect(res.status).toBe(200);
    expect(applyAgentDiscount).toHaveBeenCalledWith({
      callAttemptId: 'attempt-1',
      phoneE164: '+972501234567',
      objectionReason: 'יקר לי',
    });
    expect(await res.json()).toEqual({
      offer: { id: 'o-1', title: 'הנחה' },
      options: [{ package_id: 'p-1', package_name: 'בסיס', list_price: 200, final_price: 190 }],
      expires_at: '2030-01-01T00:00:00.000Z',
    });
  });

  it("no offer → the mapper's defined no-offer shape", async () => {
    vi.mocked(applyAgentDiscount).mockResolvedValue({ status: 'no_offer' });

    const res = await call({ objection_reason: 'יקר לי' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ offer: null, options: [] });
  });

  it('REJECTS a caller-sent price/value/package — the strict schema refuses unknown fields', async () => {
    const res = await call({ objection_reason: 'יקר לי', amount_or_pct: 50, package_id: 'p-1' });

    expect(res.status).toBe(400);
    expect(applyAgentDiscount).not.toHaveBeenCalled();
  });

  it('refuses a missing objection reason', async () => {
    const res = await call({});
    expect(res.status).toBe(400);
    expect(applyAgentDiscount).not.toHaveBeenCalled();
  });

  it('an unnormalizable callback phone answers no-offer, never a tool failure', async () => {
    vi.mocked(getSalesRequestForAttempt).mockResolvedValue({ ...REQUEST_ROW, phone: 'לא טלפון' });

    const res = await call({ objection_reason: 'יקר לי' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ offer: null, options: [] });
    expect(applyAgentDiscount).not.toHaveBeenCalled();
  });

  it('a module throw answers no-offer — a broken server never invents a discount', async () => {
    vi.mocked(applyAgentDiscount).mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await call({ objection_reason: 'יקר לי' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ offer: null, options: [] });
    errorSpy.mockRestore();
  });

  it('a failed guard answers its own status and runs nothing', async () => {
    vi.mocked(guardSalesToolRequest).mockResolvedValue({ ok: false, status: 429 });
    const req = new Request(`https://beta.kalfa.me/api/voximplant/sls/tool/discount/${TOKEN}`, {
      method: 'POST',
      body: '{}',
    });

    const res = await POST(req, { params: Promise.resolve({ token: TOKEN }) });

    expect(res.status).toBe(429);
    expect(getSalesRequestForAttempt).not.toHaveBeenCalled();
  });
});
