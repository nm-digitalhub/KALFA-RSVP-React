import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// Chainable admin-client stub: .select().eq().neq() for the row list read,
// .update().eq() for each write. Convention matches
// template-health-processing.test.ts / call-result-processing.test.ts.
let selectRows: Array<Record<string, unknown>> = [];
// whatsapp_template_settings joined to the mirror: the templates some step sends.
let watchedRows: Array<Record<string, unknown>> = [];
const updateCalls: Array<{ id: string; payload: Record<string, unknown> }> = [];

// whatsapp_message_templates (the Meta mirror): every call is recorded in
// order, so a test can assert "mark DELETED, then upsert".
const mirrorCalls: Array<{ op: string; args: unknown[] }> = [];
let mirrorMarkError: { code: string } | null = null;
let mirrorUpsertError: { code: string } | null = null;

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => table === 'whatsapp_message_templates' ? ({
      update: (payload: Record<string, unknown>) => ({
        not: (col: string, op: string, list: string) => ({
          or: async (filter: string) => {
            mirrorCalls.push({ op: 'mark_deleted', args: [payload, col, op, list, filter] });
            return { error: mirrorMarkError };
          },
        }),
      }),
      upsert: async (rows: unknown[], opts: unknown) => {
        mirrorCalls.push({ op: 'upsert', args: [rows, opts] });
        return { error: mirrorUpsertError };
      },
    }) : table === 'whatsapp_template_settings' ? ({
      select: async () => ({ data: watchedRows, error: null }),
    }) : ({
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

import { runTemplateHealthSync, toMirrorRow } from './template-health-sync';

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
  mirrorCalls.length = 0;
  watchedRows = [];
  mirrorMarkError = null;
  mirrorUpsertError = null;
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

  // Every template a step sends is watched — here an event-type variant with
  // no legacy row — against the category requested for THAT template.
  it('alerts on a genuine downgrade transition (was not, now is), naming its steps', async () => {
    watchedRows = [
      {
        whatsapp_template_id: 'meta-1',
        requested_category: 'UTILITY',
        whatsapp_message_templates: {
          name: 'invite',
          category: 'UTILITY',
          message_template_routes: [{ message_key: 'invite' }, { message_key: 'invite' }],
        },
      },
    ];
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
    expect(sendSlackAlert.mock.calls[0][0]).toMatchObject({
      level: 'error',
      fields: expect.objectContaining({ message_key: 'invite', requested: 'UTILITY', actual: 'MARKETING' }),
    });
  });

  it('does not re-alert a downgrade that was already stored', async () => {
    watchedRows = [
      {
        whatsapp_template_id: 'meta-1',
        requested_category: 'UTILITY',
        whatsapp_message_templates: { name: 'invite', category: 'MARKETING', message_template_routes: [] },
      },
    ];
    fetchTemplateHealth.mockResolvedValue([
      { id: 'meta-1', name: 'invite', language: 'he', category: 'MARKETING', status: 'APPROVED' },
    ]);
    const result = await runTemplateHealthSync();
    expect(result.newDowngrades).toBe(0);
    expect(sendSlackAlert).not.toHaveBeenCalled();
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

// The Meta mirror (whatsapp_message_templates): columns are Meta's keys.
const META_TEMPLATE = {
  id: '1080274718090675',
  name: 'kalfa_event_invite_v2',
  language: 'he',
  status: 'APPROVED',
  category: 'UTILITY',
  sub_category: 'CUSTOM',
  components: [{ type: 'BODY', text: 'שלום {{1}}' }],
  parameter_format: 'POSITIONAL',
  quality_score: { score: 'UNKNOWN', date: 1783261355 },
  rejected_reason: 'NONE',
  correct_category: 'UTILITY',
  previous_category: 'MARKETING',
  message_send_ttl_seconds: 3600,
  library_template_name: 'lib_x',
  disable_ios_autofill: false,
  is_primary_device_delivery_only: false,
};

describe('toMirrorRow', () => {
  it('copies every Meta key into the column of the same name', () => {
    expect(toMirrorRow(META_TEMPLATE, 'T')).toEqual({ ...META_TEMPLATE, synced_at: 'T' });
  });

  it('absent optional keys become null', () => {
    expect(toMirrorRow({ id: '1', name: 'n', language: 'he' }, 'T')).toMatchObject({
      status: null, components: null, quality_score: null, sub_category: null,
    });
  });

  it.each([
    ['a non-numeric id', { id: 'meta-1', name: 'n', language: 'he' }],
    ['an id that could escape the filter', { id: '1),(2', name: 'n', language: 'he' }],
    ['no name', { id: '1', name: '', language: 'he' }],
    ['no language', { id: '1', name: 'n', language: '' }],
  ])('refuses %s', (_label, t) => {
    expect(toMirrorRow(t, 'T')).toBeNull();
  });
});

describe('runTemplateHealthSync — Meta mirror', () => {
  const RECREATED = { ...META_TEMPLATE, id: '2222222222222222' }; // same name+language, new id

  it('marks templates Meta no longer returns as DELETED, THEN upserts by id', async () => {
    fetchTemplateHealth.mockResolvedValue([RECREATED, { ...META_TEMPLATE, id: '333', name: 'other' }]);
    const r = await runTemplateHealthSync();

    expect(mirrorCalls.map((c) => c.op)).toEqual(['mark_deleted', 'upsert']);
    const [payload, col, op, list, filter] = mirrorCalls[0].args;
    expect(payload).toMatchObject({ status: 'DELETED' });
    expect([col, op, list]).toEqual(['id', 'in', '(2222222222222222,333)']);
    expect(filter).toBe('status.is.null,status.neq.DELETED');
    const [rows, opts] = mirrorCalls[1].args as [Array<{ id: string }>, unknown];
    expect(rows.map((x) => x.id)).toEqual(['2222222222222222', '333']);
    expect(opts).toEqual({ onConflict: 'id' });
    expect(r.mirrored).toBe(2);
  });

  it('an empty or unusable list from Meta never marks anything DELETED', async () => {
    fetchTemplateHealth.mockResolvedValue([{ id: 'x', name: 'invite', language: 'he' }]);
    const r = await runTemplateHealthSync();
    expect(mirrorCalls).toEqual([]);
    expect(r.mirrored).toBe(0);
  });

  it('a failed DELETED mark alerts, skips the upsert, and the health sync still runs', async () => {
    mirrorMarkError = { code: '42501' };
    fetchTemplateHealth.mockResolvedValue([{ ...META_TEMPLATE, name: 'invite' }]);
    const r = await runTemplateHealthSync();
    expect(mirrorCalls.map((c) => c.op)).toEqual(['mark_deleted']);
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'שמירת תבניות WhatsApp מ-Meta נכשלה', detail: 'mark_deleted: 42501' }),
    );
    expect(r.mirrored).toBe(0);
    expect(updateCalls.map((c) => c.id)).toEqual(['row-1']); // message_templates health update
  });

  it('a failed upsert alerts and reports 0 mirrored', async () => {
    mirrorUpsertError = { code: '23505' };
    fetchTemplateHealth.mockResolvedValue([META_TEMPLATE]);
    const r = await runTemplateHealthSync();
    expect(sendSlackAlert).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'upsert: 23505' }),
    );
    expect(r.mirrored).toBe(0);
  });
});
