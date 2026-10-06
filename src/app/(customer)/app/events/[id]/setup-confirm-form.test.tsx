// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SetupConfirmForm } from './setup-confirm-form';

afterEach(cleanup);

const items = [
  { name: 'ack_datetime', label: 'אני מאשר/ת את תאריך האירוע ושעתו' },
  { name: 'ack_venue', label: 'אני מאשר/ת את המקום והכתובת' },
  { name: 'ack_lock', label: 'הבנתי שלא ניתן לשנות לאחר האישור' },
] as const;

function setup(action = vi.fn(async () => null)) {
  render(
    <SetupConfirmForm action={action} items={items} warning="אזהרת הנעילה" submitLabel="אישור פרטי האירוע והמשך" />,
  );
  return { action, user: userEvent.setup() };
}

describe('SetupConfirmForm', () => {
  it('shows every acknowledgment as an unchecked checkbox and the warning above the button', () => {
    setup();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getAllByRole('checkbox').every((c) => !(c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText('אזהרת הנעילה')).toBeTruthy();
  });

  it('keeps the button disabled until every box is ticked', async () => {
    const { user } = setup();
    const button = screen.getByRole('button', { name: 'אישור פרטי האירוע והמשך' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0]);
    await user.click(boxes[1]);
    expect(button.disabled).toBe(true);

    await user.click(boxes[2]);
    expect(button.disabled).toBe(false);

    await user.click(boxes[1]);
    expect(button.disabled).toBe(true);
  });

  it('posts each acknowledgment under its key when submitted', async () => {
    const action = vi.fn(async (_prev: unknown, _fd: FormData) => null);
    const { user } = setup(action as never);
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);

    await user.click(screen.getByRole('button', { name: 'אישור פרטי האירוע והמשך' }));

    expect(action).toHaveBeenCalledTimes(1);
    const fd = action.mock.calls[0][1] as FormData;
    expect(fd.get('ack_datetime')).toBe('on');
    expect(fd.get('ack_venue')).toBe('on');
    expect(fd.get('ack_lock')).toBe('on');
  });

  it("shows the server's error next to the button", async () => {
    const { user } = setup(vi.fn(async () => ({ error: 'יש להשלים לפני האישור: שעת האירוע' })) as never);
    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    await user.click(screen.getByRole('button', { name: 'אישור פרטי האירוע והמשך' }));

    expect((await screen.findByRole('alert')).textContent).toContain('יש להשלים לפני האישור: שעת האירוע');
  });
});
