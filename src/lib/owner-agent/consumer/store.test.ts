import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';
import type { createAdminClient } from '@/lib/supabase/admin';

import { SUPABASE_TOOL_IDS, toolIdFromMcpName } from '../mcp/names';

import { OwnerAgentStoreError, createReplyStore, sanitizeToolNames } from './store';

type AdminClient = ReturnType<typeof createAdminClient>;

const STAFF = '11111111-1111-4111-8111-111111111111';

const ENTRY = 'entry-self';

function intake(id: string, status: string, receivedAt = '2026-09-24T08:00:00Z', staff = STAFF): TableRow {
  return {
    id,
    wamid: `wamid.${id}`,
    phone_number_id: '1111',
    staff_user_id: staff,
    allowlist_entry_id: staff === STAFF ? ENTRY : 'entry-other',
    message_text: 'שאלה QUESTION-SENTINEL',
    status,
    received_at: receivedAt,
    processed_at: null,
  };
}

function setup(rows: TableRow[]) {
  const db = createFakeTableClient({ owner_agent_intake: rows, owner_agent_audit: [] });
  return { db, store: createReplyStore(db.client as unknown as AdminClient) };
}

describe('transition — the status CAS', () => {
  it('moves the row only from one of the listed states, and says whether it did', async () => {
    const { db, store } = setup([intake('a', 'processing')]);
    expect(await store.transition('a', ['queued'], 'processing')).toBe(false);
    expect(db.tables.owner_agent_intake[0].status).toBe('processing');
    expect(await store.transition('a', ['processing'], 'sending')).toBe(true);
    expect(db.tables.owner_agent_intake[0].status).toBe('sending');
    // The same claim twice: the second finds nothing to move.
    expect(await store.transition('a', ['processing'], 'sending')).toBe(false);
  });

  it('touches only its own row', async () => {
    const { db, store } = setup([intake('a', 'processing'), intake('b', 'processing')]);
    await store.transition('a', ['processing'], 'sending');
    expect(db.tables.owner_agent_intake.map((r) => r.status)).toEqual(['sending', 'processing']);
  });

  it('stamps processed_at on a terminal state only', async () => {
    const { db, store } = setup([intake('a', 'queued')]);
    await store.transition('a', ['queued'], 'processing');
    expect(db.tables.owner_agent_intake[0].processed_at).toBeNull();
    await store.transition('a', ['processing'], 'skipped');
    expect(db.tables.owner_agent_intake[0].processed_at).toEqual(expect.any(String));
  });

  it('the update is filtered by id AND status (the double-send guard)', async () => {
    const { db, store } = setup([intake('a', 'processing')]);
    await store.transition('a', ['processing'], 'sending');
    const update = db.ops.find((o) => o.op === 'update');
    expect(update?.filters).toEqual([
      ['eq', 'id', 'a'],
      ['in', 'status', ['processing']],
    ]);
  });

  it('a database error is a code, never the PostgREST message', async () => {
    const { db, store } = setup([intake('a', 'processing')]);
    db.fail('owner_agent_intake', '23514', 'update');
    const err = await store.transition('a', ['processing'], 'sending').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OwnerAgentStoreError);
    expect(err).toMatchObject({ message: 'owner_agent_store_transition_sending', step: 'transition_sending', code: '23514' });
    expect(JSON.stringify(err)).not.toContain('forced');
  });
});

describe('the other reads', () => {
  it('countIntakeBefore: this allow-list row, from the day start up to (not including) the question', async () => {
    const { db, store } = setup([
      intake('self', 'processing', '2026-09-24T08:00:00Z'),
      intake('earlier-today', 'answered', '2026-09-24T07:00:00Z'),
      intake('later-today', 'queued', '2026-09-24T09:00:00Z'),
      intake('yesterday', 'answered', '2026-09-23T07:00:00Z'),
      intake('someone-else', 'answered', '2026-09-24T07:00:00Z', '22222222-2222-4222-8222-222222222222'),
    ]);
    expect(await store.countIntakeBefore(ENTRY, '2026-09-23T21:00:00.000Z', '2026-09-24T08:00:00.000Z')).toBe(1);
    expect(db.ops.at(-1)?.filters).toEqual([
      ['eq', 'allowlist_entry_id', ENTRY],
      ['gte', 'received_at', '2026-09-23T21:00:00.000Z'],
      ['lt', 'received_at', '2026-09-24T08:00:00.000Z'],
    ]);
  });

  it('loadIntake maps the row and returns null when it is gone', async () => {
    const { store } = setup([intake('a', 'queued')]);
    expect(await store.loadIntake('a')).toMatchObject({
      id: 'a',
      status: 'queued',
      staffUserId: STAFF,
      allowlistEntryId: ENTRY,
      phoneNumberId: '1111',
    });
    expect(await store.loadIntake('nope')).toBeNull();
  });
});

describe('loadEntry', () => {
  it('maps a known kind, and fails closed on an unknown kind or a missing row', async () => {
    const db = createFakeTableClient({
      owner_agent_allowlist: [
        { id: 'e1', e164: '+972501234567', staff_user_id: null, approval_kind: 'external_override', enabled: true },
        { id: 'e2', e164: '+972501234568', staff_user_id: STAFF, approval_kind: 'future_kind', enabled: true },
      ],
    });
    const store = createReplyStore(db.client as unknown as AdminClient);
    expect(await store.loadEntry('e1')).toEqual({
      id: 'e1',
      e164: '+972501234567',
      staffUserId: null,
      approvalKind: 'external_override',
      enabled: true,
    });
    expect(await store.loadEntry('e2')).toBeNull();
    expect(await store.loadEntry('nope')).toBeNull();
  });
});

describe('writeAudit', () => {
  it('hashes the wamid, keeps codes, and never throws', async () => {
    const { db, store } = setup([]);
    expect(
      await store.writeAudit({
        stage: 'send',
        outcome: 'answered',
        reasonCode: null,
        staffUserId: STAFF,
        intakeId: 'a',
        wamid: 'wamid.a',
        toolNames: ['events_pipeline'],
        steps: 2,
        latencyMs: 10,
      }),
    ).toBe(true);
    expect(db.tables.owner_agent_audit[0]).toMatchObject({
      wamid_sha256: createHash('sha256').update('wamid.a').digest('hex'),
      tool_names: ['events_pipeline'],
      steps: 2,
      latency_ms: 10,
    });
    db.fail('owner_agent_audit', '23514', 'insert');
    expect(await store.writeAudit({ stage: 'agent', outcome: 'gated', reasonCode: 'x', staffUserId: null, intakeId: null, wamid: null })).toBe(false);
  });

  it('sanitizeToolNames: our ids pass, anything else is other_tool, deduplicated, at most 32', () => {
    expect(sanitizeToolNames(['events_pipeline', 'Bash', 'mcp__x__y', 'Bash', 'rsvp_totals'])).toEqual([
      'events_pipeline',
      'other_tool',
      'mcp__x__y',
      'rsvp_totals',
    ]);
    const many = Array.from({ length: 40 }, (_, i) => `tool_${i}`);
    expect(sanitizeToolNames(many)).toHaveLength(32);
  });

  it('the Supabase tools are audited by name (free-read §3.6), as the runner reports them', () => {
    const fromTrace = ['mcp__supabase__list_tables', 'mcp__supabase__execute_sql', 'mcp__owner_agent__rsvp_totals'].map(
      toolIdFromMcpName,
    );
    expect(sanitizeToolNames(fromTrace)).toEqual(['list_tables', 'execute_sql', 'rsvp_totals']);
    for (const id of SUPABASE_TOOL_IDS) expect(sanitizeToolNames([id])).toEqual([id]);
  });
});

// ── Capabilities (migration 20260927011338) ────────────────────────────────────

describe('loadIntake — the capability columns', () => {
  it('maps media, location, tap, follow-ups and reply wamids; a text row has none of them', async () => {
    const { store } = setup([
      intake('t', 'queued'),
      {
        ...intake('m', 'queued'),
        message_type: 'image',
        message_text: null,
        media_id: '123',
        media_mime: 'image/png',
        media_voice: null,
        media_filename: null,
        location_lat: 32.1,
        location_lng: 34.8,
        location_label: null,
        interactive_id: 'oa:fu:x:1',
        reply_to_wamid: 'wamid.ctx',
        followups: ['א', 'ב'],
        reply_wamids: ['wamid.1'],
        coalesced_into: 't',
        processed_at: '2026-09-24T08:01:00Z',
      },
    ]);
    const text = await store.loadIntake('t');
    expect(text).toMatchObject({
      messageType: 'text',
      media: null,
      location: null,
      interactiveId: null,
      followups: null,
      replyWamids: null,
      coalescedInto: null,
    });
    expect(await store.loadIntake('m')).toMatchObject({
      messageType: 'image',
      messageText: null,
      media: { id: '123', mime: 'image/png', voice: false, filename: null },
      location: { lat: 32.1, lng: 34.8, label: null },
      interactiveId: 'oa:fu:x:1',
      replyToWamid: 'wamid.ctx',
      followups: ['א', 'ב'],
      replyWamids: ['wamid.1'],
      coalescedInto: 't',
      processedAt: '2026-09-24T08:01:00Z',
    });
  });

  it('a followups value that is not a list of strings is no follow-up list at all', async () => {
    const { store } = setup([{ ...intake('a', 'answered'), followups: [1, 'x'] }]);
    expect((await store.loadIntake('a'))?.followups).toBeNull();
  });
});

describe('burst coalescing', () => {
  const at = (s: number) => `2026-09-24T08:00:${String(s).padStart(2, '0')}Z`;

  it('hasNewerQueued: only a QUEUED row of the SAME allow-list row that arrived later (ties by id)', async () => {
    const { store } = setup([
      intake('b', 'queued', at(10)),
      intake('c', 'processing', at(20)),
      intake('d', 'queued', at(30), 'other-staff'),
    ]);
    const row = { id: 'b', allowlistEntryId: ENTRY, receivedAt: at(10) };
    expect(await store.hasNewerQueued(row)).toBe(false);
    const { store: tied } = setup([intake('b', 'queued', at(10)), intake('c', 'queued', at(10))]);
    expect(await tied.hasNewerQueued(row)).toBe(true);
    expect(await tied.hasNewerQueued({ ...row, id: 'c' })).toBe(false);
    const { store: later } = setup([intake('b', 'queued', at(10)), intake('e', 'queued', at(11))]);
    expect(await later.hasNewerQueued(row)).toBe(true);
  });

  it('coalesceInto: one update, filtered by allow-list row, status queued, not the leader, not newer', async () => {
    const { db, store } = setup([
      intake('a', 'queued', at(1)),
      intake('b', 'queued', at(2)),
      intake('c', 'processing', at(3)),
      intake('d', 'queued', at(4), 'other-staff'),
      intake('lead', 'processing', at(5)),
      intake('z', 'queued', at(9)),
    ]);
    const moved = await store.coalesceInto({ id: 'lead', allowlistEntryId: ENTRY, receivedAt: at(5) });
    expect(moved.map((m) => m.id).sort()).toEqual(['a', 'b']);
    const byId = Object.fromEntries(db.tables.owner_agent_intake.map((r) => [r.id, r]));
    expect(byId.a).toMatchObject({ status: 'coalesced', coalesced_into: 'lead', processed_at: expect.any(String) });
    expect([byId.c.status, byId.d.status, byId.z.status, byId.lead.status]).toEqual(['processing', 'queued', 'queued', 'processing']);
    expect(db.ops.filter((o) => o.op === 'update')).toHaveLength(1);
    // A second fold finds nothing left.
    expect(await store.coalesceInto({ id: 'lead', allowlistEntryId: ENTRY, receivedAt: at(5) })).toEqual([]);
  });

  it('loadCoalesced: the followers, oldest first', async () => {
    const { store } = setup([
      { ...intake('b', 'coalesced', at(2)), coalesced_into: 'lead' },
      { ...intake('a', 'coalesced', at(1)), coalesced_into: 'lead' },
      { ...intake('x', 'coalesced', at(1)), coalesced_into: 'other' },
    ]);
    expect((await store.loadCoalesced('lead')).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('coalesced is terminal: it is never expired or re-enqueued by the sweep lists', async () => {
    const { store } = setup([{ ...intake('a', 'coalesced', at(1)), coalesced_into: 'lead' }]);
    expect(await store.listExpirable('2027-01-01T00:00:00Z', 10)).toEqual([]);
    expect(await store.listStranded('2027-01-01T00:00:00Z', '2000-01-01T00:00:00Z', 10)).toEqual([]);
  });
});

describe('follow-ups and reply wamids', () => {
  it('countFollowupUses: other rows of the same id whose answer went out, not this row, not a skipped one', async () => {
    const tap = (id: string, status: string, interactiveId = 'oa:fu:s:1') => ({ ...intake(id, status), interactive_id: interactiveId });
    const { store } = setup([
      tap('self', 'answered'),
      tap('skipped', 'skipped'),
      tap('failed', 'failed'),
      tap('otherid', 'answered', 'oa:fu:s:2'),
    ]);
    expect(await store.countFollowupUses('oa:fu:s:1', 'self')).toBe(0);
    const { store: used } = setup([tap('self', 'processing'), tap('first', 'answered')]);
    expect(await used.countFollowupUses('oa:fu:s:1', 'self')).toBe(1);
    const { store: sending } = setup([tap('self', 'processing'), tap('first', 'sending')]);
    expect(await sending.countFollowupUses('oa:fu:s:1', 'self')).toBe(1);
  });

  it('countFollowupUses: a database error throws a code (never "unused")', async () => {
    const { db, store } = setup([]);
    db.fail('owner_agent_intake', '08006', 'select');
    await expect(store.countFollowupUses('oa:fu:s:1', 'self')).rejects.toBeInstanceOf(OwnerAgentStoreError);
  });

  it('recordReply writes both columns on its own row, and never throws', async () => {
    const { db, store } = setup([intake('a', 'sending'), intake('b', 'sending')]);
    expect(await store.recordReply('a', { followups: ['א'], replyWamids: ['w1', 'w2'] })).toBe(true);
    expect(db.tables.owner_agent_intake[0]).toMatchObject({ followups: ['א'], reply_wamids: ['w1', 'w2'] });
    expect(db.tables.owner_agent_intake[1].reply_wamids).toBeUndefined();
    db.fail('owner_agent_intake', '08006', 'update');
    expect(await store.recordReply('a', { followups: null, replyWamids: ['w3'] })).toBe(false);
  });

  it('the audit row carries turn_intake_id', async () => {
    const { db, store } = setup([]);
    await store.writeAudit({
      stage: 'agent',
      outcome: 'coalesced',
      reasonCode: null,
      staffUserId: STAFF,
      intakeId: 'a',
      wamid: 'wamid.a',
      turnIntakeId: 'lead',
    });
    expect(db.tables.owner_agent_audit[0]).toMatchObject({ turn_intake_id: 'lead', intake_id: 'a' });
  });

  it('settings: burst_ms read, and 0 when absent', async () => {
    const db = createFakeTableClient({
      app_settings: [{ id: true, owner_agent_enabled: true, owner_agent_phone_number_id: '1', owner_agent_daily_cap: 5, owner_agent_burst_ms: 3000 }],
    });
    expect((await createReplyStore(db.client as unknown as AdminClient).readSettings())?.burstMs).toBe(3000);
    delete db.tables.app_settings[0].owner_agent_burst_ms;
    expect((await createReplyStore(db.client as unknown as AdminClient).readSettings())?.burstMs).toBe(0);
  });
});
