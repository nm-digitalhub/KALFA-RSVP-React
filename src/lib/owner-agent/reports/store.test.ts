import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { OwnerAgentStoreError } from '@/lib/owner-agent/consumer/store';
import type { createAdminClient } from '@/lib/supabase/admin';
import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';

import { createReportStore } from './store';

type AdminClient = ReturnType<typeof createAdminClient>;

// Driven over the filter-aware fake: a CAS or a scan that lost its filter
// changes (or returns) rows it must not, and these tests see it.

const RUN = '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f';
const SUB = '0b7e1f2a-3c4d-4e5f-9a6b-7c8d9e0f1a2b';
const ENTRY = '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a';
const OTHER_ENTRY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function setup(tables: Record<string, TableRow[]> = {}) {
  const fake = createFakeTableClient(tables, {
    is_platform_staff_for_user: () => ({ data: true }),
    has_platform_permission_for_user: (args) => ({ data: args?._key === 'view_events' }),
  });
  return { fake, store: createReportStore(fake.client as unknown as AdminClient) };
}

describe('transitionRun (the send CAS)', () => {
  it('moves only a run in one of the listed statuses, and says whether it did', async () => {
    const { fake, store } = setup({ owner_agent_report_run: [{ id: RUN, status: 'sending' }] });
    expect(await store.transitionRun(RUN, ['processing'], 'sending')).toBe(false);
    expect(fake.tables.owner_agent_report_run[0].status).toBe('sending');
    expect(await store.transitionRun(RUN, ['sending'], 'sent', { channel: 'text', outboundWamid: 'wamid.X', errorCode: null, sentAt: '2026-09-28T05:00:10.000Z' })).toBe(true);
    expect(fake.tables.owner_agent_report_run[0]).toMatchObject({
      status: 'sent',
      channel: 'text',
      outbound_wamid: 'wamid.X',
      error_code: null,
      sent_at: '2026-09-28T05:00:10.000Z',
    });
  });

  it('writes only the result columns it was given', async () => {
    const { fake, store } = setup({ owner_agent_report_run: [{ id: RUN, status: 'queued' }] });
    await store.transitionRun(RUN, ['queued'], 'processing');
    const update = fake.ops.find((o) => o.op === 'update');
    expect(update?.patch).toEqual({ status: 'processing' });
    expect(update?.filters).toEqual([
      ['eq', 'id', RUN],
      ['in', 'status', ['queued']],
    ]);
  });

  it('a database error throws a code-only store error', async () => {
    const { fake, store } = setup({ owner_agent_report_run: [{ id: RUN, status: 'queued' }] });
    fake.fail('owner_agent_report_run', '08006', 'update');
    await expect(store.transitionRun(RUN, ['queued'], 'processing')).rejects.toBeInstanceOf(OwnerAgentStoreError);
  });
});

describe('insertRun (one run per slot)', () => {
  it('inserts a queued run and returns its id', async () => {
    const { fake, store } = setup({ owner_agent_report_run: [] });
    const id = await store.insertRun(SUB, '2026-09-28', '08:00:00');
    expect(id).toEqual(expect.any(String));
    expect(fake.tables.owner_agent_report_run).toEqual([
      expect.objectContaining({ id, subscription_id: SUB, local_date: '2026-09-28', slot_time: '08:00:00', status: 'queued' }),
    ]);
  });

  it('the unique key (23505) reads as "already planned", not as an error', async () => {
    const { fake, store } = setup({ owner_agent_report_run: [] });
    fake.fail('owner_agent_report_run', '23505', 'insert');
    expect(await store.insertRun(SUB, '2026-09-28', '08:00:00')).toBeNull();
  });

  it('any other insert error throws', async () => {
    const { fake, store } = setup({ owner_agent_report_run: [] });
    fake.fail('owner_agent_report_run', '42501', 'insert');
    await expect(store.insertRun(SUB, '2026-09-28', '08:00:00')).rejects.toBeInstanceOf(OwnerAgentStoreError);
  });
});

describe('listPlannable', () => {
  it('enabled daily_business subscriptions of enabled, opted-in rows only', async () => {
    const { store } = setup({
      owner_agent_report_subscription: [
        { id: 's1', allowlist_entry_id: ENTRY, report_key: 'daily_business', slot_time: '08:00:00', timezone: 'Asia/Jerusalem', enabled: true },
        { id: 's2', allowlist_entry_id: ENTRY, report_key: 'daily_business', slot_time: '00:00:00', timezone: 'Asia/Jerusalem', enabled: false },
        { id: 's3', allowlist_entry_id: ENTRY, report_key: 'other_report', slot_time: '09:00:00', timezone: 'Asia/Jerusalem', enabled: true },
        { id: 's4', allowlist_entry_id: OTHER_ENTRY, report_key: 'daily_business', slot_time: '08:00:00', timezone: 'Asia/Jerusalem', enabled: true },
      ],
      owner_agent_allowlist: [
        { id: ENTRY, enabled: true, report_opt_in: true },
        { id: OTHER_ENTRY, enabled: true, report_opt_in: false },
      ],
    });
    expect(await store.listPlannable()).toEqual([{ id: 's1', slotTime: '08:00:00', timezone: 'Asia/Jerusalem' }]);
  });

  it('a disabled row plans nothing even when opted in', async () => {
    const { store } = setup({
      owner_agent_report_subscription: [
        { id: 's1', allowlist_entry_id: ENTRY, report_key: 'daily_business', slot_time: '08:00:00', timezone: 'Asia/Jerusalem', enabled: true },
      ],
      owner_agent_allowlist: [{ id: ENTRY, enabled: false, report_opt_in: true }],
    });
    expect(await store.listPlannable()).toEqual([]);
  });
});

describe('scans', () => {
  const runs = () => [
    { id: 'r1', status: 'queued', claimed_at: '2026-09-28T05:00:00Z' },
    { id: 'r2', status: 'queued', claimed_at: '2026-09-28T04:00:00Z' },
    { id: 'r3', status: 'processing', claimed_at: '2026-09-28T03:00:00Z' },
    { id: 'r4', status: 'sent', claimed_at: '2026-09-28T03:00:00Z' },
    { id: 'r5', status: 'sending', claimed_at: '2026-09-28T03:00:00Z' },
  ];

  it('listStrandedRuns: queued, claimed in (newer, older]', async () => {
    const { store } = setup({ owner_agent_report_run: runs() });
    expect(await store.listStrandedRuns('2026-09-28T05:00:00Z', '2026-09-28T04:00:00Z', 10)).toEqual(['r1']);
  });

  it('listStaleRuns: queued or processing claimed at or before the cutoff — never sending or done', async () => {
    const { store } = setup({ owner_agent_report_run: runs() });
    expect(await store.listStaleRuns('2026-09-28T04:00:00Z', 10)).toEqual(['r3', 'r2']);
  });
});

describe('reads', () => {
  it('readSettings maps the switches, number and template', async () => {
    const { store } = setup({
      app_settings: [
        {
          id: true,
          owner_agent_enabled: true,
          owner_agent_phone_number_id: '123456789012345',
          owner_agent_reports_enabled: false,
          owner_agent_report_template_name: 'kalfa_owner_daily_report_util_v1',
          owner_agent_report_template_lang: null,
        },
      ],
    });
    expect(await store.readSettings()).toEqual({
      enabled: true,
      reportsEnabled: false,
      phoneNumberId: '123456789012345',
      templateName: 'kalfa_owner_daily_report_util_v1',
      templateLang: null,
    });
  });

  it('loadEntry fails closed on an unknown approval kind', async () => {
    const { store } = setup({
      owner_agent_allowlist: [
        { id: ENTRY, e164: '+972501234567', staff_user_id: 'u1', approval_kind: 'something_new', enabled: true, report_opt_in: true },
      ],
    });
    expect(await store.loadEntry(ENTRY)).toBeNull();
  });

  it('lastIntakeAt: the newest intake of THIS row on THIS number', async () => {
    const { store } = setup({
      owner_agent_intake: [
        { id: 'i1', allowlist_entry_id: ENTRY, phone_number_id: '111', received_at: '2026-09-27T10:00:00Z' },
        { id: 'i2', allowlist_entry_id: ENTRY, phone_number_id: '222', received_at: '2026-09-28T01:00:00Z' },
        { id: 'i3', allowlist_entry_id: OTHER_ENTRY, phone_number_id: '111', received_at: '2026-09-28T02:00:00Z' },
        { id: 'i4', allowlist_entry_id: ENTRY, phone_number_id: '111', received_at: '2026-09-26T10:00:00Z' },
      ],
    });
    expect(await store.lastIntakeAt(ENTRY, '111')).toBe('2026-09-27T10:00:00Z');
    expect(await store.lastIntakeAt(ENTRY, '333')).toBeNull();
  });

  it('staff and permission checks are the reply consumer’s RPCs', async () => {
    const { fake, store } = setup();
    expect(await store.isStaff('u1')).toBe(true);
    expect(await store.hasPermission('u1', 'view_events')).toBe(true);
    expect(await store.hasPermission('u1', 'view_billing')).toBe(false);
    expect(fake.rpcCalls.map((c) => c.fn)).toEqual([
      'is_platform_staff_for_user',
      'has_platform_permission_for_user',
      'has_platform_permission_for_user',
    ]);
  });
});

describe('writeAudit', () => {
  it('stage report, the run id, ids and codes only', async () => {
    const { fake, store } = setup({ owner_agent_audit: [] });
    expect(
      await store.writeAudit({
        outcome: 'sent',
        reasonCode: null,
        reportRunId: RUN,
        staffUserId: 'u1',
        allowlistEntryId: ENTRY,
        sections: ['events_pipeline', 'Bad Name', 'events_pipeline'],
        latencyMs: 1200,
      }),
    ).toBe(true);
    expect(fake.tables.owner_agent_audit[0]).toEqual(
      expect.objectContaining({
        stage: 'report',
        outcome: 'sent',
        reason_code: null,
        report_run_id: RUN,
        staff_user_id: 'u1',
        allowlist_entry_id: ENTRY,
        intake_id: null,
        wamid_sha256: null,
        tool_names: ['events_pipeline'],
        latency_ms: 1200,
      }),
    );
  });

  it('never throws; a failed insert reads as false', async () => {
    const { fake, store } = setup({ owner_agent_audit: [] });
    fake.fail('owner_agent_audit', '23514', 'insert');
    expect(await store.writeAudit({ outcome: 'sent', reasonCode: null, reportRunId: RUN })).toBe(false);
  });
});
