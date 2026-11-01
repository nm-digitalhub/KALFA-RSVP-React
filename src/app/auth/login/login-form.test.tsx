// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { login, resendConfirmationEmail, results } = vi.hoisted(() => ({
  login: vi.fn(),
  resendConfirmationEmail: vi.fn(),
  results: new Map<unknown, Record<string, unknown>>(),
}));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useActionState: (action: unknown) => [results.get(action) ?? {}, vi.fn(), false],
}));
vi.mock('../actions', () => ({ login, resendConfirmationEmail }));

import { LoginForm } from './login-form';

afterEach(() => {
  cleanup();
  results.clear();
});

const UNCONFIRMED = 'החשבון עדיין לא אומת. שלחנו לכם מייל אישור בעת ההרשמה — בדקו את תיבת הדואר, וגם את תיקיית הספאם.';

describe('LoginForm — what a result shows', () => {
  it('an invalid address shows its message once, under the field — not again at the top', () => {
    results.set(login, { validationErrors: { formErrors: [], fieldErrors: { email: ['כתובת אימייל לא תקינה'] } } });
    const { container } = render(<LoginForm />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.textContent?.split('כתובת אימייל לא תקינה').length).toBe(2);
  });

  it('an unconfirmed account shows its line and offers the resend for that address', () => {
    results.set(login, { data: { error: UNCONFIRMED, unconfirmedEmail: 'dana@example.com' } });
    const { container } = render(<LoginForm />);
    expect(screen.getByRole('alert').textContent).toBe(UNCONFIRMED);
    expect(container.querySelector<HTMLInputElement>('input[type="hidden"][name="email"]')?.value).toBe('dana@example.com');
  });

  it('a failed resend shows its message in the resend form', () => {
    results.set(login, { data: { error: UNCONFIRMED, unconfirmedEmail: 'dana@example.com' } });
    results.set(resendConfirmationEmail, { serverError: 'הפעולה נכשלה. נסו שוב.' });
    render(<LoginForm />);
    expect(screen.getAllByRole('alert').map((el) => el.textContent)).toEqual([UNCONFIRMED, 'הפעולה נכשלה. נסו שוב.']);
  });
});
