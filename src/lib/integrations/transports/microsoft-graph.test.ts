import { describe, expect, it } from 'vitest';

import { microsoftGraphRequest } from './microsoft-graph';

describe('Microsoft Graph transport', () => {
  it('builds the delegated /me/sendMail request and never injects auth itself', () => {
    const request = microsoftGraphRequest('mail.send', {
      to: 'guest@example.com',
      subject: 'אישור הגעה',
      body: 'שלום',
    });

    expect(request.url.href).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(request.init?.method).toBe('POST');
    expect(new Headers(request.init?.headers).has('authorization')).toBe(false);
    expect(JSON.parse(String(request.init?.body))).toEqual({
      message: {
        subject: 'אישור הגעה',
        body: { contentType: 'Text', content: 'שלום' },
        toRecipients: [{ emailAddress: { address: 'guest@example.com' } }],
      },
    });
  });
});
