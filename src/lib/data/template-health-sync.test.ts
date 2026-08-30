import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Chainable admin-client stub: .select().eq().neq() for the row list read,
// .update().eq() for each write. Convention matches
// template-health-processing.test.ts / call-result-processing.test.ts.
let selectRows: Array<Record<string, unknown>> = [];
const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          neq: async () => ({ data: selectRows, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          updateCalls.push({ id, payload });
          return { error: null };
        },
      }),
    }),
  }),
}));

const getWhatsAppConfig = vi.fn();
vi.mock('@/lib/data/outreach-config', () => ({
  getWhatsAppConfig: (...args: unknown[]) => getWhatsAppConfig(...args),
}));

const fetchTemplateHealth = vi.fn();
vi.mock('@/lib/whatsapp/template-health', async () => {
  const actual = await vi.importActual<typeof import('@/lib/whatsapp/template-health')>(
    '@/lib/whatsapp/template-health',
  );
  return {
    ...actual,
    fetchTemplateHealth: (...args: unknown[]) => fetchTemplateHealth(...args),
  };
});

const sendSlackAlert = vi.fn(async (..._args: unknown[]) => null as string | null);
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: (...args: unknown[]) => sendSlackAlert(...args) }));

import { runTemplateHealthSync } from './template-health-sync';

const ROW = {
  id: 'row-1',
  name: 'invite',
  language: 'he',
  requested_category: 'UTILITY',
  category: 'UTILITY',
  message_key: 'invite',
};

beforeEach(() => {
  vi.clearAllMocks();
  selectRows = [ROW];
  updateCalls.length = 0;
  getWhatsAppConfig.mockResolvedValue({ wabaId: 'waba-1', accessToken: 't1' });
});

describe('runTemplateHealthSync', () => {
  // Live-verified 2026-08-27: Meta's GET .../message_templates returns
  // quality_score as a NESTED OBJECT ({ score, date }), not the plain string
  // the field name suggests — only `.score` may reach the DB.
  it('stores only quality_score.score, never the raw Meta object', async () => {
    fetchTemplateHealth.mockResolvedValue([
      {
        id: 'meta-1',
        name: 'invite',
        language: 'he',
        category: 'UTILITY',
        quality_score: { score: 'UNKNOWN', date: 1783261355 },
        rejected_reason: 'NONE',
        status: 'APPROVED',
      },
    ]);

    const result = await runTemplateHealthSync();

    expect(result).toMatchObject({ synced: 1, skipped: 0, newDowngrades: 0 });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.quality_score).toBe('UNKNOWN');
  });

  it('stores null when Meta omits quality_score entirely', async () => {
    fetchTemplateHealth.mockResolvedValue([
      {
        id: 'meta-1',
        name: 'invite',
        language: 'he',
        category: 'UTILITY',
        status: 'APPROVED',
      },
    ]);

    await runTemplateHealthSync();

    expect(updateCalls[0].payload.quality_score).toBeNull();
  });

  it('no-ops (skipped) when no Meta template matches name+language', async () => {
    fetchTemplateHealth.mockResolvedValue([
      { id: 'meta-1', name: 'unrelated_template', language: 'pt-BR' },
    ]);

    const result = await runTemplateHealthSync();

    expect(result).toMatchObject({ synced: 0, skipped: 1, newDowngrades: 0 });
    expect(updateCalls).toHaveLength(0);
  });

  it('alerts on a genuine downgrade transition (was not, now is)', async () => {
    fetchTemplateHealth.mockResolvedValue([
      {
        id: 'meta-1',
        name: 'invite',
        language: 'he',
        category: 'MARKETING',
        quality_score: { score: 'GREEN' },
        status: 'APPROVED',
      },
    ]);

    const result = await runTemplateHealthSync();

    expect(result.newDowngrades).toBe(1);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'error' });
  });

  it('returns zeroed counts and alerts (warn) when the Meta fetch itself fails', async () => {
    fetchTemplateHealth.mockRejectedValue(new Error('network'));

    const result = await runTemplateHealthSync();

    expect(result).toMatchObject({ synced: 0, skipped: 1, newDowngrades: 0 });
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({ level: 'warn' });
  });

  it('no-ops entirely when outreach has no WABA configured', async () => {
    getWhatsAppConfig.mockResolvedValue(null);

    const result = await runTemplateHealthSync();

    expect(result).toMatchObject({ synced: 0, skipped: 0, newDowngrades: 0 });
    expect(fetchTemplateHealth).not.toHaveBeenCalled();
  });
});
