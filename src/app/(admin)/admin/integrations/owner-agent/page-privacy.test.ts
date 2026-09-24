// End to end from the database row to the component props: the REAL owner-agent DAL
// runs under the real page, fed rows that carry full E.164 numbers, and nothing handed
// to a component may contain one. The client components are what cross to the
// browser, so this is the boundary the masking exists for.
//
// page.test.ts mocks the DAL and cannot make this claim; owner-agent.test.ts proves
// each reader masks. This one proves the two are still joined up — a reader that
// stopped masking, or a page that started reading a raw column of its own, fails here.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockSupabase, type QueryResult } from '@/test/supabase-mock';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformOwner: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('./actions', () => ({
  setOwnerAgentEnabledAction: vi.fn(),
  setOwnerAgentNumberAction: vi.fn(),
  setOwnerAgentDailyCapAction: vi.fn(),
  addAllowlistEntryAction: vi.fn(),
  setAllowlistEntryEnabledAction: vi.fn(),
  relabelAllowlistEntryAction: vi.fn(),
  removeAllowlistEntryAction: vi.fn(),
}));

import { requirePlatformOwner } from '@/lib/auth/dal';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import OwnerAgentPage from './page';

const OWNER_ID = '6f1c2d3e-4b5a-4c7d-8e9f-0a1b2c3d4e5f';
const ENTRY_ID = '9d8c7b6a-5f4e-4d3c-ab2a-1f0e9d8c7b6a';

// Three distinct raw numbers, one per source the page draws from.
const BUSINESS_E164 = '+97233301505'; // provider_numbers.e164
const ALLOWED_E164 = '+972501234567'; // owner_agent_allowlist.e164
const VERIFIED_E164 = '+972539998877'; // profiles.phone_verified_e164

function routed(tables: Record<string, QueryResult<unknown>>) {
  const builders = Object.fromEntries(
    Object.entries(tables).map(([t, r]) => [t, createMockSupabase(r as never).builder]),
  );
  const fallback = createMockSupabase({ data: null, error: null } as never).builder;
  return { from: vi.fn((t: string) => builders[t] ?? fallback), rpc: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformOwner).mockResolvedValue({ id: OWNER_ID } as never);
  vi.mocked(createClient).mockResolvedValue(
    routed({
      app_settings: {
        data: {
          owner_agent_enabled: false,
          owner_agent_phone_number_id: '1234567890123456',
          owner_agent_daily_cap: 50,
        },
        error: null,
      },
      provider_numbers: {
        data: [
          {
            provider_ref: '1234567890123456',
            e164: BUSINESS_E164,
            display_label: 'אישורי הגעה',
            is_active: true,
            provider_number_roles: [{ role: 'whatsapp_rsvp_sender' }],
          },
        ],
        error: null,
      },
      owner_agent_allowlist: {
        data: [
          {
            id: ENTRY_ID,
            e164: ALLOWED_E164,
            staff_user_id: OWNER_ID,
            enabled: true,
            label: null,
            created_at: '2026-09-24T08:00:00Z',
          },
        ],
        error: null,
      },
      platform_staff: {
        data: [{ user_id: OWNER_ID, platform_roles: { label: 'בעלים', is_owner_role: true } }],
        error: null,
      },
      owner_agent_audit: { data: [], error: null },
    }) as never,
  );
  vi.mocked(createAdminClient).mockReturnValue(
    routed({
      profiles: {
        data: [{ id: OWNER_ID, full_name: 'בעל המערכת', phone_verified_e164: VERIFIED_E164 }],
        error: null,
      },
    }) as never,
  );
});

type Props = Record<string, unknown>;

function componentProps(node: unknown, out: Props[] = []): Props[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => componentProps(n, out));
    return out;
  }
  const el = node as { props?: Props & { children?: unknown } };
  if (el.props) out.push(el.props);
  componentProps(el.props?.children, out);
  return out;
}

describe('/admin/integrations/owner-agent — no raw phone crosses to a component', () => {
  it('hands every component masked numbers only', async () => {
    const tree = await OwnerAgentPage();
    // Data props only: element plumbing (children, component types) is not data.
    const json = JSON.stringify(componentProps(tree), (key, value) =>
      key === 'children' || key === 'type' ? undefined : value,
    );

    // The walk really reached the data — both sources arrive, masked.
    expect(json).toContain('033***1505');
    expect(json).toContain('050***4567');

    for (const raw of [BUSINESS_E164, ALLOWED_E164, VERIFIED_E164]) {
      expect(json).not.toContain(raw);
      expect(json).not.toContain(raw.slice(1)); // nor the digits without the plus
    }
    expect(json).not.toMatch(/\+\d{7,}/);
  });

  it('still reports the verified-phone match, as a boolean', async () => {
    const tree = await OwnerAgentPage();
    const panel = componentProps(tree).find((p) => Array.isArray(p.entries));
    expect(panel?.entries).toEqual([
      expect.objectContaining({ id: ENTRY_ID, verifiedMatch: false, maskedNumber: '050***4567' }),
    ]);
  });
});
