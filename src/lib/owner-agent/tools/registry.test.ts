import { describe, expect, expectTypeOf, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { OWNER_AGENT_TOOLS, toolsForPermissions, type OwnerAgentToolId } from './registry';
import { OWNER_AGENT_PERMISSIONS } from './shared';

// The §5 table, restated as the binding contract: tool id → the one permission
// that unlocks it, for all nine tools. Decision 9.10 (recommended default,
// assumed) puts tools 7 and 9 under view_webhooks.
const PLAN_TABLE: Record<OwnerAgentToolId, string> = {
  inquiries_summary: 'view_customer_data',
  campaigns_status_summary: 'manage_billing',
  billing_summary: 'view_billing',
  voice_calls_summary: 'manage_voice',
  events_pipeline: 'view_events',
  rsvp_totals: 'view_events',
  whatsapp_delivery_summary: 'view_webhooks',
  web_traffic_summary: 'view_customer_data',
  system_health: 'view_webhooks',
};

const ids = (o: object) => Object.keys(o).sort();
const entries = (list: ReadonlyArray<{ tool: { id: string }; permission: string }>) =>
  Object.fromEntries(list.map((t) => [t.tool.id, t.permission]));

describe('OWNER_AGENT_TOOLS', () => {
  it('offers all nine §5 tools, each with its §5 permission, in §5 order', () => {
    expect(OWNER_AGENT_TOOLS).toHaveLength(9);
    expect(entries(OWNER_AGENT_TOOLS)).toEqual(PLAN_TABLE);
    expect(OWNER_AGENT_TOOLS.map((t) => t.tool.id)).toEqual(Object.keys(PLAN_TABLE));
  });

  it('ids are unique and every permission is one of the six keys', () => {
    expect(new Set(OWNER_AGENT_TOOLS.map((t) => t.tool.id)).size).toBe(9);
    for (const { permission } of OWNER_AGENT_TOOLS) {
      expect(OWNER_AGENT_PERMISSIONS).toContain(permission);
    }
  });

  it('tool ids are literal types (a typo in a consumer is a tsc error)', () => {
    // Spelled out, not derived from PLAN_TABLE (whose key type IS
    // OwnerAgentToolId, so comparing against it would prove nothing). If the
    // id type widened to `string`, this is a tsc error.
    expectTypeOf<OwnerAgentToolId>().toEqualTypeOf<
      | 'inquiries_summary'
      | 'campaigns_status_summary'
      | 'billing_summary'
      | 'voice_calls_summary'
      | 'events_pipeline'
      | 'rsvp_totals'
      | 'whatsapp_delivery_summary'
      | 'web_traffic_summary'
      | 'system_health'
    >();
  });
});

describe('toolsForPermissions', () => {
  it('an empty grant set yields no tools', () => {
    expect(toolsForPermissions(new Set())).toEqual({});
  });

  it('unrelated or unknown keys grant nothing', () => {
    expect(toolsForPermissions(new Set(['manage_settings', 'manage_staff', 'roles.manage', '']))).toEqual({});
    // Case and whitespace are not normalised: only the exact key counts.
    expect(toolsForPermissions(new Set(['VIEW_EVENTS', ' view_events']))).toEqual({});
  });

  it.each([
    ['view_customer_data', ['inquiries_summary', 'web_traffic_summary']],
    ['manage_billing', ['campaigns_status_summary']],
    ['view_billing', ['billing_summary']],
    ['manage_voice', ['voice_calls_summary']],
    ['view_events', ['events_pipeline', 'rsvp_totals']],
    ['view_webhooks', ['system_health', 'whatsapp_delivery_summary']],
  ])('%s alone unlocks exactly %j', (key, expected) => {
    expect(ids(toolsForPermissions(new Set([key])))).toEqual(expected);
  });

  it('all six keys unlock the nine tools, keyed by id, the same objects', () => {
    const tools = toolsForPermissions(new Set(OWNER_AGENT_PERMISSIONS));
    expect(ids(tools)).toEqual(OWNER_AGENT_TOOLS.map((t) => t.tool.id).sort());
    for (const { tool } of OWNER_AGENT_TOOLS) {
      expect(tools[tool.id]).toBe(tool);
    }
  });

  it('is pure: a fresh object each call, the input set untouched, no client created', () => {
    const granted = new Set(['view_events']);
    const a = toolsForPermissions(granted);
    const b = toolsForPermissions(granted);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    expect([...granted]).toEqual(['view_events']);
    expect(vi.mocked(createAdminClient)).not.toHaveBeenCalled();
  });
});
