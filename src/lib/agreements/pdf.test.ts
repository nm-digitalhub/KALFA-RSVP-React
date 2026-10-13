import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/url', () => ({
  getAppOrigin: vi.fn(),
}));

import { getAppOrigin } from '@/lib/url';

import {
  renderAgreementPdf,
  sha256Hex,
} from './pdf';

import type {
  AgreementContent,
  AgreementDoc,
} from './template';

beforeEach(() => {
  vi.mocked(getAppOrigin).mockResolvedValue(
    'https://kalfa.me',
  );
});

describe('renderAgreementPdf', () => {
  const content: AgreementContent = {
    company: {
      name: 'קאלפא',
      id: '51-1234567',
      address: 'הרצל 1, תל אביב',
      contactPhone: '03-1234567',
      contactEmail: 'support@kalfa.me',
      privacyUrl: '/privacy',
      termsUrl: '/terms',
      warrantyText: 'השירות ניתן כפי שהוא.',
    },
    eventName: 'החתונה של דנה ויוסי',
    channels: ['whatsapp', 'call'],
    windowText: '1.11.2026 – 19.11.2026',
    packagePrice: 200,
    contactQuota: 200,
  };

  const doc: AgreementDoc = {
    version: '2026-10-v6',
    status: 'approved',
    bodyHtml: `
      <h1>הסכם אישור קמפיין ושירות — KALFA</h1>
      <div class="sub">גרסה {{version}}</div>

      <h2>מחיר</h2>
      <p>
        מחיר החבילה:
        <strong>{{packagePrice}}</strong>
        · עד {{contactQuota}} אנשי קשר
      </p>

      <p>
        KALFA · RSVP · CVV · IP · User-Agent · SHA-256
      </p>

      <p>
        §14ג · §30א · 13/10/2026 · 203.0.113.5
      </p>

      <p>{{privacyLink}} · {{termsLink}}</p>

      <dl class="terms">
        <dt>מחיר החבילה</dt>
        <dd>{{packagePrice}}</dd>
        <dt>מכסה</dt>
        <dd>{{contactQuota}}</dd>
      </dl>

      <div class="intent">
        אני מאשר/ת שקראתי והבנתי את התנאים.
      </div>
    `,
  };

  it('produces a real PDF without launching a browser', async () => {
    const bytes = await renderAgreementPdf({
      content,
      approval: {
        approverName: 'דנה כהן',
        approvedDateText: '13/10/2026',
        ip: '203.0.113.5',
      },
      doc,
    });

    const buffer = Buffer.from(bytes);

    expect(
      buffer.subarray(0, 5).toString('ascii'),
    ).toBe('%PDF-');

    expect(buffer.length).toBeGreaterThan(1_000);

    expect(sha256Hex(bytes)).toMatch(
      /^[a-f0-9]{64}$/,
    );
  });
});