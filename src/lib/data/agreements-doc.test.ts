import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import { getApprovedPackageAgreementDoc } from './agreements-doc';

const GOOD_BODY = '<h1>חבילה</h1><p>{{packagePrice}} · עד {{contactQuota}} אנשי קשר</p>';

function wire(row: Record<string, unknown> | null) {
  const { client, builder } = createMockSupabase<unknown>({ data: row, error: null });
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return { client, builder };
}

beforeEach(() => {
  vi.mocked(createAdminClient).mockReset();
});

describe('getApprovedPackageAgreementDoc — the package contract a customer may be offered', () => {
  it('reads the package document and returns it when it is approved, has a body, the package version and the price + quota tokens', async () => {
    const { builder } = wire({ version: '2026-10-v6', body_html: GOOD_BODY, status: 'approved' });
    expect(await getApprovedPackageAgreementDoc()).toEqual({ version: '2026-10-v6', status: 'approved', bodyHtml: GOOD_BODY });
    expect(builder.eq).toHaveBeenCalledWith('model', 'package');
  });

  it.each([
    ['there is no package document', null],
    ['it is still a draft — a draft is never offered', { version: 'draft-2026-10-v6', body_html: GOOD_BODY, status: 'draft' }],
    ['it has no body (there is no in-code text to fall back to)', { version: '2026-10-v6', body_html: null, status: 'approved' }],
    ['its body is blank', { version: '2026-10-v6', body_html: '  \n ', status: 'approved' }],
    ['its version is not the package version', { version: '2026-09-v5', body_html: GOOD_BODY, status: 'approved' }],
    ['its body does not state the price', { version: '2026-10-v6', body_html: '<p>עד {{contactQuota}}</p>', status: 'approved' }],
    ['its body does not state the quota', { version: '2026-10-v6', body_html: '<p>{{packagePrice}}</p>', status: 'approved' }],
  ])('returns null when %s', async (_label, row) => {
    wire(row);
    expect(await getApprovedPackageAgreementDoc()).toBeNull();
  });

  it('never falls back to the pay-per-result document', async () => {
    const { client } = wire(null);
    await getApprovedPackageAgreementDoc();
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});
