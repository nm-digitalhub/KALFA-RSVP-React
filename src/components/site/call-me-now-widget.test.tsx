import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next-i18next/client', () => ({
  useT: () => ({
    t: (_key: string, defaultValue: string) => defaultValue,
    i18n: { language: 'en' },
  }),
}));

import { CallMeNowWidget } from './call-me-now-widget';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const answer = (body: unknown) => fetchMock.mockResolvedValue({ json: async () => body });

async function requestCode() {
  await userEvent.click(screen.getByRole('button', { name: 'התקשרו אליי עכשיו' }));
  await userEvent.click(screen.getByRole('button', { name: 'הבנתי, המשך' }));
  await userEvent.type(screen.getByLabelText('מספר טלפון'), '0501234567');
  await userEvent.click(screen.getByRole('button', { name: 'שליחת קוד אימות' }));
}

describe('CallMeNowWidget: requesting a code', () => {
  it.each([
    ['rate_limited', 'יותר מדי בקשות. נסו שוב בעוד כמה דקות.'],
    ['too_many_codes', 'נשלחו יותר מדי קודים. נסו שוב מאוחר יותר.'],
    ['body_too_large', 'בקשה גדולה מדי'],
    ['bad_body', 'גוף הבקשה אינו תקין'],
    ['invalid_phone', 'מספר טלפון לא תקין'],
    ['otp_create_failed', 'יצירת קוד האימות נכשלה'],
    ['send_failed', 'שליחת קוד האימות נכשלה'],
  ])('shows %s in the wording the server used to send', async (reason, wording) => {
    answer({ ok: false, reason });
    render(<CallMeNowWidget />);

    await requestCode();

    expect((await screen.findByRole('alert')).textContent).toBe(wording);
  });

  it('falls back to the generic wording for a reason it does not know', async () => {
    answer({ ok: false, reason: 'something_new' });
    render(<CallMeNowWidget />);

    await requestCode();

    expect((await screen.findByRole('alert')).textContent).toBe('שליחת קוד האימות נכשלה.');
  });

  it('sends the page language with the phone', async () => {
    answer({ ok: true });
    render(<CallMeNowWidget />);

    await requestCode();

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe('/api/call-me-now/request-code');
    expect(JSON.parse(init.body)).toEqual({ phone: '0501234567', language: 'en' });
  });
});
