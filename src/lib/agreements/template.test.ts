import { describe, expect, it } from 'vitest';

import {
  AGREEMENT_TOKEN_KEYS,
  PACKAGE_AGREEMENT_VERSION,
  PACKAGE_BODY_MANAGED_IN_ADMIN,
  agreementTokens,
  findUnknownTokens,
  renderAgreementBody,
  renderAgreementDocument,
  type AgreementApproval,
  type AgreementContent,
  type AgreementDoc,
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
  channels: ['whatsapp', 'call'],
  windowText: '1.7.2026 – 15.7.2026',
  packagePrice: 150,
  contactQuota: 100,
};

const doc = (bodyHtml: string | null, status: AgreementDoc['status'] = 'approved'): AgreementDoc => ({
  version: PACKAGE_AGREEMENT_VERSION,
  status,
  bodyHtml,
});

const approval: AgreementApproval = {
  approverName: 'דנה כהן',
  approvedDateText: '25.6.2026',
  ip: '203.0.113.5',
};

describe('renderAgreementBody', () => {
  it('substitutes the built-in tokens: the seller identity (§14ג), the event and the package figures', () => {
    const html = renderAgreementBody(
      content,
      doc('<p>{{company.name}} {{company.id}} {{company.address}} {{company.contactEmail}}</p><p>{{eventName}} {{packagePrice}} {{contactQuota}} {{channels}} {{version}}</p>'),
    );
    expect(html).toContain('קאלפא בע״מ');
    expect(html).toContain('51-1234567');
    expect(html).toContain('הרצל 1, תל אביב');
    expect(html).toContain('support@kalfa.me');
    expect(html).toContain('החתונה של דנה ויוסי');
    expect(html).toContain('₪150.00');
    expect(html).toContain('100');
    expect(html).toContain('וואטסאפ, שיחה טלפונית (AI)');
    expect(html).toContain(PACKAGE_AGREEMENT_VERSION);
  });

  it('marks missing company fields as [יושלם] rather than blank', () => {
    const html = renderAgreementBody({ ...content, company: { ...company, name: '', id: '' } }, doc('<p>{{company.name}} {{company.id}}</p>'));
    expect(html).toContain('[יושלם]');
  });

  it('escapes HTML in the event name (no injection)', () => {
    const html = renderAgreementBody({ ...content, eventName: '<script>alert(1)</script>' }, doc('<p>{{eventName}}</p>'));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('has no in-code text: an empty body is never rendered', () => {
    expect(() => renderAgreementBody(content, doc(null))).toThrow(PACKAGE_BODY_MANAGED_IN_ADMIN);
    expect(() => renderAgreementBody(content, doc('   '))).toThrow(PACKAGE_BODY_MANAGED_IN_ADMIN);
  });

  it('appends the draft marker only while the document is a draft', () => {
    expect(renderAgreementBody(content, doc('<p>x</p>', 'draft'))).toContain('טיוטה — נוסח משפטי');
    expect(renderAgreementBody(content, doc('<p>x</p>'))).not.toContain('טיוטה');
  });
});

describe('renderAgreementBody + injected config tokens', () => {
  it('substitutes injected admin-config tokens', () => {
    const html = renderAgreementBody(content, doc('<p>תקרת אחריות: {{liabilityCap}} · תוקף הצעה: {{offerValidityDays}} ימים</p>'), {
      liabilityCap: '₪10,000',
      offerValidityDays: '14',
    });
    expect(html).toContain('₪10,000');
    expect(html).toContain('14 ימים');
  });

  it('escapes injected config values (no HTML/entity injection)', () => {
    const html = renderAgreementBody(content, doc('<p>{{liabilityCap}}</p>'), { liabilityCap: '<script>&"x"' });
    expect(html).not.toContain('<script>&"x"');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('built-in tokens win over a same-named injected token (precedence)', () => {
    const html = renderAgreementBody(content, doc('<p>{{eventName}}</p>'), { eventName: 'HACKED' });
    expect(html).toContain(content.eventName);
    expect(html).not.toContain('HACKED');
  });

  it('leaves unknown tokens literal', () => {
    expect(renderAgreementBody(content, doc('<p>{{nope}}</p>'))).toContain('{{nope}}');
  });
});

describe('the token list', () => {
  it('offers the package figures and none of the earlier pay-per-result ones', () => {
    expect(AGREEMENT_TOKEN_KEYS).toContain('packagePrice');
    expect(AGREEMENT_TOKEN_KEYS).toContain('contactQuota');
    for (const retired of ['pricePerReached', 'maxContacts', 'ceiling', 'baseFee', 'includedReached']) {
      expect(AGREEMENT_TOKEN_KEYS).not.toContain(retired);
    }
  });

  it('adds the admin-config tokens after the built-in ones', () => {
    expect(agreementTokens(['liabilityCap'])).toEqual([...AGREEMENT_TOKEN_KEYS, 'liabilityCap']);
  });

  it('a body quoting a retired pay-per-result figure has an unknown token, so approval refuses it', () => {
    expect(findUnknownTokens('<p>{{packagePrice}} {{pricePerReached}}</p>')).toEqual(['pricePerReached']);
  });
});

describe('renderAgreementDocument', () => {
  const html = renderAgreementDocument(content, approval, doc('<p>{{company.name}} {{packagePrice}}</p>'));

  it('is a full RTL Hebrew document with the body and the approval: who, when, from where, which version', () => {
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain('קאלפא בע״מ');
    expect(html).toContain('אישור תנאי החבילה');
    expect(html).toContain('דנה כהן');
    expect(html).toContain('25.6.2026');
    expect(html).toContain('203.0.113.5');
    expect(html).toContain(PACKAGE_AGREEMENT_VERSION);
    expect(html).toContain('בסימון תיבת האישור');
  });

  it('has no signature image and no verified phone', () => {
    expect(html).not.toContain('<img');
    expect(html).not.toContain('טלפון מאומת');
  });

  it('escapes HTML in the approver name', () => {
    const escaped = renderAgreementDocument(content, { ...approval, approverName: '<b>x</b>' }, doc('<p>x</p>'));
    expect(escaped).not.toContain('<b>x</b>');
    expect(escaped).toContain('&lt;b&gt;');
  });
});

// personal-coupons 2.3: when a benefit applies the rendered document states all three figures.
describe('benefit tokens (personal-coupons 2.3)', () => {
  const content = {
    company: { name: 'קלפה', id: '1', address: 'א', contactPhone: '0', contactEmail: 'a@b', privacyUrl: '', termsUrl: '', warrantyText: 'ת' },
    eventName: 'אירוע',
    channels: ['whatsapp'],
    windowText: 'חלון',
    packagePrice: 190,
    contactQuota: 200,
    listPrice: 200,
    discountAmount: 10,
  };

  const doc = (bodyHtml: string) =>
    ({ version: 'v-test', status: 'approved', bodyHtml }) as const;

  it('a discounted document shows list price, discount and final price', () => {
    const html = renderAgreementBody(content, doc('מחיר מחירון {{listPrice}}; הטבה {{discountAmount}}; לתשלום {{packagePrice}}'));
    expect(html).toContain('₪200.00');
    expect(html).toContain('₪10.00');
    expect(html).toContain('₪190.00');
  });

  it('without a benefit the tokens still render (list = final, discount ₪0.00)', () => {
    const { listPrice: _l, discountAmount: _d, ...plain } = content;
    const html = renderAgreementBody({ ...plain, packagePrice: 200 }, doc('{{listPrice}}|{{discountAmount}}|{{packagePrice}}'));
    expect(html).toContain('₪200.00|₪0.00|₪200.00');
  });
});
