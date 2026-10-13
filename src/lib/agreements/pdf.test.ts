import { Children, isValidElement, type ReactNode } from 'react';
import { AgreementPdfDocument } from './pdf-document';
import { parseAgreementPdfHtml } from './pdf-html';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@/lib/url', () => ({
  getAppOrigin: vi.fn(),
}));

import { getAppOrigin } from '@/lib/url';

import { renderAgreementPdf, sha256Hex } from './pdf';

import type { AgreementContent, AgreementDoc } from './template';

beforeEach(() => {
  vi.mocked(getAppOrigin).mockResolvedValue('https://kalfa.me');
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

      <h4>תנאים נוספים</h4><h5>פרטים</h5><h6>הערה</h6>
      <section dir="rtl" style="border:1px solid #ddd; padding:4px; color:#123456">
        <p><u>קו תחתון</u> <mark>מסומן</mark> <small>אותיות קטנות</small>
          H<sub>2</sub>O · x<sup>2</sup> · <span dir="ltr">ABC 123</span>
          <abbr title="example">EX</abbr> <cite>מקור</cite> <time datetime="2026-10-13">13/10/2026</time>
          <bdi>ABC</bdi> <bdo dir="ltr">DEF</bdo>
        </p>
        <pre dir="ltr"><code>  const price = 200;
    <strong>const quota = 200;</strong>
    <em>const label = "KALFA שלום";</em>
    <strong><em>return price;</em></strong></code></pre>
      </section>
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

    // File-format sanity only; this is not a Hebrew BiDi correctness assertion.
    expect(buffer.subarray(0, 5).toString('ascii')).toBe('%PDF-');

    expect(buffer.length).toBeGreaterThan(1_000);

    expect(sha256Hex(bytes)).toMatch(/^[a-f0-9]{64}$/);
  });
});
// Inspect applied styles as well as successful PDF serialization: dropping a
// mark, direction or inherited color must fail even if the bytes start %PDF-.
function renderedStyles(node: ReactNode): Array<Record<string, unknown>> {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ style?: Record<string, unknown>; children?: ReactNode }>(child))
      return [];
    return [
      ...(child.props.style ? [child.props.style] : []),
      ...renderedStyles(child.props.children),
    ];
  });
}
describe('agreement renderer style mapping', () => {
  it('applies semantics, explicit styles and inherited direction to nested blocks', () => {
    const blocks = parseAgreementPdfHtml(
      '<section dir="ltr" style="color:red;font-size:20px"><p><u>u</u><mark>mark</mark><small>small</small><sub>sub</sub><sup>sup</sup><code><strong><em>code</em></strong></code></p><div><p style="color:blue">nested</p></div></section>',
    );
    const tree = AgreementPdfDocument({
      blocks,
      approval: { approverName: 'Example', approvedDateText: '13/10/2026', ip: null },
      version: 'test',
      appOrigin: 'https://kalfa.me',
    });
    const styles = renderedStyles(tree);
    expect(styles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: 'ltr',
          textAlign: 'left',
          fontSize: 15,
          color: '#ff0000',
          textDecoration: 'underline',
        }),
        expect.objectContaining({ backgroundColor: '#ffff00' }),
        expect.objectContaining({ fontSize: 12, color: '#ff0000' }),
        expect.objectContaining({ verticalAlign: 'sub' }),
        expect.objectContaining({ verticalAlign: 'super' }),
        expect.objectContaining({
          fontFamily: ['AgreementMono', 'AgreementSans'],
          fontWeight: 700,
          fontStyle: 'italic',
        }),
        expect.objectContaining({ direction: 'ltr', textAlign: 'left', color: '#0000ff' }),
      ]),
    );
  });
  it('lets explicit styles override semantic styles', () => {
    const blocks = parseAgreementPdfHtml(
      '<p><mark style="background-color:blue">x</mark><strong style="font-weight:400">y</strong></p>',
    );
    const tree = AgreementPdfDocument({
      blocks,
      approval: { approverName: 'Example', approvedDateText: '13/10/2026', ip: null },
      version: 'test',
      appOrigin: 'https://kalfa.me',
    });
    expect(renderedStyles(tree)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ backgroundColor: '#0000ff' }),
        expect.objectContaining({ fontWeight: 400 }),
      ]),
    );
  });
});

it('retains pre indentation and expands tabs across nested marks at render time', () => {
  const tree = AgreementPdfDocument({
    blocks: parseAgreementPdfHtml('<pre dir="ltr"><code>  a\n <strong>b</strong>\tc</code></pre>'),
    approval: { approverName: 'Example', approvedDateText: '13/10/2026', ip: null },
    version: 'test',
    appOrigin: 'https://kalfa.me',
  });
  function text(node: ReactNode): string {
    return Children.toArray(node)
      .map((child) =>
        isValidElement<{ children?: ReactNode }>(child)
          ? text(child.props.children)
          : String(child),
      )
      .join('');
  }
  expect(text(tree)).toContain('\u00a0\u00a0a\n\u00a0b' + '\u00a0'.repeat(6) + 'c');
});

it('keeps heading and pre semantic fonts inside a styled parent', () => {
  const tree = AgreementPdfDocument({
    blocks: parseAgreementPdfHtml(
      '<div class="intent" dir="ltr" style="font-size:24px;font-weight:400"><h4>Heading</h4><pre>  code</pre></div>',
    ),
    approval: { approverName: 'Example', approvedDateText: '13/10/2026', ip: null },
    version: 'test',
    appOrigin: 'https://kalfa.me',
  });
  expect(renderedStyles(tree)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ fontSize: 10.5, fontWeight: 700, direction: 'ltr' }),
      expect.objectContaining({
        fontFamily: ['AgreementMono', 'AgreementSans'],
        fontSize: 10,
        direction: 'ltr',
      }),
    ]),
  );
});
