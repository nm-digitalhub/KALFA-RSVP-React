// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { WhatsAppTemplateAdmin } from '@/lib/data/admin/whatsapp-templates';

import { removeTemplateRouteAction, requestTemplateSyncAction } from './actions';
import { WhatsAppTemplatesSection } from './whatsapp-templates-section';

// Server actions are the one thing that cannot run here (they need a request,
// a session and the database); the screen itself renders for real.
vi.mock('./actions', () => ({
  setTemplateRouteAction: vi.fn(),
  removeTemplateRouteAction: vi.fn(),
  saveTemplateParametersAction: vi.fn(),
  requestTemplateSyncAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DATA: WhatsAppTemplateAdmin = {
  lastSyncedAt: null,
  steps: [
    {
      messageKey: 'invite',
      label: 'הזמנה',
      active: true,
      valuePaths: ['guest.greeting_name', 'event.venue', 'event.invite_image'],
      routes: [{ eventType: null, withMedia: false, templateId: '111' }],
    },
  ],
  templates: [
    {
      id: '111',
      name: 'invite_v2',
      language: 'he',
      status: 'APPROVED',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'שלום {{1}}, נשמח לראותך ב{{2}}' }],
      requestedCategory: 'UTILITY',
      rsvpQuickReplies: true,
      parameters: [
        { type: 'body', sub_type: null, index: null, position: 1, source_path: 'guest.greeting_name' },
        { type: 'body', sub_type: null, index: null, position: 2, source_path: null },
      ],
      unsupported: ['כפתור מסוג OTP'],
    },
  ],
};

describe('WhatsAppTemplatesSection', () => {
  it('shows each step with its route, the template text and one field per variable', () => {
    render(<WhatsAppTemplatesSection data={DATA} />);

    expect(screen.getByRole('heading', { name: 'הזמנה' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'תבנית עבור ברירת מחדל' })).toBeTruthy();
    expect(screen.getByText('שלום {{1}}, נשמח לראותך ב{{2}}')).toBeTruthy();
    expect(screen.getByText('{{1}}')).toBeTruthy();
    expect(screen.getByText('{{2}}')).toBeTruthy();
    // The mapped variable shows its value's Hebrew name as a chip.
    expect(screen.getByText('פנייה לאורח')).toBeTruthy();
    // What the sender cannot fill is reported, not hidden.
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toContain('התבנית כוללת כפתור מסוג OTP, שהמערכת עדיין לא יודעת למלא');
    // An unmapped variable says so in Hebrew (JSON Forms' own message is AJV's English).
    expect(alerts).toContain('צריך לבחור ערך');
    expect(alerts.join(' ')).not.toMatch(/required property/);
    // The default text route cannot be removed.
    expect(screen.queryByRole('button', { name: 'הסרה' })).toBeNull();
  });

  it('offers saving only after a change', () => {
    render(<WhatsAppTemplatesSection data={DATA} />);
    expect(screen.getByRole('button', { name: 'שמירת המשתנים' }).hasAttribute('disabled')).toBe(true);
  });

  it('requests a sync and says it runs in the background', async () => {
    vi.mocked(requestTemplateSyncAction).mockResolvedValue({ ok: true });
    render(<WhatsAppTemplatesSection data={DATA} />);

    fireEvent.click(screen.getByRole('button', { name: 'סנכרון מול Meta עכשיו' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('הסנכרון רץ ברקע'));
    expect(requestTemplateSyncAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText('עוד לא סונכרן')).toBeTruthy();
  });

  it('removes an extra route and shows the server problems when refused', async () => {
    vi.mocked(removeTemplateRouteAction).mockResolvedValue({ ok: false, problems: ['המסלול כבר הוסר'] });
    const withExtra: WhatsAppTemplateAdmin = {
      ...DATA,
      steps: [
        {
          ...DATA.steps[0]!,
          routes: [...DATA.steps[0]!.routes, { eventType: 'wedding', withMedia: false, templateId: '111' }],
        },
      ],
    };
    render(<WhatsAppTemplatesSection data={withExtra} />);

    fireEvent.click(screen.getByRole('button', { name: 'הסרה' }));

    await waitFor(() => expect(screen.getByText('המסלול כבר הוסר')).toBeTruthy());
    expect(removeTemplateRouteAction).toHaveBeenCalledWith({
      messageKey: 'invite',
      eventType: 'wedding',
      withMedia: false,
    });
  });
});
