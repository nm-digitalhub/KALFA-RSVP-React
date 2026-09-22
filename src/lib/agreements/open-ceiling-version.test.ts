import { describe, expect, it } from 'vitest';

import {
  renderAgreementBody,
  BASE_FEE_AGREEMENT_VERSION,
  OPEN_CEILING_AGREEMENT_VERSION,
  isBaseFeeAgreementVersion,
  isOpenCeilingAgreementVersion,
  type AgreementContent,
  type AgreementDoc,
} from '@/lib/agreements/template';

// v5 exists because the PRODUCT flow changed: the customer signs BEFORE building
// the guest list, so v4's frozen "תקרת חיוב מרבית" figure prices a contact count
// of zero and caps the charge at the activation fee. v5 states the ceiling as the
// formula the customer drives instead.
//
// The property this suite defends is NOT the wording — it is that introducing v5
// did not disturb v4. One real signature exists against v4 (2026-09-02, verified
// live), and a signed contract's text and billing model must not change under its
// own version label.

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
  pricePerReached: 4,
  // The live shape of this flow: the list is empty when the contract is signed.
  maxContacts: 0,
  ceiling: 200,
  channels: ['whatsapp', 'call'],
  windowText: '1.11.2026 – 19.11.2026',
  baseFee: 200,
  includedReached: 200,
};

const doc = (version: string): AgreementDoc => ({
  version,
  status: 'approved',
  bodyHtml: null,
});

const v4 = renderAgreementBody(content, doc(BASE_FEE_AGREEMENT_VERSION));
const v5 = renderAgreementBody(content, doc(OPEN_CEILING_AGREEMENT_VERSION));

describe('v5 still bills as a base-fee contract', () => {
  // If v5 fell out of the base-fee set the D5 guard in close-charge would
  // suppress base+included and a v5 signer would never be charged the
  // activation fee at all.
  it('v5 is a base-fee version, so the activation fee is authorised', () => {
    expect(isBaseFeeAgreementVersion(OPEN_CEILING_AGREEMENT_VERSION)).toBe(true);
    expect(isBaseFeeAgreementVersion(`draft-${OPEN_CEILING_AGREEMENT_VERSION}`)).toBe(true);
  });

  it('v4 REMAINS a base-fee version — the existing signature still bills correctly', () => {
    expect(isBaseFeeAgreementVersion(BASE_FEE_AGREEMENT_VERSION)).toBe(true);
  });

  it('only v5 is an open-ceiling version; v3/v4 and unknown versions are not', () => {
    expect(isOpenCeilingAgreementVersion(OPEN_CEILING_AGREEMENT_VERSION)).toBe(true);
    expect(isOpenCeilingAgreementVersion(BASE_FEE_AGREEMENT_VERSION)).toBe(false);
    expect(isOpenCeilingAgreementVersion('draft-2026-07-v3')).toBe(false);
    expect(isOpenCeilingAgreementVersion(null)).toBe(false);
    expect(isOpenCeilingAgreementVersion(undefined)).toBe(false);
  });
});

describe('v4 is untouched by the introduction of v5', () => {
  it('still states the ceiling as a fixed figure bounded by the maximum count', () => {
    expect(v4).toContain('ועד למספר המרבי');
    expect(v4).toContain('מספר אנשי קשר מרבי');
  });

  it('still describes the hold as covering the whole ceiling', () => {
    expect(v4).toContain('תפיסת מסגרת אשראי עד גובה התקרה');
  });

  it('does not leak any v5 wording', () => {
    expect(v4).not.toContain('תקרת החיוב אינה סכום קבוע מראש');
  });
});

describe('v5 states the ceiling as a formula the customer drives', () => {
  it('drops the fixed-count bound that capped the charge at the activation fee', () => {
    expect(v5).not.toContain('ועד למספר המרבי');
    expect(v5).not.toContain('מספר אנשי קשר מרבי');
  });

  it('says outright that the ceiling is not a pre-set number', () => {
    expect(v5).toContain('תקרת החיוב אינה סכום קבוע מראש');
  });

  it('ties every increase to the customer adding guests who actually answer', () => {
    expect(v5).toContain('רק כתוצאה מפעולה של הלקוח');
    expect(v5).toContain('רק עבור מוזמנים שנענו בפועל');
    expect(v5).toContain('מוזמן שנוסף ולא נענה אינו מוסיף לחיוב');
  });

  // The clause promises this in writing, so the running total is a contractual
  // commitment, not a nice-to-have. A build that stops showing it makes the
  // signed text untrue.
  it('promises the customer a visible running total', () => {
    expect(v5).toContain('מוצג ללקוח במסך ניהול הקמפיין');
  });

  it('describes the hold as the activation fee only, charged once at close', () => {
    expect(v5).toContain('בגובה דמי ההפעלה');
    expect(v5).toContain('יבוצע חיוב אחד באמצעות אמצעי התשלום השמור');
    expect(v5).not.toContain('תפיסת מסגרת אשראי עד גובה התקרה');
  });

  it('keeps the unconditional activation-fee disclosure v4 established', () => {
    expect(v5).toContain('בכל מקרה, גם אם לא הושג אף איש קשר');
  });

  it('still states the עוסק פטור no-VAT position', () => {
    expect(v5).toContain('לא נגבה מע"מ');
  });

  it('renders the real figures, never a hardcoded price', () => {
    expect(v5).toContain('₪200.00');
    expect(v5).toContain('₪4.00');
    expect(v5).toContain('200 אנשי הקשר הכלולים');
  });
});
