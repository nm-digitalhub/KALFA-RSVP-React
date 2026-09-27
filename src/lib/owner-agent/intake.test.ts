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
  handleOwnerAgentRevocations,
  matchAllowlistedSender,
  matchBoundBsuid,
  reactionReason,
  planOwnerAgentDiversion,
  withoutDivertedRows,
  type OwnerAgentAllowlistEntry,
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

function entry(overrides: Partial<OwnerAgentAllowlistEntry> = {}): OwnerAgentAllowlistEntry {
  return {
    entryId: ENTRY,
    e164: STAFF_E164,
    staffUserId: STAFF,
    approvalKind: 'verified_staff',
    bsuid: null,
    boundFromE164: null,
    ...overrides,
  };
}

function routing(overrides: Partial<OwnerAgentRouting> = {}): OwnerAgentRouting {
  return {
    phoneNumberId: CHOSEN,
    enabled: true,
    dailyCap: 50,
    burstMs: 0,
    allowlist: new Map([[STAFF_E164, entry()]]),
    bsuids: new Map(),
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
      body(CHOSEN, [{ id: 'wamid.img', from: STAFF_WA_ID, type: 'image', image: { id: '1234' } }]),
      routing(),
    );
    expect(d.messages[0]).toMatchObject({ wamid: 'wamid.img', type: 'image', text: null, payloadError: null });
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
      'owner_agent_enabled, owner_agent_phone_number_id, owner_agent_daily_cap, owner_agent_burst_ms',
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
      row: {
        wamid: 'wamid.q',
        phone_number_id: CHOSEN,
        staff_user_id: STAFF,
        allowlist_entry_id: ENTRY,
        message_text: QUESTION,
      },
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
        allowlist_entry_id: ENTRY,
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

  it('daily cap counts real intake rows since Israel midnight, per allow-list row', async () => {
    const r = routing({ dailyCap: 1 });
    await run(r, [textMessage('wamid.1', STAFF_WA_ID)]);
    await run(r, [textMessage('wamid.2', STAFF_WA_ID)]);
    expect(auditRows().map((a) => [a.outcome, a.reason_code])).toEqual([
      ['intake_queued', null],
      ['gated', 'daily_cap'],
    ]);
    const countRead = fake.admin.reads.find((x) => x.table === 'owner_agent_intake');
    expect(countRead?.filters.map(([c, op]) => `${c}:${op}`)).toEqual(['allowlist_entry_id:eq', 'received_at:gte']);
  });

  it('rate limit: the 11th message in a minute is rate_limited', async () => {
    const msgs = Array.from({ length: OWNER_AGENT_RATE_LIMIT.limit + 1 }, (_, i) => textMessage(`wamid.r${i}`, STAFF_WA_ID));
    await run(routing(), msgs);
    const codes = auditRows().map((a) => a.reason_code ?? a.outcome);
    expect(codes.slice(0, OWNER_AGENT_RATE_LIMIT.limit).every((c) => c === 'intake_queued')).toBe(true);
    expect(codes[OWNER_AGENT_RATE_LIMIT.limit]).toBe('rate_limited');
  });

  it('unsupported type (video): gated, no intake, no enqueue', async () => {
    await run(routing(), [{ id: 'wamid.vid', from: STAFF_WA_ID, type: 'video', video: { id: '123' } }]);
    expect(auditRows().map((a) => [a.outcome, a.reason_code])).toEqual([['gated', 'unsupported_type']]);
    expect(intakeWrites()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('gate order: not_staff wins over phone_unverified and the type gate', async () => {
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

describe('manual approval on the route gate (plans/owner-agent-allowlist-override-plan.md)', () => {
  async function runKind(kind: 'staff_unverified_override' | 'external_override', staffUserId: string | null) {
    const r = routing({
      allowlist: new Map([[STAFF_E164, entry({ staffUserId, approvalKind: kind })]]),
    });
    const d = planOwnerAgentDiversion(body(CHOSEN, [textMessage('wamid.o', STAFF_WA_ID)]), r);
    await handleOwnerAgentMessages(d.messages, r);
  }

  it('reads approval_kind with the enabled rows, and never routes an unknown kind', async () => {
    fake.admin.reset(
      configured({
        allowlist: [
          { id: ENTRY, e164: STAFF_E164, staff_user_id: STAFF, enabled: true, approval_kind: 'staff_unverified_override' },
          { id: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f', e164: '+972501111111', staff_user_id: null, enabled: true, approval_kind: 'future_kind' },
        ],
      }),
    );
    const r = await getOwnerAgentRouting();
    expect(fake.admin.reads.find((x) => x.table === 'owner_agent_allowlist')?.columns).toBe(
      'id, e164, staff_user_id, approval_kind, bsuid, bound_from_e164',
    );
    expect([...(r?.allowlist.keys() ?? [])]).toEqual([STAFF_E164]);
    expect(r?.allowlist.get(STAFF_E164)?.approvalKind).toBe('staff_unverified_override');
  });

  it('staff_unverified_override: passes without a verified phone, still requires staff, audited as an override', async () => {
    fake.admin.state.verifiedPhones.set(STAFF, null);
    await runKind('staff_unverified_override', STAFF);
    expect(auditRows().map((a) => [a.outcome, a.reason_code])).toEqual([['intake_queued', 'override_staff_unverified']]);
    expect(fake.admin.reads.some((x) => x.table === 'profiles')).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('staff_unverified_override for someone no longer staff → not_staff', async () => {
    fake.admin.state.staff.clear();
    await runKind('staff_unverified_override', STAFF);
    expect(auditRows().map((a) => [a.outcome, a.reason_code])).toEqual([['gated', 'not_staff']]);
    expect(send).not.toHaveBeenCalled();
  });

  it('external_override: no staff or phone check, intake without a staff id, audited as an override', async () => {
    fake.admin.state.staff.clear();
    await runKind('external_override', null);
    expect(fake.admin.rpcCalls).toEqual([]);
    expect(intakeWrites()[0].row).toMatchObject({ staff_user_id: null, allowlist_entry_id: ENTRY });
    expect(auditRows()).toEqual([
      expect.objectContaining({
        outcome: 'intake_queued',
        reason_code: 'override_external',
        staff_user_id: null,
        allowlist_entry_id: ENTRY,
      }),
    ]);
  });

  it('external_override still obeys the kill switch, the rate limit and the daily cap', async () => {
    fake.admin.state.settings!.owner_agent_daily_cap = 0;
    const r = routing({
      dailyCap: 0,
      allowlist: new Map([
        [STAFF_E164, entry({ staffUserId: null, approvalKind: 'external_override' })],
      ]),
    });
    const d = planOwnerAgentDiversion(body(CHOSEN, [textMessage('wamid.cap', STAFF_WA_ID)]), r);
    await handleOwnerAgentMessages(d.messages, r);
    expect(auditRows().map((a) => a.reason_code)).toEqual(['daily_cap']);
    fake.admin.writes = [];
    await handleOwnerAgentMessages(d.messages, { ...r, enabled: false });
    expect(auditRows().map((a) => a.reason_code)).toEqual(['kill_switch_off']);
  });
});

// ═══ Capabilities (plans/owner-agent-chat-sdk-capabilities-plan.md §4.2, §4.4, §4.5, §4.7) ═══

const MEDIA_ID = '1234567890123456';
const SHA = 'n2Wd3M1l7tpdo6BhKjQ8ZrEtuLq2sB2L7GxjqzVr0qA=';

async function runOne(message: Record<string, unknown>, r: OwnerAgentRouting = routing()) {
  const d = planOwnerAgentDiversion(body(CHOSEN, [message]), r);
  await handleOwnerAgentMessages(d.messages, r);
  return d;
}
function decisions() {
  return auditRows().map((a) => [a.outcome, a.reason_code]);
}

describe('the type gate: admitted types become intake rows the CHECKs accept', () => {
  const base = { from: STAFF_WA_ID, timestamp: '1700000000' };
  it.each<[string, Record<string, unknown>, Record<string, unknown>]>([
    [
      'image + caption',
      { id: 'wamid.i', type: 'image', image: { id: MEDIA_ID, mime_type: 'image/jpeg', sha256: SHA, caption: 'מה זה?' } },
      { message_type: 'image', message_text: 'מה זה?', media_id: MEDIA_ID, media_mime: 'image/jpeg', media_sha256_b64: SHA, media_filename: null, media_voice: null },
    ],
    [
      'document + filename, no caption',
      { id: 'wamid.d', type: 'document', document: { id: MEDIA_ID, mime_type: 'application/pdf', filename: 'דוח.pdf' } },
      { message_type: 'document', message_text: null, media_id: MEDIA_ID, media_filename: 'דוח.pdf' },
    ],
    [
      'voice note',
      { id: 'wamid.a', type: 'audio', audio: { id: MEDIA_ID, mime_type: 'audio/ogg; codecs=opus', voice: true } },
      { message_type: 'audio', message_text: null, media_id: MEDIA_ID, media_voice: true },
    ],
    [
      'location with name and address',
      { id: 'wamid.l', type: 'location', location: { latitude: 32.08, longitude: 34.78, name: 'אולם', address: 'תל אביב' } },
      { message_type: 'location', location_lat: 32.08, location_lng: 34.78, location_label: 'אולם, תל אביב', media_id: null },
    ],
    [
      'location without a label',
      { id: 'wamid.l2', type: 'location', location: { latitude: -1.5, longitude: 0 } },
      { message_type: 'location', location_lat: -1.5, location_lng: 0, location_label: null },
    ],
    [
      'interactive button_reply, replying to our message',
      { id: 'wamid.b', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'oa:fu:x:1', title: 'עוד' } }, context: { id: 'wamid.ours' } },
      { message_type: 'interactive', interactive_id: 'oa:fu:x:1', interactive_title: 'עוד', reply_to_wamid: 'wamid.ours', message_text: null },
    ],
    [
      'interactive list_reply',
      { id: 'wamid.li', type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'oa:fu:x:4', title: 'שורה', description: 'd' } } },
      { message_type: 'interactive', interactive_id: 'oa:fu:x:4', interactive_title: 'שורה' },
    ],
    [
      'template quick-reply button',
      { id: 'wamid.t', type: 'button', button: { payload: 'stop_reports', text: 'הפסקת דוחות' } },
      { message_type: 'button', interactive_id: 'stop_reports', interactive_title: 'הפסקת דוחות' },
    ],
  ])('%s', async (_l, message, expected) => {
    await runOne({ ...base, ...message });
    expect(decisions()).toEqual([['intake_queued', null]]);
    expect(intakeWrites()).toHaveLength(1);
    expect(intakeWrites()[0].row).toMatchObject({ wamid: message.id, allowlist_entry_id: ENTRY, ...expected });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a text row carries message_type text and no typed group', async () => {
    await runOne(textMessage('wamid.txt', STAFF_WA_ID));
    expect(intakeWrites()[0].row).toMatchObject({ message_type: 'text', message_text: QUESTION, media_id: null, interactive_id: null, location_lat: null, reply_to_wamid: null });
  });

  it.each<[string, Record<string, unknown>]>([
    ['video', { type: 'video', video: { id: MEDIA_ID } }],
    ['sticker', { type: 'sticker', sticker: { id: MEDIA_ID } }],
    ['contacts', { type: 'contacts', contacts: [{ name: { formatted_name: 'x' } }] }],
    ['system (not a BSUID change)', { type: 'system', system: { type: 'customer_changed_number', body: 'x' } }],
    ['unknown', { type: 'unknown', errors: [{ code: 131051 }] }],
    ['no type', {}],
    ['interactive nfm_reply (a flow)', { type: 'interactive', interactive: { type: 'nfm_reply', nfm_reply: { response_json: '{}' } } }],
  ])('%s → gated/unsupported_type, no intake', async (_l, extra) => {
    await runOne({ id: 'wamid.u', ...base, ...extra });
    expect(decisions()).toEqual([['gated', 'unsupported_type']]);
    expect(intakeWrites()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it.each<[string, Record<string, unknown>]>([
    ['media id not digits', { type: 'image', image: { id: 'm1' } }],
    ['media id too long', { type: 'image', image: { id: '1'.repeat(33) } }],
    ['media id a number', { type: 'image', image: { id: 1234 } }],
    ['no media block', { type: 'document' }],
    ['mime too short', { type: 'image', image: { id: MEDIA_ID, mime_type: 'x' } }],
    ['sha256 with a space', { type: 'image', image: { id: MEDIA_ID, sha256: 'ab cd' } }],
    ['filename over 255', { type: 'document', document: { id: MEDIA_ID, filename: 'א'.repeat(256) } }],
    ['voice not boolean', { type: 'audio', audio: { id: MEDIA_ID, voice: 'yes' } }],
    ['caption not a string', { type: 'image', image: { id: MEDIA_ID, caption: 5 } }],
    ['latitude out of range', { type: 'location', location: { latitude: 91, longitude: 0 } }],
    ['latitude a string', { type: 'location', location: { latitude: '32.1', longitude: 34 } }],
    ['longitude missing', { type: 'location', location: { latitude: 32 } }],
    ['label over 1024', { type: 'location', location: { latitude: 1, longitude: 1, name: 'x'.repeat(600), address: 'y'.repeat(600) } }],
    ['button_reply without id', { type: 'interactive', interactive: { type: 'button_reply', button_reply: { title: 'x' } } }],
    ['list_reply id over 1024', { type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'i'.repeat(1025) } } }],
    ['button title over 256', { type: 'button', button: { payload: 'p', text: 't'.repeat(257) } }],
    ['button without payload', { type: 'button', button: { text: 'מגיע' } }],
    ['text without body', { type: 'text', text: {} }],
    ['context id over 512', { type: 'text', text: { body: 'hi' }, context: { id: 'w'.repeat(513) } }],
  ])('%s → gated/invalid_payload, never a DB error', async (_l, extra) => {
    await runOne({ id: 'wamid.bad', ...base, ...extra });
    expect(decisions()).toEqual([['gated', 'invalid_payload']]);
    expect(intakeWrites()).toEqual([]);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a caption over 4096 is text_length, like a text body', async () => {
    await runOne({ id: 'wamid.cap', ...base, type: 'image', image: { id: MEDIA_ID, caption: 'x'.repeat(4097) } });
    expect(decisions()).toEqual([['gated', 'text_length']]);
  });

  it('the type gate comes after the daily cap (an unsupported type spends the rate limit, as non_text did)', async () => {
    const r = routing({ dailyCap: 0 });
    await runOne({ id: 'wamid.v', ...base, type: 'video', video: { id: MEDIA_ID } }, r);
    expect(decisions()).toEqual([['gated', 'daily_cap']]);
  });
});

describe('reactions: after the identity gate, one audit row, nothing else (§4.5, M6)', () => {
  const reaction = (id: string, emoji?: string) => ({
    id,
    from: STAFF_WA_ID,
    timestamp: '1700000000',
    type: 'reaction',
    reaction: { message_id: 'wamid.answer', ...(emoji === undefined ? {} : { emoji }) },
  });

  it.each([
    ['\u{1F44D}', 'feedback_up'],
    ['\u{1F44D}\u{1F3FD}', 'feedback_up'],
    ['\u{1F44D}\u{FE0F}', 'feedback_up'],
    ['\u{1F44E}', 'feedback_down'],
    ['\u{2764}\u{FE0F}', 'reaction_other'],
    ['', 'reaction_removed'],
  ])('%s → %s', async (emoji, code) => {
    expect(reactionReason(emoji)).toBe(code);
    await runOne(reaction('wamid.re', emoji));
    expect(decisions()).toEqual([['reaction_received', code]]);
    expect(auditRows()[0]).toMatchObject({ stage: 'route', intake_id: null, wamid_sha256: sha('wamid.re') });
    expect(JSON.stringify(auditRows())).not.toContain('wamid.answer');
    expect(intakeWrites()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    // The daily cap is never read for a reaction.
    expect(fake.admin.reads.some((r) => r.table === 'owner_agent_intake')).toBe(false);
  });

  it('a reaction without an emoji is a removal', async () => {
    await runOne(reaction('wamid.re0'));
    expect(decisions()).toEqual([['reaction_received', 'reaction_removed']]);
  });

  it('reactions spend neither the rate limit nor the daily cap', async () => {
    const r = routing({ dailyCap: 1 });
    const many = Array.from({ length: OWNER_AGENT_RATE_LIMIT.limit + 5 }, (_, i) => reaction(`wamid.rx${i}`, '\u{1F44D}'));
    const d = planOwnerAgentDiversion(body(CHOSEN, [...many, textMessage('wamid.after', STAFF_WA_ID)]), r);
    await handleOwnerAgentMessages(d.messages, r);
    const out = decisions();
    expect(out.slice(0, many.length).every(([o]) => o === 'reaction_received')).toBe(true);
    expect(out[many.length]).toEqual(['intake_queued', null]);
  });

  it('still behind the identity gate: kill switch and not_staff come first', async () => {
    await runOne(reaction('wamid.k', '\u{1F44D}'), routing({ enabled: false }));
    expect(decisions()).toEqual([['gated', 'kill_switch_off']]);
    fake.admin.writes = [];
    fake.admin.state.staff.clear();
    await runOne(reaction('wamid.k2', '\u{1F44D}'));
    expect(decisions()).toEqual([['gated', 'not_staff']]);
  });
});

// ─── BSUID (§4.7) ────────────────────────────────────────────────────────────

const BSUID = 'IL.13491208655302741918';
const OTHER_BSUID = 'IL.99999999999999999999';
const PARENT = 'IL.ENT.11815799212886844830';

function bound(overrides: Partial<OwnerAgentAllowlistEntry> = {}) {
  return entry({ bsuid: BSUID, boundFromE164: STAFF_E164, ...overrides });
}
function boundRouting(e: OwnerAgentAllowlistEntry = bound(), extra: Partial<OwnerAgentRouting> = {}) {
  return routing({ allowlist: new Map([[STAFF_E164, e]]), bsuids: new Map(e.bsuid ? [[e.bsuid, e]] : []), ...extra });
}
function noFrom(id: string, fromUserId: unknown, extra: Record<string, unknown> = {}) {
  return { id, from_user_id: fromUserId, timestamp: '1700000000', type: 'text', text: { body: QUESTION }, ...extra };
}
function boundState(overrides: Partial<FakeAdminState> = {}) {
  return configured({
    allowlist: [
      { id: ENTRY, e164: STAFF_E164, staff_user_id: STAFF, enabled: true, bsuid: BSUID, bsuid_bound_at: '2026-09-27T00:00:00Z', bound_from_e164: STAFF_E164 },
    ],
    ...overrides,
  });
}

describe('matchBoundBsuid', () => {
  const list = boundRouting().bsuids;
  it('matches a bound BSUID still bound to the row phone', () => {
    expect(matchBoundBsuid(BSUID, list)?.entryId).toBe(ENTRY);
  });
  it('never matches a parent BSUID, junk, or an unbound value', () => {
    for (const v of [PARENT, 'IL.', 'il.123', `${BSUID} `, 123, null, undefined, OTHER_BSUID]) {
      expect(matchBoundBsuid(v, list)).toBeNull();
    }
  });
  it('never matches when the row phone changed after binding', () => {
    const stale = bound({ boundFromE164: '+972501111111' });
    expect(matchBoundBsuid(BSUID, new Map([[BSUID, stale]]))).toBeNull();
  });
});

describe('BSUID diversion (pure)', () => {
  it('a message with NO from and the bound BSUID is diverted, matched by bsuid', () => {
    const d = planOwnerAgentDiversion(body(CHOSEN, [noFrom('wamid.nf', BSUID)]), boundRouting());
    expect(d.messages).toHaveLength(1);
    expect(d.messages[0]).toMatchObject({ wamid: 'wamid.nf', matchedBy: 'bsuid', entry: { entryId: ENTRY }, fromUserId: BSUID });
  });

  it.each<[string, Record<string, unknown>, OwnerAgentRouting]>([
    ['unbound row', noFrom('w', BSUID), routing()],
    ['a different BSUID', noFrom('w', OTHER_BSUID), boundRouting()],
    ['from present (a guest phone) with the staff BSUID', noFrom('w', BSUID, { from: '972501111111' }), boundRouting()],
    ['from present but malformed', noFrom('w', BSUID, { from: '' }), boundRouting()],
    ['from null', noFrom('w', BSUID, { from: null }), boundRouting()],
    ['only from_parent_user_id', { id: 'w', from_parent_user_id: PARENT, type: 'text', text: { body: 'x' } }, boundRouting(bound({ bsuid: BSUID }))],
    ['a stale binding (row phone changed)', noFrom('w', BSUID), boundRouting(bound({ boundFromE164: '+972501111111' }))],
    ['on another number', noFrom('w', BSUID), boundRouting(bound(), { phoneNumberId: OTHER })],
  ])('stays guest traffic: %s', (_l, message, r) => {
    expect(planOwnerAgentDiversion(body(CHOSEN, [message]), r).messages).toEqual([]);
  });

  it('a phone-matched message still wins when its from_user_id is some other value', () => {
    const d = planOwnerAgentDiversion(body(CHOSEN, [{ ...textMessage('w', STAFF_WA_ID), from_user_id: OTHER_BSUID }]), boundRouting());
    expect(d.messages[0]).toMatchObject({ matchedBy: 'phone', fromUserId: OTHER_BSUID });
  });

  it('getOwnerAgentRouting indexes bound enabled rows by BSUID', async () => {
    fake.admin.reset(boundState());
    const r = await getOwnerAgentRouting();
    expect(r?.bsuids.get(BSUID)).toMatchObject({ entryId: ENTRY, bsuid: BSUID, boundFromE164: STAFF_E164 });
  });

  it('a BSUID-matched message runs the full identity gate against the row phone', async () => {
    fake.admin.state.verifiedPhones.set(STAFF, '+972501111111');
    const r = boundRouting();
    const d = planOwnerAgentDiversion(body(CHOSEN, [noFrom('wamid.nf', BSUID)]), r);
    await handleOwnerAgentMessages(d.messages, r);
    expect(decisions()).toEqual([['gated', 'phone_unverified']]);
  });
});

describe('BSUID binding: only from a signed message with a matching, verified from AND a from_user_id', () => {
  const withBsuid = (id: string, fromUserId: unknown = BSUID) => ({ ...textMessage(id, STAFF_WA_ID), from_user_id: fromUserId });
  function allowlistUpdates() {
    return fake.admin.writes.filter((w) => w.table === 'owner_agent_allowlist');
  }

  it('binds by CAS (id + bsuid is null), audits bsuid_bound, and the message continues', async () => {
    await runOne(withBsuid('wamid.bind'));
    const updates = allowlistUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0].row).toEqual({ bsuid: BSUID, bsuid_bound_at: expect.any(String), bound_from_e164: STAFF_E164 });
    expect(updates[0].filters).toEqual([['id', 'eq', ENTRY], ['bsuid', 'is', null]]);
    expect(fake.admin.state.allowlist[0]).toMatchObject({ bsuid: BSUID, bound_from_e164: STAFF_E164 });
    expect(decisions()).toEqual([['bsuid_bound', null], ['intake_queued', null]]);
    expect(JSON.stringify(auditRows())).not.toContain(BSUID);
  });

  it.each<[string, () => void, Record<string, unknown>, OwnerAgentRouting | undefined]>([
    ['kill switch off', () => {}, withBsuid('w1'), routing({ enabled: false })],
    ['not staff', () => fake.admin.state.staff.clear(), withBsuid('w2'), undefined],
    ['phone not verified', () => fake.admin.state.verifiedPhones.set(STAFF, null), withBsuid('w3'), undefined],
    ['a parent BSUID', () => {}, withBsuid('w4', PARENT), undefined],
    ['a malformed from_user_id', () => {}, withBsuid('w5', 'IL.12 34'), undefined],
    ['no from_user_id', () => {}, textMessage('w6', STAFF_WA_ID), undefined],
    ['matched by BSUID (no from)', () => {}, noFrom('w8', BSUID), boundRouting()],
  ])('never binds: %s', async (_l, arrange, message, r) => {
    arrange();
    await runOne(message, r ?? routing());
    expect(allowlistUpdates()).toEqual([]);
    expect(auditRows().some((a) => a.outcome === 'bsuid_bound')).toBe(false);
  });

  it('staff_unverified_override binds on the phone match alone (no verified phone for that kind)', async () => {
    fake.admin.state.verifiedPhones.set(STAFF, null);
    await runOne(withBsuid('wamid.o'), routing({ allowlist: new Map([[STAFF_E164, entry({ approvalKind: 'staff_unverified_override' })]]) }));
    expect(decisions()).toEqual([['bsuid_bound', null], ['intake_queued', 'override_staff_unverified']]);
  });

  it('a BSUID already bound to ANOTHER row (23505): one ids-only alert, the message still continues', async () => {
    fake.admin.state.allowlist.push({
      id: 'c3d4e5f6-a7b8-4c9d-8e0f-1a2b3c4d5e6f', e164: '+972501111111', staff_user_id: STAFF, enabled: true,
      bsuid: BSUID, bsuid_bound_at: '2026-09-27T00:00:00Z', bound_from_e164: '+972501111111',
    });
    await runOne(withBsuid('wamid.dup'));
    expect(decisions()).toEqual([['intake_queued', null]]);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(alert.fields).toEqual({ step: 'bind', code: '23505', entry: ENTRY });
    expect(JSON.stringify(alert)).not.toContain(BSUID);
    expect(JSON.stringify(alert)).not.toContain(STAFF_WA_ID);
  });

  it('a lost CAS race (row bound meanwhile) writes no audit and no alert', async () => {
    fake.admin.state.allowlist[0] = { ...fake.admin.state.allowlist[0], bsuid: OTHER_BSUID, bsuid_bound_at: 'x', bound_from_e164: STAFF_E164 };
    await runOne(withBsuid('wamid.race')); // routing still shows the row unbound
    expect(fake.admin.state.allowlist[0].bsuid).toBe(OTHER_BSUID);
    expect(decisions()).toEqual([['intake_queued', null]]);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

describe('BSUID rotation revokes, never moves (observed, not diverted)', () => {
  function rotationBody(value: Record<string, unknown>) {
    return { object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes: [{ field: 'user_id_update', value }] }] };
  }
  const changed = (previous: string, current: string) => ({
    wa_id: '972500000009', detail: 'x', user_id: { previous, current }, timestamp: '1700000000',
  });
  const systemChange = (id: string, extra: Record<string, unknown> = {}) => ({
    id, from: '972500000009', timestamp: '1700000000', type: 'system',
    system: { type: 'user_changed_user_id', body: 'User X changed', user_id: OTHER_BSUID, wa_id: '972500000009' },
    ...extra,
  });

  it.each([
    ['user_id_update, array shape (previous)', rotationBody({ metadata: { phone_number_id: OTHER }, user_id_update: [changed(BSUID, OTHER_BSUID)] })],
    ['user_id_update, single-object shape', rotationBody(changed(BSUID, OTHER_BSUID))],
    ['user_id_update naming it as current', rotationBody({ user_id_update: [changed('IL.1', BSUID)] })],
  ])('%s → one revocation', (_l, data) => {
    const d = planOwnerAgentDiversion(data, boundRouting());
    expect(d.messages).toEqual([]);
    expect(d.revocations).toContainEqual({ bsuid: BSUID, reason: 'user_id_update', wamid: null });
  });

  it('a user_changed_user_id system message from the STAFF phone on the chosen number is not diverted, only revoked', () => {
    const d = planOwnerAgentDiversion(body(CHOSEN, [systemChange('wamid.sys', { from: STAFF_WA_ID, from_user_id: BSUID })]), boundRouting());
    expect(d.messages).toEqual([]);
    expect(d.wamids.size).toBe(0);
    // Both structured ids are candidates; the handler finds which one is bound.
    expect(d.revocations).toEqual([
      { bsuid: BSUID, reason: 'user_changed_user_id', wamid: 'wamid.sys' },
      { bsuid: OTHER_BSUID, reason: 'user_changed_user_id', wamid: 'wamid.sys' },
    ]);
  });

  it('system.user_id naming the bound BSUID revokes too; system.body is never parsed', () => {
    const viaUserId = systemChange('w1');
    (viaUserId.system as Record<string, unknown>).user_id = BSUID;
    expect(planOwnerAgentDiversion(body(OTHER, [viaUserId]), boundRouting()).revocations.map((r) => r.bsuid)).toEqual([BSUID]);
    const viaBody = systemChange('w2');
    (viaBody.system as Record<string, unknown>).body = `User ${BSUID} changed from ${BSUID} to ${OTHER_BSUID}`;
    expect(planOwnerAgentDiversion(body(OTHER, [viaBody]), boundRouting()).revocations.map((r) => r.bsuid)).toEqual([OTHER_BSUID]);
  });

  it('a BSUID rotated in this same delivery identifies no one', () => {
    const data = body(CHOSEN, [systemChange('wamid.sys', { from_user_id: BSUID }), noFrom('wamid.late', BSUID)]);
    const d = planOwnerAgentDiversion(data, boundRouting());
    expect(d.messages).toEqual([]);
    expect(d.revocations.map((r) => r.bsuid)).toContain(BSUID);
  });

  it('parent ids never count; no routing → nothing', () => {
    const parentOnly = rotationBody({ user_id_update: [{ parent_user_id: { previous: PARENT, current: PARENT } }] });
    expect(planOwnerAgentDiversion(parentOnly, boundRouting())).toBe(NO_DIVERSION);
    expect(planOwnerAgentDiversion(rotationBody(changed(BSUID, OTHER_BSUID)), null)).toBe(NO_DIVERSION);
  });

  it('a rotation of a BSUID bound to nobody: one read, no write, no audit, no alert', async () => {
    const d = planOwnerAgentDiversion(rotationBody(changed('IL.1', 'IL.2')), routing());
    await handleOwnerAgentRevocations(d.revocations);
    expect(fake.admin.reads.map((r) => [r.table, r.columns])).toEqual([['owner_agent_allowlist', 'id, staff_user_id, bsuid']]);
    expect(fake.admin.writes).toEqual([]);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a DISABLED bound row is revoked too (resolved against all rows, not the routing map)', async () => {
    fake.admin.reset(boundState());
    fake.admin.state.allowlist[0].enabled = false;
    // Routing holds enabled rows only — here none of them is bound.
    const d = planOwnerAgentDiversion(rotationBody(changed(BSUID, OTHER_BSUID)), routing());
    await handleOwnerAgentRevocations(d.revocations);
    const read = fake.admin.reads.find((r) => r.table === 'owner_agent_allowlist');
    expect(read?.filters.map(([c, op]) => `${c}:${op}`)).toEqual(['bsuid:in']); // no enabled filter
    expect(fake.admin.state.allowlist[0]).toMatchObject({ enabled: false, bsuid: null, bound_from_e164: null });
    expect(decisions()).toEqual([['bsuid_revoked', 'user_id_update']]);
  });

  it('the revocation read failing → one ids-only alert, no write, never throws', async () => {
    fake.admin.reset(boundState({ allowlistError: { code: '57014', message: `row (${BSUID})` } }));
    const d = planOwnerAgentDiversion(rotationBody(changed(BSUID, OTHER_BSUID)), boundRouting());
    await expect(handleOwnerAgentRevocations(d.revocations)).resolves.toBeUndefined();
    expect(fake.admin.writes).toEqual([]);
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].fields).toEqual({ step: 'revoke_read', code: '57014' });
    expect(JSON.stringify(vi.mocked(sendSlackAlert).mock.calls)).not.toContain(BSUID);
  });

  it('handleOwnerAgentRevocations: CAS on the old value clears all four columns, one audit, one ids-only alert; a retry is a no-op', async () => {
    fake.admin.reset(boundState());
    fake.admin.state.allowlist[0].parent_bsuid = PARENT;
    const d = planOwnerAgentDiversion(rotationBody(changed(BSUID, OTHER_BSUID)), boundRouting());
    await handleOwnerAgentRevocations(d.revocations);
    const upd = fake.admin.writes.filter((w) => w.table === 'owner_agent_allowlist');
    expect(upd).toHaveLength(1);
    expect(upd[0].row).toEqual({ bsuid: null, parent_bsuid: null, bsuid_bound_at: null, bound_from_e164: null });
    expect(upd[0].filters).toEqual([['id', 'eq', ENTRY], ['bsuid', 'eq', BSUID]]);
    expect(fake.admin.state.allowlist[0]).toMatchObject({ bsuid: null, parent_bsuid: null, bound_from_e164: null });
    expect(auditRows()).toEqual([
      { stage: 'route', outcome: 'bsuid_revoked', reason_code: 'user_id_update', staff_user_id: STAFF, allowlist_entry_id: ENTRY, intake_id: null, wamid_sha256: null },
    ]);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(alert).toMatchObject({ level: 'warn', source: 'owner-agent', fields: { entry: ENTRY, reason: 'user_id_update' } });
    expect(JSON.stringify(alert)).not.toContain(BSUID);

    vi.mocked(sendSlackAlert).mockClear();
    fake.admin.writes = [];
    await handleOwnerAgentRevocations(d.revocations);
    expect(auditRows()).toEqual([]);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a revocation DB error → failed/db_error audit and one ids-only alert, never throws', async () => {
    fake.admin.reset(boundState({ allowlistUpdateError: { code: '57014', message: `row (${BSUID})` } }));
    const d = planOwnerAgentDiversion(rotationBody(changed(BSUID, OTHER_BSUID)), boundRouting());
    await expect(handleOwnerAgentRevocations(d.revocations)).resolves.toBeUndefined();
    expect(decisions()).toEqual([['failed', 'db_error']]);
    expect(vi.mocked(sendSlackAlert).mock.calls[0][0].fields).toEqual({ step: 'revoke', code: '57014', audit: 'written', entry: ENTRY });
    expect(JSON.stringify(vi.mocked(sendSlackAlert).mock.calls)).not.toContain(BSUID);
  });

  it('after a revocation the next phone-matched message binds the new BSUID', async () => {
    fake.admin.reset(boundState());
    await handleOwnerAgentRevocations(planOwnerAgentDiversion(rotationBody(changed(BSUID, OTHER_BSUID)), boundRouting()).revocations);
    const r = await getOwnerAgentRouting();
    await runOne({ ...textMessage('wamid.new', STAFF_WA_ID), from_user_id: OTHER_BSUID }, r!);
    expect(fake.admin.state.allowlist[0]).toMatchObject({ bsuid: OTHER_BSUID, bound_from_e164: STAFF_E164 });
  });
});

describe('BSUID mismatch: a phone match whose from_user_id differs from the binding', () => {
  it('no rebind, no revoke: one bsuid_mismatch audit, one ids-only warn alert, and the message continues', async () => {
    fake.admin.reset(boundState());
    await runOne({ ...textMessage('wamid.mm', STAFF_WA_ID), from_user_id: OTHER_BSUID }, boundRouting());
    expect(fake.admin.writes.filter((w) => w.table === 'owner_agent_allowlist')).toEqual([]);
    expect(fake.admin.state.allowlist[0]).toMatchObject({ bsuid: BSUID, bound_from_e164: STAFF_E164 });
    expect(decisions()).toEqual([['bsuid_mismatch', null], ['intake_queued', null]]);
    expect(sendSlackAlert).toHaveBeenCalledTimes(1);
    const alert = vi.mocked(sendSlackAlert).mock.calls[0][0];
    expect(alert).toMatchObject({ level: 'warn', source: 'owner-agent', fields: { entry: ENTRY } });
    const text = JSON.stringify([alert, auditRows()]);
    expect(text).not.toContain(BSUID);
    expect(text).not.toContain(OTHER_BSUID);
    expect(text).not.toContain(STAFF_WA_ID);
  });

  it('the same BSUID as bound: nothing extra', async () => {
    await runOne({ ...textMessage('wamid.same', STAFF_WA_ID), from_user_id: BSUID }, boundRouting());
    expect(decisions()).toEqual([['intake_queued', null]]);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a mismatch is only checked after the identity gate', async () => {
    fake.admin.state.staff.clear();
    await runOne({ ...textMessage('wamid.mm2', STAFF_WA_ID), from_user_id: OTHER_BSUID }, boundRouting());
    expect(decisions()).toEqual([['gated', 'not_staff']]);
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });
});

describe('burst window: owner_agent_burst_ms → pg-boss startAfter (seconds)', () => {
  it('0 (the default): the enqueue options are exactly { id }', async () => {
    await runOne(textMessage('wamid.b0', STAFF_WA_ID));
    expect(send.mock.calls[0][2]).toStrictEqual({ id: deterministicJobId('wamid.b0') });
  });

  it('3000 ms → startAfter 3 (seconds), read in the same routing read', async () => {
    fake.admin.reset(configured());
    fake.admin.state.settings!.owner_agent_burst_ms = 3000;
    const r = await getOwnerAgentRouting();
    expect(r?.burstMs).toBe(3000);
    expect(fake.admin.reads.filter((x) => x.table === 'app_settings')).toHaveLength(1);
    await runOne(textMessage('wamid.b3', STAFF_WA_ID), r!);
    expect(send.mock.calls[0][2]).toStrictEqual({ id: deterministicJobId('wamid.b3'), startAfter: 3 });
  });

  it('a sub-second window stays fractional (pg-boss casts "1.5" to an interval)', async () => {
    await runOne(textMessage('wamid.b15', STAFF_WA_ID), routing({ burstMs: 1500 }));
    expect(send.mock.calls[0][2]).toStrictEqual({ id: deterministicJobId('wamid.b15'), startAfter: 1.5 });
  });

  it('a missing column reads as 0', async () => {
    fake.admin.reset(configured());
    expect((await getOwnerAgentRouting())?.burstMs).toBe(0);
  });
});
