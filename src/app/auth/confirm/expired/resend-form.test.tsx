// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { state } = vi.hoisted(() => ({ state: { current: {} as Record<string, unknown> } }));
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useActionState: () => [state.current, vi.fn(), false],
}));
vi.mock('../../actions', () => ({ resendConfirmationEmail: vi.fn() }));

import { ResendConfirmationForm } from './resend-form';

afterEach(cleanup);

describe('ResendConfirmationForm — what a result shows', () => {
  it('a failed send shows its message above the button', () => {
    state.current = { serverError: 'הפעולה נכשלה. נסו שוב.' };
    render(<ResendConfirmationForm />);
    expect(screen.getByRole('alert').textContent).toBe('הפעולה נכשלה. נסו שוב.');
  });

  it('an invalid address shows its message once, under the field', () => {
    state.current = { validationErrors: { formErrors: [], fieldErrors: { email: ['כתובת אימייל לא תקינה'] } } };
    const { container } = render(<ResendConfirmationForm />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.textContent?.split('כתובת אימייל לא תקינה').length).toBe(2);
  });
});
