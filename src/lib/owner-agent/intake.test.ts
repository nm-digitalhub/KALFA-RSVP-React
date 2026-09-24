import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeAdmin, unconfiguredState, type FakeAdminState } from '@/test/owner-agent-fake-admin';

const fake = vi.hoisted(() => ({ admin: null as unknown as ReturnType<typeof createFakeAdmin> }));
const send = vi.hoisted(() => vi.fn());

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => fake.admin.client) }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/queue/web-sender', () => ({ getWebJobSender: vi.fn(async () => ({ send })) }));

import { sendSlackAlert } from '@/lib/alerts/slack';
import { deterministicJobId } from '@/lib/queue/deterministic-id';
import { QUEUES } from '@/lib/queue/queues';
import { getWebJobSender } from '@/lib/queue/web-sender';
import { __resetRateLimitStateForTests } from '@/lib/security/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

import {
  NO_DIVERSION,
  OWNER_AGENT_RATE_LIMIT,
  getOwnerAgentRouting,
  handleOwnerAgentMessages,
  matchAllowlistedSender,
  planOwnerAgentDiversion,
  withoutDivertedRows,
  type OwnerAgentRouting,
} from './intake';

fake.admin = createFakeAdmin();

// Synthetic numbers only.
const CHOSEN = '1111222233334444';
const OTHER = '5555666677778888';
const STAFF = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const ENTRY = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const STAFF_E164 = '+972508412345';
const STAFF_WA_ID = '972508412345';
const QUESTION = 'כמה פניות פתוחות יש היום?';

function configured(overrides: Partial<FakeAdminState> = {}): FakeAdminState {
  return {
    ...unconfiguredState(),
    settings: { owner_agent_enabled: true, owner_agent_phone_number_id: CHOSEN, owner_agent_daily_cap: 50 },
    allowlist: [{ id: ENTRY, e164: STAFF_E164, staff_user_id: STAFF, enabled: true }],
    staff: new Set([STAFF]),
    verifiedPhones: new Map([[STAFF, STAFF_E164]]),
    ...overrides,
  };
}

function routing(overrides: Partial<OwnerAgentRouting> = {}): OwnerAgentRouting {
  return {
    phoneNumberId: CHOSEN,
    enabled: true,
    dailyCap: 50,
    allowlist: new Map([[STAFF_E164, { entryId: ENTRY, e164: STAFF_E164, staffUserId: STAFF }]]),
    ...overrides,
  };
}

function body(phoneNumberId: string, messages: unknown[]) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId },
              messages,
            },
          },
        ],
      },
    ],
  };
}

function textMessage(id: string, from: string, text = QUESTION) {
  return { id, from, timestamp: '1700000000', type: 'text', text: { body: text } };
}

function auditRows() {
  return fake.admin.writes.filter((w) => w.table === 'owner_agent_audit').map((w) => w.row);
}
function intakeWrites() {
  return fake.admin.writes.filter((w) => w.table === 'owner_agent_intake');
}
function sha(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

beforeEach(() => {
  vi.clearAllMocks();
  fake.admin.reset(configured());
  __resetRateLimitStateForTests();
  send.mockResolvedValue('job-id');
});

describe('matchAllowlistedSender — exact identity, never "normalizes to"', () => {
  const list = routing().allowlist;

  it('matches the wa_id whose "+" form IS the row', () => {
    expect(matchAllowlistedSender(STAFF_WA_ID, list)?.entryId).toBe(ENTRY);
  });

  it('does not map a foreign wa_id onto an Israeli row (the IL-default trap)', () => {
    // normalizePhone('508412345') would give +972508412345 — this row. It must not match.
    expect(matchAllowlistedSender('508412345', list)).toBeNull();
  });

  it('does not map a trunk-zero form onto the row (+9720… → +972…)', () => {
    expect(matchAllowlistedSender('9720508412345', list)).toBeNull();
  });

  it('rejects non-phone senders (username/BSUID, leading 0, "+", junk)', () => {
    for (const from of ['IL.123', '0508412345', '+972508412345', '', null, 972508412345, 'abc']) {
      expect(matchAllowlistedSender(from, list)).toBeNull();
    }
  });
});

describe('planOwnerAgentDiversion — pure and total', () => {
  it('diverts only an allow-listed sender on the chosen number, per message', () => {
    const data = body(CHOSEN, [textMessage('wamid.staff', STAFF_WA_ID), textMessage('wamid.guest', '972501111111')]);
    const snapshot = JSON.stringify(data);
    const d = planOwnerAgentDiversion(data, routing());
    expect(d.messages.map((m) => m.wamid)).toEqual(['wamid.staff']);
    expect(d.messages[0]).toMatchObject({ phoneNumberId: CHOSEN, type: 'text', text: QUESTION, entry: { entryId: ENTRY } });
    expect([...d.wamids]).toEqual(['wamid.staff']);
    expect(JSON.stringify(data)).toBe(snapshot); // never mutates the envelope
  });

  it('diverts nothing on another number, even from the allow-listed phone', () => {
    expect(planOwnerAgentDiversion(body(OTHER, [textMessage('w', STAFF_WA_ID)]), routing())).toBe(NO_DIVERSION);
  });

  it('never diverts statuses (including replies to the staff phone)', () => {
    const data = {
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: CHOSEN },
                statuses: [{ id: 'wamid.s', status: 'read', recipient_id: STAFF_WA_ID }],
              },
            },
          ],
        },
      ],
    };
    expect(planOwnerAgentDiversion(data, routing())).toBe(NO_DIVERSION);
  });

  it('returns NO_DIVERSION without routing', () => {
    expect(planOwnerAgentDiversion(body(CHOSEN, [textMessage('w', STAFF_WA_ID)]), null)).toBe(NO_DIVERSION);
  });

  it('never throws on any JSON value or malformed nesting', () => {
    const weird: unknown[] = [
      null, [], 'x', 5, true, {}, { entry: null }, { entry: 5 }, { entry: [null, 5, 'x'] },
      { entry: [{ changes: 5 }] }, { entry: [{ changes: [null, { field: 'messages', value: null }] }] },
      { entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: CHOSEN }, messages: 5 } }] }] },
      { entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: CHOSEN }, messages: [null, 1, { from: STAFF_WA_ID }] } }] }] },
    ];
    for (const data of weird) {
      expect(() => planOwnerAgentDiversion(data, routing())).not.toThrow();
      expect(planOwnerAgentDiversion(data, routing())).toBe(NO_DIVERSION);
    }
  });

  it('marks a non-text message with text null', () => {
    const d = planOwnerAgentDiversion(
      body(CHOSEN, [{ id: 'wamid.img', from: STAFF_WA_ID, type: 'image', image: { id: 'm1' } }]),
      routing(),
    );
    expect(d.messages[0]).toMatchObject({ wamid: 'wamid.img', type: 'image', text: null });
  });
});

describe('withoutDivertedRows', () => {
  it('removes only message rows of diverted wamids on the chosen number, keeping order and identity', () => {
    const d = planOwnerAgentDiversion(body(CHOSEN, [textMessage('wamid.staff', STAFF_WA_ID)]), routing());
    const rows = [
      { event_kind: 'message', message_id: 'wamid.guest', phone_number_id: CHOSEN },
      { event_kind: 'message', message_id: 'wamid.staff', phone_number_id: CHOSEN },
      { event_kind: 'status', message_id: 'wamid.staff', phone_number_id: CHOSEN },
      { event_kind: 'message', message_id: 'wamid.staff', phone_number_id: OTHER },
    ];
    const kept = withoutDivertedRows(rows, d);
    expect(kept).toEqual([rows[0], rows[2], rows[3]]);
    expect(kept[0]).toBe(rows[0]);
  });
});

describe('getOwnerAgentRouting', () => {
  it('is null when no number is chosen, and never reads the allow-list then', async () => {
    fake.admin.reset(unconfiguredState());
    expect(await getOwnerAgentRouting()).toBeNull();
    expect(fake.admin.reads.map((r) => r.table)).toEqual(['app_settings']);
    expect(fake.admin.reads[0].columns).toBe(
      'owner_agent_enabled, owner_agent_phone_number_id, owner_agent_daily_cap',
    );
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('reads ENABLED rows only', async () => {
    fake.admin.reset(
      configured({
        allowlist: [
          { id: ENTRY, e164: STAFF_E164, staff_user_id: STAFF, enabled: true },
          { id: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f', e164: '+972501111111', staff_user_id: STAFF, enabled: false },
        ],
      }),
    );
    const r = await getOwnerAgentRouting();
    expect(r).toMatchObject({ phoneNumberId: CHOSEN, enabled: true, dailyCap: 50 });
    expect([...(r?.allowlist.keys() ?? [])]).toEqual([STAFF_E164]);
  });

  it('is null (divert nothing) when a number is chosen but no row is enabled', async () => {
    fake.admin.reset(configured({ allowlist: [{ id: ENTRY, e164: STAFF_E164, staff_user_id: STAFF, enabled: false }] }));
    expect(await getOwnerAgentRouting()).toBeNull();
  });

  it.each([
    ['settings', { settingsError: { code: '57014', message: 'Failing row contains (+972508412345)' } }, 'routing_settings'],
    ['allow-list', { allowlistError: { code: '57014', message: 'Failing row contains (+972508412345)' } }, 'routing_allowlist'],
  ])('a %s read error → null plus ONE ids-only alert', async (_label, override, step) => {
    fake.admin.reset(configured(override as Partial<FakeAdminState>));
    expect(await getOwnerAgentRouting()).toBeNull();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(alert).toMatchObject({ source: 'owner-agent', fields: { step, code: '57014' } });
    expect(JSON.stringify(alert)).not.toContain('972508412345');
  });

  it('a thrown client → null plus one alert, never a throw', async () => {
    vi.mocked(createAdminClient).mockImplementationOnce(() => {
      throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured');
    });
    await expect(getOwnerAgentRouting()).resolves.toBeNull();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].fields).toEqual({ step: 'routing_settings', code: 'exception' });
  });
});

describe('handleOwnerAgentMessages — the §3.1 route gate', () => {
  async function run(r: OwnerAgentRouting = routing(), messages: unknown[] = [textMessage('wamid.q', STAFF_WA_ID)]) {
    const d = planOwnerAgentDiversion(body(CHOSEN, messages), r);
    await handleOwnerAgentMessages(d.messages, r);
  }

  it('passes: intake insert ON CONFLICT (wamid), enqueue by deterministicJobId(wamid), one intake_queued audit', async () => {
    await run();
    const intake = intakeWrites();
    expect(intake).toHaveLength(1);
    expect(intake[0]).toMatchObject({
      op: 'upsert',
      row: { wamid: 'wamid.q', phone_number_id: CHOSEN, staff_user_id: STAFF, message_text: QUESTION },
      options: { onConflict: 'wamid', ignoreDuplicates: true },
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [queue, job, opts] = send.mock.calls[0];
    expect(queue).toBe(QUEUES.ownerAgentReply);
    expect(opts).toEqual({ id: deterministicJobId('wamid.q') });
    expect(Object.keys(job)).toEqual(['intakeId']); // ids only — no text, no phone
    const audits = auditRows();
    expect(audits).toEqual([
      {
        stage: 'route',
        outcome: 'intake_queued',
        reason_code: null,
        staff_user_id: STAFF,
        intake_id: job.intakeId,
        wamid_sha256: sha('wamid.q'),
      },
    ]);
    expect(JSON.stringify(audits)).not.toContain('972508412345');
    expect(JSON.stringify(audits)).not.toContain(QUESTION);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a Meta retry of the same wamid: duplicate audit, no second enqueue', async () => {
    await run();
    send.mockClear();
    fake.admin.writes = [];
    await run();
    expect(send).not.toHaveBeenCalled();
    expect(auditRows().map((a) => [a.outcome, a.reason_code])).toEqual([['duplicate', null]]);
  });

  type Case = [string, () => void, string];
  const cases: Case[] = [
    ['kill_switch_off', () => {}, 'kill_switch_off'],
    ['not_staff', () => fake.admin.state.staff.clear(), 'not_staff'],
    ['phone_unverified (no verified phone)', () => fake.admin.state.verifiedPhones.set(STAFF, null), 'phone_unverified'],
    ['phone_unverified (another phone)', () => fake.admin.state.verifiedPhones.set(STAFF, '+972501111111'), 'phone_unverified'],
    ['daily_cap', () => { fake.admin.state.settings!.owner_agent_daily_cap = 0; }, 'daily_cap'],
  ];

  it.each(cases)('%s → one gated audit row, no intake, no enqueue', async (label, arrange, code) => {
    arrange();
    const r = routing({
      enabled: label !== 'kill_switch_off',
      dailyCap: fake.admin.state.settings!.owner_agent_daily_cap,
    });
    await run(r);
    expect(auditRows().map((a) => [a.outcome, a.reason_code])).toEqual([['gated', code]]);
    expect(intakeWrites()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('kill switch off is checked first: no DB read at all beyond the audit row', async () => {
    fake.admin.state.staff.clear();
    await run(routing({ enabled: false }));
    expect(fake.admin.rpcCalls).toEqual([]);
    expect(fake.admin.reads).toEqual([]);
    expect(auditRows().map((a) => a.reason_code)).toEqual(['kill_switch_off']);
  });

  it('daily cap counts real intake rows since Israel midnight, per staff member', async () => {
    const r = routing({ dailyCap: 1 });
    await run(r, [textMessage('wamid.1', STAFF_WA_ID)]);
    await run(r, [textMessage('wamid.2', STAFF_WA_ID)]);
    expect(auditRows().map((a) => [a.outcome, a.reason_code])).toEqual([
      ['intake_queued', null],
      ['gated', 'daily_cap'],
    ]);
    const countRead = fake.admin.reads.find((x) => x.table === 'owner_agent_intake');
    expect(countRead?.filters.map(([c, op]) => `${c}:${op}`)).toEqual(['staff_user_id:eq', 'received_at:gte']);
  });

  it('rate limit: the 11th message in a minute is rate_limited', async () => {
    const msgs = Array.from({ length: OWNER_AGENT_RATE_LIMIT.limit + 1 }, (_, i) => textMessage(`wamid.r${i}`, STAFF_WA_ID));
    await run(routing(), msgs);
    const codes = auditRows().map((a) => a.reason_code ?? a.outcome);
    expect(codes.slice(0, OWNER_AGENT_RATE_LIMIT.limit).every((c) => c === 'intake_queued')).toBe(true);
    expect(codes[OWNER_AGENT_RATE_LIMIT.limit]).toBe('rate_limited');
  });

  it('non_text: gated, no intake, no enqueue', async () => {
    await run(routing(), [{ id: 'wamid.img', from: STAFF_WA_ID, type: 'image', image: { id: 'm' } }]);
    expect(auditRows().map((a) => [a.outcome, a.reason_code])).toEqual([['gated', 'non_text']]);
    expect(intakeWrites()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('gate order: not_staff wins over phone_unverified and non_text', async () => {
    fake.admin.state.staff.clear();
    fake.admin.state.verifiedPhones.set(STAFF, null);
    await run(routing(), [{ id: 'wamid.img', from: STAFF_WA_ID, type: 'image' }]);
    expect(auditRows().map((a) => a.reason_code)).toEqual(['not_staff']);
  });

  it.each([
    ['staff rpc', { staffError: { code: 'PGRST301', message: 'x' } }, 'gate_staff'],
    ['profiles', { profilesError: { code: '57014', message: 'x' } }, 'gate_phone'],
    ['intake count', { intakeCountError: { code: '57014', message: 'x' } }, 'gate_daily_cap'],
    ['intake insert', { intakeInsertError: { code: '23514', message: `Failing row contains (${QUESTION}, +972508412345)` } }, 'intake'],
  ])('DB error at %s → failed/db_error audit, ONE ids-only alert, never throws', async (_l, override, step) => {
    Object.assign(fake.admin.state, override);
    await expect(run()).resolves.toBeUndefined();
    expect(auditRows().map((a) => [a.outcome, a.reason_code])).toEqual([['failed', 'db_error']]);
    expect(send).not.toHaveBeenCalled();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(alert.fields).toEqual({ step, code: (override as Record<string, { code: string }>)[Object.keys(override)[0]].code, audit: 'written', entry: ENTRY });
    const text = JSON.stringify(alert);
    expect(text).not.toContain('972508412345');
    expect(text).not.toContain(QUESTION);
  });

  it('enqueue failure → failed/enqueue_failed audit with the intake id, one alert', async () => {
    send.mockRejectedValueOnce(new Error('Queue owner-agent-reply does not exist'));
    await run();
    const audits = auditRows();
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ outcome: 'failed', reason_code: 'enqueue_failed' });
    expect(audits[0].intake_id).toEqual(expect.any(String));
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].fields).toMatchObject({ step: 'enqueue', code: 'send_failed' });
  });

  it('a sender connection failure is handled the same way', async () => {
    vi.mocked(getWebJobSender).mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    await run();
    expect(auditRows().map((a) => a.reason_code)).toEqual(['enqueue_failed']);
  });

  it('an audit insert failure is alerted (ids only) and does not throw', async () => {
    fake.admin.state.auditError = { code: '23514', message: 'x' };
    await expect(run(routing({ enabled: false }))).resolves.toBeUndefined();
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].fields).toEqual({
      step: 'audit',
      code: 'gated',
      audit: 'failed',
      entry: ENTRY,
    });
  });

  it('no messages → no client, no write', async () => {
    await handleOwnerAgentMessages([], routing());
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(fake.admin.writes).toEqual([]);
  });
});
