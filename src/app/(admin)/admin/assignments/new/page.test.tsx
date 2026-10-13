import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/coupon-assignments', () => ({
  listAssignableOffers: vi.fn(),
  lookupStaffAssignmentRecipient: vi.fn(),
}));
vi.mock('./assign-form', () => ({
  AssignForm: ({ email }: { email: string }) => <div data-marker="assign-form" data-email={email} />,
}));

import { requirePlatformPermission } from '@/lib/auth/dal';
import {
  listAssignableOffers,
  lookupStaffAssignmentRecipient,
} from '@/lib/data/admin/coupon-assignments';
import AdminAssignNewPage from './page';

// The assign screen's account step (admin-panel ג.1, spec §8): nothing can be assigned
// before an account was resolved and shown; found / not-found / lookup-failed are three
// different messages, and a lookup failure is NEVER presented as a missing account.

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  const tree = await AdminAssignNewPage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'staff-1' } as unknown as User);
  vi.mocked(listAssignableOffers).mockResolvedValue([
    {
      id: 'o-1',
      title: 'לקוחות מצטרפים',
      valueLabel: '10%',
      expiresLabel: '27.10.2026',
      options: [{ name: 'חבילה', listPrice: '₪100', finalPrice: '₪90' }],
      rawOptions: [{ packageId: 'p-1', listPrice: 100, discountAmount: 10, finalPrice: 90 }],
    },
  ]);
});

describe('/admin/assignments/new (the account step)', () => {
  it('without an email: only the lookup step — no offer form, nothing assignable yet', async () => {
    const html = await render();
    expect(html).toContain('איתור חשבון');
    expect(html).not.toContain('assign-form');
    expect(lookupStaffAssignmentRecipient).not.toHaveBeenCalled();
  });

  it('a malformed email is rejected by shape before any lookup', async () => {
    const html = await render({ email: 'not-an-email' });
    expect(html).toContain('כתובת אימייל לא תקינה');
    expect(lookupStaffAssignmentRecipient).not.toHaveBeenCalled();
  });

  it('found: the account card with its active benefits, and ONLY then the offer form', async () => {
    vi.mocked(lookupStaffAssignmentRecipient).mockResolvedValue({
      status: 'found',
      account: { id: 'u-1', email: 'c@x.il', name: 'נועם לקוח' },
      activeBenefits: [{ summary: '90₪', expiresAt: '2026-10-26T00:00:00.000Z' }],
    });

    const html = await render({ email: 'c@x.il' });

    expect(html).toContain('נועם לקוח');
    expect(html).toContain('הטבות פעילות קיימות');
    expect(html).toContain('data-marker="assign-form"');
    expect(html).toContain('data-email="c@x.il"');
  });

  it('not_found: the exact spec message, no form', async () => {
    vi.mocked(lookupStaffAssignmentRecipient).mockResolvedValue({ status: 'not_found' });
    const html = await render({ email: 'missing@x.il' });
    expect(html).toContain('לא נמצא חשבון עם האימייל הזה');
    expect(html).not.toContain('assign-form');
  });

  it('unavailable: a lookup FAILURE message distinct from a missing account, no form', async () => {
    vi.mocked(lookupStaffAssignmentRecipient).mockResolvedValue({ status: 'unavailable' });
    const html = await render({ email: 'c@x.il' });
    expect(html).toContain('חיפוש החשבון נכשל');
    expect(html).toContain('לא חשבון חסר');
    expect(html).not.toContain('לא נמצא חשבון עם האימייל הזה');
    expect(html).not.toContain('assign-form');
  });
});
