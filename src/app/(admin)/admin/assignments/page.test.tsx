import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/coupon-assignments', () => ({ listStaffAssignments: vi.fn() }));
vi.mock('@/lib/data/admin/offers', () => ({ listOffers: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { listStaffAssignments } from '@/lib/data/admin/coupon-assignments';
import { listOffers } from '@/lib/data/admin/offers';
import AdminAssignmentsPage from './page';

// The list screen's states (admin-panel ב.1, spec §6): honest empty / filtered-empty /
// error-with-retry, the exception banner rules (no green banner, failed check is NOT a
// clean bill), and the URL params round-tripping into the pager's links.

type ListResult = Awaited<ReturnType<typeof listStaffAssignments>>;

function listResult(overrides: Partial<ListResult> = {}): ListResult {
  return {
    rows: [],
    total: 0,
    page: 1,
    pageSize: 25,
    globalGuardCount: 0,
    guardCheckStatus: 'ok',
    ...overrides,
  } as ListResult;
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'a-1',
    createdAt: '2026-10-12T10:00:00.000Z',
    expiresAt: '2026-10-26T10:00:00.000Z',
    display: { key: 'waiting' as const, label: 'ממתינה לשימוש' },
    offerTitle: 'לקוחות מצטרפים',
    target: { name: 'נועם לקוח', email: null, phoneMasked: null, claimed: true },
    sourceKind: 'staff' as const,
    ...overrides,
  };
}

async function render(searchParams: Record<string, string> = {}): Promise<string> {
  const tree = await AdminAssignmentsPage({ searchParams: Promise.resolve(searchParams) });
  return renderToStaticMarkup(tree);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'staff-1' } as unknown as User);
  vi.mocked(listOffers).mockResolvedValue([]);
});

describe('/admin/assignments (list states)', () => {
  it('empty with no filters → the onboarding empty state, and NO green banner for a clean guard', async () => {
    vi.mocked(listStaffAssignments).mockResolvedValue(listResult());
    const html = await render();
    expect(html).toContain('עדיין לא הוקצו הטבות אישיות');
    expect(html).not.toContain('אין תשלום שהצליח');
  });

  it('empty WITH filters → "לא נמצאו" with ניקוי מסננים, not the onboarding text', async () => {
    vi.mocked(listStaffAssignments).mockResolvedValue(listResult());
    const html = await render({ status: 'consumed' });
    expect(html).toContain('לא נמצאו הטבות התואמות לחיפוש');
    expect(html).not.toContain('עדיין לא הוקצו');
  });

  it('a fetch failure renders an ERROR with retry — never an empty list', async () => {
    vi.mocked(listStaffAssignments).mockRejectedValue(new Error('boom'));
    const html = await render();
    expect(html).toContain('טעינת ההטבות נכשלה');
    expect(html).toContain('ניסיון חוזר');
    expect(html).not.toContain('עדיין לא הוקצו');
  });

  it('exceptions found → the red count with a link to the guard filter', async () => {
    vi.mocked(listStaffAssignments).mockResolvedValue(
      listResult({ rows: [row()], total: 1, globalGuardCount: 2 }),
    );
    const html = await render();
    expect(html).toContain('נמצאו 2 הטבות הדורשות בדיקת מימוש');
    expect(html).toContain('/admin/assignments?status=guard');
  });

  it('a FAILED guard check says the check is unavailable — not a clean bill', async () => {
    vi.mocked(listStaffAssignments).mockResolvedValue(
      listResult({ rows: [row()], total: 1, globalGuardCount: null, guardCheckStatus: 'failed' }),
    );
    const html = await render();
    expect(html).toContain('בדיקת חריגות המימוש אינה זמינה');
  });

  it('rows render the concise content and the details link; filters round-trip into the pager', async () => {
    vi.mocked(listStaffAssignments).mockResolvedValue(
      listResult({
        rows: [row(), row({ id: 'a-2', target: { name: null, email: null, phoneMasked: '+9725…567', claimed: false } })],
        total: 60,
        page: 2,
      }),
    );
    const html = await render({ page: '2', status: 'waiting', sort: 'expiry', q: 'x@y.il' });

    expect(html).toContain('נועם לקוח');
    expect(html).toContain('טרם שויכה לחשבון');
    expect(html).toContain('/admin/assignments/a-1');
    // The pager keeps the filters (validated params only — never a free return URL).
    expect(html).toMatch(/page=3[^"]*/);
    expect(html).toContain('status=waiting');
    expect(html).toContain('sort=expiry');
    // The list never offers a void button (spec §6) — that belongs to the detail page.
    expect(html).not.toContain('ביטול ההטבה');
  });
});
