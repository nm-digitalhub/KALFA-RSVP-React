import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({
  getVoximplantConfig: vi.fn(),
  getVoximplantBalancePullConfig: vi.fn(),
  envAllowsLiveCalls: vi.fn(() => true),
}));
vi.mock('@/lib/voximplant/core', () => ({
  getAccountInfo: vi.fn(),
  getApplications: vi.fn(),
  getRules: vi.fn(),
}));

import { createMockSupabase } from '@/test/supabase-mock';
import { createClient } from '@/lib/supabase/server';
import { getVoximplantBalancePullConfig } from '@/lib/data/voximplant-config';
import { getApplications, getRules } from '@/lib/voximplant/core';
import {
  getVoximplantChannelConfig,
  listVoximplantRules,
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
  voximplant_low_balance_threshold: '',
  voximplant_min_call_reserve: '',
  voximplant_max_concurrent_calls: '',
  voximplant_max_calls_per_campaign_hour: '',
  voximplant_call_me_now_rule_id: '',
  voximplant_application_id: '',
};

beforeEach(() => vi.clearAllMocks());

describe('getVoximplantChannelConfig', () => {
  it('NEVER returns the service-account JSON — only its presence', async () => {
    mock({
      voximplant_service_account_json: '{"account_id":1,"key_id":"k","private_key":"pk"}',
      voximplant_rule_id: '1494311',
      voximplant_caller_id: '+972500000000',
      voximplant_callback_secret: 'sec',
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
    // Added 2026-09-14 — both columns had no admin surface at all before, so
    // they get the same '' => null contract as the three above, asserted here
    // rather than assumed.
    expect(payload.voximplant_call_me_now_rule_id).toBeNull();
    expect(payload.voximplant_application_id).toBeNull();
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

// The rule picker's data source. Added 2026-09-14 so four admin fields could
// offer the account's real rules instead of a free-text id — a wrong id there
// dials a different scenario without any error.
describe('listVoximplantRules', () => {
  const AUTH = { accountId: 1, keyId: 'k', privateKey: 'p' };

  it('reads the service account WITHOUT requiring a dial config', async () => {
    // getVoximplantConfig returns null until a rule id AND caller id are stored,
    // so using it here would hide the picker from exactly the operator who has
    // not picked a rule yet. This pins the looser dependency.
    vi.mocked(getVoximplantBalancePullConfig).mockResolvedValue({
      auth: AUTH,
      lowBalanceThreshold: 5,
      minCallReserve: 0.1,
    } as never);
    vi.mocked(getApplications).mockResolvedValue({
      result: [{ application_id: 11107202, application_name: 'kalfa-rsvp.example.com' }],
    } as never);
    vi.mocked(getRules).mockResolvedValue({
      result: [
        { rule_id: 1520915, rule_name: 'OutCallAgent', rule_pattern: '.*', scenarios: [{ scenario_id: 920395, scenario_name: 'RSVPAgent' }] },
      ],
    } as never);

    const res = await listVoximplantRules();
    expect(getVoximplantBalancePullConfig).toHaveBeenCalled();
    expect(res).toEqual({
      ok: true,
      rules: [
        {
          ruleId: '1520915',
          ruleName: 'OutCallAgent',
          applicationName: 'kalfa-rsvp.example.com',
          scenarios: ['RSVPAgent'],
        },
      ],
    });
  });

  it('sorts by rule name and keeps a rule bound to no scenario', async () => {
    vi.mocked(getVoximplantBalancePullConfig).mockResolvedValue({
      auth: AUTH, lowBalanceThreshold: 5, minCallReserve: 0.1,
    } as never);
    vi.mocked(getApplications).mockResolvedValue({
      result: [{ application_id: 1, application_name: 'app' }],
    } as never);
    vi.mocked(getRules).mockResolvedValue({
      result: [
        { rule_id: 2, rule_name: 'zeta', rule_pattern: '.*', scenarios: [] },
        { rule_id: 1, rule_name: 'alpha', rule_pattern: '.*', scenarios: [{ scenario_id: 9, scenario_name: 'S' }] },
      ],
    } as never);

    const res = await listVoximplantRules();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rules.map((r) => r.ruleName)).toEqual(['alpha', 'zeta']);
    // An unbound rule is a real rule and stays in the list — hiding it would
    // make the picker lie about what the account contains.
    expect(res.rules[1].scenarios).toEqual([]);
  });

  it('fails with a message instead of throwing when the account is not configured', async () => {
    vi.mocked(getVoximplantBalancePullConfig).mockResolvedValue(null as never);
    const res = await listVoximplantRules();
    expect(res.ok).toBe(false);
    expect(getApplications).not.toHaveBeenCalled();
  });

  it('never leaks provider detail when the API throws', async () => {
    vi.mocked(getVoximplantBalancePullConfig).mockResolvedValue({
      auth: AUTH, lowBalanceThreshold: 5, minCallReserve: 0.1,
    } as never);
    vi.mocked(getApplications).mockRejectedValue(
      new Error('401 Unauthorized: key_id 9f3c… rejected by api.voximplant.com'),
    );
    const res = await listVoximplantRules();
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.message).not.toMatch(/401|key_id|voximplant\.com/);
  });
});
