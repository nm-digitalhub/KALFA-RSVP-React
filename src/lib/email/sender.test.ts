import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `server-only` throws outside Next's server runtime — stub it (repo convention).
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));

// Mock the Resend SDK so no real request is ever made. `send` is shared across
// `new Resend(apiKey)` instances so a fresh client per call still records onto
// the same spy (same pattern as slack.test.ts's WebClient mock).
const { send, Resend } = vi.hoisted(() => {
  const s = vi.fn();
  return {
    send: s,
    Resend: vi.fn(
      class {
        emails = { send: s };
      },
    ),
  };
});
vi.mock('resend', () => ({ Resend }));

// Mock nodemailer the same way: `sendMail` is shared across
// `createTransport(...)` calls.
const { sendMail, createTransport } = vi.hoisted(() => {
  const sm = vi.fn();
  return {
    sendMail: sm,
    createTransport: vi.fn(() => ({ sendMail: sm })),
  };
});
vi.mock('nodemailer', () => ({ default: { createTransport } }));

import { createAdminClient } from '@/lib/supabase/admin';
import { createMockSupabase } from '@/test/supabase-mock';
import { getEmailSender } from './sender';

const RESEND_ROW = {
  email_enabled: true,
  smtp_from: 'KALFA <no-reply@kalfa.me>',
  smtp_host: null,
  smtp_port: null,
  smtp_secure: null,
  smtp_user: null,
  smtp_password: null,
};

const SMTP_ROW = {
  email_enabled: true,
  smtp_from: 'KALFA <no-reply@kalfa.me>',
  smtp_host: 'smtp.example.com',
  smtp_port: 587,
  smtp_secure: false,
  smtp_user: 'user',
  smtp_password: 'pass',
};

function wireAdminSettings(row: unknown): void {
  const { client } = createMockSupabase({ data: row, error: null } as never);
  vi.mocked(createAdminClient).mockReturnValue(
    client as unknown as ReturnType<typeof createAdminClient>,
  );
}

const BASE_PARAMS = {
  to: 'guest@example.com',
  subject: 'Re: RSVP',
  html: '<p>hi</p>',
};

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({ data: { id: 'email_1' }, error: null });
  sendMail.mockResolvedValue({ messageId: 'm1' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getEmailSender — resend transport threading + idempotency', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    wireAdminSettings(RESEND_ROW);
  });

  it('passes In-Reply-To/References headers when inReplyTo is set, References defaulting to [inReplyTo]', async () => {
    const sender = await getEmailSender();
    await sender.send({ ...BASE_PARAMS, inReplyTo: '<msg-1@kalfa.me>' });

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        headers: {
          'In-Reply-To': '<msg-1@kalfa.me>',
          References: '<msg-1@kalfa.me>',
        },
      }),
    );
  });

  it('joins an explicit references array with spaces', async () => {
    const sender = await getEmailSender();
    await sender.send({
      ...BASE_PARAMS,
      inReplyTo: '<msg-2@kalfa.me>',
      references: ['<msg-1@kalfa.me>', '<msg-2@kalfa.me>'],
    });

    const payload = send.mock.calls[0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        headers: {
          'In-Reply-To': '<msg-2@kalfa.me>',
          References: '<msg-1@kalfa.me> <msg-2@kalfa.me>',
        },
      }),
    );
  });

  it('omits the headers object entirely when inReplyTo is not set', async () => {
    const sender = await getEmailSender();
    await sender.send({ ...BASE_PARAMS });

    const payload = send.mock.calls[0][0];
    expect(payload).not.toHaveProperty('headers');
  });

  it('drops references silently when inReplyTo is absent (documented current behavior, not a bug)', async () => {
    const sender = await getEmailSender();
    await sender.send({ ...BASE_PARAMS, references: ['<orphan@kalfa.me>'] });

    const payload = send.mock.calls[0][0];
    expect(payload).not.toHaveProperty('headers');
  });

  it('passes idempotencyKey as the SDK call\'s second, positional argument', async () => {
    const sender = await getEmailSender();
    await sender.send({ ...BASE_PARAMS, idempotencyKey: 'klf-abc123' });

    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'klf-abc123' });
  });

  it('passes undefined as the second argument when idempotencyKey is not set', async () => {
    const sender = await getEmailSender();
    await sender.send({ ...BASE_PARAMS });

    // sender.ts passes `idempotencyKey ? {...} : undefined` explicitly — the
    // call still has arity 2, so this must be an explicit undefined check
    // rather than toHaveBeenCalledWith(payload) (which asserts arity 1).
    expect(send.mock.calls[0][1]).toBeUndefined();
  });

  it('throws EmailSendError with the safe Hebrew message, never the provider detail, when the SDK reports an error', async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'insider provider detail' },
    });
    const sender = await getEmailSender();

    // Pinning the exact safe string excludes the provider detail by
    // construction — a leak would fail this assertion outright.
    const result = sender.send({ ...BASE_PARAMS });
    await expect(result).rejects.toThrow('שליחת הדואר נכשלה');
    await expect(result).rejects.toMatchObject({ name: 'EmailSendError' });
  });

  it('logs the real provider detail server-side (console.error) so a real failure is diagnosable', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'insider provider detail' },
    });
    const sender = await getEmailSender();

    await expect(sender.send({ ...BASE_PARAMS })).rejects.toThrow();

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('validation_error'),
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('insider provider detail'),
    );
    errSpy.mockRestore();
  });
});

describe('getEmailSender — smtp transport threading + idempotency limitation', () => {
  beforeEach(() => {
    vi.stubEnv('EMAIL_PROVIDER', 'smtp');
    wireAdminSettings(SMTP_ROW);
  });

  it('passes inReplyTo/references straight into sendMail options, References defaulting to [inReplyTo]', async () => {
    const sender = await getEmailSender();
    await sender.send({ ...BASE_PARAMS, inReplyTo: '<msg-1@kalfa.me>' });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const options = sendMail.mock.calls[0][0];
    expect(options).toEqual(
      expect.objectContaining({
        inReplyTo: '<msg-1@kalfa.me>',
        references: ['<msg-1@kalfa.me>'],
      }),
    );
  });

  it('passes an explicit references array through unchanged', async () => {
    const sender = await getEmailSender();
    await sender.send({
      ...BASE_PARAMS,
      inReplyTo: '<msg-2@kalfa.me>',
      references: ['<msg-1@kalfa.me>', '<msg-2@kalfa.me>'],
    });

    const options = sendMail.mock.calls[0][0];
    expect(options).toEqual(
      expect.objectContaining({
        inReplyTo: '<msg-2@kalfa.me>',
        references: ['<msg-1@kalfa.me>', '<msg-2@kalfa.me>'],
      }),
    );
  });

  it('omits inReplyTo/references entirely when inReplyTo is not set', async () => {
    const sender = await getEmailSender();
    await sender.send({ ...BASE_PARAMS });

    const options = sendMail.mock.calls[0][0];
    expect(options).not.toHaveProperty('inReplyTo');
    expect(options).not.toHaveProperty('references');
  });

  it('never forwards idempotencyKey to sendMail — nodemailer/SMTP has no protocol-level equivalent (documented limitation)', async () => {
    const sender = await getEmailSender();
    await sender.send({ ...BASE_PARAMS, idempotencyKey: 'klf-abc123' });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const options = sendMail.mock.calls[0][0];
    expect(options).not.toHaveProperty('idempotencyKey');
    expect(Object.keys(options)).not.toContain('idempotencyKey');
  });

  it('throws EmailSendError with the safe Hebrew message, never the provider detail, when sendMail rejects', async () => {
    sendMail.mockRejectedValue(new Error('550 5.7.708 provider-specific detail'));
    const sender = await getEmailSender();

    // Pinning the exact safe string excludes the provider detail by
    // construction — a leak would fail this assertion outright.
    const result = sender.send({ ...BASE_PARAMS });
    await expect(result).rejects.toThrow('שליחת הדואר נכשלה');
    await expect(result).rejects.toMatchObject({ name: 'EmailSendError' });
  });

  it('logs the real provider detail server-side (console.error) so a real failure is diagnosable', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    sendMail.mockRejectedValue(new Error('550 5.7.708 provider-specific detail'));
    const sender = await getEmailSender();

    await expect(sender.send({ ...BASE_PARAMS })).rejects.toThrow();

    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('550 5.7.708 provider-specific detail'),
    );
    errSpy.mockRestore();
  });
});
