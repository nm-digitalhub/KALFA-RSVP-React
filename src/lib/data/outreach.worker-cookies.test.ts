import { beforeEach, describe, expect, it, vi } from 'vitest';

// Regression guard for the auto-thankyou worker incident (2026-07-13): the
// pg-boss worker's runThankyouSweep → sendCampaignWhatsApp(…, 'thankyou') threw
// "(0 , import_headers.cookies) is not a function" because the send path
// resolved contacts through listSendableContacts → requireEventAccess →
// requireUser → createClient(server) → cookies(), and next/headers is a no-op
// stub in the esbuild worker bundle.
//
// Unlike outreach.test.ts (which MOCKS the contact resolver and so never
// exercised the cookie dependency — that is exactly why the bug shipped), this
// file runs the REAL resolveSendableContacts and mocks every cookie-bearing
// module to THROW. The path must complete the send WITHOUT ever touching any of
// them; if the send path is ever reverted to the request-scoped gate, one of
// these throwing mocks is invoked and this test fails loudly.

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/outreach-config', () => ({
  getOutreachEnabled: vi.fn(),
  getWhatsAppConfig: vi.fn(),
}));
vi.mock('@/lib/data/message-templates-resolve', () => ({ resolveTemplateForEvent: vi.fn() }));
vi.mock('@/lib/whatsapp/client', () => ({
  sendWhatsAppTemplate: vi.fn(),
  sendWhatsAppMarketingTemplate: vi.fn(),
}));
// After the request-free split, outreach.ts resolves contacts through
// @/lib/data/sendable-contacts (which imports ONLY createAdminClient), so
// contacts.ts / reconcile-config are no longer in the worker send graph. This
// stub stays as belt-and-suspenders in case the graph regresses back through
// contacts.ts (module load only — the resolver never calls it).
vi.mock('@/lib/data/reconcile-config', () => ({ isReconcileEnabled: vi.fn(() => false) }));

// The cookie-bearing modules: any invocation throws with a unique marker. These
// are the ONLY thing the fix removed from the worker send path. Defined via
// vi.hoisted so the (hoisted) vi.mock factories below can reference them.
const { cookies, serverCreateClient, requireEventAccess, requireUser } = vi.hoisted(
  () => ({
    cookies: vi.fn(() => {
      throw new Error('WORKER_PATH_CALLED_cookies');
    }),
    serverCreateClient: vi.fn(() => {
      throw new Error('WORKER_PATH_CALLED_server_createClient');
    }),
    requireEventAccess: vi.fn(() => {
      throw new Error('WORKER_PATH_CALLED_requireEventAccess');
    }),
    requireUser: vi.fn(() => {
      throw new Error('WORKER_PATH_CALLED_requireUser');
    }),
  }),
);
vi.mock('next/headers', () => ({ cookies }));
vi.mock('@/lib/supabase/server', () => ({ createClient: serverCreateClient }));
vi.mock('@/lib/data/events', () => ({ requireEventAccess, requireOwnedEvent: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requireUser, getUser: requireUser }));

import { createMockSupabase, type MockQueryBuilder } from '@/test/supabase-mock';
import { createAdminClient } from '@/lib/supabase/admin';
import { getOutreachEnabled, getWhatsAppConfig } from '@/lib/data/outreach-config';
import { resolveTemplateForEvent } from '@/lib/data/message-templates-resolve';
import { sendWhatsAppMarketingTemplate } from '@/lib/whatsapp/client';
import { sendCampaignWhatsApp } from '@/lib/data/outreach';

const config = {
  phoneNumberId: 'PNID',
  wabaId: null,
  accessToken: 'TKN',
  appSecret: null,
  verifyToken: null,
};

const activeCampaignRow = {
  id: 'c1',
  event_id: 'e1',
  status: 'active',
  allowed_channels: ['whatsapp'],
};

// 2999 far-future so the L1 past-event gate never trips.
const bindableEventRow = {
  event_date: '2999-01-07T19:00:00+00:00',
  status: 'active',
  name: 'החתונה של דוד ושרה',
  event_type: 'wedding',
  venue_name: 'אולמי הגן',
  venue_address: 'דרך השלום 10, תל אביב',
  celebrants: { groom: 'דוד לוי', bride: 'שרה כהן' },
};

const thankyouTemplate = {
  name: 'kalfa_event_thankyou_v1',
  language: 'he',
  channel: 'whatsapp' as const,
  paramContract: 'thankyou',
};

type Row = Record<string, unknown>;

// Sequence the shared admin builder across the whole thankyou run, INCLUDING the
// real resolveSendableContacts contacts query (await #3):
//   1 campaign read · 2 events read · 3 resolveSendableContacts contacts read ·
//   4 attending-guests read · 5 guest-names read · (rest → builder default).
function sequenceRun(builder: MockQueryBuilder<Row>) {
  vi.spyOn(builder, 'then')
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: activeCampaignRow, error: null }),
    )
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: bindableEventRow, error: null }),
    )
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({
        data: [{ id: 'k1', normalized_phone: '+972501111111' }],
        error: null,
      }),
    )
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({ data: [{ contact_id: 'k1' }], error: null }),
    )
    .mockImplementationOnce((f) =>
      (f as (v: unknown) => unknown)({
        data: [{ contact_id: 'k1', full_name: 'דנה כהן' }],
        error: null,
      }),
    );
}

beforeEach(() => vi.clearAllMocks());

describe('sendCampaignWhatsApp — worker (auto-thankyou) path is cookies-free', () => {
  it('sends a thank-you via the REAL contact resolver without touching cookies/requireUser/server-client/requireEventAccess', async () => {
    vi.mocked(getOutreachEnabled).mockResolvedValue(true);
    vi.mocked(getWhatsAppConfig).mockResolvedValue(config);
    vi.mocked(resolveTemplateForEvent).mockResolvedValue(thankyouTemplate);
    vi.mocked(sendWhatsAppMarketingTemplate).mockResolvedValue({
      kind: 'accepted',
      providerId: 'wamid.ty',
    });

    const { client, builder } = createMockSupabase<Row>({ data: null, error: null });
    vi.mocked(createAdminClient).mockReturnValue(
      client as unknown as ReturnType<typeof createAdminClient>,
    );
    client.rpc.mockResolvedValue({ data: 'claimed', error: null });
    sequenceRun(builder);

    const r = await sendCampaignWhatsApp('c1', 'thankyou');

    // The send path completed end-to-end through the real resolver.
    expect(r).toEqual({ sent: 1, skipped: 0, blocked: false });
    expect(sendWhatsAppMarketingTemplate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendWhatsAppMarketingTemplate).mock.calls[0][1].to).toBe(
      '+972501111111',
    );

    // …and never invoked ANY cookie-bearing helper (the worker bundle stubs them).
    expect(cookies).not.toHaveBeenCalled();
    expect(serverCreateClient).not.toHaveBeenCalled();
    expect(requireEventAccess).not.toHaveBeenCalled();
    expect(requireUser).not.toHaveBeenCalled();
  });
});
