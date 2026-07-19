import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({
  getVoximplantConfig: vi.fn(),
  envAllowsLiveCalls: vi.fn(() => true),
}));
vi.mock('@/lib/voximplant/core', () => ({ getAccountInfo: vi.fn() }));
vi.mock('@/lib/voximplant/mutations', () => ({ setAccountCallbackUrl: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn(async (p: string) => `https://beta.kalfa.me${p}`) }));

import { createClient } from '@/lib/supabase/server';
import { requirePlatformPermission } from '@/lib/auth/dal';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getAccountInfo } from '@/lib/voximplant/core';
import { setAccountCallbackUrl } from '@/lib/voximplant/mutations';
import { sha256Hex } from '@/lib/security/token-compare';
import {
  rollbackVoximplantAccountCallback,
  wireVoximplantAccountCallback,
} from './voximplant-channel';

const cfg = { auth: { accountId: 1, keyId: 'k', privateKey: 'pk' } };

// A supabase double that records every .update() patch and can seed a select.
function supabaseDouble(selectData: Record<string, unknown> | null = null) {
  const updates: Array<Record<string, unknown>> = [];
  const builder: Record<string, unknown> = {};
  builder.update = vi.fn((patch: Record<string, unknown>) => {
    updates.push(patch);
    return builder;
  });
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => ({ data: selectData, error: null }));
  // update().eq() resolves to { error: null } when awaited.
  (builder as { then: unknown }).then = (onF: (v: unknown) => unknown) => onF({ error: null });
  const client = { from: vi.fn(() => builder) };
  return { client, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as unknown as User);
  vi.mocked(getVoximplantConfig).mockResolvedValue(cfg as never);
});

describe('wireVoximplantAccountCallback — persist-then-mutate + hash-only', () => {
  it('snapshots prev echo, persists pending BEFORE SetAccountInfo, stores only the hash, ends wired', async () => {
    const { client, updates } = supabaseDouble();
    vi.mocked(createClient).mockResolvedValue(client as never);
    // echo before (prev snapshot) then echo after (confirms).
    vi.mocked(getAccountInfo)
      .mockResolvedValueOnce({ result: { callback_url: 'https://old/url', callback_salt: 'olds' } } as never)
      .mockImplementation(async () => ({ result: { callback_url: 'PLACEHOLDER' } }) as never);
    vi.mocked(setAccountCallbackUrl).mockResolvedValue({ result: 1 } as never);

    const res = await wireVoximplantAccountCallback();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // The pending persist happened BEFORE the provider mutation.
    const pending = updates[0];
    expect(pending.voximplant_account_callback_state).toBe('pending');
    // Only the HASH is stored — never the raw token.
    expect(pending.voximplant_account_callback_token_hash).toBe(sha256Hex(res.rawToken));
    expect(JSON.stringify(updates)).not.toContain(res.rawToken);
    // prev snapshot captured from the first echo.
    expect(pending.voximplant_account_callback_prev).toEqual({
      callback_url: 'https://old/url',
      callback_salt: 'olds',
    });
    // SetAccountInfo was called with the URL containing the raw token.
    expect(vi.mocked(setAccountCallbackUrl).mock.calls[0][1]).toContain(res.rawToken);
    // Final state wired.
    expect(updates.at(-1)?.voximplant_account_callback_state).toBe('wired');
  });

  it('marks failed (token still stored) when SetAccountInfo throws', async () => {
    const { client, updates } = supabaseDouble();
    vi.mocked(createClient).mockResolvedValue(client as never);
    vi.mocked(getAccountInfo).mockResolvedValue({ result: {} } as never);
    vi.mocked(setAccountCallbackUrl).mockRejectedValue(new Error('vox down'));

    const res = await wireVoximplantAccountCallback();
    expect(res.ok).toBe(false);
    expect(updates.at(-1)?.voximplant_account_callback_state).toBe('failed');
  });

  it('refuses when the channel is unconfigured', async () => {
    vi.mocked(getVoximplantConfig).mockResolvedValue(null);
    const res = await wireVoximplantAccountCallback();
    expect(res.ok).toBe(false);
  });
});

describe('rollbackVoximplantAccountCallback — restores prev, never blank-resets', () => {
  it('restores the snapshotted url/salt and clears the hash (route goes dark)', async () => {
    const { client, updates } = supabaseDouble({
      voximplant_account_callback_prev: { callback_url: 'https://old/url', callback_salt: 'olds' },
    });
    vi.mocked(createClient).mockResolvedValue(client as never);
    vi.mocked(setAccountCallbackUrl).mockResolvedValue({ result: 1 } as never);

    const res = await rollbackVoximplantAccountCallback();
    expect(res.ok).toBe(true);
    // SetAccountInfo called with the PREVIOUS values (restore, not reset).
    expect(vi.mocked(setAccountCallbackUrl).mock.calls[0][1]).toBe('https://old/url');
    expect(vi.mocked(setAccountCallbackUrl).mock.calls[0][2]).toBe('olds');
    // Final: rolled_back + hash cleared.
    const last = updates.at(-1)!;
    expect(last.voximplant_account_callback_state).toBe('rolled_back');
    expect(last.voximplant_account_callback_token_hash).toBeNull();
  });
});
