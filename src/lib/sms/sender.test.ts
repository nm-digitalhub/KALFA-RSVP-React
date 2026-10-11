import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

import { sendSlackAlert } from '@/lib/alerts/slack';

import { SmsSendError, createExtraSmsSender } from './sender';

const TOKEN = 'EXTRA-KEY-SECRET';
const fetchMock = vi.fn<typeof fetch>();
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  vi.mocked(sendSlackAlert).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const sender = createExtraSmsSender({ token: TOKEN, sender: 'KALFA' });

// Answers shaped like the real ones captured 11.10.2026 (docs/extra/samples-2026-10-11.json).
describe('createExtraSmsSender through the generated smsSend', () => {
  it('posts the documented JSON body with the Bearer token and returns the id', async () => {
    fetchMock.mockResolvedValue(json(200, { success: true, id: '3yEIZ4jLcT5', messages_count: { sent: 1, charged: 1 } }));
    await expect(sender.send({ to: '0501234567', text: 'קוד: 1234' })).resolves.toEqual({ id: '3yEIZ4jLcT5' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.exm.co.il/api/v1/sms/send/');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers as HeadersInit);
    expect(headers.get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toEqual({ message: 'קוד: 1234', destination: '0501234567', sender: 'KALFA' });
  });

  it('a business rejection (HTTP 200, success:false) throws with every error, and is not alerted', async () => {
    fetchMock.mockResolvedValue(
      json(200, {
        success: false,
        errors: [
          { id: 'message', code: 7321, description: 'message body is missing' },
          { id: 'destination', code: 7526, description: 'Missing destination number, or invalid' },
        ],
      }),
    );
    const err = await sender.send({ to: '', text: '' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(String((err as Error).message)).toContain('7321');
    expect(String((err as Error).message)).toContain('7526');
    expect(sendSlackAlert).not.toHaveBeenCalled();
  });

  it('a bad key (HTTP 401) throws, is alerted, and never carries the token', async () => {
    fetchMock.mockResolvedValue(json(401, { success: false, errors: { id: 'HTTP_401', code: 401, description: '401 Unauthorized' } }));
    const err = await sender.send({ to: '0501234567', text: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(String((err as Error).message)).toContain('HTTP 401');
    expect(String((err as Error).message)).not.toContain(TOKEN);
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ detail: 'http_401' }));
  });

  it('a body that is not JSON is an invalid response', async () => {
    fetchMock.mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(sender.send({ to: '0501234567', text: 'x' })).rejects.toThrow('תגובה לא תקינה מספק ה-SMS');
    expect(sendSlackAlert).toHaveBeenCalledWith(expect.objectContaining({ detail: 'invalid_response' }));
  });

  it('a network failure is a transport failure, and the original error is not kept', async () => {
    fetchMock.mockRejectedValue(new Error(`connect failed, Authorization: Bearer ${TOKEN}`));
    const err = await sender.send({ to: '0501234567', text: 'x' }).catch((e: unknown) => e);
    expect(String((err as Error).message)).toBe('שליחת ההודעה נכשלה (תקשורת)');
    expect((err as Error).cause).toBeUndefined();
  });
});
