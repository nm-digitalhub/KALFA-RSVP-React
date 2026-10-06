// The proactive-report data layer: owner-only on every export, a schedule that is
// never deleted or moved (only disabled / re-enabled / added), and nothing but ids and
// codes out of the run table.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));

import { requirePlatformOwner } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { OWNER_AGENT_REPORT_ERRORS as E } from '@/lib/validation/owner-agent-reports';

import {
  OWNER_AGENT_REPORT_RUN_COLUMNS,
  getOwnerAgentReportSettings,
  listOwnerAgentReportRuns,
  listOwnerAgentReportSchedules,
  setOwnerAgentCustomReportTemplate,
  setOwnerAgentReportSchedule,
  setOwnerAgentReportTemplate,
  setOwnerAgentReportsEnabled,
} from './owner-agent-reports';

// Real v4 UUIDs — Zod 4's z.uuid() rejects placeholder shapes.
const OWNER_ID = '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f';
const ENTRY_ID = '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a';
const OTHER_ENTRY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function db(tables: Record<string, TableRow[]>): FakeTableClient {
  const fake = createFakeTableClient(tables);
  vi.mocked(createClient).mockResolvedValue(fake.client as never);
  vi.mocked(createAdminClient).mockReturnValue(fake.client as never);
  return fake;
}

const sub = (id: string, slot: string, enabled: boolean, entry = ENTRY_ID): TableRow => ({
  id,
  allowlist_entry_id: entry,
  report_key: 'daily_business',
  slot_time: `${slot}:00`,
  timezone: 'Asia/Jerusalem',
  enabled,
  instructions: null,
});

// Times without instructions, in the DAL's input shape.
const sl = (...times: string[]) => times.map((time) => ({ time, instructions: '' }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformOwner).mockResolvedValue({ id: OWNER_ID } as User);
  vi.mocked(logActivity).mockResolvedValue(undefined);
});

describe('the owner gate', () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ['getOwnerAgentReportSettings', () => getOwnerAgentReportSettings()],
    ['listOwnerAgentReportSchedules', () => listOwnerAgentReportSchedules()],
    ['listOwnerAgentReportRuns', () => listOwnerAgentReportRuns()],
    ['setOwnerAgentReportsEnabled', () => setOwnerAgentReportsEnabled(true)],
    ['setOwnerAgentReportTemplate', () => setOwnerAgentReportTemplate({ templateName: 'x', templateLang: '' })],
    ['setOwnerAgentCustomReportTemplate', () => setOwnerAgentCustomReportTemplate({ templateName: 'x', templateLang: '' })],
    ['setOwnerAgentReportSchedule', () => setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: true, slots: sl('08:00') })],
  ];
  for (const [name, call] of calls) {
    it(`${name} refuses a non-owner before any query`, async () => {
      vi.mocked(requirePlatformOwner).mockRejectedValue(new Error('NEXT_REDIRECT'));
      const fake = db({});
      await expect(call()).rejects.toThrow('NEXT_REDIRECT');
      expect(fake.ops).toEqual([]);
      expect(logActivity).not.toHaveBeenCalled();
    });
  }
});

describe('reads', () => {
  it('settings: the switch and both templates', async () => {
    db({
      app_settings: [
        {
          id: true,
          owner_agent_reports_enabled: true,
          owner_agent_report_template_name: 'owner_activity_report',
          owner_agent_report_template_lang: 'he',
          owner_agent_custom_report_template_name: 'owner_custom_report',
          owner_agent_custom_report_template_lang: null,
        },
      ],
    });
    expect(await getOwnerAgentReportSettings()).toEqual({
      reportsEnabled: true,
      templateName: 'owner_activity_report',
      templateLang: 'he',
      customTemplateName: 'owner_custom_report',
      customTemplateLang: null,
    });
  });

  it('schedules: every row, enabled slots only, and whether it was ever configured', async () => {
    db({
      owner_agent_allowlist: [
        { id: ENTRY_ID, report_opt_in: true, created_at: '2026-09-24T00:00:00Z' },
        { id: OTHER_ENTRY, report_opt_in: false, created_at: '2026-09-25T00:00:00Z' },
      ],
      owner_agent_report_subscription: [sub('s1', '08:00', true), sub('s2', '00:00', true), sub('s3', '12:00', false)],
    });
    expect(await listOwnerAgentReportSchedules()).toEqual([
      {
        entryId: ENTRY_ID,
        optIn: true,
        slots: [
          { time: '00:00', instructions: null },
          { time: '08:00', instructions: null },
        ],
        configured: true,
      },
      { entryId: OTHER_ENTRY, optIn: false, slots: [], configured: false },
    ]);
  });

  it('runs: ids and codes only, mapped to their allow-list row', async () => {
    const fake = db({
      owner_agent_report_run: [
        { id: 'r1', subscription_id: 's1', local_date: '2026-09-28', slot_time: '08:00:00', status: 'sent', channel: 'text', error_code: null, claimed_at: '2026-09-28T05:00:10Z', sent_at: '2026-09-28T05:00:20Z', outbound_wamid: 'wamid.SECRET' },
      ],
      owner_agent_report_subscription: [sub('s1', '08:00', true)],
    });
    expect(await listOwnerAgentReportRuns()).toEqual([
      {
        id: 'r1',
        entryId: ENTRY_ID,
        localDate: '2026-09-28',
        slotTime: '08:00',
        status: 'sent',
        channel: 'text',
        errorCode: null,
        claimedAt: '2026-09-28T05:00:10Z',
        sentAt: '2026-09-28T05:00:20Z',
      },
    ]);
    expect(fake.ops.find((o) => o.table === 'owner_agent_report_run')?.columns).toBe(OWNER_AGENT_REPORT_RUN_COLUMNS);
    expect(OWNER_AGENT_REPORT_RUN_COLUMNS).not.toContain('*');
    expect(OWNER_AGENT_REPORT_RUN_COLUMNS).not.toContain('wamid');
  });

  it('a failed read throws the owner-facing message', async () => {
    const fake = db({ app_settings: [] });
    fake.fail('app_settings', '08006');
    await expect(getOwnerAgentReportSettings()).rejects.toThrow(E.readFailed);
  });
});

describe('setOwnerAgentReportSchedule', () => {
  it('adds new slots, disables removed ones, re-enables returning ones — never deletes, never moves', async () => {
    const fake = db({
      owner_agent_allowlist: [{ id: ENTRY_ID, report_opt_in: false }],
      owner_agent_report_subscription: [
        sub('s08', '08:00', true), // kept
        sub('s12', '12:00', true), // removed → disabled
        sub('s00', '00:00', false), // returns → re-enabled
        sub('other', '20:00', true, OTHER_ENTRY), // another row: untouched
      ],
    });
    await setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: true, slots: sl('08:00', '00:00', '18:00') });

    const rows = fake.tables.owner_agent_report_subscription;
    const byId = (id: string) => rows.find((r) => r.id === id);
    expect(byId('s08')).toMatchObject({ enabled: true, slot_time: '08:00:00' });
    expect(byId('s12')).toMatchObject({ enabled: false, slot_time: '12:00:00' });
    expect(byId('s00')).toMatchObject({ enabled: true, slot_time: '00:00:00' });
    expect(byId('other')).toMatchObject({ enabled: true });
    expect(rows.filter((r) => r.slot_time === '18:00:00')).toEqual([
      expect.objectContaining({
        allowlist_entry_id: ENTRY_ID,
        report_key: 'daily_business',
        timezone: 'Asia/Jerusalem',
        enabled: true,
        created_by: OWNER_ID,
      }),
    ]);
    expect(rows).toHaveLength(5);
    expect(fake.tables.owner_agent_allowlist[0].report_opt_in).toBe(true);

    expect(fake.ops.some((o) => o.op === 'delete')).toBe(false);
    // Never moved: no update writes slot_time.
    for (const op of fake.ops.filter((o) => o.op === 'update' && o.table === 'owner_agent_report_subscription')) {
      expect(Object.keys(op.patch ?? {})).not.toContain('slot_time');
    }
  });

  it('logs ids, the opt-in and the slots — nothing else', async () => {
    db({ owner_agent_allowlist: [{ id: ENTRY_ID, report_opt_in: false }], owner_agent_report_subscription: [] });
    await setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: true, slots: sl('08:00', '00:00') });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.owner_agent.report_schedule_set',
      meta: { entryId: ENTRY_ID, optIn: true, slots: ['00:00', '08:00'], withInstructions: [] },
    });
  });

  it('opting out leaves the slots as they are — the opt-in alone stops the reports', async () => {
    const fake = db({
      owner_agent_allowlist: [{ id: ENTRY_ID, report_opt_in: true }],
      owner_agent_report_subscription: [sub('s08', '08:00', true)],
    });
    await setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: false, slots: sl('08:00') });
    expect(fake.tables.owner_agent_allowlist[0].report_opt_in).toBe(false);
    expect(fake.tables.owner_agent_report_subscription[0].enabled).toBe(true);
  });

  it('accepts any whole-minute time (no fixed menu)', async () => {
    const fake = db({ owner_agent_allowlist: [{ id: ENTRY_ID, report_opt_in: false }], owner_agent_report_subscription: [] });
    await setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: true, slots: sl('07:45', '23:59', '00:01') });
    expect(fake.tables.owner_agent_report_subscription.map((r) => r.slot_time).sort()).toEqual([
      '00:01:00',
      '07:45:00',
      '23:59:00',
    ]);
  });

  it('refuses a malformed time, more than 24, a duplicate, and opt-in with none', async () => {
    db({ owner_agent_allowlist: [{ id: ENTRY_ID, report_opt_in: false }] });
    const many = Array.from({ length: 25 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
    for (const times of [['8:30'], ['24:00'], ['08:00:30'], many, ['08:00', '08:00'], []]) {
      await expect(setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: true, slots: sl(...times) })).rejects.toThrow();
    }
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('24 times is the limit, and allowed', async () => {
    db({ owner_agent_allowlist: [{ id: ENTRY_ID, report_opt_in: false }], owner_agent_report_subscription: [] });
    const all = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:15`);
    await expect(setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: true, slots: sl(...all) })).resolves.toBeUndefined();
  });

  it('stores, changes and clears instructions per time; the activity row names times, never the text', async () => {
    const fake = db({
      owner_agent_allowlist: [{ id: ENTRY_ID, report_opt_in: true }],
      owner_agent_report_subscription: [{ ...sub('s08', '08:00', true), instructions: 'ישן' }, sub('s00', '00:00', true)],
    });
    await setOwnerAgentReportSchedule({
      entryId: ENTRY_ID,
      optIn: true,
      slots: [
        { time: '08:00', instructions: '   ' }, // cleared
        { time: '00:00', instructions: '  רק הכנסות  ' }, // set, trimmed
        { time: '12:30', instructions: 'סיכום צהריים' }, // new row
      ],
    });
    const byTime = (t: string) => fake.tables.owner_agent_report_subscription.find((r) => r.slot_time === `${t}:00`);
    expect(byTime('08:00')?.instructions).toBeNull();
    expect(byTime('00:00')?.instructions).toBe('רק הכנסות');
    expect(byTime('12:30')).toMatchObject({ instructions: 'סיכום צהריים', enabled: true });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.owner_agent.report_schedule_set',
      meta: { entryId: ENTRY_ID, optIn: true, slots: ['00:00', '08:00', '12:30'], withInstructions: ['00:00', '12:30'] },
    });
    expect(JSON.stringify(vi.mocked(logActivity).mock.calls)).not.toContain('הכנסות');
  });

  it('refuses instructions longer than 2000 characters', async () => {
    db({ owner_agent_allowlist: [{ id: ENTRY_ID, report_opt_in: false }] });
    await expect(
      setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: true, slots: [{ time: '08:00', instructions: 'א'.repeat(2001) }] }),
    ).rejects.toThrow();
  });

  it('an unchanged kept slot is not written at all', async () => {
    const fake = db({
      owner_agent_allowlist: [{ id: ENTRY_ID, report_opt_in: true }],
      owner_agent_report_subscription: [sub('s08', '08:00', true)],
    });
    await setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: true, slots: sl('08:00') });
    expect(fake.ops.filter((o) => o.op === 'update' && o.table === 'owner_agent_report_subscription')).toEqual([]);
  });

  it('an unknown row is entryNotFound, with no subscription written', async () => {
    const fake = db({ owner_agent_allowlist: [], owner_agent_report_subscription: [] });
    await expect(setOwnerAgentReportSchedule({ entryId: ENTRY_ID, optIn: true, slots: sl('08:00') })).rejects.toThrow(
      E.entryNotFound,
    );
    expect(fake.tables.owner_agent_report_subscription).toEqual([]);
  });
});

describe('app_settings writes', () => {
  it('the switch, logged as a boolean', async () => {
    const fake = db({ app_settings: [{ id: true, owner_agent_reports_enabled: false }] });
    await setOwnerAgentReportsEnabled(true);
    expect(fake.tables.app_settings[0].owner_agent_reports_enabled).toBe(true);
    expect(logActivity).toHaveBeenCalledWith({ action: 'admin.owner_agent.reports_enabled_set', meta: { enabled: true } });
  });

  it('the template: blank clears it; a malformed name is refused before any write', async () => {
    const fake = db({
      app_settings: [{ id: true, owner_agent_report_template_name: 'old_v1', owner_agent_report_template_lang: 'he' }],
    });
    await setOwnerAgentReportTemplate({ templateName: '  ', templateLang: '' });
    expect(fake.tables.app_settings[0]).toMatchObject({
      owner_agent_report_template_name: null,
      owner_agent_report_template_lang: null,
    });
    await expect(setOwnerAgentReportTemplate({ templateName: 'Bad Name', templateLang: 'he' })).rejects.toThrow();
    await expect(setOwnerAgentReportTemplate({ templateName: 'ok_v1', templateLang: 'hebrew' })).rejects.toThrow();
  });

  it('the custom template: its own columns only, logged as name and language', async () => {
    const fake = db({
      app_settings: [
        {
          id: true,
          owner_agent_report_template_name: 'owner_activity_report',
          owner_agent_report_template_lang: 'he',
          owner_agent_custom_report_template_name: null,
          owner_agent_custom_report_template_lang: null,
        },
      ],
    });
    await setOwnerAgentCustomReportTemplate({ templateName: ' owner_custom_report ', templateLang: 'he' });
    expect(fake.tables.app_settings[0]).toMatchObject({
      owner_agent_report_template_name: 'owner_activity_report',
      owner_agent_report_template_lang: 'he',
      owner_agent_custom_report_template_name: 'owner_custom_report',
      owner_agent_custom_report_template_lang: 'he',
    });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.owner_agent.custom_report_template_set',
      meta: { templateName: 'owner_custom_report', templateLang: 'he' },
    });
    await setOwnerAgentCustomReportTemplate({ templateName: '', templateLang: '' });
    expect(fake.tables.app_settings[0]).toMatchObject({
      owner_agent_custom_report_template_name: null,
      owner_agent_custom_report_template_lang: null,
    });
  });

  it('both template names mirror the DB CHECK: ^[a-z0-9_]+$ and at most 512 characters', async () => {
    db({ app_settings: [{ id: true }] });
    for (const set of [setOwnerAgentReportTemplate, setOwnerAgentCustomReportTemplate]) {
      await expect(set({ templateName: 'a'.repeat(512), templateLang: 'he' })).resolves.toBeUndefined();
      await expect(set({ templateName: 'a'.repeat(513), templateLang: 'he' })).rejects.toThrow();
      await expect(set({ templateName: 'Owner_Report', templateLang: 'he' })).rejects.toThrow();
      await expect(set({ templateName: 'owner-report', templateLang: 'he' })).rejects.toThrow();
      await expect(set({ templateName: 'owner_report', templateLang: 'en_us' })).rejects.toThrow();
      await expect(set({ templateName: 'owner_report', templateLang: 'en_US' })).resolves.toBeUndefined();
    }
  });
});
