import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createFakeTableClient, type TableRow } from '@/test/fake-table-client';
import type { createAdminClient } from '@/lib/supabase/admin';

import { OwnerAgentStoreError, createReplyStore, sanitizeToolNames } from './store';

type AdminClient = ReturnType<typeof createAdminClient>;

const STAFF = '11111111-1111-4111-8111-111111111111';

function intake(id: string, status: string, receivedAt = '2026-09-24T08:00:00Z', staff = STAFF): TableRow {
  return {
    id,
    wamid: `wamid.${id}`,
    phone_number_id: '1111',
    staff_user_id: staff,
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
  it('countIntakeBefore: this staff member, from the day start up to (not including) the question', async () => {
    const { db, store } = setup([
      intake('self', 'processing', '2026-09-24T08:00:00Z'),
      intake('earlier-today', 'answered', '2026-09-24T07:00:00Z'),
      intake('later-today', 'queued', '2026-09-24T09:00:00Z'),
      intake('yesterday', 'answered', '2026-09-23T07:00:00Z'),
      intake('someone-else', 'answered', '2026-09-24T07:00:00Z', '22222222-2222-4222-8222-222222222222'),
    ]);
    expect(await store.countIntakeBefore(STAFF, '2026-09-23T21:00:00.000Z', '2026-09-24T08:00:00.000Z')).toBe(1);
    expect(db.ops.at(-1)?.filters).toEqual([
      ['eq', 'staff_user_id', STAFF],
      ['gte', 'received_at', '2026-09-23T21:00:00.000Z'],
      ['lt', 'received_at', '2026-09-24T08:00:00.000Z'],
    ]);
  });

  it('loadIntake maps the row and returns null when it is gone', async () => {
    const { store } = setup([intake('a', 'queued')]);
    expect(await store.loadIntake('a')).toMatchObject({ id: 'a', status: 'queued', staffUserId: STAFF, phoneNumberId: '1111' });
    expect(await store.loadIntake('nope')).toBeNull();
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
});
