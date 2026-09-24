import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));

import { createFakeTableClient, type FakeTableClient, type TableRow } from '@/test/fake-table-client';
import type { createAdminClient } from '@/lib/supabase/admin';
import { OwnerAgentRunError, type OwnerAgentRunInput, type OwnerAgentRunResult } from '@/lib/owner-agent/runner';
import { OWNER_AGENT_PERMISSIONS } from '@/lib/owner-agent/tools/shared';
import type { DeliveryOutcome } from '@/lib/whatsapp/client';

import { OWNER_AGENT_RUN_TIMEOUT_MS } from './budgets';
import {
  ANSWER_WINDOW_MS,
  OwnerAgentReplyError,
  handleOwnerAgentReply,
  type ReplyDeps,
  type WhatsAppSender,
} from './reply';
import {
  OWNER_AGENT_FAILURE_REPLY,
  OWNER_AGENT_SQL_UNAVAILABLE_NOTE,
  OWNER_AGENT_SYSTEM_PROMPT,
  WHATSAPP_TEXT_LIMIT,
} from './reply-text';
import { createSessionMemory, ownerAgentConfigFingerprint } from './sessions';
import { OwnerAgentStoreError, createReplyStore } from './store';

// The reply consumer, end to end, with NO real CLI, database or WhatsApp: the
// REAL store (store.ts) over a filter-aware in-memory table fake, so the status
// CAS that prevents a double send is exercised by its actual WHERE clause; the
// runner and the WhatsApp send are fakes that record what they were given.

type AdminClient = ReturnType<typeof createAdminClient>;

const NOW = Date.parse('2026-09-24T09:30:00Z'); // 12:30 Israel
const STAFF = '11111111-1111-4111-8111-111111111111';
const OTHER_STAFF = '22222222-2222-4222-8222-222222222222';
const INTAKE = '33333333-3333-4333-8333-333333333333';
const SESSION = '44444444-4444-4444-8444-444444444444';
const SESSION_2 = '55555555-5555-4555-8555-555555555555';
const PHONE = '+972501234567';
const NUMBER = '1111222233334444';
const OTHER_NUMBER = '5555666677778888';
const WAMID = 'wamid.HBgMOTcyNTAxMjM0NTY3FQIAEhgUM0E';
const QUESTION = 'כמה אירועים פעילים יש השבוע? QUESTION-SENTINEL';
const ANSWER = 'יש 12 אירועים פעילים.';

// ── The migration's CHECK shapes, read from the file, not retyped ─────────────

const MIGRATION = readFileSync(
  path.join(import.meta.dirname, '../../../../supabase/migrations/20260924034054_owner_agent_whatsapp.sql'),
  'utf8',
);
function checkRegex(pattern: RegExp): RegExp {
  const m = pattern.exec(MIGRATION);
  if (!m) throw new Error(`CHECK not found: ${pattern}`);
  return new RegExp(m[1]);
}
const CHECKS = {
  stage: checkRegex(/owner_agent_audit_stage_shape\s+check \(stage ~ '([^']+)'\)/),
  outcome: checkRegex(/owner_agent_audit_outcome_shape\s+check \(outcome ~ '([^']+)'\)/),
  reason: checkRegex(/reason_code is null or reason_code ~ '([^']+)'/),
  toolNames: checkRegex(/array_to_string\(tool_names, ','\) ~ '([^']+)'/),
  wamid: checkRegex(/wamid_sha256 is null or wamid_sha256 ~ '([^']+)'/),
  intakeStatus: checkRegex(/owner_agent_intake_status_shape\s+check \(status ~ '([^']+)'\)/),
};

function assertAuditFitsChecks(row: TableRow): void {
  expect(row.stage).toMatch(CHECKS.stage);
  expect(row.outcome).toMatch(CHECKS.outcome);
  if (row.reason_code !== null) expect(row.reason_code).toMatch(CHECKS.reason);
  if (row.wamid_sha256 !== null) expect(row.wamid_sha256).toMatch(CHECKS.wamid);
  if (row.tool_names !== null) {
    const names = row.tool_names as string[];
    expect(names.length).toBeLessThanOrEqual(32);
    expect(names.join(',')).toMatch(CHECKS.toolNames);
  }
  for (const key of ['steps', 'latency_ms'] as const) {
    if (row[key] !== null) expect(row[key]).toBeGreaterThanOrEqual(0);
  }
  // Ids and codes only: nothing of the question, the answer or the phone.
  const json = JSON.stringify(row);
  for (const leak of ['QUESTION-SENTINEL', 'אירועים', '972501234567', WAMID]) expect(json).not.toContain(leak);
}

// ── The world ─────────────────────────────────────────────────────────────────

interface World {
  db: FakeTableClient;
  staff: Set<string>;
  granted: Set<string>;
  deps: ReplyDeps;
  run: ReturnType<typeof vi.fn<(input: OwnerAgentRunInput) => Promise<OwnerAgentRunResult>>>;
  sendText: ReturnType<typeof vi.fn<(s: WhatsAppSender, p: { to: string; body: string }) => Promise<DeliveryOutcome>>>;
  logs: string[];
  alerts: unknown[];
  clock: { now: number };
}

let stateDir: string;
beforeEach(() => {
  stateDir = mkdtempSync(path.join(tmpdir(), 'owner-agent-reply-'));
});
afterEach(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

const iso = (ms: number) => new Date(ms).toISOString();
const ok = (over: Partial<OwnerAgentRunResult> = {}): OwnerAgentRunResult => ({
  text: ANSWER,
  costUsd: 0.01,
  sessionId: SESSION,
  toolNames: ['events_pipeline'],
  turns: 3,
  sqlUnavailable: false,
  ...over,
});

function world(opts: { intake?: Partial<TableRow>; settings?: Partial<TableRow>; extraIntake?: TableRow[] } = {}): World {
  const staff = new Set([STAFF]);
  const granted = new Set<string>(OWNER_AGENT_PERMISSIONS);
  const db = createFakeTableClient(
    {
      app_settings: [
        { id: true, owner_agent_enabled: true, owner_agent_phone_number_id: NUMBER, owner_agent_daily_cap: 50, ...opts.settings },
      ],
      owner_agent_allowlist: [{ id: 'row-1', e164: PHONE, staff_user_id: STAFF, enabled: true }],
      profiles: [{ id: STAFF, phone_verified_e164: PHONE }],
      owner_agent_intake: [
        {
          id: INTAKE,
          wamid: WAMID,
          phone_number_id: NUMBER,
          staff_user_id: STAFF,
          message_text: QUESTION,
          status: 'queued',
          received_at: iso(NOW - 60_000),
          processed_at: null,
          ...opts.intake,
        },
        ...(opts.extraIntake ?? []),
      ],
      owner_agent_audit: [],
    },
    {
      is_platform_staff_for_user: (a) => ({ data: staff.has(String(a?._user_id)) }),
      has_platform_permission_for_user: (a) => ({ data: a?._user_id === STAFF && granted.has(String(a?._key)) }),
    },
  );
  const clock = { now: NOW };
  const logs: string[] = [];
  const alerts: unknown[] = [];
  const run = vi.fn<(input: OwnerAgentRunInput) => Promise<OwnerAgentRunResult>>(async () => ok());
  const sendText = vi.fn<(s: WhatsAppSender, p: { to: string; body: string }) => Promise<DeliveryOutcome>>(
    async () => ({ kind: 'accepted', providerId: 'wamid.out' }),
  );
  const deps: ReplyDeps = {
    store: createReplyStore(db.client as unknown as AdminClient),
    sessions: createSessionMemory(path.join(stateDir, 'sessions.json')),
    run,
    sender: async (phoneNumberId) => ({ phoneNumberId: `config-default-not-${phoneNumberId}`, accessToken: 'tok', appSecret: null }),
    sendText,
    alert: async (a) => {
      alerts.push(a);
    },
    log: (line) => logs.push(line),
    now: () => clock.now,
  };
  return { db, staff, granted, deps, run, sendText, logs, alerts, clock };
}

const job = { data: { intakeId: INTAKE } };
const intakeRow = (w: World) => w.db.tables.owner_agent_intake.find((r) => r.id === INTAKE);
const audits = (w: World) => w.db.tables.owner_agent_audit;
const settingsRow = (w: World) => w.db.tables.app_settings[0];

function expectSilence(w: World) {
  expect(w.sendText).not.toHaveBeenCalled();
}

// ─────────────────────────────────────────────────────────────────────────────

describe('a question that passes every gate', () => {
  it('is answered once, from the number it arrived on, to the verified phone, and audited', async () => {
    const w = world();
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('answered');

    expect(w.run).toHaveBeenCalledTimes(1);
    const input = w.run.mock.calls[0][0];
    expect(input).toEqual({
      prompt: expect.stringContaining(QUESTION),
      systemPrompt: OWNER_AGENT_SYSTEM_PROMPT,
      permissions: [...OWNER_AGENT_PERMISSIONS],
      model: 'sonnet',
      maxTurns: 12,
      timeoutMs: OWNER_AGENT_RUN_TIMEOUT_MS,
    });
    // Israel's date and time is in the PROMPT (the system prompt is frozen on resume).
    expect(input.prompt).toContain('24.09.2026, 12:30');
    expect(OWNER_AGENT_SYSTEM_PROMPT).not.toMatch(/\d{2}\.\d{2}\.\d{4}/);

    expect(w.sendText).toHaveBeenCalledTimes(1);
    const [from, params] = w.sendText.mock.calls[0];
    expect(from.phoneNumberId).toBe(NUMBER);
    expect(params).toEqual({ to: PHONE, body: ANSWER });

    expect(intakeRow(w)).toMatchObject({ status: 'answered' });
    expect(intakeRow(w)?.processed_at).toEqual(expect.any(String));
    expect(audits(w)).toHaveLength(1);
    expect(audits(w)[0]).toMatchObject({
      stage: 'send',
      outcome: 'answered',
      reason_code: null,
      staff_user_id: STAFF,
      intake_id: INTAKE,
      tool_names: ['events_pipeline'],
      steps: 3,
    });
    for (const row of audits(w)) assertAuditFitsChecks(row);
  });

  it('passes the runner exactly the permissions resolved server-side, one RPC per key', async () => {
    const w = world();
    w.granted.clear();
    w.granted.add('view_webhooks');
    w.granted.add('view_events');
    await handleOwnerAgentReply(job, w.deps);
    expect(w.run.mock.calls[0][0].permissions).toEqual(['view_events', 'view_webhooks']);
    const keys = w.db.rpcCalls.filter((c) => c.fn === 'has_platform_permission_for_user').map((c) => c.args?._key);
    expect(keys).toEqual([...OWNER_AGENT_PERMISSIONS]);
    for (const c of w.db.rpcCalls) expect(c.args?._user_id).toBe(STAFF);
  });

  it('a staff member with no permission still gets a run, with no tools', async () => {
    const w = world();
    w.granted.clear();
    await handleOwnerAgentReply(job, w.deps);
    expect(w.run.mock.calls[0][0].permissions).toEqual([]);
  });
});

describe('every gate failure is silence: no model run, no message, one audit row', () => {
  it.each<[string, string, (w: World) => void]>([
    ['the switch is off', 'kill_switch_off', (w) => (settingsRow(w).owner_agent_enabled = false)],
    ['the settings row is gone', 'not_configured', (w) => (w.db.tables.app_settings = [])],
    ['the chosen number moved', 'number_changed', (w) => (settingsRow(w).owner_agent_phone_number_id = OTHER_NUMBER)],
    ['no number is chosen any more', 'number_changed', (w) => (settingsRow(w).owner_agent_phone_number_id = null)],
    ['the sender is no longer staff', 'not_staff', (w) => w.staff.clear()],
    ['the verified phone was cleared', 'phone_unverified', (w) => (w.db.tables.profiles[0].phone_verified_e164 = null)],
    ['the profile is gone', 'phone_unverified', (w) => (w.db.tables.profiles = [])],
    ['the allow-list row was disabled', 'not_allowlisted', (w) => (w.db.tables.owner_agent_allowlist[0].enabled = false)],
    ['the allow-list row was removed', 'not_allowlisted', (w) => (w.db.tables.owner_agent_allowlist = [])],
    [
      'the row belongs to another staff member',
      'not_allowlisted',
      (w) => (w.db.tables.owner_agent_allowlist[0].staff_user_id = OTHER_STAFF),
    ],
    [
      'the verified phone is not the allow-listed one',
      'not_allowlisted',
      (w) => (w.db.tables.profiles[0].phone_verified_e164 = '+972529999999'),
    ],
    ['the daily cap was lowered to zero', 'daily_cap', (w) => (settingsRow(w).owner_agent_daily_cap = 0)],
  ])('%s → %s', async (_label, reason, arrange) => {
    const w = world();
    arrange(w);
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('gated');
    expect(w.run).not.toHaveBeenCalled();
    expectSilence(w);
    expect(intakeRow(w)).toMatchObject({ status: 'skipped' });
    expect(audits(w)).toEqual([expect.objectContaining({ stage: 'agent', outcome: 'gated', reason_code: reason })]);
    for (const row of audits(w)) assertAuditFitsChecks(row);
  });

  it('the daily cap counts today\'s OTHER rows of this staff member, not this one', async () => {
    const today = (id: string, staff = STAFF) => ({
      id,
      wamid: `w-${id}`,
      phone_number_id: NUMBER,
      staff_user_id: staff,
      message_text: 'x',
      status: 'answered',
      received_at: iso(NOW - 3_600_000),
    });
    // cap 2: this row + one other today → allowed (the route counted 1 < 2).
    const allowed = world({ settings: { owner_agent_daily_cap: 2 }, extraIntake: [today('a'), today('b', OTHER_STAFF)] });
    expect(await handleOwnerAgentReply(job, allowed.deps)).toBe('answered');
    // cap 2 with two others today → capped.
    const capped = world({ settings: { owner_agent_daily_cap: 2 }, extraIntake: [today('a'), today('c')] });
    expect(await handleOwnerAgentReply(job, capped.deps)).toBe('gated');
    expect(audits(capped)[0]).toMatchObject({ reason_code: 'daily_cap' });
    // Yesterday (Israel) does not count.
    const yesterday = world({
      settings: { owner_agent_daily_cap: 1 },
      extraIntake: [{ ...today('d'), received_at: iso(NOW - 20 * 3_600_000) }],
    });
    expect(await handleOwnerAgentReply(job, yesterday.deps)).toBe('answered');
    // Questions that arrived AFTER this one do not count against it (review 24.9).
    const later = world({
      settings: { owner_agent_daily_cap: 1 },
      extraIntake: [
        { ...today('e'), status: 'queued', received_at: iso(NOW - 30_000) },
        { ...today('f'), status: 'queued', received_at: iso(NOW - 10_000) },
      ],
    });
    expect(await handleOwnerAgentReply(job, later.deps)).toBe('answered');
  });

  it('the cap is counted on the Israel day the question ARRIVED, even when answered after midnight', async () => {
    // 23:59:30 Israel on the 24th (IDT, UTC+3); handled at 00:00:30 on the 25th.
    const arrived = Date.parse('2026-09-24T20:59:30Z');
    const w = world({
      settings: { owner_agent_daily_cap: 1 },
      intake: { received_at: iso(arrived) },
      extraIntake: [
        {
          id: 'earlier-that-day',
          wamid: 'w-x',
          phone_number_id: NUMBER,
          staff_user_id: STAFF,
          message_text: 'x',
          status: 'answered',
          received_at: iso(arrived - 3_600_000),
        },
      ],
    });
    w.clock.now = arrived + 60_000;
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('gated');
    expect(audits(w)[0]).toMatchObject({ reason_code: 'daily_cap' });
  });
});

describe('the send-time gate (§3.1 #3): state can change while the model runs', () => {
  it.each<[string, string, (w: World) => void]>([
    ['the switch is turned off', 'kill_switch_off', (w) => (settingsRow(w).owner_agent_enabled = false)],
    ['the number is moved', 'number_changed', (w) => (settingsRow(w).owner_agent_phone_number_id = OTHER_NUMBER)],
    ['the recipient row is disabled', 'not_allowlisted', (w) => (w.db.tables.owner_agent_allowlist[0].enabled = false)],
  ])('%s mid-run → no message (%s)', async (_label, reason, change) => {
    const w = world();
    w.run.mockImplementation(async () => {
      change(w);
      return ok();
    });
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('send_gated');
    expectSilence(w);
    expect(intakeRow(w)).toMatchObject({ status: 'skipped' });
    expect(audits(w)).toEqual([expect.objectContaining({ stage: 'send', outcome: 'gated', reason_code: reason })]);
  });

  it('switch off during a FAILED run → not even the fixed failure reply (9.6)', async () => {
    const w = world();
    w.run.mockImplementation(async () => {
      settingsRow(w).owner_agent_enabled = false;
      throw new OwnerAgentRunError('timeout');
    });
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('send_gated');
    expectSilence(w);
    expect(audits(w).map((r) => [r.stage, r.outcome, r.reason_code])).toEqual([
      ['agent', 'run_failed', 'timeout'],
      ['send', 'gated', 'kill_switch_off'],
    ]);
  });
});

describe('a failed run gets ONE fixed reply, never the error', () => {
  it.each(['timeout', 'mcp_unavailable', 'model_error', 'token_unavailable', 'max_turns'] as const)(
    'runner code %s',
    async (code) => {
      const w = world();
      w.run.mockRejectedValue(new OwnerAgentRunError(code));
      expect(await handleOwnerAgentReply(job, w.deps)).toBe('fallback_sent');
      expect(w.sendText).toHaveBeenCalledTimes(1);
      expect(w.sendText.mock.calls[0][1]).toEqual({ to: PHONE, body: OWNER_AGENT_FAILURE_REPLY });
      expect(OWNER_AGENT_FAILURE_REPLY).not.toMatch(/[a-z_]{4,}/);
      expect(intakeRow(w)).toMatchObject({ status: 'answered' });
      expect(audits(w).map((r) => [r.stage, r.outcome, r.reason_code])).toEqual([
        ['agent', 'run_failed', code],
        ['send', 'fallback_sent', code],
      ]);
      for (const row of audits(w)) assertAuditFitsChecks(row);
    },
  );

  it('an unexpected exception is run_exception, and its text goes nowhere', async () => {
    const w = world();
    w.run.mockRejectedValue(new Error('relation "x" does not exist ERROR-SENTINEL'));
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('fallback_sent');
    expect(w.sendText.mock.calls[0][1].body).toBe(OWNER_AGENT_FAILURE_REPLY);
    expect(audits(w)[0]).toMatchObject({ reason_code: 'run_exception' });
    expect(JSON.stringify([w.logs, w.alerts, audits(w)])).not.toContain('ERROR-SENTINEL');
  });

  it('an empty answer is a failure, not an empty message', async () => {
    const w = world();
    w.run.mockResolvedValue(ok({ text: '   \n ' }));
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('fallback_sent');
    expect(w.sendText.mock.calls[0][1].body).toBe(OWNER_AGENT_FAILURE_REPLY);
    expect(audits(w)[0]).toMatchObject({ outcome: 'run_failed', reason_code: 'empty_answer' });
  });
});

describe('never twice', () => {
  it('a second delivery of an answered job sends nothing', async () => {
    const w = world();
    await handleOwnerAgentReply(job, w.deps);
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('already_done');
    expect(w.sendText).toHaveBeenCalledTimes(1);
    expect(w.run).toHaveBeenCalledTimes(1);
  });

  it('a delivery that finds the row `sending` (an earlier one died mid-send) sends nothing and closes it', async () => {
    const w = world({ intake: { status: 'sending' } });
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('send_unconfirmed');
    expect(w.run).not.toHaveBeenCalled();
    expectSilence(w);
    expect(intakeRow(w)).toMatchObject({ status: 'failed' });
    expect(audits(w)).toEqual([
      expect.objectContaining({ stage: 'send', outcome: 'send_failed', reason_code: 'send_unconfirmed' }),
    ]);
  });

  it('a database error before the send claim throws for a retry, and the retry sends exactly once', async () => {
    const w = world();
    w.db.fail('owner_agent_allowlist', '08006'); // the agent gate's allow-list read
    const err = await handleOwnerAgentReply(job, w.deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OwnerAgentStoreError);
    expect((err as Error).message).toBe('owner_agent_store_allowlist');
    expectSilence(w);
    expect(intakeRow(w)).toMatchObject({ status: 'processing' });

    expect(await handleOwnerAgentReply(job, w.deps)).toBe('answered');
    expect(w.sendText).toHaveBeenCalledTimes(1);
  });

  it('two deliveries at once: both may run the model, only one sends', async () => {
    const w = world();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started = 0;
    w.run.mockImplementation(async () => {
      started += 1;
      if (started === 2) release();
      await gate;
      return ok();
    });
    const outcomes = await Promise.all([handleOwnerAgentReply(job, w.deps), handleOwnerAgentReply(job, w.deps)]);
    expect(outcomes.sort()).toEqual(['answered', 'lost_race']);
    expect(w.run).toHaveBeenCalledTimes(2);
    expect(w.sendText).toHaveBeenCalledTimes(1);
  });

  it('a row another delivery moved to `sending` after this one loaded it is not claimed', async () => {
    const w = world();
    const real = w.deps.store;
    let raced = false;
    w.deps.store = {
      ...real,
      transition: async (id, from, to) => {
        if (!raced) {
          raced = true;
          intakeRow(w)!.status = 'sending'; // the other delivery, between our load and our claim
        }
        return real.transition(id, from, to);
      },
    };
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('lost_race');
    expect(w.run).not.toHaveBeenCalled();
    expectSilence(w);
  });

  it('a failed send is final: a later delivery does not try again', async () => {
    const w = world();
    w.sendText.mockResolvedValue({ kind: 'unknown', reason: 'send_threw' });
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('send_failed');
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('already_done');
    expect(w.sendText).toHaveBeenCalledTimes(1);
  });

  it('after the send claim nothing throws, even when every write fails', async () => {
    const w = world();
    w.sendText.mockImplementation(async () => {
      w.db.fail('owner_agent_intake', '08006', 'update');
      w.db.fail('owner_agent_audit', '08006', 'insert');
      return { kind: 'accepted', providerId: 'x' };
    });
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('answered');
    expect(w.logs.some((l) => l.includes('status_not_recorded'))).toBe(true);
    expect(w.alerts).toHaveLength(1);
  });
});

describe('the 4096 split', () => {
  it('a long answer goes out as several WhatsApp-sized messages, in order', async () => {
    const w = world();
    const para = `${'א'.repeat(3000)}\n`;
    const long = `${para}${para}${para}`; // ~9000 characters
    w.run.mockResolvedValue(ok({ text: long }));
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('answered');
    const bodies = w.sendText.mock.calls.map((c) => c[1].body);
    expect(bodies).toHaveLength(3);
    for (const b of bodies) expect(b.length).toBeLessThanOrEqual(WHATSAPP_TEXT_LIMIT);
    expect(bodies.join('').replace(/\s/g, '')).toBe(long.replace(/\s/g, ''));
  });

  it('a later part that fails is recorded as a partial send', async () => {
    const w = world();
    w.run.mockResolvedValue(ok({ text: `${'א'.repeat(4000)}\n${'ב'.repeat(100)}` }));
    w.sendText
      .mockResolvedValueOnce({ kind: 'accepted', providerId: 'x' })
      .mockResolvedValueOnce({ kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: '131026' });
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('send_failed');
    expect(audits(w)[0]).toMatchObject({ outcome: 'send_failed', reason_code: 'partial_send' });
  });
});

describe('send outcomes are codes', () => {
  it.each<[string, DeliveryOutcome, string]>([
    ['the 24h window closed', { kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: '131047' }, 'window_closed'],
    ['a definite rejection', { kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: '131026' }, 'provider_rejected'],
    ['an unknown outcome', { kind: 'unknown', reason: 'provider_error', providerCode: '1' }, 'send_unknown'],
  ])('%s → send_failed/%s', async (_label, outcome, code) => {
    const w = world();
    w.sendText.mockResolvedValue(outcome);
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('send_failed');
    expect(intakeRow(w)).toMatchObject({ status: 'failed' });
    expect(audits(w)[0]).toMatchObject({ stage: 'send', outcome: 'send_failed', reason_code: code, tool_names: ['events_pipeline'] });
  });

  it('a thrown send is send_unknown and does not throw', async () => {
    const w = world();
    w.sendText.mockRejectedValue(new Error('socket hang up'));
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('send_failed');
    expect(audits(w)[0]).toMatchObject({ reason_code: 'send_unknown' });
  });
});

describe('graceful degradation: the Supabase server did not connect', () => {
  it('the answer still goes out, the note is appended IN CODE, and the audit says sql_unavailable', async () => {
    const w = world();
    w.run.mockResolvedValue(ok({ sqlUnavailable: true, toolNames: ['rsvp_totals'] }));
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('answered');
    const body = w.sendText.mock.calls.map((c) => c[1].body).join('\n');
    expect(body).toContain(ANSWER);
    expect(body.endsWith(OWNER_AGENT_SQL_UNAVAILABLE_NOTE)).toBe(true);
    expect(audits(w)).toEqual([
      expect.objectContaining({ stage: 'send', outcome: 'answered', reason_code: 'sql_unavailable' }),
    ]);
    assertAuditFitsChecks(audits(w)[0]);
  });

  it('a normal answer carries no note and no reason code', async () => {
    const w = world();
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('answered');
    const body = w.sendText.mock.calls.map((c) => c[1].body).join('\n');
    expect(body).not.toContain(OWNER_AGENT_SQL_UNAVAILABLE_NOTE);
    expect(audits(w)[0]).toMatchObject({ outcome: 'answered', reason_code: null });
  });
});

describe('conversation history (--resume)', () => {
  async function ask(w: World) {
    w.db.tables.owner_agent_intake[0].status = 'queued';
    w.db.tables.owner_agent_audit = [];
    return handleOwnerAgentReply(job, w.deps);
  }

  it('resumes the same staff member\'s session within 60 minutes, not after', async () => {
    const w = world();
    await ask(w);
    expect(w.run.mock.calls[0][0].resumeSessionId).toBeUndefined();

    w.clock.now = NOW + 59 * 60_000;
    await ask(w);
    expect(w.run.mock.calls[1][0].resumeSessionId).toBe(SESSION);

    w.clock.now = NOW + 59 * 60_000 + 61 * 60_000;
    await ask(w);
    expect(w.run.mock.calls[2][0].resumeSessionId).toBeUndefined();
  });

  it('a send-gated answer is not remembered: the next question starts fresh', async () => {
    const w = world();
    w.run.mockImplementationOnce(async () => {
      w.db.tables.owner_agent_allowlist[0].enabled = false; // blocked at send time
      return ok();
    });
    expect(await ask(w)).toBe('send_gated');
    w.db.tables.owner_agent_allowlist[0].enabled = true;
    w.clock.now = NOW + 60_000;
    expect(await ask(w)).toBe('answered');
    expect(w.run.mock.calls[1][0].resumeSessionId).toBeUndefined();
  });

  it('does not resume under a different permission set', async () => {
    const w = world();
    await ask(w);
    w.granted.delete('view_billing');
    w.clock.now = NOW + 60_000;
    await ask(w);
    expect(w.run.mock.calls[1][0].resumeSessionId).toBeUndefined();
  });

  it('does not resume a session started under another system prompt or tool set (free-read §3.7)', async () => {
    const w = world();
    await ask(w);
    // A deploy changed the prompt: the stored fingerprint no longer matches.
    w.deps.sessions = createSessionMemory(path.join(stateDir, 'sessions.json'), () => 'another-prompt-version');
    w.clock.now = NOW + 60_000;
    await ask(w);
    expect(w.run.mock.calls[1][0].resumeSessionId).toBeUndefined();
  });

  it('an entry written before the config fingerprint existed is never resumed', async () => {
    const w = world();
    writeFileSync(
      path.join(stateDir, 'sessions.json'),
      JSON.stringify({
        version: 1,
        sessions: { [STAFF]: { sessionId: SESSION, lastAt: NOW, permissions: [...OWNER_AGENT_PERMISSIONS].sort().join(',') } },
      }),
    );
    w.clock.now = NOW + 60_000;
    await ask(w);
    expect(w.run.mock.calls[0][0].resumeSessionId).toBeUndefined();
  });

  it('the fingerprint follows the prompt and the allowed tools', () => {
    const all = [...OWNER_AGENT_PERMISSIONS];
    expect(ownerAgentConfigFingerprint(all)).toMatch(/^[0-9a-f]{64}$/);
    expect(ownerAgentConfigFingerprint(all)).toBe(ownerAgentConfigFingerprint([...all].reverse()));
    expect(ownerAgentConfigFingerprint(['view_events'])).not.toBe(ownerAgentConfigFingerprint(['view_billing']));
  });

  it('a resumed run that fails fast is retried once as a fresh session', async () => {
    const w = world();
    await ask(w);
    w.clock.now = NOW + 60_000;
    w.run.mockRejectedValueOnce(new OwnerAgentRunError('cli_failed')).mockResolvedValueOnce(ok({ sessionId: SESSION_2 }));
    expect(await ask(w)).toBe('answered');
    expect(w.run.mock.calls[1][0].resumeSessionId).toBe(SESSION);
    expect(w.run.mock.calls[2][0].resumeSessionId).toBeUndefined();
    // The new session is remembered for next time.
    w.clock.now = NOW + 120_000;
    await ask(w);
    expect(w.run.mock.calls[3][0].resumeSessionId).toBe(SESSION_2);
  });

  it('a resumed run that timed out is not retried (the budget allows one run)', async () => {
    const w = world();
    await ask(w);
    w.clock.now = NOW + 60_000;
    w.run.mockRejectedValueOnce(new OwnerAgentRunError('timeout'));
    expect(await ask(w)).toBe('fallback_sent');
    expect(w.run).toHaveBeenCalledTimes(2);
  });

  it('the state file is 0600 and holds ids, a timestamp and permission keys only', async () => {
    const w = world();
    await ask(w);
    const file = path.join(stateDir, 'sessions.json');
    const { statSync } = await import('node:fs');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const raw = readFileSync(file, 'utf8');
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      sessions: {
        [STAFF]: {
          sessionId: SESSION,
          lastAt: NOW,
          permissions: [...OWNER_AGENT_PERMISSIONS].sort().join(','),
          config: ownerAgentConfigFingerprint(OWNER_AGENT_PERMISSIONS),
        },
      },
    });
    expect(raw).toMatch(/"config":"[0-9a-f]{64}"/);
    for (const leak of ['QUESTION', 'אירועים', PHONE]) expect(raw).not.toContain(leak);
  });
});

describe('everything else', () => {
  it('a question older than the 24h window is expired, not answered', async () => {
    const w = world({ intake: { received_at: iso(NOW - ANSWER_WINDOW_MS - 1) } });
    expect(await handleOwnerAgentReply(job, w.deps)).toBe('expired');
    expect(w.run).not.toHaveBeenCalled();
    expectSilence(w);
    expect(intakeRow(w)).toMatchObject({ status: 'expired' });
    expect(audits(w)).toEqual([expect.objectContaining({ stage: 'agent', outcome: 'expired', reason_code: 'window_closed' })]);
  });

  it('WhatsApp not configured: throws before the model runs', async () => {
    const w = world();
    w.deps.sender = async () => null;
    const err = await handleOwnerAgentReply(job, w.deps).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OwnerAgentReplyError);
    expect(w.run).not.toHaveBeenCalled();
    expect(intakeRow(w)).toMatchObject({ status: 'processing' });
  });

  it.each([
    ['no intakeId', { nope: 1 }],
    ['a non-uuid id', { intakeId: 'x; drop table owner_agent_intake' }],
    ['a uuid-length string that is not hex', { intakeId: 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz' }],
    ['a number', { intakeId: 42 }],
  ])('a payload with %s is invalid_job: nothing read, nothing of it logged', async (_label, data) => {
    const w = world();
    expect(await handleOwnerAgentReply({ data }, w.deps)).toBe('invalid_job');
    expect(w.db.ops).toEqual([]);
    expect(w.logs).toEqual(['[owner-agent] reply invalid_job']);
  });

  it('a bad payload or a missing row ends quietly', async () => {
    const w = world();
    expect(await handleOwnerAgentReply({ data: { nope: 1 } }, w.deps)).toBe('invalid_job');
    expect(await handleOwnerAgentReply({ data: { intakeId: '99999999-9999-4999-8999-999999999999' } }, w.deps)).toBe(
      'not_found',
    );
    expect(w.run).not.toHaveBeenCalled();
  });

  it('a foreign tool name is recorded as other_tool (the CHECK would reject it)', async () => {
    const w = world();
    w.run.mockResolvedValue(ok({ toolNames: ['events_pipeline', 'Bash', 'events_pipeline'] }));
    await handleOwnerAgentReply(job, w.deps);
    expect(audits(w)[0].tool_names).toEqual(['events_pipeline', 'other_tool']);
    assertAuditFitsChecks(audits(w)[0]);
  });

  it('every intake status the consumer writes fits the migration CHECK', async () => {
    for (const status of ['queued', 'processing', 'sending', 'answered', 'failed', 'skipped', 'expired']) {
      expect(status).toMatch(CHECKS.intakeStatus);
    }
  });

  it('logs carry ids and outcome codes only', async () => {
    const w = world();
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    await handleOwnerAgentReply(job, w.deps);
    w.run.mockRejectedValue(new OwnerAgentRunError('timeout'));
    w.db.tables.owner_agent_intake[0].status = 'queued';
    await handleOwnerAgentReply(job, w.deps);
    const all = JSON.stringify([w.logs, w.alerts, spies.map((s) => s.mock.calls)]);
    for (const leak of ['QUESTION-SENTINEL', 'אירועים', PHONE, '972501234567', WAMID, ANSWER]) {
      expect(all).not.toContain(leak);
    }
    expect(w.logs).toEqual([`[owner-agent] reply intake=${INTAKE} answered`, `[owner-agent] reply intake=${INTAKE} fallback_sent`]);
    for (const s of spies) s.mockRestore();
  });
});
