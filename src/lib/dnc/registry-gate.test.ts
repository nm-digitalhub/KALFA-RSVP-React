import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const gateEnabled = vi.fn<() => Promise<boolean>>();
vi.mock('@/lib/data/call-compliance-settings', () => ({ dncRegistryGateEnabled: () => gateEnabled() }));

const checkRegistry = vi.fn();
vi.mock('./registry-check', () => ({ checkRegistry: (phone: string) => checkRegistry(phone) }));

import type { createAdminClient } from '@/lib/supabase/admin';

import { evaluateRegistryGate } from './registry-gate';

const PHONE = '+972501234567';
const insert = vi.fn<(row: Record<string, unknown>) => Promise<{ error: unknown }>>();
const admin = { from: vi.fn(() => ({ insert })) } as unknown as ReturnType<typeof createAdminClient>;

const check = (result: string, extra: Record<string, unknown> = {}) => ({
  result,
  source: result === 'local_blocked' ? 'local_list' : 'national_registry',
  checkedAt: '2026-10-11T10:00:00.000Z',
  transactionId: null,
  errorCode: null,
  failure: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  gateEnabled.mockResolvedValue(true);
  insert.mockResolvedValue({ error: null });
});

describe('evaluateRegistryGate', () => {
  it('a call that is not marketing is never checked and nothing is recorded', async () => {
    expect(await evaluateRegistryGate(admin, PHONE, 'not_applicable', { dialPath: 'x' })).toEqual({ ok: true });
    expect(checkRegistry).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('while the switch is off, nothing is checked or recorded', async () => {
    gateEnabled.mockResolvedValue(false);
    expect(await evaluateRegistryGate(admin, PHONE, 'required', { dialPath: 'x' })).toEqual({ ok: true });
    expect(checkRegistry).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it.each(['person_request', 'missed_call'])('a request with origin %s is exempt, and the exemption is recorded', async (origin) => {
    const r = await evaluateRegistryGate(admin, PHONE, 'exempt_if_requested', {
      dialPath: 'sales_call',
      exemption: { origin, ref: 'callback_requests:r1' },
    });
    expect(r).toEqual({ ok: true });
    expect(checkRegistry).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ phone_e164: PHONE, result: 'exempt', exemption_ref: 'callback_requests:r1', dial_path: 'sales_call' }),
    );
  });

  it.each(['workflow', 'staff', 'unknown', null])('a request with origin %s is not exempt: it is checked', async (origin) => {
    checkRegistry.mockResolvedValue(check('registry_clear'));
    await evaluateRegistryGate(admin, PHONE, 'exempt_if_requested', {
      dialPath: 'sales_call',
      exemption: { origin, ref: 'callback_requests:r1' },
    });
    expect(checkRegistry).toHaveBeenCalledWith(PHONE);
  });

  it.each([
    ['registry_clear', { ok: true }],
    ['not_covered', { ok: true }],
    ['local_blocked', { ok: false, reason: 'dnc' }],
    ['registry_listed', { ok: false, reason: 'registry_listed' }],
    ['registry_unchecked', { ok: false, reason: 'registry_unchecked' }],
    ['registry_unavailable', { ok: false, reason: 'registry_pending' }],
  ])('a check returning %s → %o, and the check is recorded', async (result, expected) => {
    checkRegistry.mockResolvedValue(check(result, { transactionId: 'fc39330c-7cb2-4a02-bfbe-d9f0a2f9b2d9' }));
    expect(await evaluateRegistryGate(admin, PHONE, 'required', { dialPath: 'meeting_confirm', jobId: 'j1' })).toEqual(
      expected,
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        phone_e164: PHONE,
        result,
        purpose: 'marketing',
        dial_path: 'meeting_confirm',
        transaction_id: 'fc39330c-7cb2-4a02-bfbe-d9f0a2f9b2d9',
        job_id: 'j1',
      }),
    );
  });

  it('a clean check that could not be recorded holds the dial back (it waits)', async () => {
    checkRegistry.mockResolvedValue(check('registry_clear'));
    insert.mockResolvedValue({ error: { code: '42501' } });
    expect(await evaluateRegistryGate(admin, PHONE, 'required', { dialPath: 'x' })).toEqual({
      ok: false,
      reason: 'registry_pending',
    });
  });

  it('an exemption that could not be recorded holds the dial back too', async () => {
    insert.mockRejectedValue(new Error('down'));
    expect(
      await evaluateRegistryGate(admin, PHONE, 'exempt_if_requested', {
        dialPath: 'x',
        exemption: { origin: 'person_request', ref: 'r' },
      }),
    ).toEqual({ ok: false, reason: 'registry_pending' });
  });
});
