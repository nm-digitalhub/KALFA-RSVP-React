import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { permMock, listMock, countMock, moneyMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  listMock: vi.fn(),
  countMock: vi.fn(),
  moneyMock: vi.fn(),
}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
// The sort menu is a client component with its own test; here it reports the links it was handed.
vi.mock('./sort-menu', () => ({
  SortMenu: ({ sort, hrefs }: { sort: string; hrefs: Record<string, string> }) => (
    <div data-marker="sort" data-sort={sort} data-oldest={hrefs.oldest} data-newest={hrefs.newest} />
  ),
}));
vi.mock('@/lib/data/admin/cancellation-money', () => ({ cancellationMoneyForAdmin: moneyMock }));
vi.mock('@/lib/data/event-cancellation', () => ({
  listCancellationRequestsForAdmin: listMock,
  countCancellationRequestsForAdmin: countMock,
}));

import AdminCancellationsPage from './page';

// The list of cancellation requests. What is defended: the status filter is read from the URL and applied by the
// database (the page passes it on, it never filters in memory); the counts come from the database; and every request
// has an explicit way in — "טיפול בבקשה" while it waits, "צפייה" once it was handled — in the table AND in the
// phone-width cards.

const row = (over: Record<string, unknown> = {}) => ({
  id: '40c6ff9d-bef6-4882-a1c8-5d670d0f3311',
  requestCode: 'HS64-1HRR',
  eventId: 'e1',
  eventName: 'טסט',
  eventStatus: 'active',
  reason: 'שינוי תוכניות',
  status: 'pending',
  createdAt: '2026-10-09T11:24:02.000Z',
  ...over,
});

async function render(status?: string, q?: string) {
  return renderToStaticMarkup(
    await AdminCancellationsPage({ searchParams: Promise.resolve({ ...(status ? { status } : {}), ...(q !== undefined ? { q } : {}) }) }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'staff' });
  countMock.mockResolvedValue({ pending: 1, resolved: 3 });
  moneyMock.mockResolvedValue(new Map());
});

describe('/admin/cancellations', () => {
  it('asks for the billing permission', async () => {
    listMock.mockResolvedValue([]);
    await render();
    expect(permMock).toHaveBeenCalledWith('manage_billing');
  });

  it('gives a pending request a "טיפול בבקשה" link that opens it, in the table and in the card', async () => {
    listMock.mockResolvedValue([row()]);
    const html = await render();
    const opens = html.match(/href="\/admin\/cancellations\/40c6ff9d-bef6-4882-a1c8-5d670d0f3311" aria-label="טיפול בבקשה CX-HS64-1HRR"/g) ?? [];
    expect(opens).toHaveLength(2);
    expect(html).toContain('>ממתינה<');
  });

  it('gives a handled request a "צפייה" link instead', async () => {
    listMock.mockResolvedValue([row({ status: 'resolved' })]);
    const html = await render();
    expect(html).toContain('aria-label="צפייה בבקשה CX-HS64-1HRR"');
    expect(html).not.toContain('aria-label="טיפול בבקשה');
    expect(html).toContain('>טופלה<');
  });

  it('shows the event status the way the admin names it, never the raw value', async () => {
    listMock.mockResolvedValue([row()]);
    const html = await render();
    expect(html).toContain('פרטי האירוע אושרו');
    expect(html).not.toMatch(/>active</);
  });

  // The page opens on "הכל" (owner 9.10.2026).
  it.each([
    [undefined, undefined],
    ['all', undefined],
    ['pending', 'pending'],
    ['resolved', 'resolved'],
    ['anything-else', undefined],
  ])('?status=%s asks the database for %s', async (param, asked) => {
    listMock.mockResolvedValue([]);
    await render(param);
    expect(listMock).toHaveBeenCalledWith(asked, null, 'oldest');
  });

  it('tabs read הכל · טופלו · ממתינות, mark the current one, and show the counts the database gave', async () => {
    listMock.mockResolvedValue([row()]);
    const html = await render();
    expect(html).toMatch(/href="\/admin\/cancellations" aria-current="page"[^>]*>.*?הכל<span[^>]*>4<\/span>/);
    expect(html).toMatch(/href="\/admin\/cancellations\?status=resolved"[^>]*>.*?טופלו<span[^>]*>3<\/span>/);
    expect(html).toMatch(/href="\/admin\/cancellations\?status=pending"[^>]*>.*?ממתינות<span[^>]*>1<\/span>/);
    const order = ['>הכל<', '>טופלו<', '>ממתינות<'].map((t) => html.indexOf(t.replace('>', '</svg>')));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('searches in the database, keeps the search on the tabs, and keeps the tab on the search', async () => {
    listMock.mockResolvedValue([]);
    const html = await render('resolved', 'cx-yefz');
    expect(listMock).toHaveBeenCalledWith('resolved', { likeCode: 'YEFZ', likeText: 'cx-yefz' }, 'oldest');
    expect(html).toContain('href="/admin/cancellations?q=cx-yefz"');
    expect(html).toContain('href="/admin/cancellations?status=pending&amp;q=cx-yefz"');
    expect(html).toContain('<input type="hidden" name="status" value="resolved"/>');
    expect(html).toContain('value="cx-yefz"');
  });

  it('sorts by submission time in the database; the header flips the order and keeps the filter and the search', async () => {
    listMock.mockResolvedValue([row()]);
    let html = await render('pending', 'חתונה');
    expect(listMock).toHaveBeenLastCalledWith('pending', expect.anything(), 'oldest');
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('href="/admin/cancellations?status=pending&amp;q=%D7%97%D7%AA%D7%95%D7%A0%D7%94&amp;sort=newest"');
    // The sort button gets a link per order, each keeping the filter and the search.
    expect(html).toContain('data-sort="oldest"');
    expect(html).toContain('data-newest="/admin/cancellations?status=pending&amp;q=%D7%97%D7%AA%D7%95%D7%A0%D7%94&amp;sort=newest"');
    html = renderToStaticMarkup(await AdminCancellationsPage({ searchParams: Promise.resolve({ sort: 'newest' }) }));
    expect(listMock).toHaveBeenLastCalledWith(undefined, null, 'newest');
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('data-oldest="/admin/cancellations"');
  });

  it('shows the money of each request, and says so when it could not be read', async () => {
    listMock.mockResolvedValue([row()]);
    moneyMock.mockResolvedValue(new Map([[row().id, 'refund_failed']]));
    expect(await render()).toContain('ניסיון החזר נכשל');
    moneyMock.mockResolvedValue(null);
    expect(await render()).toContain('לא ניתן לטעון');
  });

  it('an empty list says so', async () => {
    listMock.mockResolvedValue([]);
    expect(await render('resolved')).toContain('אין בקשות שמתאימות לסינון.');
  });
});
