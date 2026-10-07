// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  rescheduleCallbackAction: vi.fn(async () => ({ notice: 'השיחה תוזמנה מחדש' })),
}));

import { rescheduleCallbackAction } from './actions';
import { RescheduleForm } from './reschedule-form';

const ID = '3b0ab9ec-c77b-4c75-b6e4-2c431c1d8cd0';
const LABEL = 'מועד חדש לשיחה';
const SUBMIT = 'תזמנו שיחה למועד הזה';

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date is faked, so userEvent's own timers keep running. 06:33 in Israel.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-07T03:33:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// After a successful form action React resets an UNCONTROLLED field to its default
// (react.dev, `<form>`). The default here is "now + 1 hour", so saving 07:53 at
// 07:54 left the field showing 08:54 — as if a different time had been scheduled
// (reported 2026-10-07). The field is controlled so it keeps what the admin chose.
describe('RescheduleForm', () => {
  it('starts one hour from now', () => {
    render(<RescheduleForm id={ID} />);
    expect((screen.getByLabelText(LABEL) as HTMLInputElement).value).toBe('2026-10-07T07:33');
  });

  it('keeps the time the admin chose after a successful save', async () => {
    const user = userEvent.setup();
    render(<RescheduleForm id={ID} />);
    const field = screen.getByLabelText(LABEL) as HTMLInputElement;

    await user.clear(field);
    await user.type(field, '2026-10-07T07:53');
    await user.click(screen.getByRole('button', { name: SUBMIT }));
    await screen.findByText('השיחה תוזמנה מחדש');

    expect(field.value).toBe('2026-10-07T07:53');
  });

  it('posts what is in the field', async () => {
    const user = userEvent.setup();
    render(<RescheduleForm id={ID} />);
    const field = screen.getByLabelText(LABEL) as HTMLInputElement;

    await user.clear(field);
    await user.type(field, '2026-10-07T07:53');
    await user.click(screen.getByRole('button', { name: SUBMIT }));
    await screen.findByText('השיחה תוזמנה מחדש');

    const posted = vi.mocked(rescheduleCallbackAction).mock.calls[0][1] as FormData;
    expect(posted.get('id')).toBe(ID);
    expect(posted.get('exactAt')).toBe('2026-10-07T07:53');
  });
});
