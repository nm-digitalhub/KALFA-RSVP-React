import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn(), hasPlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/coupon-assignments', () => ({ getStaffAssignmentDetail: vi.fn() }));
vi.mock('./void-dialog', () => ({
  VoidAssignmentDialog: () => <div data-marker="void-dialog" />,
}));

import { notFound } from 'next/navigation';
import { hasPlatformPermission, requirePlatformPermission } from '@/lib/auth/dal';
import { getStaffAssignmentDetail, type StaffAssignmentDetail } from '@/lib/data/admin/coupon-assignments';
import AdminAssignmentDetailPage from './page';

// The detail page (admin-panel ב.2, spec §7): the permission gate runs BEFORE existence
// is revealed, side-section failures render as unavailable without hiding the record,
// and cross-links appear only under the viewer's own permissions.

const ID = '12345678-1234-1234-1234-123456789abc';

function detail(overrides: Partial<StaffAssignmentDetail> = {}): StaffAssignmentDetail {
  return {
    assignment: {
      id: ID,
      createdAt: '2026-10-12T10:00:00.000Z',
      expiresAt: '2026-10-26T10:00:00.000Z',
      state: 'bound',
      display: { key: 'bound', label: 'משויכת לאירוע' },
      kind: 'percent',
      value: 10,
      offerId: 'o-1',
      offerTitle: 'לקוחות מצטרפים',
    },
    recipient: {
      userId: 'u-1',
      name: 'נועם לקוח',
      email: 'c@x.il',
      phoneMasked: '+9725…567',
      claimed: true,
      claimedAt: null,
    },
    source: { kind: 'agent', callAttemptId: 'call-1', callbackRequestId: 'cb-1', objectionReason: 'יקר לי' },
    frozenOptions: [
      { packageId: 'p-1', packageName: 'חבילה', listPrice: 100, discountAmount: 10, finalPrice: 90 },
    ],
    currentBinding: {
      campaignId: 'c-1',
      eventId: 'e-1',
      eventName: 'בר מצווה',
      packageId: 'p-1',
      packageName: 'חבילה',
      roundPrice: 90,
      locked: false,
    },
    paymentAttempts: [],
    history: [],
    allowedActions: { canVoid: true, blockReason: null },
    warnings: [],
    ...overrides,
  };
}

async function render(id = ID, searchParams: Record<string, string> = {}): Promise<string> {
  const tree = await AdminAssignmentDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'staff-1' } as unknown as User);
  vi.mocked(hasPlatformPermission).mockResolvedValue(true);
});

describe('/admin/assignments/[id]', () => {
  it('unknown id → notFound, and only AFTER the permission gate ran', async () => {
    vi.mocked(getStaffAssignmentDetail).mockResolvedValue(null);
    await expect(render()).rejects.toThrow(); // notFound() throws
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_billing');
    expect(vi.mocked(notFound)).toBeDefined();
  });

  it('a malformed id 404s without ever reaching the reader', async () => {
    await expect(render('../../etc')).rejects.toThrow();
    expect(getStaffAssignmentDetail).not.toHaveBeenCalled();
  });

  it('renders every section: recipient, saved terms, frozen options with the chosen package marked by ID, binding and status', async () => {
    vi.mocked(getStaffAssignmentDetail).mockResolvedValue(detail());
    const html = await render();

    expect(html).toContain('נועם לקוח');
    expect(html).toContain('10% הנחה');
    expect(html).toContain('יקר לי');
    expect(html).toContain('החבילה שנבחרה');
    expect(html).toContain('משויכת לאירוע');
    expect(html).toContain('טרם נפתח תשלום');
    expect(html).toContain('אין פעולות נוספות מתועדות');
    expect(html).toContain(ID); // the copyable id
    expect(html).toContain('data-marker="void-dialog"'); // the void entry point (ד.6)
  });

  it('side-section failures render as unavailable WITHOUT discarding the main record', async () => {
    vi.mocked(getStaffAssignmentDetail).mockResolvedValue(
      detail({ history: 'unavailable', paymentAttempts: 'unavailable', recipient: 'unavailable' }),
    );
    const html = await render();

    expect(html).toContain('פרטי החשבון אינם זמינים כרגע');
    expect(html).toContain('טעינת ההיסטוריה נכשלה');
    expect(html).toContain('לקוחות מצטרפים'); // the record itself still renders
  });

  it('cross-links are permission-gated: without manage_staff/view_events no user/event link renders', async () => {
    vi.mocked(hasPlatformPermission).mockResolvedValue(false);
    vi.mocked(getStaffAssignmentDetail).mockResolvedValue(detail());
    const html = await render();

    expect(html).not.toContain('/admin/users/u-1');
    expect(html).not.toContain('/admin/events/e-1');
    expect(html).toContain('בר מצווה'); // the name still shows, linkless
  });

  it('ב.3: the back link keeps ONLY validated list params — a crafted return target is dropped', async () => {
    vi.mocked(getStaffAssignmentDetail).mockResolvedValue(detail());
    const html = await render(ID, {
      status: 'waiting',
      page: '2',
      sort: 'expiry',
      // Crafted/unknown params must never shape the back link:
      returnTo: 'https://evil.example/phish',
      q: '../../../etc/passwd',
      offer: 'not-a-uuid',
    });

    expect(html).toContain('href="/admin/assignments?status=waiting&amp;sort=expiry&amp;page=2"');
    expect(html).not.toContain('evil.example');
    expect(html).not.toContain('etc/passwd');
    expect(html).not.toContain('not-a-uuid');
  });

  it('a blocked void explains WHY; warnings (incl. the expired-open-payment sentence) surface', async () => {
    vi.mocked(getStaffAssignmentDetail).mockResolvedValue(
      detail({
        allowedActions: { canVoid: false, blockReason: 'held_by_payment' },
        warnings: ['תוקף ההטבה פג. התשלום הפתוח כפוף לתנאים שנשמרו בעת פתיחתו.'],
      }),
    );
    const html = await render();

    expect(html).toContain('מוחזקת על ידי תשלום פתוח');
    expect(html).toContain('התשלום הפתוח כפוף לתנאים שנשמרו');
  });

  it('a void refusal carried by the notice code is answered on the page — closed codes only', async () => {
    vi.mocked(getStaffAssignmentDetail).mockResolvedValue(
      detail({ allowedActions: { canVoid: false, blockReason: 'already_ended' } }),
    );
    const refused = await render(ID, { notice: 'void_refused_already_ended' });
    expect(refused).toContain('הביטול לא בוצע.');
    expect(refused).toContain('ההטבה כבר הסתיימה — אין מה לבטל.');
    expect(refused).toContain('המצב המעודכן מוצג כאן.');

    const unknown = await render(ID, { notice: 'void_refused_<script>' });
    expect(unknown).not.toContain('הביטול לא בוצע.');
    expect(unknown).not.toContain('<script>');
    const inherited = await render(ID, { notice: 'void_refused_constructor' });
    expect(inherited).not.toContain('הביטול לא בוצע.');
  });

  it('a completed void is confirmed on the page, in place of the stale "created" banner', async () => {
    vi.mocked(getStaffAssignmentDetail).mockResolvedValue(
      detail({ allowedActions: { canVoid: false, blockReason: 'already_ended' } }),
    );
    const html = await render(ID, { notice: 'voided' });
    expect(html).toContain('ההטבה בוטלה.');
    expect(html).not.toContain('ההטבה הוקצתה.');
  });
});
