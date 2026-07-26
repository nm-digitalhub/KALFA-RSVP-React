import { describe, expect, it } from 'vitest';

import {
  renderAgreementBody,
  renderAgreementDocument,
  AGREEMENT_VERSION,
  BASE_FEE_AGREEMENT_VERSION,
  type AgreementContent,
  type AgreementSignature,
} from '@/lib/agreements/template';

const company = {
  name: 'קאלפא בע״מ',
  id: '51-1234567',
  address: 'הרצל 1, תל אביב',
  contactPhone: '03-1234567',
  contactEmail: 'support@kalfa.me',
  privacyUrl: 'https://kalfa.me/privacy',
  termsUrl: 'https://kalfa.me/terms',
  warrantyText: 'השירות ניתן כפי שהוא.',
};

const content: AgreementContent = {
  company,
  eventName: 'החתונה של דנה ויוסי',
  pricePerReached: 4,
  maxContacts: 100,
  ceiling: 400,
  channels: ['whatsapp', 'call'],
  windowText: '1.7.2026 – 15.7.2026',
  baseFee: 0, // per-reached (v3) content
  includedReached: 0,
};

const sig: AgreementSignature = {
  signerName: 'דנה כהן',
  verifiedPhone: '+972501234567',
  signedDateText: '25.6.2026',
  ip: '203.0.113.5',
  signatureDataUrl: 'data:image/png;base64,AAAA',
};

describe('base-fee (v4) body — version-selected §3-4', () => {
  const v4Content: AgreementContent = {
    ...content,
    baseFee: 200,
    includedReached: 200,
    ceiling: 600,
  };
  const v4 = renderAgreementBody(v4Content, {
    version: BASE_FEE_AGREEMENT_VERSION,
    status: 'draft',
    bodyHtml: null,
  });

  it('renders the base-fee clauses with data-driven figures (no hardcoded price)', () => {
    expect(v4).toContain('דמי הפעלת שירות');
    expect(v4).toContain('₪200.00'); // baseFee, from data
    expect(v4).toContain('₪4.00'); // overage, from data
    expect(v4).toContain('₪600.00'); // ceiling, from data
    expect(v4).toContain('200 אנשי קשר שהושגו'); // includedReached, from data
  });

  it('discloses the activation fee is charged even at 0 results (§2 / חוזים אחידים)', () => {
    expect(v4).toContain('0 תוצאות');
    expect(v4).toContain('דמי ההפעלה');
  });

  it('does NOT show the per-reached "0 → no charge" wording', () => {
    expect(v4).not.toContain('חיוב 0 אנשי קשר → אין חיוב');
  });

  it('the per-reached (v3) default still shows its own §3-4, not the base fee', () => {
    const v3 = renderAgreementBody(content); // baseFee 0 → per-reached
    expect(v3).toContain('מחיר לאיש קשר שהושג');
    expect(v3).not.toContain('דמי הפעלת שירות');
  });
});

describe('renderAgreementBody', () => {
  const html = renderAgreementBody(content);

  it('discloses the seller identity (§14ג)', () => {
    expect(html).toContain('קאלפא בע״מ');
    expect(html).toContain('51-1234567');
    expect(html).toContain('הרצל 1, תל אביב');
    expect(html).toContain('support@kalfa.me');
  });

  it('shows final prices with the osek-patur no-VAT disclosure', () => {
    expect(html).toContain('₪4.00');
    expect(html).toContain('לא נגבה מע"מ');
    expect(html).toContain('₪400.00');
    // The business is an עוסק פטור — a "VAT included" claim would be false.
    expect(html).not.toContain('כולל מע"מ');
  });

  it('includes the "not billed" clause', () => {
    expect(html).toContain('לא יחויבו');
    expect(html).toContain('משיבון');
  });

  it('discloses the §14ג cancellation right incl. the 4-month extension', () => {
    expect(html).toContain('14 ימים');
    expect(html).toContain('4 חודשים');
  });

  it('includes the §30א owner declaration + indemnity', () => {
    expect(html).toContain('משפה');
  });

  it('includes the evidentiary anchor (signature / OTP / IP / device)', () => {
    expect(html).toContain('OTP');
    expect(html).toContain('IP');
    expect(html).toContain('User');
    expect(html).toContain('SHA');
  });

  it('marks missing company fields as [יושלם] rather than blank', () => {
    const partial = renderAgreementBody({
      ...content,
      company: { ...company, name: '', id: '' },
    });
    expect(partial).toContain('[יושלם]');
  });

  it('escapes HTML in the event name (no injection)', () => {
    const injected = renderAgreementBody({
      ...content,
      eventName: '<script>alert(1)</script>',
    });
    expect(injected).not.toContain('<script>alert(1)</script>');
    expect(injected).toContain('&lt;script&gt;');
  });
});

describe('renderAgreementBody custom body + injected config tokens', () => {
  const customDoc = {
    version: 'custom-v1',
    status: 'approved' as const,
    bodyHtml:
      '<p>תקרת אחריות: {{liabilityCap}} · תוקף הצעה: {{offerValidityDays}} ימים</p>',
  };

  it('substitutes injected admin-config tokens into a custom body', () => {
    const html = renderAgreementBody(content, customDoc, {
      liabilityCap: '₪10,000',
      offerValidityDays: '14',
    });
    expect(html).toContain('₪10,000');
    expect(html).toContain('14 ימים');
  });

  it('escapes injected config values (no HTML/entity injection)', () => {
    const html = renderAgreementBody(
      content,
      { ...customDoc, bodyHtml: '<p>{{liabilityCap}}</p>' },
      { liabilityCap: '<script>&"x"' },
    );
    expect(html).not.toContain('<script>&"x"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('built-in tokens win over a same-named injected token (precedence)', () => {
    const html = renderAgreementBody(
      content,
      { ...customDoc, bodyHtml: '<p>{{eventName}}</p>' },
      { eventName: 'HACKED' },
    );
    expect(html).toContain(content.eventName);
    expect(html).not.toContain('HACKED');
  });

  it('leaves unknown tokens literal', () => {
    const html = renderAgreementBody(
      content,
      { ...customDoc, bodyHtml: '<p>{{nope}}</p>' },
      {},
    );
    expect(html).toContain('{{nope}}');
  });
});

describe('renderAgreementDocument', () => {
  const doc = renderAgreementDocument(content, sig);

  it('is a full RTL Hebrew document with the body + signature block', () => {
    expect(doc).toContain('<html lang="he" dir="rtl">');
    expect(doc).toContain('קאלפא בע״מ'); // body included
    expect(doc).toContain('דנה כהן'); // signer
    expect(doc).toContain('+972501234567'); // verified phone
    expect(doc).toContain('203.0.113.5'); // ip in signature meta
    expect(doc).toContain('src="data:image/png;base64,AAAA"');
    expect(doc).toContain(AGREEMENT_VERSION);
  });

  it('escapes HTML in the signer name', () => {
    const doc2 = renderAgreementDocument(content, {
      ...sig,
      signerName: '<b>x</b>',
    });
    expect(doc2).not.toContain('<b>x</b>');
    expect(doc2).toContain('&lt;b&gt;');
  });
});
