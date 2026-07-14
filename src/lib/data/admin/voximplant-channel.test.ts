import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({
  getVoximplantConfig: vi.fn(),
  getVoximplantLiveEnabled: vi.fn(() => false),
}));
vi.mock('@/lib/voximplant/core', () => ({ getAccountInfo: vi.fn() }));

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import {
  getVoximplantChannelConfig,
  updateVoximplantChannelConfig,
} from '@/lib/data/admin/voximplant-channel';

type Row = Record<string, unknown>;

function mock(row: Row | null) {
  const { client, builder } = createMockSupabase<Row>({
    data: row,
    error: null,
  });
  vi.mocked(createClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  return { client, builder };
}

const BLANK_INPUT = {
  voximplant_service_account_json: '',
  voximplant_rule_id: '',
  voximplant_caller_id: '',
  voximplant_callback_secret: '',
  voximplant_groq_api_key: '',
  voximplant_low_balance_threshold: '',
  voximplant_min_call_reserve: '',
  voximplant_max_concurrent_calls: '',
  voximplant_max_calls_per_campaign_hour: '',
};

beforeEach(() => vi.clearAllMocks());

describe('getVoximplantChannelConfig', () => {
  it('NEVER returns the service-account JSON — only its presence', async () => {
    mock({
      voximplant_service_account_json: '{"account_id":1,"key_id":"k","private_key":"pk"}',
      voximplant_rule_id: '1494311',
      voximplant_caller_id: '+972500000000',
      voximplant_callback_secret: 'sec',
      voximplant_groq_api_key: 'gk',
      voximplant_low_balance_threshold: 5,
      voximplant_min_call_reserve: 0.1,
      voximplant_max_concurrent_calls: 5,
      voximplant_max_calls_per_campaign_hour: 200,
    });
    const cfg = await getVoximplantChannelConfig();
    // The raw key must never appear on the returned object under any key.
    expect(JSON.stringify(cfg)).not.toContain('private_key');
    expect(
      (cfg as unknown as Record<string, unknown>)
        .voximplant_service_account_json,
    ).toBeUndefined();
    expect(cfg.serviceAccountConfigured).toBe(true);
    expect(cfg.configured).toBe(true);
  });

  it('reports configured=false when the SA-JSON is absent', async () => {
    mock({
      voximplant_rule_id: '1494311',
      voximplant_caller_id: '+972500000000',
    });
    const cfg = await getVoximplantChannelConfig();
    expect(cfg.serviceAccountConfigured).toBe(false);
    expect(cfg.configured).toBe(false);
  });

  it('handles a missing settings row', async () => {
    mock(null);
    const cfg = await getVoximplantChannelConfig();
    expect(cfg.serviceAccountConfigured).toBe(false);
    expect(cfg.configured).toBe(false);
    expect(cfg.voximplant_rule_id).toBe('');
  });
});

describe('updateVoximplantChannelConfig', () => {
  it('leaves the SA-JSON untouched on a blank submit and never writes outreach_enabled', async () => {
    const { builder } = mock(null);
    await updateVoximplantChannelConfig({ ...BLANK_INPUT });
    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // blank SA-JSON => omitted (keep existing)
    expect(payload).not.toHaveProperty('voximplant_service_account_json');
    // blank NOT NULL numeric cols => omitted
    expect(payload).not.toHaveProperty('voximplant_low_balance_threshold');
    expect(payload).not.toHaveProperty('voximplant_max_concurrent_calls');
    // never touches the shared master switch
    expect(payload).not.toHaveProperty('outreach_enabled');
    // nullable text cols cleared to null
    expect(payload.voximplant_rule_id).toBeNull();
    expect(payload.voximplant_callback_secret).toBeNull();
  });

  it('replaces the SA-JSON on a non-empty submit and parses numeric cols', async () => {
    const { builder } = mock(null);
    await updateVoximplantChannelConfig({
      ...BLANK_INPUT,
      voximplant_service_account_json: '  {"account_id":1}  ',
      voximplant_rule_id: '1494311',
      voximplant_low_balance_threshold: '5',
      voximplant_max_concurrent_calls: '7',
    });
    const payload = vi.mocked(builder.update).mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.voximplant_service_account_json).toBe('{"account_id":1}'); // trimmed
    expect(payload.voximplant_rule_id).toBe('1494311');
    expect(payload.voximplant_low_balance_threshold).toBe(5);
    expect(payload.voximplant_max_concurrent_calls).toBe(7);
    expect(payload).not.toHaveProperty('outreach_enabled');
  });
});
