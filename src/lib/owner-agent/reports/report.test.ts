import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { OWNER_AGENT_SEND_RETRY_MS } from '@/lib/owner-agent/consumer/budgets';
import type { OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';
import type { DeliveryOutcome } from '@/lib/whatsapp/client';

import type { ReportContent } from './content';
import { handleOwnerAgentReport, isOwnerAgentReportJob, OwnerAgentReportError, type ReportDeps } from './report';
import type {
  ReportAuditInput,
  ReportEntryRow,
  ReportRunRow,
  ReportRunStatus,
  ReportSettings,
  ReportStore,
  ReportSubscriptionRow,
  RunResultPatch,
} from './store';

// The handler over an in-memory store whose run CAS is real (status filter
// applied), so "sent at most once" is exercised, not assumed. The store's own
// SQL is store.test.ts's job.

const RUN = '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f';
const SUB = '0b7e1f2a-3c4d-4e5f-9a6b-7c8d9e0f1a2b';
const ENTRY = '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a';
const STAFF = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const OWNER_PHONE = '+972501234567';
const AGENT_NUMBER = '123456789012345';

// The 08:00 slot of 28.9 in Israel = 05:00Z.
const SLOT_MS = Date.parse('2026-09-28T05:00:00Z');
const HOUR = 60 * 60 * 1000;

interface State {
  settings: ReportSettings | null;
  run: ReportRunRow & { patch?: RunResultPatch };
  sub: ReportSubscriptionRow | null;
  entry: ReportEntryRow | null;
  staff: Set<string>;
  verified: Map<string, string | null>;
  permissions: Set<string>;
  lastIntake: string | null;
  audits: ReportAuditInput[];
  failTransitionTo?: ReportRunStatus;
}

function initialState(): State {
  return {
    settings: {
      enabled: true,
      reportsEnabled: true,
      phoneNumberId: AGENT_NUMBER,
      templateName: 'owner_activity_report',
      templateLang: 'he',
      customTemplateName: 'owner_custom_report',
      customTemplateLang: 'he',
    },
    run: { id: RUN, subscriptionId: SUB, localDate: '2026-09-28', slotTime: '08:00:00', status: 'queued', claimedAt: '2026-09-28T05:00:30Z' },
    sub: {
      id: SUB,
      allowlistEntryId: ENTRY,
      reportKey: 'daily_business',
      slotTime: '08:00:00',
      timezone: 'Asia/Jerusalem',
      enabled: true,
      templateName: null,
      templateLang: null,
      instructions: null,
    },
    entry: { id: ENTRY, e164: OWNER_PHONE, staffUserId: STAFF, approvalKind: 'verified_staff', enabled: true, reportOptIn: true },
    staff: new Set([STAFF]),
    verified: new Map([[STAFF, OWNER_PHONE]]),
    permissions: new Set(['view_events', 'view_billing']),
    // Two hours before the slot: inside the 24h window.
    lastIntake: new Date(SLOT_MS - 2 * HOUR).toISOString(),
    audits: [],
  };
}

function memStore(s: State): ReportStore {
  return {
    loadRun: async (id) => (id === s.run.id ? { ...s.run } : null),
    loadSubscription: async (id) => (s.sub && s.sub.id === id ? { ...s.sub } : null),
    transitionRun: async (id, from, to, patch) => {
      if (s.failTransitionTo === to) throw new Error('owner_agent_store_report_transition');
      if (id !== s.run.id || !from.includes(s.run.status as ReportRunStatus)) return false;
      s.run = { ...s.run, status: to, patch: { ...s.run.patch, ...patch } };
      return true;
    },
    readSettings: async () => (s.settings ? { ...s.settings } : null),
    loadEntry: async (id) => (s.entry && s.entry.id === id ? { ...s.entry } : null),
    isStaff: async (id) => s.staff.has(id),
    verifiedPhone: async (id) => s.verified.get(id) ?? null,
    hasPermission: async (_id, key) => s.permissions.has(key),
    lastIntakeAt: async () => s.lastIntake,
    writeAudit: async (row) => {
      s.audits.push(row);
      return true;
    },
    listPlannable: async () => [],
    insertRun: async () => null,
    listStrandedRuns: async () => [],
    listStaleRuns: async () => [],
  };
}

const accepted = (id = 'wamid.OUT'): DeliveryOutcome => ({ kind: 'accepted', providerId: id });
const closedWindow: DeliveryOutcome = { kind: 'definitely_not_sent', reason: 'provider_rejected', providerCode: '131047' };

let state: State;
let deps: ReportDeps & {
  sendText: ReturnType<typeof vi.fn>;
  sendTemplate: ReturnType<typeof vi.fn>;
  content: ReturnType<typeof vi.fn>;
  reroute: ReturnType<typeof vi.fn>;
  modelContent: ReturnType<typeof vi.fn>;
};

function content(text = 'דוח פעילות — 28.9 00:00–08:00\n\nאירועים חדשים: 1'): ReportContent {
  return {
    kind: 'numeric',
    text,
    templateParams: ['28.9 00:00–08:00', '1', '2', '0 ₪'],
    sections: ['events_pipeline', 'rsvp_totals', 'billing_summary'],
    permissions: ['view_events', 'view_billing'],
  };
}

function modelReport(): ReportContent {
  return {
    kind: 'custom',
    text: '*סיכום הלילה*\nשלושה אירועים חדשים',
    templateParams: ['28.9 00:00–08:00', 'סיכום הלילה'],
    sections: [],
    toolNames: ['execute_sql', 'events_pipeline'],
    permissions: ['view_events', 'view_billing'],
  };
}

beforeEach(() => {
  state = initialState();
  deps = {
    store: memStore(state),
    lane: 'report',
    reroute: vi.fn(async () => true),
    modelContent: vi.fn(async () => modelReport()),
    content: vi.fn(async () => content()),
    sender: vi.fn(async (phoneNumberId: string) => ({ phoneNumberId, accessToken: 'tok', appSecret: null })),
    sendText: vi.fn(async () => accepted()),
    sendTemplate: vi.fn(async () => accepted('wamid.TPL')),
    alert: vi.fn(async () => undefined),
    log: vi.fn(),
    now: () => SLOT_MS + 3 * 60 * 1000,
  } as unknown as typeof deps;
});

const run = () => handleOwnerAgentReport({ data: { runId: RUN } }, deps);
const lastAudit = () => state.audits.at(-1);
const nothingSent = () => {
  expect(deps.sendText).not.toHaveBeenCalled();
  expect(deps.sendTemplate).not.toHaveBeenCalled();
};

describe('delivery', () => {
  it('inside the window: free text to the row’s own phone, from the agent number', async () => {
    expect(await run()).toBe('sent');
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    const [from, params] = deps.sendText.mock.calls[0];
    expect(from).toEqual({ phoneNumberId: AGENT_NUMBER, accessToken: 'tok', appSecret: null });
    expect(params).toEqual({ to: OWNER_PHONE, body: content().text, retryBudgetMs: OWNER_AGENT_SEND_RETRY_MS });
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(state.run.status).toBe('sent');
    expect(state.run.patch).toMatchObject({ channel: 'text', outboundWamid: 'wamid.OUT', errorCode: null });
    expect(lastAudit()).toMatchObject({
      outcome: 'sent',
      reasonCode: null,
      reportRunId: RUN,
      staffUserId: STAFF,
      allowlistEntryId: ENTRY,
      sections: ['events_pipeline', 'rsvp_totals', 'billing_summary'],
    });
  });

  it('the content is built for the permitted sections of the run’s own period', async () => {
    await run();
    const [sections, period] = deps.content.mock.calls[0];
    expect(sections).toEqual(['events_pipeline', 'rsvp_totals', 'billing_summary']);
    expect(period).toMatchObject({ sinceIso: '2026-09-27T21:00:00.000Z', untilIso: '2026-09-28T05:00:00.000Z', includeSnapshot: true });
  });

  it('outside the window: the approved template, single-line params', async () => {
    state.lastIntake = new Date(SLOT_MS - 30 * HOUR).toISOString();
    expect(await run()).toBe('sent');
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendTemplate).toHaveBeenCalledWith(expect.objectContaining({ phoneNumberId: AGENT_NUMBER }), {
      to: OWNER_PHONE,
      templateName: 'owner_activity_report',
      language: 'he',
      bodyParams: ['28.9 00:00–08:00', '1', '2', '0 ₪'],
      retryBudgetMs: OWNER_AGENT_SEND_RETRY_MS,
    });
    expect(state.run.patch).toMatchObject({ channel: 'template', outboundWamid: 'wamid.TPL' });
  });

  it('the 15-minute margin: 23h50m since the last message is already outside', async () => {
    state.lastIntake = new Date(deps.now() - (23 * HOUR + 50 * 60 * 1000)).toISOString();
    await run();
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('a subscription’s own template overrides the default', async () => {
    state.lastIntake = null;
    state.sub = { ...state.sub!, templateName: 'kalfa_owner_daily_report_util_v2', templateLang: 'en' };
    await run();
    expect(deps.sendTemplate.mock.calls[0][1]).toMatchObject({ templateName: 'kalfa_owner_daily_report_util_v2', language: 'en' });
  });

  it('the numbers never go out as the custom template, even when only that one is configured', async () => {
    state.lastIntake = null;
    state.settings = { ...state.settings!, templateName: null };
    expect(await run()).toBe('skipped');
    nothingSent();
    expect(lastAudit()).toMatchObject({ reasonCode: 'template_unavailable' });
  });

  it('outside the window with no template: skipped, NEVER free text', async () => {
    state.lastIntake = null;
    state.settings = { ...state.settings!, templateName: null };
    expect(await run()).toBe('skipped');
    nothingSent();
    expect(state.run.status).toBe('skipped');
    expect(lastAudit()).toMatchObject({ outcome: 'skipped', reasonCode: 'template_unavailable' });
  });

  it('131047 on the first text part: one fallback to the template', async () => {
    deps.sendText.mockResolvedValueOnce(closedWindow);
    expect(await run()).toBe('sent');
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendTemplate).toHaveBeenCalledTimes(1);
    expect(state.run.patch).toMatchObject({ channel: 'template', outboundWamid: 'wamid.TPL' });
    expect(lastAudit()).toMatchObject({ outcome: 'sent', reasonCode: 'template_fallback' });
  });

  it('131047 with no template configured: failed, nothing else sent', async () => {
    state.settings = { ...state.settings!, templateName: null };
    deps.sendText.mockResolvedValueOnce(closedWindow);
    expect(await run()).toBe('send_failed');
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ outcome: 'send_failed', reasonCode: 'window_closed' });
  });

  it('any other rejection or an unknown outcome is not retried as a template', async () => {
    deps.sendText.mockResolvedValueOnce({ kind: 'unknown', reason: 'provider_error', providerCode: '131000' });
    expect(await run()).toBe('send_failed');
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(state.run.patch).toMatchObject({ errorCode: 'send_unknown_131000' });
  });

  it('a later part failing is partial_send, with no fallback', async () => {
    deps.content.mockResolvedValueOnce(content('א'.repeat(5000)));
    deps.sendText.mockResolvedValueOnce(accepted('wamid.1')).mockResolvedValueOnce(closedWindow);
    expect(await run()).toBe('send_failed');
    expect(deps.sendText).toHaveBeenCalledTimes(2);
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(state.run.patch).toMatchObject({ errorCode: 'partial_send', outboundWamid: 'wamid.1' });
  });

  it('a send that throws is an unknown outcome, never a throw out of the handler', async () => {
    deps.sendText.mockRejectedValueOnce(new Error('boom'));
    expect(await run()).toBe('send_failed');
    expect(state.run.patch).toMatchObject({ errorCode: 'send_unknown' });
  });

  it('after the send claim a store error is swallowed (no pg-boss retry, no second send)', async () => {
    state.failTransitionTo = 'sent';
    expect(await run()).toBe('sent');
    expect(state.run.status).toBe('sending');
    expect(deps.log).toHaveBeenCalledWith(`[owner-agent] report status_not_recorded run=${RUN}`);
  });
});

describe('never twice', () => {
  it('a run found in `sending` is failed and nothing is sent', async () => {
    state.run.status = 'sending';
    expect(await run()).toBe('send_unconfirmed');
    nothingSent();
    expect(state.run.status).toBe('failed');
    expect(lastAudit()).toMatchObject({ outcome: 'send_failed', reasonCode: 'send_unconfirmed' });
  });

  it('a finished run is left alone', async () => {
    for (const status of ['sent', 'failed', 'skipped', 'expired']) {
      state.run.status = status;
      expect(await run()).toBe('already_done');
    }
    nothingSent();
    expect(state.audits).toEqual([]);
  });

  it('running the same job twice sends once', async () => {
    expect(await run()).toBe('sent');
    expect(await run()).toBe('already_done');
    expect(deps.sendText).toHaveBeenCalledTimes(1);
  });

  it('a content failure throws BEFORE the claim — pg-boss retries, and the retry sends once', async () => {
    deps.content.mockRejectedValueOnce(new Error('count_events_created_failed'));
    await expect(run()).rejects.toThrow('count_events_created_failed');
    nothingSent();
    expect(state.run.status).toBe('processing');
    expect(await run()).toBe('sent');
    expect(deps.sendText).toHaveBeenCalledTimes(1);
  });

  it('no WhatsApp configuration throws before the content is read', async () => {
    deps.sender = vi.fn(async () => null);
    await expect(run()).rejects.toBeInstanceOf(OwnerAgentReportError);
    expect(deps.content).not.toHaveBeenCalled();
    nothingSent();
  });
});

describe('late', () => {
  it('a slot whose minute began an hour ago or more is expired, not sent', async () => {
    deps.now = () => SLOT_MS + HOUR;
    expect(await run()).toBe('expired');
    nothingSent();
    expect(state.run.status).toBe('expired');
    expect(lastAudit()).toMatchObject({ outcome: 'expired', reasonCode: 'late' });
  });

  it('59 minutes late is still sent', async () => {
    deps.now = () => SLOT_MS + HOUR - 60_000;
    expect(await run()).toBe('sent');
  });
});

describe('the gate at the start (silence: an audit row, no message, no content read)', () => {
  const cases: Array<[string, (s: State) => void, string]> = [
    ['no settings row', (s) => void (s.settings = null), 'not_configured'],
    ['kill switch off', (s) => void (s.settings!.enabled = false), 'kill_switch_off'],
    ['reports switch off', (s) => void (s.settings!.reportsEnabled = false), 'reports_off'],
    ['no number chosen', (s) => void (s.settings!.phoneNumberId = null), 'no_number'],
    ['subscription disabled', (s) => void (s.sub!.enabled = false), 'subscription_off'],
    ['subscription moved to another slot', (s) => void (s.sub!.slotTime = '09:00:00'), 'subscription_off'],
    ['allow-list row disabled', (s) => void (s.entry!.enabled = false), 'not_allowlisted'],
    ['allow-list row gone', (s) => void (s.entry = null), 'not_allowlisted'],
    ['not opted in', (s) => void (s.entry!.reportOptIn = false), 'not_opted_in'],
    ['no longer staff', (s) => void s.staff.clear(), 'not_staff'],
    ['verified_staff whose phone is no longer the verified one', (s) => void s.verified.set(STAFF, '+972529999999'), 'phone_unverified'],
  ];
  for (const [name, mutate, reason] of cases) {
    it(name, async () => {
      mutate(state);
      expect(await run()).toBe('gated');
      nothingSent();
      expect(deps.content).not.toHaveBeenCalled();
      expect(state.run.status).toBe('skipped');
      expect(lastAudit()).toMatchObject({ outcome: 'gated', reasonCode: reason, reportRunId: RUN });
    });
  }

  it('staff_unverified_override passes without a verified phone', async () => {
    state.entry = { ...state.entry!, approvalKind: 'staff_unverified_override' };
    state.verified.set(STAFF, null);
    expect(await run()).toBe('sent');
  });

  it('external_override holds no permission: skipped as no_permissions, no core read', async () => {
    state.entry = { ...state.entry!, approvalKind: 'external_override', staffUserId: null };
    expect(await run()).toBe('skipped');
    nothingSent();
    expect(deps.content).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ outcome: 'skipped', reasonCode: 'no_permissions' });
  });

  it('staff with none of the report permissions: no_permissions', async () => {
    state.permissions = new Set(['view_webhooks']);
    expect(await run()).toBe('skipped');
    nothingSent();
    expect(lastAudit()).toMatchObject({ reasonCode: 'no_permissions' });
  });

  it('only the granted sections are asked for', async () => {
    state.permissions = new Set<OwnerAgentPermission>(['view_customer_data']);
    await run();
    expect(deps.content.mock.calls[0][0]).toEqual(['inquiries_summary']);
  });
});

describe('the gate at send time (state changed while the report was built)', () => {
  const cases: Array<[string, (s: State) => void, string]> = [
    ['kill switch turned off', (s) => void (s.settings!.enabled = false), 'kill_switch_off'],
    ['reports switch turned off', (s) => void (s.settings!.reportsEnabled = false), 'reports_off'],
    ['number changed', (s) => void (s.settings!.phoneNumberId = '999999999999999'), 'number_changed'],
    ['row disabled', (s) => void (s.entry!.enabled = false), 'not_allowlisted'],
    // verified_staff would already fail on phone_unverified; an override row
    // reaches the recipient check itself.
    [
      'row phone changed (override row)',
      (s) => void (s.entry = { ...s.entry!, approvalKind: 'staff_unverified_override', e164: '+972529999999' }),
      'not_allowlisted',
    ],
    ['row phone changed (verified_staff)', (s) => void (s.entry!.e164 = '+972529999999'), 'phone_unverified'],
    ['opted out', (s) => void (s.entry!.reportOptIn = false), 'not_opted_in'],
    ['subscription disabled', (s) => void (s.sub!.enabled = false), 'subscription_off'],
    ['a section’s permission revoked', (s) => void s.permissions.delete('view_billing'), 'permissions_changed'],
  ];
  for (const [name, mutate, reason] of cases) {
    it(name, async () => {
      deps.content.mockImplementationOnce(async () => {
        mutate(state);
        return content();
      });
      expect(await run()).toBe('send_gated');
      nothingSent();
      expect(state.run.status).toBe('skipped');
      expect(lastAudit()).toMatchObject({ outcome: 'send_gated', reasonCode: reason });
    });
  }
});

describe('job payload', () => {
  it('anything but { runId: uuid } is refused without a read', async () => {
    const loadRun = vi.spyOn(deps.store, 'loadRun');
    expect(await handleOwnerAgentReport({ data: { runId: 'x' } }, deps)).toBe('invalid_job');
    expect(await handleOwnerAgentReport({ data: null }, deps)).toBe('invalid_job');
    expect(loadRun).not.toHaveBeenCalled();
  });

  it('an unknown run is not_found', async () => {
    expect(await handleOwnerAgentReport({ data: { runId: 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' } }, deps)).toBe('not_found');
  });

  it('logs ids and codes only — never the phone or the report text', async () => {
    await run();
    const logged = vi.mocked(deps.log).mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).not.toContain(OWNER_PHONE);
    expect(logged).not.toContain('אירועים');
  });
});

describe('reports with the owner’s instructions (model-backed)', () => {
  beforeEach(() => {
    state.sub = { ...state.sub!, instructions: 'תן לי רק את מספר האירועים החדשים ואת ההכנסות' };
  });

  it('on the report queue: handed to the reply queue, nothing claimed, read or sent', async () => {
    expect(await run()).toBe('rerouted');
    expect(deps.reroute).toHaveBeenCalledWith(RUN);
    expect(state.run.status).toBe('queued');
    expect(deps.content).not.toHaveBeenCalled();
    expect(deps.modelContent).not.toHaveBeenCalled();
    nothingSent();
    expect(state.audits).toEqual([]);
  });

  it('a late run is still expired on the report queue, not handed on', async () => {
    deps.now = () => SLOT_MS + HOUR;
    expect(await run()).toBe('expired');
    expect(deps.reroute).not.toHaveBeenCalled();
  });

  it('on the reply queue (lane model): the model writes it, with the recipient’s permissions and the run’s own period', async () => {
    deps.lane = 'model';
    expect(await run()).toBe('sent');
    const [instructions, permissions, period] = deps.modelContent.mock.calls[0];
    expect(instructions).toBe('תן לי רק את מספר האירועים החדשים ואת ההכנסות');
    expect([...(permissions as string[])].sort()).toEqual(['view_billing', 'view_events']);
    expect(period).toMatchObject({ untilIso: '2026-09-28T05:00:00.000Z' });
    expect(deps.content).not.toHaveBeenCalled();
    expect(deps.sendText.mock.calls[0][1]).toEqual({ to: OWNER_PHONE, body: modelReport().text, retryBudgetMs: OWNER_AGENT_SEND_RETRY_MS });
    expect(lastAudit()).toMatchObject({ outcome: 'sent', reasonCode: null, sections: ['execute_sql', 'events_pipeline'] });
  });

  it('outside the window the model report goes out as the CUSTOM template, exactly [period, summary]', async () => {
    deps.lane = 'model';
    state.lastIntake = null;
    expect(await run()).toBe('sent');
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendTemplate).toHaveBeenCalledTimes(1);
    expect(deps.sendTemplate.mock.calls[0][1]).toEqual({
      to: OWNER_PHONE,
      templateName: 'owner_custom_report',
      language: 'he',
      bodyParams: ['28.9 00:00–08:00', 'סיכום הלילה'],
      retryBudgetMs: OWNER_AGENT_SEND_RETRY_MS,
    });
    expect(lastAudit()).toMatchObject({ outcome: 'sent', reasonCode: null });
  });

  it('no custom template, outside the window: the numbers through the numeric template, and no model run', async () => {
    deps.lane = 'model';
    state.lastIntake = null;
    state.settings = { ...state.settings!, customTemplateName: null };
    expect(await run()).toBe('sent');
    expect(deps.modelContent).not.toHaveBeenCalled();
    expect(deps.content).toHaveBeenCalledTimes(1);
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendTemplate.mock.calls[0][1]).toEqual({
      to: OWNER_PHONE,
      templateName: 'owner_activity_report',
      language: 'he',
      bodyParams: ['28.9 00:00–08:00', '1', '2', '0 ₪'],
      retryBudgetMs: OWNER_AGENT_SEND_RETRY_MS,
    });
    expect(lastAudit()).toMatchObject({ outcome: 'sent', reasonCode: 'custom_template_missing' });
  });

  it('no custom template, window closed while the model ran: the numbers, one core read, with the note', async () => {
    deps.lane = 'model';
    state.settings = { ...state.settings!, customTemplateName: null };
    deps.modelContent.mockImplementationOnce(async () => {
      state.lastIntake = null;
      return modelReport();
    });
    expect(await run()).toBe('sent');
    expect(deps.content).toHaveBeenCalledTimes(1);
    expect(deps.sendText).not.toHaveBeenCalled();
    expect(deps.sendTemplate.mock.calls[0][1]).toMatchObject({
      templateName: 'owner_activity_report',
      bodyParams: ['28.9 00:00–08:00', '1', '2', '0 ₪'],
    });
    expect(lastAudit()).toMatchObject({ outcome: 'sent', reasonCode: 'custom_template_missing' });
  });

  it('no custom template but inside the window: the model’s text as usual', async () => {
    deps.lane = 'model';
    state.settings = { ...state.settings!, customTemplateName: null };
    expect(await run()).toBe('sent');
    expect(deps.modelContent).toHaveBeenCalledTimes(1);
    expect(deps.sendText.mock.calls[0][1]).toEqual({ to: OWNER_PHONE, body: modelReport().text, retryBudgetMs: OWNER_AGENT_SEND_RETRY_MS });
    expect(lastAudit()).toMatchObject({ reasonCode: null });
  });

  it('no custom template, 131047 on the model text: window_closed — never the numeric template with a model’s params', async () => {
    deps.lane = 'model';
    state.settings = { ...state.settings!, customTemplateName: null };
    deps.sendText.mockResolvedValueOnce(closedWindow);
    expect(await run()).toBe('send_failed');
    expect(deps.sendTemplate).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ outcome: 'send_failed', reasonCode: 'window_closed' });
  });

  it('131047 on the model text with a custom template: one fallback, as the custom template', async () => {
    deps.lane = 'model';
    deps.sendText.mockResolvedValueOnce(closedWindow);
    expect(await run()).toBe('sent');
    expect(deps.sendTemplate.mock.calls[0][1]).toMatchObject({
      templateName: 'owner_custom_report',
      bodyParams: ['28.9 00:00–08:00', 'סיכום הלילה'],
    });
    expect(lastAudit()).toMatchObject({ reasonCode: 'template_fallback' });
  });

  it('neither template configured, outside the window: skipped/template_unavailable, no model run, nothing sent', async () => {
    deps.lane = 'model';
    state.lastIntake = null;
    state.settings = { ...state.settings!, templateName: null, customTemplateName: null };
    expect(await run()).toBe('skipped');
    expect(deps.modelContent).not.toHaveBeenCalled();
    expect(deps.content).not.toHaveBeenCalled();
    nothingSent();
    expect(lastAudit()).toMatchObject({ outcome: 'skipped', reasonCode: 'template_unavailable' });
  });

  it('no custom template and no section to fall back to (external row), outside the window: template_unavailable', async () => {
    deps.lane = 'model';
    state.lastIntake = null;
    state.settings = { ...state.settings!, customTemplateName: null };
    state.entry = { ...state.entry!, approvalKind: 'external_override', staffUserId: null };
    expect(await run()).toBe('skipped');
    expect(deps.modelContent).not.toHaveBeenCalled();
    nothingSent();
    expect(lastAudit()).toMatchObject({ reasonCode: 'template_unavailable' });
  });

  it('a subscription’s own template replaces the CUSTOM one for a report with instructions', async () => {
    deps.lane = 'model';
    state.lastIntake = null;
    state.sub = { ...state.sub!, templateName: 'owner_custom_report_v2', templateLang: 'en' };
    await run();
    expect(deps.sendTemplate.mock.calls[0][1]).toMatchObject({
      templateName: 'owner_custom_report_v2',
      language: 'en',
      bodyParams: ['28.9 00:00–08:00', 'סיכום הלילה'],
    });
  });

  it('a failed model run never sends four params into the subscription’s own (custom-mode) template', async () => {
    deps.lane = 'model';
    state.lastIntake = null;
    state.sub = { ...state.sub!, templateName: 'owner_custom_report_v2', templateLang: 'en' };
    deps.modelContent.mockRejectedValueOnce(new Error('timeout'));
    expect(await run()).toBe('sent');
    expect(deps.sendTemplate.mock.calls[0][1]).toMatchObject({
      templateName: 'owner_activity_report',
      language: 'he',
      bodyParams: ['28.9 00:00–08:00', '1', '2', '0 ₪'],
    });
    expect(lastAudit()).toMatchObject({ reasonCode: 'model_fallback' });
  });

  it('a failed model run falls back to the numbers, with a note, and says so in the audit', async () => {
    deps.lane = 'model';
    deps.modelContent.mockRejectedValueOnce(new Error('timeout'));
    expect(await run()).toBe('sent');
    expect(deps.content).toHaveBeenCalledTimes(1);
    expect(String(deps.sendText.mock.calls[0][1].body)).toMatch(/^לא הצלחתי להכין את הדוח לפי ההנחיות שלך/);
    expect(lastAudit()).toMatchObject({ outcome: 'sent', reasonCode: 'model_fallback' });
  });

  it('a failed model run with no deterministic section to fall back to is skipped with the run code', async () => {
    deps.lane = 'model';
    state.entry = { ...state.entry!, approvalKind: 'external_override', staffUserId: null };
    deps.modelContent.mockRejectedValueOnce(new Error('cli_failed'));
    expect(await run()).toBe('skipped');
    nothingSent();
    expect(lastAudit()).toMatchObject({ outcome: 'skipped', reasonCode: 'cli_failed' });
  });

  it('an external row gets the model report with no platform permissions (as its own question would)', async () => {
    deps.lane = 'model';
    state.entry = { ...state.entry!, approvalKind: 'external_override', staffUserId: null };
    deps.modelContent.mockResolvedValueOnce({ ...modelReport(), permissions: [] });
    expect(await run()).toBe('sent');
    expect(deps.modelContent.mock.calls[0][1]).toEqual([]);
  });

  it('a permission the model ran with, revoked before the send: send_gated', async () => {
    deps.lane = 'model';
    deps.modelContent.mockImplementationOnce(async () => {
      state.permissions.delete('view_billing');
      return modelReport();
    });
    expect(await run()).toBe('send_gated');
    nothingSent();
    expect(lastAudit()).toMatchObject({ reasonCode: 'permissions_changed' });
  });

  it('instructions removed before the reply queue got to it: the deterministic report', async () => {
    deps.lane = 'model';
    state.sub = { ...state.sub!, instructions: null };
    expect(await run()).toBe('sent');
    expect(deps.modelContent).not.toHaveBeenCalled();
    expect(deps.content).toHaveBeenCalledTimes(1);
  });
});

describe('isOwnerAgentReportJob (routing on the reply queue)', () => {
  it('only { runId } without intakeId is a report', () => {
    expect(isOwnerAgentReportJob({ runId: RUN })).toBe(true);
    expect(isOwnerAgentReportJob({ intakeId: RUN })).toBe(false);
    expect(isOwnerAgentReportJob({ runId: RUN, intakeId: RUN })).toBe(false);
    expect(isOwnerAgentReportJob(null)).toBe(false);
    expect(isOwnerAgentReportJob('runId')).toBe(false);
  });
});
