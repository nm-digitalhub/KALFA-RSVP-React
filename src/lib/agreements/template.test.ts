import { describe, expect, it } from 'vitest';

import {
  renderAgreementBody,
  renderAgreementDocument,
  AGREEMENT_VERSION,
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
};

const sig: AgreementSignature = {
  signerName: 'דנה כהן',
  verifiedPhone: '+972501234567',
  signedDateText: '25.6.2026',
  ip: '203.0.113.5',
  signatureDataUrl: 'data:image/png;base64,AAAA',
};

describe('renderAgreementBody', () => {
  const html = renderAgreementBody(content);

  it('discloses the seller identity (§14ג)', () => {
    expect(html).toContain('קאלפא בע״מ');
    expect(html).toContain('51-1234567');
    expect(html).toContain('הרצל 1, תל אביב');
    expect(html).toContain('support@kalfa.me');
  });

  it('shows VAT-inclusive price + ceiling', () => {
    expect(html).toContain('₪4.00');
    expect(html).toContain('כולל מע"מ');
    expect(html).toContain('₪400.00');
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
