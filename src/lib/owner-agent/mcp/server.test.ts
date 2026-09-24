import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/events', () => ({ getEventsPipelineSummary: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/system-health', () => ({ getSystemHealthSummary: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/inquiries', () => ({ getInquiriesSummary: vi.fn() }));
vi.mock('@/lib/owner-agent/cores/billing', () => ({ getBillingSummary: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { getBillingSummary, type BillingSummary } from '@/lib/owner-agent/cores/billing';
import { getEventsPipelineSummary, type EventsPipelineSummary } from '@/lib/owner-agent/cores/events';
import { getInquiriesSummary } from '@/lib/owner-agent/cores/inquiries';
import { getSystemHealthSummary, type SystemHealthSummary } from '@/lib/owner-agent/cores/system-health';
import { eventsPipelineTool } from '@/lib/owner-agent/tools/events-pipeline';
import { OWNER_AGENT_PERMISSIONS } from '@/lib/owner-agent/tools/shared';
import { createOwnerAgentMcpServer, parsePermissionsEnv } from './server';

const FAKE_CLIENT = { marker: 'fake-admin-client' };

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
  chargedAmountIls: 1250.5,
  creditAppliedAmountIls: 50,
  creditGrantedAmountIls: 100,
  creditUnvoidedAmountIls: 170,
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

let client: Client | undefined;

async function connect(granted: Iterable<string>): Promise<Client> {
  const server = createOwnerAgentMcpServer(new Set(granted));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: 'owner-agent-test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), c.connect(clientSide)]);
  client = c;
  return c;
}

const listed = async (c: Client) => (await c.listTools()).tools.map((t) => t.name).sort();

type CallResult = Awaited<ReturnType<Client['callTool']>>;
const textOf = (r: CallResult) => {
  const content = r.content as { type: string; text: string }[];
  expect(content).toHaveLength(1);
  expect(content[0].type).toBe('text');
  return content[0].text;
};
const errorCode = (r: CallResult) => {
  expect(r.isError).toBe(true);
  return (JSON.parse(textOf(r)) as { error: string }).error;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue(
    FAKE_CLIENT as unknown as ReturnType<typeof createAdminClient>,
  );
});

afterEach(async () => {
  await client?.close();
  client = undefined;
});

describe('tools/list offers only what the permission set unlocks', () => {
  it.each([
    [['view_events'], ['events_pipeline', 'rsvp_totals']],
    [['view_webhooks'], ['system_health', 'whatsapp_delivery_summary']],
    [['view_customer_data', 'manage_voice'], ['inquiries_summary', 'voice_calls_summary', 'web_traffic_summary']],
    [['view_billing'], ['billing_summary']],
    [['view_billing', 'view_events'], ['billing_summary', 'events_pipeline', 'rsvp_totals']],
    [[], []],
    [['manage_staff', 'VIEW_EVENTS', ' view_events'], []],
  ])('%j → %j', async (granted, expected) => {
    expect(await listed(await connect(granted))).toEqual(expected);
  });

  it('all six keys → the nine tools', async () => {
    const names = await listed(await connect(OWNER_AGENT_PERMISSIONS));
    expect(names).toEqual([
      'billing_summary',
      'campaigns_status_summary',
      'events_pipeline',
      'inquiries_summary',
      'rsvp_totals',
      'system_health',
      'voice_calls_summary',
      'web_traffic_summary',
      'whatsapp_delivery_summary',
    ]);
  });

  it("each tool carries the Mastra tool's description and a strict { range } JSON Schema", async () => {
    const tools = (await (await connect(['view_events'])).listTools()).tools;
    const tool = tools.find((t) => t.name === 'events_pipeline');
    if (!tool) throw new Error('events_pipeline not listed');
    expect(tool.description).toBe(eventsPipelineTool.description);
    expect(tool.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['range'],
      properties: { range: { type: 'string', enum: ['today', '7d', '30d'] } },
    });
  });
});

describe('tools/call', () => {
  it('a permitted tool runs its core with the server-side client and returns the output as JSON text', async () => {
    vi.mocked(getEventsPipelineSummary).mockResolvedValue(events);
    const r = await (await connect(['view_events'])).callTool({ name: 'events_pipeline', arguments: { range: '7d' } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(textOf(r))).toEqual(events);
    expect(vi.mocked(getEventsPipelineSummary)).toHaveBeenCalledWith(FAKE_CLIENT, '7d');
  });

  it('a tool whose permission is NOT granted fails as unknown_tool and never runs', async () => {
    const c = await connect(['view_events']);
    for (const name of ['system_health', 'inquiries_summary']) {
      expect(errorCode(await c.callTool({ name, arguments: { range: '7d' } }))).toBe('unknown_tool');
    }
    expect(vi.mocked(getSystemHealthSummary)).not.toHaveBeenCalled();
    expect(vi.mocked(getInquiriesSummary)).not.toHaveBeenCalled();
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });

  it('billing_summary is callable only under view_billing', async () => {
    const withoutBilling = await connect(['view_events', 'manage_billing']);
    expect(
      errorCode(await withoutBilling.callTool({ name: 'billing_summary', arguments: { range: 'today' } })),
    ).toBe('unknown_tool');
    expect(vi.mocked(getBillingSummary)).not.toHaveBeenCalled();
    await withoutBilling.close();

    vi.mocked(getBillingSummary).mockResolvedValue(billing);
    const withBilling = await connect(['view_billing']);
    const r = await withBilling.callTool({ name: 'billing_summary', arguments: { range: 'today' } });
    expect(r.isError).toBeFalsy();
    expect(JSON.parse(textOf(r))).toEqual(billing);
    expect(vi.mocked(getBillingSummary)).toHaveBeenCalledWith(FAKE_CLIENT, 'today');
  });

  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', '', 'mcp__owner_agent__events_pipeline'])(
    'the name %j is not a tool',
    async (name) => {
      const c = await connect(OWNER_AGENT_PERMISSIONS);
      expect(errorCode(await c.callTool({ name, arguments: { range: '7d' } }))).toBe('unknown_tool');
    },
  );

  it.each([
    ['an unknown range', { range: '90d' }],
    ['free text', { range: 'כמה אירועים היו אצל דנה?' }],
    ['an extra key', { range: '7d', eventId: '6f1c1f9e-0000-4000-8000-000000000000' }],
    ['no range', {}],
    ['no arguments at all', undefined],
  ])('%s is invalid_input and never reaches the core', async (_label, args) => {
    const c = await connect(['view_events']);
    const r = await c.callTool({ name: 'events_pipeline', ...(args === undefined ? {} : { arguments: args }) });
    expect(errorCode(r)).toBe('invalid_input');
    expect(textOf(r)).toBe('{"error":"invalid_input"}');
    expect(vi.mocked(getEventsPipelineSummary)).not.toHaveBeenCalled();
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });

  it('a core failure is tool_failed: no SQL, no provider text, not even on stderr', async () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getSystemHealthSummary).mockRejectedValue(
      new Error('relation "webhook_inbox" does not exist — password=hunter2 at pg://db'),
    );
    const r = await (await connect(['view_webhooks'])).callTool({ name: 'system_health', arguments: { range: 'today' } });
    expect(errorCode(r)).toBe('tool_failed');
    expect(textOf(r)).toBe('{"error":"tool_failed"}');
    const logged = JSON.stringify(stderr.mock.calls);
    expect(logged).not.toMatch(/relation|hunter2|pg:\/\//);
    expect(stderr).toHaveBeenCalledWith('[owner-agent-mcp] tool_failed system_health');
  });

  it('a core result of the wrong shape is tool_failed, and the value is not echoed', async () => {
    vi.mocked(getSystemHealthSummary).mockResolvedValue({
      ...health,
      unprocessed: 'דנה 0501234567' as unknown as number,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await (await connect(['view_webhooks'])).callTool({ name: 'system_health', arguments: { range: '30d' } });
    expect(errorCode(r)).toBe('tool_failed');
    expect(textOf(r)).not.toContain('0501234567');
  });
});

describe('parsePermissionsEnv', () => {
  it.each([
    [undefined, []],
    ['', []],
    [',', []],
    ['view_events', ['view_events']],
    ['view_events,view_webhooks', ['view_events', 'view_webhooks']],
    // Exact keys only, like toolsForPermissions: no trimming, no case folding.
    [' view_events', [' view_events']],
  ])('%j → %j', (raw, expected) => {
    expect([...parsePermissionsEnv(raw)]).toEqual(expected);
  });
});
