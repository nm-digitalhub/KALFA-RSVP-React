// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { removeTemplateRouteAction, setStepActiveAction } from './actions';
import { RouteControl, StepActiveSwitch, TemplateVariables } from './template-admin-client';

// Server actions need a request, a session and the database; the components
// themselves render for real.
vi.mock('./actions', () => ({
  acknowledgeWhatsAppCategoryAction: vi.fn(),
  removeTemplateRouteAction: vi.fn(),
  requestTemplateSyncAction: vi.fn(),
  saveTemplateParametersAction: vi.fn(),
  setStepActiveAction: vi.fn(),
  setTemplateRouteAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StepActiveSwitch', () => {
  it('shows why the server refused to switch a step on', async () => {
    vi.mocked(setStepActiveAction).mockResolvedValue({ ok: false, problems: ['התבנית מושהית — השלב לא נשלח'] });
    render(<StepActiveSwitch messageKey="invite" active={false} label="הזמנה" />);

    fireEvent.click(screen.getByRole('switch', { name: 'הזמנה — כבוי' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('התבנית מושהית — השלב לא נשלח'));
    expect(setStepActiveAction).toHaveBeenCalledWith({ messageKey: 'invite', active: true });
  });
});

describe('RouteControl', () => {
  const base = { messageKey: 'invite', withMedia: false, options: [], audienceLabel: 'חתונה' };

  it('an audience on its own route can go back to the default', async () => {
    vi.mocked(removeTemplateRouteAction).mockResolvedValue({ ok: true });
    render(<RouteControl {...base} eventType="wedding" currentTemplateId="1" hasOwnRoute />);

    fireEvent.click(screen.getByRole('button', { name: 'חזרה לברירת המחדל של השלב' }));

    await waitFor(() =>
      expect(removeTemplateRouteAction).toHaveBeenCalledWith({ messageKey: 'invite', eventType: 'wedding', withMedia: false }),
    );
  });

  it('the default text route itself cannot be dropped', () => {
    render(<RouteControl {...base} eventType={null} currentTemplateId="1" hasOwnRoute />);
    expect(screen.queryByRole('button', { name: 'חזרה לברירת המחדל של השלב' })).toBeNull();
  });

  it('an audience on the default is offered its own template', () => {
    render(<RouteControl {...base} eventType="wedding" currentTemplateId={null} hasOwnRoute={false} />);
    expect(screen.getByRole('combobox', { name: 'תבנית עבור חתונה' }).textContent).toContain('בחירת תבנית לחתונה');
  });
});

describe('TemplateVariables', () => {
  it('an unmapped variable says so in Hebrew (JSON Forms own message is English), and saving waits for a change', () => {
    render(
      <TemplateVariables
        templateId="1"
        parameters={[{ type: 'body', sub_type: null, index: null, position: 1, source_path: null }]}
        valuePaths={['guest.first_name']}
      />,
    );
    const alerts = screen.getAllByRole('alert').map((a) => a.textContent);
    expect(alerts).toContain('צריך לבחור ערך');
    expect(alerts.join(' ')).not.toMatch(/required property/);
    expect(screen.getByRole('button', { name: 'שמירת המשתנים' }).hasAttribute('disabled')).toBe(true);
  });
});
