import { describe, expect, it, vi, beforeEach } from 'vitest';

// `server-only` throws outside Next's server runtime — stub it (repo convention).
vi.mock('server-only', () => ({}));

// The filter under test is pure list logic over what the query returned, so the
// admin client is stubbed at the module boundary rather than the DB being faked.
const rows = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => rows(),
        }),
      }),
    }),
  }),
}));

const { listDialableVoicePurposes, listVoicePurposes } = await import('./voice-purposes');

const row = (over: Record<string, unknown>) => ({
  key: 'k',
  display_name: 'שם',
  description: null,
  rule_id: '123',
  enabled: true,
  is_builtin: false,
  lead_ms: 0,
  min_delay_ms: 0,
  token_ttl_sec: 7200,
  active: true,
  ...over,
});

beforeEach(() => rows.mockReset());

describe('listDialableVoicePurposes', () => {
  it('⚠️ drops the built-ins the dialler refuses', async () => {
    // voice-purpose-dispatch.ts:78 blocks them outright. Offering one in the
    // call node's dropdown lets an owner pick it, satisfy every required-field
    // gate (purposeKey is non-empty — that is all NODE_REQUIRED_FIELDS asks),
    // arm the workflow, and find out only when a guest should have been called.
    rows.mockResolvedValue({
      data: [row({ key: 'rsvp', is_builtin: true }), row({ key: 'mine' })],
      error: null,
    });
    expect((await listDialableVoicePurposes()).map((p) => p.key)).toEqual(['mine']);
  });

  it('⚠️ drops a purpose with no rule, which the dialler also refuses', async () => {
    // :81, `purpose_rule_missing`. A purpose can be non-built-in and still
    // unwired — that is the state a newly created one starts in.
    rows.mockResolvedValue({
      data: [row({ key: 'unwired', rule_id: null }), row({ key: 'mine' })],
      error: null,
    });
    expect((await listDialableVoicePurposes()).map((p) => p.key)).toEqual(['mine']);
  });

  it('⚠️ returns NOTHING for the three rows shipped today, and that is correct', () => {
    // As of 2026-09-15 the live table holds rsvp / meeting_confirm / sales, all
    // built-in and all with a NULL rule. An empty dropdown is the honest answer
    // and the property panel says so in words; a looser filter here would only
    // move the failure to run time.
    rows.mockResolvedValue({
      data: [
        row({ key: 'rsvp', is_builtin: true, rule_id: null }),
        row({ key: 'meeting_confirm', is_builtin: true, rule_id: null }),
        row({ key: 'sales', is_builtin: true, rule_id: null }),
      ],
      error: null,
    });
    return expect(listDialableVoicePurposes()).resolves.toEqual([]);
  });

  it('the unfiltered list still returns every active row — the admin needs them', async () => {
    rows.mockResolvedValue({
      data: [row({ key: 'rsvp', is_builtin: true }), row({ key: 'mine' })],
      error: null,
    });
    expect((await listVoicePurposes()).map((p) => p.key)).toEqual(['rsvp', 'mine']);
  });
});
