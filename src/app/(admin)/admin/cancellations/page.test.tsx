import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { permMock, listMock, countMock } = vi.hoisted(() => ({ permMock: vi.fn(), listMock: vi.fn(), countMock: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
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

async function render(status?: string) {
  return renderToStaticMarkup(await AdminCancellationsPage({ searchParams: Promise.resolve(status ? { status } : {}) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'staff' });
  countMock.mockResolvedValue({ pending: 1, resolved: 3 });
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

  it.each([
    [undefined, undefined],
    ['pending', 'pending'],
    ['resolved', 'resolved'],
    ['anything-else', undefined],
  ])('?status=%s asks the database for %s', async (param, asked) => {
    listMock.mockResolvedValue([]);
    await render(param);
    expect(listMock).toHaveBeenCalledWith(asked);
  });

  it('marks the current filter, and shows the counts the database gave', async () => {
    listMock.mockResolvedValue([row()]);
    const html = await render('pending');
    expect(html).toMatch(/href="\/admin\/cancellations\?status=pending" aria-current="page"[^>]*>ממתינות \(1\)/);
    expect(html).toMatch(/<b[^>]*>1<\/b> ממתינות/);
    expect(html).toMatch(/<b[^>]*>3<\/b> טופלו/);
  });

  it('an empty filter says so', async () => {
    listMock.mockResolvedValue([]);
    expect(await render('resolved')).toContain('אין בקשות בסטטוס הזה.');
    expect(await render()).toContain('אין בקשות ביטול.');
  });
});
