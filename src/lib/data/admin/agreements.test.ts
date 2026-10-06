import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/activity', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/data/agreement-config', () => ({ getAgreementConfigTokens: vi.fn() }));
vi.mock('@/lib/data/agreements-doc', () => ({ getActiveAgreementDoc: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getAgreementConfigTokens } from '@/lib/data/agreement-config';
import { getActiveAgreementDoc } from '@/lib/data/agreements-doc';
import { logActivity } from '@/lib/data/activity';
import { createAdminClient } from '@/lib/supabase/admin';
import { defaultBodyAsTemplate } from '@/lib/agreements/template';
import { createMockSupabase } from '@/test/supabase-mock';
import {
  approveAgreement,
  getAgreementForAdmin,
  getAgreementStarterBody,
  revertAgreementToTemplate,
  updateAgreement,
} from './agreements';

const GOOD_BODY = '<h1>חבילה</h1><p>{{packagePrice}} · עד {{contactQuota}} · {{company.name}}</p>';

// A query builder that also has .match (the admin layer filters by model with it).
function wire(results: Array<{ data?: unknown; error?: unknown }> = [{ data: null, error: null }]) {
  const { client, builder } = createMockSupabase<unknown>({ data: null, error: null });
  Object.assign(builder, { match: vi.fn(() => builder) });
  const then = vi.spyOn(builder, 'then');
  for (const r of results) then.mockImplementationOnce((f) => f({ data: r.data ?? null, error: (r.error ?? null) as never }));
  vi.mocked(createAdminClient).mockReturnValue(client as unknown as ReturnType<typeof createAdminClient>);
  return builder as typeof builder & { match: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  for (const m of [requirePlatformPermission, logActivity, getAgreementConfigTokens, getActiveAgreementDoc, createAdminClient]) {
    vi.mocked(m).mockReset();
  }
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'admin-1' } as unknown as User);
  vi.mocked(getAgreementConfigTokens).mockResolvedValue({ liabilityCap: '', retentionDays: '' });
});

describe('every admin function is behind manage_settings', () => {
  it.each([
    ['getAgreementForAdmin', () => getAgreementForAdmin('package')],
    ['getAgreementStarterBody', () => getAgreementStarterBody()],
    ['updateAgreement', () => updateAgreement({ model: 'package', version: '2026-10-v6', bodyHtml: GOOD_BODY })],
    ['approveAgreement', () => approveAgreement('2026-10-v6', 'package')],
    ['revertAgreementToTemplate', () => revertAgreementToTemplate()],
  ])('%s refuses before touching the database when the gate throws', async (_name, call) => {
    vi.mocked(requirePlatformPermission).mockRejectedValue(new Error('NEXT_REDIRECT'));
    await expect(call()).rejects.toThrow('NEXT_REDIRECT');
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });
});

describe('getAgreementForAdmin', () => {
  it('reads the active row for pay-per-result and the single package row for the package model', async () => {
    const perResult = wire([{ data: { version: '2026-07-v4', body_html: null, status: 'approved', approved_at: 't' } }]);
    expect((await getAgreementForAdmin()).version).toBe('2026-07-v4');
    expect(perResult.match).toHaveBeenCalledWith({ model: 'per_result', is_active: true });

    const pkg = wire([{ data: { version: 'draft-2026-10-v6', body_html: GOOD_BODY, status: 'draft', approved_at: null } }]);
    expect(await getAgreementForAdmin('package')).toMatchObject({ model: 'package', bodyHtml: GOOD_BODY, status: 'draft' });
    expect(pkg.match).toHaveBeenCalledWith({ model: 'package' });
  });

  it('with no package row yet shows an EMPTY draft — never the pay-per-result text', async () => {
    wire([{ data: null }]);
    expect(await getAgreementForAdmin('package')).toEqual({
      model: 'package',
      version: 'draft-2026-10-v6',
      status: 'draft',
      bodyHtml: '',
      approvedAt: null,
    });
    expect(getActiveAgreementDoc).not.toHaveBeenCalled();
  });
});

describe('getAgreementStarterBody', () => {
  it('is the live pay-per-result default written back as a template', async () => {
    vi.mocked(getActiveAgreementDoc).mockResolvedValue({ version: '2026-07-v4', status: 'approved', bodyHtml: null });
    expect(await getAgreementStarterBody()).toBe(defaultBodyAsTemplate('2026-07-v4'));
  });
});

describe('updateAgreement', () => {
  it('saves a package body as a DRAFT on the package row, and audits it', async () => {
    const b = wire();
    await updateAgreement({ model: 'package', version: 'draft-2026-10-v6', bodyHtml: GOOD_BODY });
    expect(b.update).toHaveBeenCalledWith({
      version: 'draft-2026-10-v6',
      body_html: GOOD_BODY,
      status: 'draft',
      approved_by: null,
      approved_at: null,
    });
    expect(b.match).toHaveBeenCalledWith({ model: 'package' });
    expect(logActivity).toHaveBeenCalledWith({
      action: 'admin.agreement.updated',
      meta: { model: 'package', version: 'draft-2026-10-v6', customBody: true },
    });
  });

  it('a package document needs a body — it has no in-code text to fall back to', async () => {
    const b = wire();
    await expect(updateAgreement({ model: 'package', version: '2026-10-v6', bodyHtml: '   ' })).rejects.toThrow('נוסח חוזה החבילה חייב להיות מלא');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('keeps the versions apart: the package contract takes the package version and the other contract may not', async () => {
    const b = wire();
    await expect(updateAgreement({ model: 'package', version: '2026-09-v5', bodyHtml: GOOD_BODY })).rejects.toThrow('גרסת חוזה החבילה חייבת להיות');
    await expect(updateAgreement({ model: 'per_result', version: '2026-10-v6', bodyHtml: null })).rejects.toThrow('גרסה זו שמורה לחוזה החבילה');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('pay-per-result: the model defaults to it, an empty body means the in-code default, and the ACTIVE row is the one edited', async () => {
    const b = wire();
    await updateAgreement({ version: 'draft-2026-07-v3', bodyHtml: '' });
    expect(b.update).toHaveBeenCalledWith(expect.objectContaining({ body_html: null, status: 'draft' }));
    expect(b.match).toHaveBeenCalledWith({ model: 'per_result', is_active: true });
  });

  it('a database failure is a safe message', async () => {
    wire([{ error: { message: 'constraint agreement_documents_model_shape' } }]);
    await expect(updateAgreement({ model: 'package', version: '2026-10-v6', bodyHtml: GOOD_BODY })).rejects.toThrow('שמירת החוזה נכשלה');
  });
});

describe('approveAgreement', () => {
  it('approves a valid package body, recording who approved it', async () => {
    const b = wire([{ data: { body_html: GOOD_BODY } }, { data: null }]);
    await approveAgreement('2026-10-v6', 'package');
    expect(b.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', version: '2026-10-v6', approved_by: 'admin-1' }),
    );
    expect(b.match).toHaveBeenLastCalledWith({ model: 'package' });
    expect(logActivity).toHaveBeenCalledWith({ action: 'admin.agreement.approved', meta: { model: 'package', version: '2026-10-v6' } });
  });

  it('refuses a package body that does not state the price and the quota', async () => {
    const b = wire([{ data: { body_html: '<p>{{company.name}}</p>' } }]);
    await expect(approveAgreement('2026-10-v6', 'package')).rejects.toThrow('{{packagePrice}} {{contactQuota}}');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('refuses a body with a token no one resolves (a typo would reach the customer as literal braces)', async () => {
    const b = wire([{ data: { body_html: `${GOOD_BODY}<p>{{pakagePrice}}</p>` } }]);
    await expect(approveAgreement('2026-10-v6', 'package')).rejects.toThrow('{{pakagePrice}}');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('refuses a package body that quotes a pay-per-result figure (a package campaign carries ₪0.00 there)', async () => {
    const b = wire([{ data: { body_html: `${GOOD_BODY}<p>{{pricePerReached}}</p>` } }]);
    await expect(approveAgreement('2026-10-v6', 'package')).rejects.toThrow('{{pricePerReached}}');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('accepts the admin-config tokens as known', async () => {
    wire([{ data: { body_html: `${GOOD_BODY}<p>{{liabilityCap}}</p>` } }, { data: null }]);
    await expect(approveAgreement('2026-10-v6', 'package')).resolves.toBeUndefined();
  });

  it('refuses a package approval with no body at all', async () => {
    const b = wire([{ data: { body_html: null } }]);
    await expect(approveAgreement('2026-10-v6', 'package')).rejects.toThrow('נוסח חוזה החבילה חייב להיות מלא');
    expect(b.update).not.toHaveBeenCalled();
  });

  it('pay-per-result: approves the active row; an in-code default body needs no token check', async () => {
    const b = wire([{ data: { body_html: null } }, { data: null }]);
    await approveAgreement('2026-07-v4');
    expect(b.match).toHaveBeenLastCalledWith({ model: 'per_result', is_active: true });
  });

  it('pay-per-result may not take the package version', async () => {
    const b = wire([{ data: { body_html: null } }]);
    await expect(approveAgreement('2026-10-v6')).rejects.toThrow('גרסה זו שמורה לחוזה החבילה');
    expect(b.update).not.toHaveBeenCalled();
  });
});

describe('revertAgreementToTemplate', () => {
  it('only ever touches the pay-per-result row — the package contract has no template to return to', async () => {
    const b = wire();
    await revertAgreementToTemplate();
    expect(b.match).toHaveBeenCalledWith({ model: 'per_result', is_active: true });
    expect(b.update).toHaveBeenCalledWith(expect.objectContaining({ body_html: null, status: 'draft' }));
  });
});
