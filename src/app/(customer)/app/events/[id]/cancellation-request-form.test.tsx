// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CancellationRequestForm } from './cancellation-request-form';

// The customer's cancellation request. What is defended here: one request at a time — while a request is on its way the
// submit button is locked, so a second click cannot send a second request (9.10.2026: two arrived 2.5 seconds apart), and
// once a request is open the form is replaced by its status.

afterEach(cleanup);

const submitButton = () => screen.getByRole('button', { name: /שליחת בקשת ביטול|רגע/ }) as HTMLButtonElement;

describe('CancellationRequestForm', () => {
  it('locks the submit button while the request is on its way', async () => {
    let finish: (value: null) => void = () => {};
    const action = vi.fn(() => new Promise<null>((resolve) => { finish = resolve; }));
    render(<CancellationRequestForm existingRequest={null} action={action} />);
    fireEvent.change(screen.getByLabelText('סיבת הביטול'), { target: { value: 'שינוי תוכניות' } });

    expect(submitButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(submitButton());
    });
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(submitButton());
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => finish(null));
    expect(submitButton().disabled).toBe(false);
  });

  it('shows the open request instead of the form, with no way to send another', () => {
    render(
      <CancellationRequestForm
        existingRequest={{ id: 'r1', requestCode: '7K4Q-92XM', status: 'pending', resolution: null, resolutionNote: null }}
        action={vi.fn()}
      />,
    );
    // The reference sits in its own <bdi> (a Latin code inside Hebrew text), so the line is matched as a whole paragraph.
    const line = screen.getByText((_, el) => el?.tagName === 'P' && (el.textContent ?? '').includes('בקשת ביטול CX-7K4Q-92XM'));
    expect(line.textContent).toContain('ממתינה לטיפול');
    expect(screen.queryByRole('button')).toBeNull();
  });
});
