import { describe, expect, it } from 'vitest';

import { microsoftGraphRequest } from './microsoft-graph';

const minimal = { to: 'guest@example.com', subject: 'אישור הגעה', body: 'שלום' };

function bodyOf(input: unknown) {
  return JSON.parse(String(microsoftGraphRequest('mail.send', input).init?.body));
}

describe('Microsoft Graph transport', () => {
  it('builds the delegated /me/sendMail request and never injects auth itself', () => {
    const request = microsoftGraphRequest('mail.send', minimal);

    expect(request.url.href).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(request.init?.method).toBe('POST');
    expect(new Headers(request.init?.headers).has('authorization')).toBe(false);
  });

  it('⚠️ sends exactly what it always did when only the four original fields are set', () => {
    // The backward-compatibility test. Every diagram saved before cc/bcc/replyTo/
    // contentType/importance/saveToSentItems existed carries none of them, so
    // this payload is what those nodes must keep producing — the three defaults
    // below are Graph's own, which is why adding them changes no mail.
    expect(bodyOf(minimal)).toEqual({
      message: {
        subject: 'אישור הגעה',
        importance: 'normal',
        body: { contentType: 'Text', content: 'שלום' },
        toRecipients: [{ emailAddress: { address: 'guest@example.com' } }],
      },
      saveToSentItems: true,
    });
  });

  it('carries every optional field when the node sets them', () => {
    expect(
      bodyOf({
        to: 'guest@example.com',
        cc: 'manager@example.com, second@example.com',
        bcc: 'audit@example.com',
        replyTo: 'support@example.com',
        subject: 'אישור הגעה',
        body: '<strong>שלום</strong>',
        contentType: 'HTML',
        importance: 'high',
        saveToSentItems: false,
      }),
    ).toEqual({
      message: {
        subject: 'אישור הגעה',
        importance: 'high',
        body: { contentType: 'HTML', content: '<strong>שלום</strong>' },
        toRecipients: [{ emailAddress: { address: 'guest@example.com' } }],
        ccRecipients: [
          { emailAddress: { address: 'manager@example.com' } },
          { emailAddress: { address: 'second@example.com' } },
        ],
        bccRecipients: [{ emailAddress: { address: 'audit@example.com' } }],
        replyTo: [{ emailAddress: { address: 'support@example.com' } }],
      },
      saveToSentItems: false,
    });
  });

  it('splits an address list on either separator, and drops duplicates', () => {
    // Graph delivers twice to a repeated address; nobody asks for that.
    expect(bodyOf({ ...minimal, cc: 'a@x.com;b@y.com, a@x.com ;; ' }).message.ccRecipients).toEqual([
      { emailAddress: { address: 'a@x.com' } },
      { emailAddress: { address: 'b@y.com' } },
    ]);
  });

  it('omits an empty optional list rather than sending an empty array', () => {
    const message = bodyOf({ ...minimal, cc: '', bcc: '   ', replyTo: undefined }).message;

    expect(Object.hasOwn(message, 'ccRecipients')).toBe(false);
    expect(Object.hasOwn(message, 'bccRecipients')).toBe(false);
    expect(Object.hasOwn(message, 'replyTo')).toBe(false);
  });

  it('⚠️ refuses a malformed recipient before the network, permanently', () => {
    // A typo is not something a retry fixes, so the classification matters as
    // much as the refusal: a transient error would re-queue the step forever.
    for (const to of ['not-an-email', '@example.com', 'a@', 'a@b@c.com', 'a b@example.com']) {
      expect(() => microsoftGraphRequest('mail.send', { ...minimal, to })).toThrowError(
        expect.objectContaining({
          code: 'integration_input_invalid',
          classification: 'permanent',
        }),
      );
    }
  });

  it('refuses a malformed address in a carbon copy too', () => {
    expect(() =>
      microsoftGraphRequest('mail.send', { ...minimal, cc: 'ok@example.com;nope' }),
    ).toThrowError(expect.objectContaining({ code: 'integration_input_invalid' }));
  });

  it('refuses a capability it does not implement', () => {
    expect(() =>
      microsoftGraphRequest('calendar.write' as never, minimal),
    ).toThrowError(
      expect.objectContaining({ code: 'integration_capability_unsupported' }),
    );
  });
});
