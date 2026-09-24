import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { createAdminClient } from '@/lib/supabase/admin';
import { createFakeCountClient, nonNumericLeaves, type FakeRow } from '@/test/fake-count-client';
import { WHATSAPP_FAILURE_CODES, getWhatsAppDeliverySummary } from './whatsapp-delivery';

type AdminClient = ReturnType<typeof createAdminClient>;

// 01:30 Israel on 2026-09-25; Israel midnight = 2026-09-24T21:00Z.
const NOW = Date.parse('2026-09-24T22:30:00Z');
const TODAY = '2026-09-24T21:30:00Z';
const WEEK = '2026-09-20T10:00:00Z';

let n = 0;
function row(over: Partial<FakeRow>): FakeRow {
  n += 1;
  return {
    id: `i${n}`,
    channel: 'whatsapp',
    direction: 'out',
    created_at: TODAY,
    delivery_status: null,
    delivery_error_code: null,
    provider_id: `wamid.${n}`,
    payload_meta: { text: 'שלום דנה' },
    ...over,
  };
}

function db() {
  n = 0;
  return createFakeCountClient({
    contact_interactions: [
      row({ delivery_status: 'read' }),
      row({ delivery_status: 'read' }),
      row({ delivery_status: 'delivered' }),
      row({ delivery_status: 'sent' }),
      row({}), // no status yet
      row({ delivery_status: 'failed', delivery_error_code: '131026' }),
      row({ delivery_status: 'failed', delivery_error_code: '131026' }),
      row({ delivery_status: 'failed', delivery_error_code: '131049' }),
      row({ delivery_status: 'failed', delivery_error_code: '999999' }), // uncatalogued
      row({ delivery_status: 'failed' }), // failed without a code
      row({ delivery_status: 'deleted' }), // a status outside the five buckets
      row({ direction: 'in' }),
      row({ direction: 'in' }),
      // earlier in the week
      row({ delivery_status: 'failed', delivery_error_code: '130472', created_at: WEEK }),
      row({ direction: 'in', created_at: WEEK }),
      // a voice interaction is never counted
      row({ channel: 'call', delivery_status: 'failed', delivery_error_code: '131026' }),
      // before Israel midnight today (23:00 on the 24th)
      row({ delivery_status: 'read', created_at: '2026-09-24T20:00:00Z' }),
    ],
  });
}

describe('getWhatsAppDeliverySummary (core)', () => {
  it("'today': outbound by current status, inbound, failures by code", async () => {
    const { client } = db();
    const s = await getWhatsAppDeliverySummary(client as unknown as AdminClient, 'today', NOW);
    expect(s.outbound).toEqual({
      total: 11,
      unacknowledged: 1,
      sent: 1,
      delivered: 1,
      read: 2,
      failed: 5,
      otherStatus: 1, // 'deleted'
    });
    expect(s.inbound).toBe(2);
    expect(s.failedByCode['131026']).toBe(2);
    expect(s.failedByCode['131049']).toBe(1);
    expect(s.failedByCode['130472']).toBe(0);
    expect(s.failedByCode.other).toBe(2); // 999999 + the one without a code
  });

  it("'7d' widens the window", async () => {
    const { client } = db();
    const s = await getWhatsAppDeliverySummary(client as unknown as AdminClient, '7d', NOW);
    expect(s.outbound.total).toBe(13); // + the 130472 failure and the 23:00 read
    expect(s.outbound.read).toBe(3);
    expect(s.inbound).toBe(3);
    expect(s.failedByCode['130472']).toBe(1);
  });

  it('each catalogued code lands on its own key', async () => {
    // One failure for code i repeated i+1 times — a position mix-up shows.
    const rows: FakeRow[] = WHATSAPP_FAILURE_CODES.flatMap((code, i) =>
      Array.from({ length: i + 1 }, (_, k) => ({
        id: `${code}-${k}`,
        channel: 'whatsapp',
        direction: 'out',
        created_at: TODAY,
        delivery_status: 'failed',
        delivery_error_code: code,
      })),
    );
    const { client } = createFakeCountClient({ contact_interactions: rows });
    const s = await getWhatsAppDeliverySummary(client as unknown as AdminClient, 'today', NOW);
    WHATSAPP_FAILURE_CODES.forEach((code, i) => expect(s.failedByCode[code]).toBe(i + 1));
    expect(s.failedByCode.other).toBe(0);
    expect(Object.keys(s.failedByCode).sort()).toEqual([...WHATSAPP_FAILURE_CODES, 'other'].sort());
  });

  it('every query is a head-only exact count on WhatsApp interactions', async () => {
    const { client, calls } = db();
    await getWhatsAppDeliverySummary(client as unknown as AdminClient, '7d', NOW);
    expect(calls).toHaveLength(7 + WHATSAPP_FAILURE_CODES.length);
    for (const c of calls) {
      expect(c.table).toBe('contact_interactions');
      expect(c.columns).toBe('id');
      expect(c.selectOptions).toEqual({ count: 'exact', head: true });
      expect(c.filters.slice(0, 2)).toEqual([
        { op: 'eq', args: ['channel', 'whatsapp'] },
        { op: 'gte', args: ['created_at', '2026-09-17T22:30:00.000Z'] },
      ]);
    }
  });

  it('result is numbers only — no wamid, no message text', async () => {
    const { client } = db();
    const s = await getWhatsAppDeliverySummary(client as unknown as AdminClient, '30d', NOW);
    expect(nonNumericLeaves(s)).toEqual([]);
    const json = JSON.stringify(s);
    expect(json).not.toContain('wamid');
    expect(json).not.toContain('דנה');
  });

  it('throws on a query error', async () => {
    const { client } = createFakeCountClient({}, { failTables: ['contact_interactions'] });
    await expect(
      getWhatsAppDeliverySummary(client as unknown as AdminClient, 'today', NOW),
    ).rejects.toThrow();
  });
});
