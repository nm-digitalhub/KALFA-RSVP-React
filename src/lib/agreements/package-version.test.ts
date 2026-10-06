import { describe, expect, it } from 'vitest';

import {
  renderAgreementBody,
  renderAgreementDocument,
  BASE_FEE_AGREEMENT_VERSION,
  OPEN_CEILING_AGREEMENT_VERSION,
  PACKAGE_AGREEMENT_VERSION,
  PACKAGE_BODY_MANAGED_IN_ADMIN,
  defaultBodyAsTemplate,
  isBaseFeeAgreementVersion,
  isOpenCeilingAgreementVersion,
  isPackageAgreementVersion,
  type AgreementContent,
} from '@/lib/agreements/template';

// The package contract (v6) is a different kind of agreement: one fixed price paid at purchase,
// no per-reached component, no settlement. Its wording is DATA (a document managed in /admin/agreement, seeded by the
// migration — see package-seed.test.ts), not code. The property defended here is that introducing it can neither switch
// an older signature into the new model nor let the in-code default put the WRONG contract text in front of a package buyer.

const content: AgreementContent = {
  company: {
    name: 'קאלפא',
    id: '51-1234567',
    address: 'הרצל 1, תל אביב',
    contactPhone: '03-1234567',
    contactEmail: 'support@kalfa.me',
    privacyUrl: 'https://kalfa.me/privacy',
    termsUrl: 'https://kalfa.me/terms',
    warrantyText: 'השירות ניתן כפי שהוא.',
  },
  eventName: 'החתונה של דנה ויוסי',
  pricePerReached: 0,
  maxContacts: 0,
  ceiling: 0,
  channels: ['whatsapp', 'call'],
  windowText: '1.11.2026 – 19.11.2026',
  baseFee: 0,
  includedReached: 0,
};

// The package contract states ONE price and a quota, so its content carries them. The pay-per-result figures are zero
// here on purpose: a package campaign snapshots 0 for them, and the contract must not quote any of them.
const packageContent: AgreementContent = { ...content, packagePrice: 150, contactQuota: 100 };
const PACKAGE_DOC = { version: PACKAGE_AGREEMENT_VERSION, status: 'approved' as const, bodyHtml: null as string | null };

describe('isPackageAgreementVersion', () => {
  it('matches the approved version and its draft form', () => {
    expect(isPackageAgreementVersion(PACKAGE_AGREEMENT_VERSION)).toBe(true);
    expect(isPackageAgreementVersion(`draft-${PACKAGE_AGREEMENT_VERSION}`)).toBe(true);
  });

  it.each([null, undefined, '', '2026-07-v4', '2026-09-v5', 'draft-2026-06-v2', '2026-10-v7'])(
    'does not match %s (unknown or absent is NOT a package: the safe default for the money path)',
    (v) => {
      expect(isPackageAgreementVersion(v)).toBe(false);
    },
  );

  it('does not leak into the other model predicates (v4 and v5 are untouched)', () => {
    expect(isBaseFeeAgreementVersion(PACKAGE_AGREEMENT_VERSION)).toBe(false);
    expect(isOpenCeilingAgreementVersion(PACKAGE_AGREEMENT_VERSION)).toBe(false);
    expect(isPackageAgreementVersion(BASE_FEE_AGREEMENT_VERSION)).toBe(false);
    expect(isPackageAgreementVersion(OPEN_CEILING_AGREEMENT_VERSION)).toBe(false);
  });
});

describe('renderAgreementBody for a package version', () => {
  it('without the package figures it refuses to render: a contract is never shown with a blank price', () => {
    expect(() => renderAgreementBody(content, { ...PACKAGE_DOC, status: 'draft' })).toThrow(
      'package agreement needs the package price and quota',
    );
    expect(() => renderAgreementBody({ ...content, packagePrice: 150 }, PACKAGE_DOC)).toThrow();
    expect(() => renderAgreementBody({ ...content, contactQuota: 100 }, PACKAGE_DOC)).toThrow();
    // ...whoever wrote the body: a custom body does not lift the requirement
    expect(() => renderAgreementBody(content, { ...PACKAGE_DOC, bodyHtml: '<p>{{packagePrice}}</p>' })).toThrow(
      'package agreement needs the package price and quota',
    );
  });

  it('has NO in-code text: without a body the package version fails closed instead of showing any contract', () => {
    // The contract is managed as data from /admin/agreement. The in-code default must never stand in for it — least of
    // all with the pay-per-result clauses.
    expect(() => renderAgreementBody(packageContent, PACKAGE_DOC)).toThrow(PACKAGE_BODY_MANAGED_IN_ADMIN);
    expect(() => renderAgreementBody(packageContent, { ...PACKAGE_DOC, bodyHtml: '   ' })).toThrow(PACKAGE_BODY_MANAGED_IN_ADMIN);
    expect(() => defaultBodyAsTemplate(PACKAGE_AGREEMENT_VERSION)).toThrow(PACKAGE_BODY_MANAGED_IN_ADMIN);
    expect(() => defaultBodyAsTemplate(`draft-${PACKAGE_AGREEMENT_VERSION}`)).toThrow(PACKAGE_BODY_MANAGED_IN_ADMIN);
  });

  it('renders a custom body for the package version, with the package tokens', () => {
    const html = renderAgreementBody(packageContent, {
      version: PACKAGE_AGREEMENT_VERSION,
      status: 'approved',
      bodyHtml: '<h1>חבילה</h1><p>גרסה {{version}} · {{packagePrice}} · {{contactQuota}}</p>',
    });
    expect(html).toContain('חבילה');
    expect(html).toContain(PACKAGE_AGREEMENT_VERSION);
    expect(html).toContain('₪150.00');
    expect(html).toContain('100');
  });

  it('every pre-existing version still renders its default body, unchanged by the new fields', () => {
    for (const version of ['draft-2026-07-v3', BASE_FEE_AGREEMENT_VERSION, OPEN_CEILING_AGREEMENT_VERSION]) {
      expect(() => renderAgreementBody(content, { version, status: 'draft', bodyHtml: null })).not.toThrow();
      expect(renderAgreementBody(packageContent, { version, status: 'draft', bodyHtml: null })).toBe(
        renderAgreementBody(content, { version, status: 'draft', bodyHtml: null }),
      );
    }
  });
});

// A fixed-price package is approved by the customer ticking the box — no signature, no phone code. The document the
// customer is sent still records WHO approved, WHEN, from which address and WHICH version, in place of the signature.
describe('renderAgreementDocument — approval instead of signature', () => {
  const approval = {
    signerName: 'דנה כהן',
    verifiedPhone: null,
    signedDateText: '4.10.2026',
    ip: '203.0.113.5',
    signatureDataUrl: null,
  };

  it('records the approval: who, when, from where, which version — and no signature image or phone', () => {
    const html = renderAgreementDocument(packageContent, approval, {
      ...PACKAGE_DOC,
      bodyHtml: '<h1>חבילה</h1><p>{{packagePrice}} · {{contactQuota}}</p>',
    });
    expect(html).toContain('אישור תנאי החבילה');
    expect(html).toContain('דנה כהן');
    expect(html).toContain('4.10.2026');
    expect(html).toContain('203.0.113.5');
    expect(html).toContain(PACKAGE_AGREEMENT_VERSION);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('טלפון מאומת');
    expect(html).not.toContain('חתם/ה');
  });

  it('a signature still renders exactly as before: the image and the verified phone', () => {
    const html = renderAgreementDocument(
      content,
      { ...approval, verifiedPhone: '+972501234567', signatureDataUrl: 'data:image/png;base64,AAAA' },
      { version: OPEN_CEILING_AGREEMENT_VERSION, status: 'approved', bodyHtml: null },
    );
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="חתימה">');
    expect(html).toContain('טלפון מאומת: +972501234567');
    expect(html).toContain('חתימה וזיהוי');
  });
});
