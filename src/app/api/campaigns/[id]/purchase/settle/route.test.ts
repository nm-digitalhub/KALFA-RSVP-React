import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/data/events', () => ({ requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/data/campaigns', () => ({ getCampaignForPurchase: vi.fn() }));
vi.mock('@/lib/payments/cardcom-settle', () => ({ settleCardcomSession: vi.fn() }));
vi.mock('@/lib/payments/activate-paid-package', () => ({ startPaidPackageNow: vi.fn() }));

import { requireUser } from '@/lib/auth/dal';
import { getCampaignForPurchase } from '@/lib/data/campaigns';
import { requireOwnedEvent } from '@/lib/data/events';
import { startPaidPackageNow } from '@/lib/payments/activate-paid-package';
import { settleCardcomSession } from '@/lib/payments/cardcom-settle';
import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

let fake: FakeTableClient;
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => fake.client }));

import { POST } from './route';

// The buyer's browser calls this right after the Open Fields form says it submitted (or errored). It does NOT report the
// outcome — the browser's word is worth nothing — it only asks the server to find out from CardCom, which
// settleCardcomSession does. Only the owner of the campaign can ask, and only about their own campaign's latest session.

const APP_ORIGIN = 'https://kalfa.test';
const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = { id: CAMPAIGN_ID, event_id: EVENT_ID, status: 'approved', package_price: 149 };

const call = (body: unknown = { submitted: true }, headers: Record<string, string> = { Origin: APP_ORIGIN }) =>
  POST(new Request(`${APP_ORIGIN}/api/campaigns/${CAMPAIGN_ID}/purchase/settle`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }) as unknown as NextRequest, {
    params: Promise.resolve({ id: CAMPAIGN_ID }),
  });

const op = (over: TableRow = {}): TableRow => ({ id: 'op1', campaign_id: CAMPAIGN_ID, kind: 'package_purchase', outcome: 'pending', recorded_at: '2026-10-07T10:00:00.000Z', meta: { provider: 'cardcom' }, ...over });
const sessionRow = (operation_id: string, low_profile_id: string): TableRow => ({ low_profile_id, operation_id });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_ORIGIN = APP_ORIGIN;
  vi.mocked(requireUser).mockResolvedValue({ id: 'u1' } as never);
  vi.mocked(getCampaignForPurchase).mockResolvedValue(CAMPAIGN as never);
  vi.mocked(requireOwnedEvent).mockResolvedValue({ id: EVENT_ID } as never);
  vi.mocked(startPaidPackageNow).mockResolvedValue('started');
  vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'settled', outcome: 'succeeded', alreadyDone: false });
  fake = createFakeTableClient({ payment_operations: [op()], cardcom_payment_sessions: [sessionRow('op1', 'lp-1')] });
});

describe('POST /api/campaigns/[id]/purchase/settle', () => {
  it('settles the campaign\'s latest CardCom session — found on the server — and starts the campaign when it was paid', async () => {
    const res = await call();
    expect(await res.json()).toEqual({ state: 'paid', activation: 'started' });
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: true, afterSubmit: true });
    expect(startPaidPackageNow).toHaveBeenCalledWith(CAMPAIGN_ID);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  // What CardCom's frames announced about 3D Secure when they reported an error: numbers and fixed labels, passed on to the settlement
  // as the browser's word. Anything else in it, and a report with no `submitted`, is dropped.
  it('passes on a 3D Secure report of an error — code, last step and the label of CardCom\'s sentence — with the submitted form', async () => {
    await call({ submitted: true, threeDs: { code: 333, step: 'fingerprint', reason: 'fail_auth' } });
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: true, afterSubmit: true, browserReport: { code: 333, step: 'fingerprint', reason: 'fail_auth' } });
  });

  it('passes on how the buyer was paying, alone or with the 3D Secure report, and ignores anything else', async () => {
    await call({ submitted: true, method: 'google_pay' });
    expect(vi.mocked(settleCardcomSession).mock.calls[0][1]).toEqual({ finalizeUnpaid: true, afterSubmit: true, browserReport: { method: 'google_pay' } });
    await call({ submitted: true, method: 'card', threeDs: { code: 333, reason: 'fail_auth' } });
    expect(vi.mocked(settleCardcomSession).mock.calls[1][1]).toEqual({ finalizeUnpaid: true, afterSubmit: true, browserReport: { method: 'card', code: 333, reason: 'fail_auth' } });
    await call({ submitted: true, method: 'apple_pay' });
    expect(vi.mocked(settleCardcomSession).mock.calls[2][1]).toEqual({ finalizeUnpaid: true, afterSubmit: true });
    await call({ method: 'card' });
    expect(vi.mocked(settleCardcomSession).mock.calls[3][1]).toEqual({ finalizeUnpaid: false });
  });

  it('passes on a report that has only some of its parts, and none when it is empty', async () => {
    await call({ submitted: true, threeDs: { code: 408 } });
    expect(vi.mocked(settleCardcomSession).mock.calls[0][1]).toEqual({ finalizeUnpaid: true, afterSubmit: true, browserReport: { code: 408 } });
    await call({ submitted: true, threeDs: {} });
    expect(vi.mocked(settleCardcomSession).mock.calls[1][1]).toEqual({ finalizeUnpaid: true, afterSubmit: true });
  });

  it('drops a report that is not numbers and fixed labels — free text, an unknown label, another type — and still honours `submitted`', async () => {
    await call({ submitted: true, threeDs: { code: 333, reason: 'a sentence CardCom wrote 4580-1234', step: 'fingerprint' } });
    expect(vi.mocked(settleCardcomSession).mock.calls[0][1]).toEqual({ finalizeUnpaid: true, afterSubmit: true });
    await call({ submitted: true, threeDs: 'fail_auth' });
    expect(vi.mocked(settleCardcomSession).mock.calls[1][1]).toEqual({ finalizeUnpaid: true, afterSubmit: true });
    await call({ submitted: true, threeDs: { code: '333' } });
    expect(vi.mocked(settleCardcomSession).mock.calls[2][1]).toEqual({ finalizeUnpaid: true, afterSubmit: true });
  });

  it('ignores a report that does not come with `submitted`: a returning buyer cannot write a note on a row', async () => {
    await call({ threeDs: { code: 333, reason: 'fail_auth' } });
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: false });
  });

  it('takes the NEWEST purchase of the campaign when there are several attempts', async () => {
    fake = createFakeTableClient({
      payment_operations: [op({ id: 'old', outcome: 'failed', recorded_at: '2026-10-07T09:00:00.000Z' }), op({ id: 'new', recorded_at: '2026-10-07T11:00:00.000Z' })],
      cardcom_payment_sessions: [sessionRow('old', 'lp-old'), sessionRow('new', 'lp-new')],
    });
    await call();
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-new', expect.anything());
  });

  it('does not close a young unpaid session unless the browser says the form was submitted', async () => {
    await call({});
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: false });
    await call({ submitted: 'yes' });
    expect(vi.mocked(settleCardcomSession).mock.calls[1][1]).toEqual({ finalizeUnpaid: false });
  });

  it('does not activate a campaign that is already running, or one that is not waiting for its payment', async () => {
    vi.mocked(getCampaignForPurchase).mockResolvedValue({ ...CAMPAIGN, status: 'active' } as never);
    expect(await (await call()).json()).toEqual({ state: 'paid', activation: 'not_needed' });
    expect(startPaidPackageNow).not.toHaveBeenCalled();
  });

  // The buyer returns from a redirect (3D Secure, a wallet) to a session CardCom already settled: the page asks with no body, the
  // session is already recorded as paid, and only this route can start the campaign.
  it('starts a campaign that still waits for its payment when a RETURNING buyer asks (no body, session already settled), and only once', async () => {
    vi.mocked(settleCardcomSession).mockResolvedValue({ status: 'settled', outcome: 'succeeded', alreadyDone: true });
    const body = '';
    expect(await (await call(body)).json()).toEqual({ state: 'paid', activation: 'started' });
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: false });
    expect(startPaidPackageNow).toHaveBeenCalledTimes(1);
    // The campaign is running now: a second ask (a reload, another tab) does not start it again.
    vi.mocked(getCampaignForPurchase).mockResolvedValue({ ...CAMPAIGN, status: 'active' } as never);
    expect(await (await call(body)).json()).toEqual({ state: 'paid', activation: 'not_needed' });
    expect(startPaidPackageNow).toHaveBeenCalledTimes(1);
  });

  it('passes on that the start was refused, so the page can say so', async () => {
    vi.mocked(startPaidPackageNow).mockResolvedValue('failed');
    expect(await (await call()).json()).toEqual({ state: 'paid', activation: 'failed' });
  });

  it.each([
    [{ status: 'settled', outcome: 'failed', alreadyDone: false }, 'declined'],
    [{ status: 'settled', outcome: 'review', alreadyDone: false }, 'review'],
    [{ status: 'unpaid' }, 'in_progress'],
    [{ status: 'not_found' }, 'none'],
    [{ status: 'error' }, 'error'],
  ])('maps %j to the state "%s", and never activates', async (outcome, state) => {
    vi.mocked(settleCardcomSession).mockResolvedValue(outcome as never);
    expect(await (await call()).json()).toEqual({ state });
    expect(startPaidPackageNow).not.toHaveBeenCalled();
  });

  it('answers "none" when the campaign has no CardCom session to settle', async () => {
    fake = createFakeTableClient({ payment_operations: [op({ meta: { provider: 'sumit' } })], cardcom_payment_sessions: [] });
    expect(await (await call()).json()).toEqual({ state: 'none' });
    expect(settleCardcomSession).not.toHaveBeenCalled();
    fake = createFakeTableClient({ payment_operations: [], cardcom_payment_sessions: [] });
    expect(await (await call()).json()).toEqual({ state: 'none' });
  });

  // A read that FAILED says nothing about the payment: it is an error, never "no payment", and CardCom is not asked on a guess.
  it.each([['payment_operations'], ['cardcom_payment_sessions']])('answers "error", never "none", when reading %s fails', async (table) => {
    fake.fail(table, 'XX000', 'select');
    expect(await (await call()).json()).toEqual({ state: 'error' });
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  it('never settles another campaign\'s session: only this campaign\'s purchases are looked at', async () => {
    fake = createFakeTableClient({ payment_operations: [op({ campaign_id: 'someone-elses' })], cardcom_payment_sessions: [sessionRow('op1', 'lp-1')] });
    expect(await (await call()).json()).toEqual({ state: 'none' });
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  it('refuses another origin, a missing session, and a campaign that is not the caller\'s', async () => {
    expect((await call({}, { Origin: 'https://evil.example' })).status).toBe(403);
    vi.mocked(requireUser).mockRejectedValue(new Error('NEXT_REDIRECT'));
    expect((await call()).status).toBe(401);
    vi.mocked(requireUser).mockResolvedValue({ id: 'u1' } as never);
    vi.mocked(requireOwnedEvent).mockRejectedValue(new Error('not yours'));
    expect((await call()).status).toBe(404);
    expect(settleCardcomSession).not.toHaveBeenCalled();
  });

  it('tolerates a body that is not JSON (it carries nothing that matters)', async () => {
    expect((await call('not json')).status).toBe(200);
    expect(settleCardcomSession).toHaveBeenCalledWith('lp-1', { finalizeUnpaid: false });
  });

  it('answers a generic error, never the thrown text', async () => {
    vi.mocked(settleCardcomSession).mockRejectedValue(new Error('postgres://user:secret@host'));
    const res = await call();
    expect(await res.json()).toEqual({ state: 'error' });
  });
});
