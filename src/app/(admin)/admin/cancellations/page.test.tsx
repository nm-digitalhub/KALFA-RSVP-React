import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const { permMock, listMock } = vi.hoisted(() => ({ permMock: vi.fn(), listMock: vi.fn() }));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/event-cancellation', () => ({ listCancellationRequestsForAdmin: listMock }));

import AdminCancellationsPage from './page';

// Every request row has an explicit way in: "טיפול בבקשה" while it waits, "צפייה" once it was handled — a link styled as a
// button (Base UI's Button is not used for links).

const row = (over: Record<string, unknown> = {}) => ({
  id: '40c6ff9d-bef6-4882-a1c8-5d670d0f3311',
  requestNumber: 12,
  eventId: 'e1',
  eventName: 'טסט',
  eventStatus: 'active',
  reason: 'שינוי תוכניות',
  status: 'pending',
  createdAt: '2026-10-09T11:24:02.000Z',
  ...over,
});

async function render() {
  return renderToStaticMarkup(await AdminCancellationsPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  permMock.mockResolvedValue({ id: 'staff' });
});

describe('/admin/cancellations', () => {
  it('asks for the billing permission', async () => {
    listMock.mockResolvedValue([]);
    await render();
    expect(permMock).toHaveBeenCalledWith('manage_billing');
  });

  it('gives a pending request a "טיפול בבקשה" button that opens it', async () => {
    listMock.mockResolvedValue([row()]);
    const html = await render();
    expect(html).toContain('href="/admin/cancellations/40c6ff9d-bef6-4882-a1c8-5d670d0f3311" aria-label="טיפול בבקשה #12"');
    expect(html).toMatch(/>טיפול בבקשה<\/a>/);
  });

  it('gives a handled request a "צפייה" button instead', async () => {
    listMock.mockResolvedValue([row({ status: 'resolved' })]);
    const html = await render();
    expect(html).toContain('aria-label="צפייה בבקשה #12"');
    expect(html).toMatch(/>צפייה<\/a>/);
    expect(html).not.toContain('טיפול בבקשה');
  });
});
