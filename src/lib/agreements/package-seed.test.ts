import { describe, expect, it } from 'vitest';

import {
  renderAgreementBody,
  OPEN_CEILING_AGREEMENT_VERSION,
  PACKAGE_AGREEMENT_VERSION,
  type AgreementContent,
} from '@/lib/agreements/template';
import { AGREEMENT_MODEL_MIGRATION_FILE, AGREEMENT_MODEL_SQL, PACKAGE_SEED_BODY } from '@/test/agreement-seed';

// The package contract is DATA: the migration seeds it as a draft document, and /admin/agreement edits it from there.
// This test is the guard on that seed. It reads the SQL of that migration, takes the body out of it, renders it the
// way a customer's contract is rendered and checks what the contract must say (and must not say). A wording or token
// mistake in the seed therefore fails here.

const file = AGREEMENT_MODEL_MIGRATION_FILE;
const sql = AGREEMENT_MODEL_SQL;
const SEED_BODY = PACKAGE_SEED_BODY;

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
  packagePrice: 150,
  contactQuota: 100,
};

const render = () =>
  renderAgreementBody(content, { version: PACKAGE_AGREEMENT_VERSION, status: 'approved', bodyHtml: SEED_BODY });

describe('the migration that adds the contract model', () => {
  it('exists and carries the package body', () => {
    expect(file, 'agreement_documents_model migration').toBeDefined();
    expect(SEED_BODY.length).toBeGreaterThan(1000);
  });

  it('seeds a DRAFT, package-model document with the package version — never an approved one', () => {
    expect(sql).toMatch(/'draft-2026-10-v6'/);
    expect(sql).toMatch(/\$agreement_body\$, 'draft', false, 'package'/);
  });

  it('seeds it INACTIVE and leaves the old one-active-row index alone: the code live today reads maybeSingle() on is_active', () => {
    // deploy-order safety: a reader without the model filter (as before this migration) would see two active rows, fail
    // maybeSingle() and fall back to the legacy v3 draft in front of customers
    expect(sql).toMatch(/'draft', false, 'package'/);
    expect(sql).not.toMatch(/drop index[^;]*agreement_documents_active_uniq/);
  });

  it('keeps one package document and shapes the rows by model', () => {
    expect(sql).toMatch(/create unique index if not exists agreement_documents_single_package_uniq\s+on public\.agreement_documents \(model\) where model = 'package'/);
    expect(sql).toContain("model in ('per_result', 'package')");
    expect(sql).toMatch(/model = 'package'\s+and body_html is not null/);
    expect(sql).toMatch(/where not exists/);
  });

  it('documents its own rollback', () => {
    expect(sql).toContain('ROLLBACK');
  });
});

describe('the seeded package contract, rendered', () => {
  it('uses tokens for every figure and detail — nothing is written into the text', () => {
    for (const token of ['{{packagePrice}}', '{{contactQuota}}', '{{company.name}}', '{{eventName}}', '{{version}}', '{{windowText}}', '{{channels}}']) {
      expect(SEED_BODY, token).toContain(token);
    }
    // no hard-coded price: the only shekel figure literal in the text is the cancellation fee cap of §5
    expect(SEED_BODY.match(/₪\s?\d[\d.,]*\d/g)).toEqual(['₪100.00']);
  });

  it('leaves no token unresolved when rendered with package content', () => {
    expect(render()).not.toMatch(/\{\{[^}]+\}\}/);
  });

  it('states the one price, the quota and the single payment — and nothing of the pay-per-result model', () => {
    const html = render();
    expect(html).toContain('חבילה במחיר קבוע');
    expect(html).toContain('₪150.00');
    expect(html).toContain('עד 100 אנשי קשר');
    expect(html).toContain('פעם אחת');
    expect(html).toContain('לא נגבה מע"מ');
    // no signature and no phone code: the package is approved by ticking the box
    for (const signing of ['החתום', 'חתימה', 'חתם', 'OTP', 'טלפון מאומת']) {
      expect(html, signing).not.toContain(signing);
    }
    expect(html).toContain('בסימון תיבת האישור');
    // none of the pay-per-result TERMS appear...
    for (const perResult of ['איש קשר שהושג', 'תקרת חיוב', 'מחיר לאיש קשר', 'לפי מספר אנשי הקשר שהושגו', 'בסגירת הקמפיין']) {
      expect(html, perResult).not.toContain(perResult);
    }
    // ...and the contract says outright what does NOT happen
    expect(html).toContain('לא תבוצע תפיסת מסגרת');
    expect(html).toContain('לא ייגבו דמי הפעלה או תשלום לפי תוצאות');
  });

  it('is honest about the card data: a token, the last four digits, the expiry and the id number are kept; the full number and the CVV are not', () => {
    const html = render();
    expect(html).toContain('אסמכתא');
    expect(html).toContain('ארבע הספרות האחרונות');
    expect(html).toContain('קוד האבטחה');
    expect(html).not.toContain('KALFA אינה שומרת את פרטי הכרטיס');
  });

  it('keeps the cancellation terms of the current agreement (§5) and defines when the service starts', () => {
    const html = render();
    const perResult = renderAgreementBody(content, { version: OPEN_CEILING_AGREEMENT_VERSION, status: 'approved', bodyHtml: null });
    const cancellation = perResult.slice(perResult.indexOf('<h2>5.'), perResult.indexOf('<h2>6.')).trimEnd();
    expect(html).toContain(cancellation);
    expect(html).toContain('תחילת מתן השירות היא שליחת ההודעה או ביצוע השיחה הראשונה לאורחים');
  });

  it('shows the draft marker while the document is a draft, and not once approved', () => {
    const draft = renderAgreementBody(content, { version: `draft-${PACKAGE_AGREEMENT_VERSION}`, status: 'draft', bodyHtml: SEED_BODY });
    expect(draft).toContain('טיוטה');
    expect(render()).not.toContain('טיוטה — נוסח משפטי');
  });
});
