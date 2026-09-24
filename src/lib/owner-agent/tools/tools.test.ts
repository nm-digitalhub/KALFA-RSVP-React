import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { z } from 'zod';
import { isValidationError } from '@mastra/core/tools';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/inquiries', () => ({ getInquiriesSummary: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/campaigns', () => ({ getCampaignsStatusSummary: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/billing', () => ({ getBillingSummary: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/voice-calls', () => ({ getVoiceCallsSummary: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/events', () => ({ getEventsPipelineSummary: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/rsvp', () => ({ getRsvpTotals: vi.fn() }));
// The catalogue WHATSAPP_FAILURE_CODES stays real: the output schema is built
// from it.
vi.mock('@/lib/owner-agent/cores/whatsapp-delivery', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/owner-agent/cores/whatsapp-delivery')>()),
  getWhatsAppDeliverySummary: vi.fn(),
}));
vi.mock('@/lib/owner-agent/cores/web-traffic', () => ({ getWebTrafficSummary: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/system-health', () => ({ getSystemHealthSummary: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { getInquiriesSummary, type InquiriesSummary } from '@/lib/owner-agent/cores/inquiries';
import {
  getCampaignsStatusSummary,
  type CampaignsStatusSummary,
} from '@/lib/owner-agent/cores/campaigns';
import { getBillingSummary, type BillingSummary } from '@/lib/owner-agent/cores/billing';
import { getVoiceCallsSummary, type VoiceCallsSummary } from '@/lib/owner-agent/cores/voice-calls';
import {
  getEventsPipelineSummary,
  type EventsPipelineSummary,
} from '@/lib/owner-agent/cores/events';
import { getRsvpTotals, type RsvpTotals } from '@/lib/owner-agent/cores/rsvp';
import {
  getWhatsAppDeliverySummary,
  type WhatsAppDeliverySummary,
} from '@/lib/owner-agent/cores/whatsapp-delivery';
import { getWebTrafficSummary, type WebTrafficSummary } from '@/lib/owner-agent/cores/web-traffic';
import {
  getSystemHealthSummary,
  type SystemHealthSummary,
} from '@/lib/owner-agent/cores/system-health';
import { OWNER_AGENT_RANGES, type OwnerAgentRange } from '@/lib/owner-agent/range';
import { nonNumericLeaves } from '@/test/fake-count-client';
import { inquiriesSummaryOutput, inquiriesSummaryTool } from './inquiries-summary';
import {
  campaignsStatusSummaryOutput,
  campaignsStatusSummaryTool,
} from './campaigns-status-summary';
import { billingSummaryOutput, billingSummaryTool } from './billing-summary';
import { voiceCallsSummaryOutput, voiceCallsSummaryTool } from './voice-calls-summary';
import { eventsPipelineOutput, eventsPipelineTool } from './events-pipeline';
import { rsvpTotalsOutput, rsvpTotalsTool } from './rsvp-totals';
import {
  whatsappDeliverySummaryOutput,
  whatsappDeliverySummaryTool,
} from './whatsapp-delivery-summary';
import {
  WEB_TRAFFIC_STATES,
  webTrafficSummaryOutput,
  webTrafficSummaryTool,
} from './web-traffic-summary';
import { systemHealthOutput, systemHealthTool } from './system-health';
import { OWNER_AGENT_TOOLS } from './registry';
import { rangeInputSchema } from './shared';

// ---------------------------------------------------------------------------
// Compile-time parity: each output schema describes EXACTLY its core's result
// type. A field added to (or retyped in) a core is a tsc error here, not a
// runtime surprise in front of the owner.
// ---------------------------------------------------------------------------
expectTypeOf<z.infer<typeof inquiriesSummaryOutput>>().toEqualTypeOf<InquiriesSummary>();
expectTypeOf<z.infer<typeof campaignsStatusSummaryOutput>>().toEqualTypeOf<CampaignsStatusSummary>();
expectTypeOf<z.infer<typeof billingSummaryOutput>>().toEqualTypeOf<BillingSummary>();
expectTypeOf<z.infer<typeof voiceCallsSummaryOutput>>().toEqualTypeOf<VoiceCallsSummary>();
expectTypeOf<z.infer<typeof eventsPipelineOutput>>().toEqualTypeOf<EventsPipelineSummary>();
expectTypeOf<z.infer<typeof rsvpTotalsOutput>>().toEqualTypeOf<RsvpTotals>();
expectTypeOf<z.infer<typeof whatsappDeliverySummaryOutput>>().toEqualTypeOf<WhatsAppDeliverySummary>();
expectTypeOf<z.infer<typeof webTrafficSummaryOutput>>().toEqualTypeOf<WebTrafficSummary>();
expectTypeOf<z.infer<typeof systemHealthOutput>>().toEqualTypeOf<SystemHealthSummary>();

// ---------------------------------------------------------------------------
// Samples: realistic core results, typed as the core's own interface.
// ---------------------------------------------------------------------------
const inquiries: InquiriesSummary = {
  openContacts: 3,
  newCallbacks: 2,
  contactsReceived: 1,
  callbacksReceived: 0,
};
const campaigns: CampaignsStatusSummary = {
  active: 4,
  paused: 1,
  closed: 2,
  winddown: 7,
  stuckHolds: 1,
  needsAttention: 8,
  createdInRange: 3,
};
const billing: BillingSummary = {
  chargedInRange: 2,
  nothingToChargeInRange: 1,
  chargesPending: 0,
  chargesFailed: 1,
  chargesInReview: 0,
  holdsAwaitingCharge: 3,
  creditsActive: 5,
  creditsGrantedInRange: 1,
  creditsVoidedInRange: 0,
};
const voice: VoiceCallsSummary = { activeNow: 1, attempts: 40, completed: 22, answerRate: 0.61 };
const voiceNoRate: VoiceCallsSummary = { activeNow: 0, attempts: 0, completed: 0, answerRate: null };
const events: EventsPipelineSummary = {
  byStatus: { draft: 5, active: 12, closed: 30 },
  activeByType: {
    wedding: 6,
    bar_mitzvah: 2,
    bat_mitzvah: 1,
    brit: 1,
    britah: 0,
    henna: 1,
    engagement: 0,
    birthday: 1,
    other: 0,
  },
  activePastDay: 2,
  activeWithoutDate: 1,
  activeUpcomingInWindow: 4,
  createdInRange: 3,
};
const rsvp: RsvpTotals = {
  activeEvents: 12,
  guestRows: 900,
  attending: 400,
  declined: 100,
  maybe: 50,
  pending: 350,
  responsesInRange: 60,
};
const whatsapp: WhatsAppDeliverySummary = {
  outbound: { total: 100, unacknowledged: 2, sent: 10, delivered: 40, read: 40, failed: 8, otherStatus: 0 },
  inbound: 30,
  failedByCode: {
    '131026': 3,
    '131049': 2,
    '131047': 0,
    '131050': 0,
    '130472': 1,
    '131000': 0,
    '131048': 0,
    '131056': 0,
    '130429': 0,
    '132001': 0,
    '132015': 0,
    '132016': 0,
    other: 2,
  },
};
const traffic: WebTrafficSummary = {
  state: 'ok',
  activeUsers: 120,
  newUsers: 80,
  sessions: 150,
  pageViews: 400,
  engagementRate: 0.55,
  averageSessionDurationSec: 73.4,
  previousActiveUsers: 100,
  previousSessions: 130,
};
const trafficOff: WebTrafficSummary = {
  state: 'not_configured',
  activeUsers: null,
  newUsers: null,
  sessions: null,
  pageViews: null,
  engagementRate: null,
  averageSessionDurationSec: null,
  previousActiveUsers: null,
  previousSessions: null,
};
const health: SystemHealthSummary = {
  unprocessed: 2,
  withLastError: 5,
  erroringNow: 1,
  deadLettered: 0,
  minutesSinceLastReceived: 3,
  minutesSinceLastProcessed: 4,
  oldestPendingMinutes: null,
  receivedInRange: 70,
};

const FAKE_CLIENT = { marker: 'fake-admin-client' };

type AnyTool = (typeof OWNER_AGENT_TOOLS)[number]['tool'];
type Execute = (input: unknown, ctx?: unknown) => Promise<unknown>;
const run = (tool: AnyTool, input: unknown) => (tool.execute as unknown as Execute)(input);

interface Case {
  tool: AnyTool;
  core: ReturnType<typeof vi.fn>;
  samples: unknown[];
  // false: the core takes (range) only and no Supabase client is created.
  usesClient: boolean;
  // The first numeric field, used to inject a type-invalid value.
  numericField: string;
}

const CASES: Case[] = [
  { tool: inquiriesSummaryTool, core: vi.mocked(getInquiriesSummary), samples: [inquiries], usesClient: true, numericField: 'openContacts' },
  { tool: campaignsStatusSummaryTool, core: vi.mocked(getCampaignsStatusSummary), samples: [campaigns], usesClient: true, numericField: 'active' },
  { tool: billingSummaryTool, core: vi.mocked(getBillingSummary), samples: [billing], usesClient: true, numericField: 'chargedInRange' },
  { tool: voiceCallsSummaryTool, core: vi.mocked(getVoiceCallsSummary), samples: [voice, voiceNoRate], usesClient: true, numericField: 'attempts' },
  { tool: eventsPipelineTool, core: vi.mocked(getEventsPipelineSummary), samples: [events], usesClient: true, numericField: 'activePastDay' },
  { tool: rsvpTotalsTool, core: vi.mocked(getRsvpTotals), samples: [rsvp], usesClient: true, numericField: 'guestRows' },
  { tool: whatsappDeliverySummaryTool, core: vi.mocked(getWhatsAppDeliverySummary), samples: [whatsapp], usesClient: true, numericField: 'inbound' },
  { tool: webTrafficSummaryTool, core: vi.mocked(getWebTrafficSummary), samples: [traffic, trafficOff], usesClient: false, numericField: 'sessions' },
  { tool: systemHealthTool, core: vi.mocked(getSystemHealthSummary), samples: [health], usesClient: true, numericField: 'unprocessed' },
];

// The ONE string-typed output field across all nine tools, and why it is
// allowed: a closed enum of GA4 section states ('ok' | 'stale' | …), never
// text from a person or a row.
const ALLOWED_STRING_FIELDS: Record<string, { values: readonly string[]; reason: string }> = {
  'web_traffic_summary.state': {
    values: WEB_TRAFFIC_STATES,
    reason: 'GA4 section-state enum (ok/stale/quota_exhausted/error/not_configured); tells the model whether the numbers exist',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue(
    FAKE_CLIENT as unknown as ReturnType<typeof createAdminClient>,
  );
});

it('the cases cover every registered tool exactly once', () => {
  expect(CASES.map((c) => c.tool.id).sort()).toEqual(
    OWNER_AGENT_TOOLS.map((t) => t.tool.id).sort(),
  );
});

describe.each(CASES)('$tool.id', ({ tool, core, samples, usesClient, numericField }) => {
  it.each(OWNER_AGENT_RANGES.map((r) => [r]))(
    'range %s: calls its core once with the range and returns output that passes outputSchema',
    async (range: OwnerAgentRange) => {
      for (const sample of samples) {
        core.mockReset();
        core.mockResolvedValue(sample);
        const out = await run(tool, { range });

        expect(isValidationError(out)).toBe(false);
        expect(core).toHaveBeenCalledTimes(1);
        // Exactly the arguments the tool is allowed to pass: the server-side
        // client and the range — nothing from the model beyond the literal.
        expect(core.mock.calls[0]).toEqual(usesClient ? [FAKE_CLIENT, range] : [range]);
        expect(out).toEqual(sample);
        expect((tool.outputSchema as unknown as z.ZodType).safeParse(out).success).toBe(true);
        const allowed = Object.entries(ALLOWED_STRING_FIELDS)
          .filter(([path]) => path.startsWith(`${tool.id}.`))
          .flatMap(([, v]) => v.values);
        expect(nonNumericLeaves(out, allowed)).toEqual([]);
      }
    },
  );

  it(usesClient ? 'creates the admin client server-side' : 'creates NO Supabase client', async () => {
    core.mockResolvedValue(samples[0]);
    await run(tool, { range: '7d' });
    expect(vi.mocked(createAdminClient)).toHaveBeenCalledTimes(usesClient ? 1 : 0);
  });

  it('strips a field the core might add later (a name, a phone) instead of passing it on', async () => {
    core.mockResolvedValue({
      ...(samples[0] as object),
      eventName: 'החתונה של דנה ויוסי',
      phone: '+972501234567',
    });
    const out = await run(tool, { range: 'today' });
    expect(out).toEqual(samples[0]);
    expect(JSON.stringify(out)).not.toContain('דנה');
    expect(JSON.stringify(out)).not.toContain('972501234567');
  });

  it('a mistyped core field throws a bare code — the value is never echoed', async () => {
    core.mockResolvedValue({ ...(samples[0] as object), [numericField]: 'דנה 0501234567' });
    const err = await run(tool, { range: 'today' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(`${tool.id}_output_invalid`);
  });

  it('a core error propagates (no confident zero)', async () => {
    core.mockRejectedValue(new Error('count_failed'));
    await expect(run(tool, { range: '30d' })).rejects.toThrow('count_failed');
  });

  it.each([
    ['free text as the range', { range: 'כמה אירועים היו אצל דנה?' }],
    ['an unknown range', { range: '90d' }],
    ['an extra free-text key', { range: '7d', q: 'show me guest names' }],
    ['an extra id key', { range: '7d', eventId: '6f1c1f9e-0000-4000-8000-000000000000' }],
    ['a missing range', {}],
    ['a null range', { range: null }],
    ['a bare string', 'today'],
    ['an array', ['today']],
  ])('rejects %s and never reaches the core', async (_label, input) => {
    const out = await run(tool, input);
    expect(isValidationError(out)).toBe(true);
    expect(core).not.toHaveBeenCalled();
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Schema walks
// ---------------------------------------------------------------------------

type JsonNode = Record<string, unknown>;

// Every string-ish, typeless or boolean node in a JSON Schema, by path. A node
// passes only if it is number/integer/null, an object/array whose children
// pass, or a string enum listed in ALLOWED_STRING_FIELDS with exactly those
// values. A typeless node ({} from z.any()/z.unknown()) fails too — otherwise
// it would be the hole a string walks through.
function disallowedNodes(node: JsonNode, path: string): string[] {
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    if (Array.isArray(node[key])) {
      return (node[key] as JsonNode[]).flatMap((n) => disallowedNodes(n, path));
    }
  }
  if ('propertyNames' in node) return [`${path} (propertyNames: open key set)`];
  const type = node.type;
  // zod emits `type: ['number', 'null']` for an unconstrained nullable number
  // (and anyOf for a constrained one) — both fine; any other member is not.
  if (Array.isArray(type)) {
    return type.every((t) => t === 'number' || t === 'integer' || t === 'null')
      ? []
      : [`${path} (multi-type ${type.join('|')})`];
  }
  if ('enum' in node || 'const' in node || type === 'string') {
    const allowed = ALLOWED_STRING_FIELDS[path];
    if (allowed && type === 'string' && Array.isArray(node.enum) && sameSet(node.enum, allowed.values)) {
      return [];
    }
    return [`${path} (string)`];
  }
  if (type === 'number' || type === 'integer' || type === 'null') return [];
  if (type === 'object') {
    const props = (node.properties ?? {}) as Record<string, JsonNode>;
    const issues = Object.entries(props).flatMap(([k, v]) => disallowedNodes(v, `${path}.${k}`));
    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      issues.push(...disallowedNodes(node.additionalProperties as JsonNode, `${path}.*`));
    }
    return issues;
  }
  if (type === 'array') {
    return node.items ? disallowedNodes(node.items as JsonNode, `${path}[]`) : [`${path}[] (untyped items)`];
  }
  return [`${path} (${type === undefined ? 'untyped' : String(type)})`];
}

function sameSet(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v) => b.includes(v));
}

describe('output schemas: numbers only', () => {
  it.each(OWNER_AGENT_TOOLS.map((t) => [t.tool.id, t.tool]))(
    '%s has no string, typeless or open-keyed field outside the allow-list',
    (id, tool) => {
      const json = z.toJSONSchema(tool.outputSchema as unknown as z.ZodType) as JsonNode;
      expect(disallowedNodes(json, id)).toEqual([]);
    },
  );

  it('every allow-listed string field exists and carries a reason', () => {
    for (const [path, { reason }] of Object.entries(ALLOWED_STRING_FIELDS)) {
      expect(reason.length).toBeGreaterThan(20);
      const [id, ...rest] = path.split('.');
      const entry = OWNER_AGENT_TOOLS.find((t) => t.tool.id === id);
      expect(entry, path).toBeDefined();
      let node = z.toJSONSchema(entry!.tool.outputSchema as unknown as z.ZodType) as JsonNode;
      for (const key of rest) node = (node.properties as Record<string, JsonNode>)[key];
      expect(node?.type, path).toBe('string');
    }
  });

  it('the walker itself catches a string, an unknown and an open record', () => {
    const bad = z.object({
      name: z.string(),
      blob: z.unknown(),
      byCode: z.record(z.string(), z.number()),
      maybeName: z.string().nullable(),
      ok: z.number().nullable(),
    });
    const issues = disallowedNodes(z.toJSONSchema(bad) as JsonNode, 't');
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('t.name'),
        expect.stringContaining('t.blob'),
        expect.stringContaining('t.byCode'),
        expect.stringContaining('t.maybeName'),
      ]),
    );
    expect(issues.some((i) => i.startsWith('t.ok'))).toBe(false);
  });
});

describe('input schemas: the range enum and nothing else', () => {
  it.each(OWNER_AGENT_TOOLS.map((t) => [t.tool.id, t.tool]))('%s takes only { range }', (_id, tool) => {
    expect(tool.inputSchema).toBe(rangeInputSchema);
    const json = z.toJSONSchema(tool.inputSchema as unknown as z.ZodType) as JsonNode;
    expect(json.type).toBe('object');
    expect(json.additionalProperties).toBe(false);
    expect(json.required).toEqual(['range']);
    const props = json.properties as Record<string, JsonNode>;
    expect(Object.keys(props)).toEqual(['range']);
    expect(props.range.type).toBe('string');
    expect(props.range.enum).toEqual(['today', '7d', '30d']);
    expect('pattern' in props.range || 'format' in props.range).toBe(false);
  });

  it('the shared schema accepts exactly the three literals', () => {
    for (const r of OWNER_AGENT_RANGES) expect(rangeInputSchema.safeParse({ range: r }).success).toBe(true);
    for (const r of ['', ' today', 'TODAY', '1d', 'yesterday', 'שבוע', '7d; drop table']) {
      expect(rangeInputSchema.safeParse({ range: r }).success).toBe(false);
    }
  });
});
