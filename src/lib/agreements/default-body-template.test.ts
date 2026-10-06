import { describe, expect, it } from 'vitest';

import {
  AGREEMENT_TOKEN_KEYS,
  PER_RESULT_FIGURE_TOKENS,
  defaultBodyAsTemplate,
  perResultTokensIn,
  renderAgreementBody,
  tokensForModel,
  BASE_FEE_AGREEMENT_VERSION,
  OPEN_CEILING_AGREEMENT_VERSION,
  type AgreementContent,
} from '@/lib/agreements/template';

// The admin editor starts a custom body from the live default, as a template. Loading it must change nothing for the
// customer: rendering the template with real content has to give exactly the default body for that content.

const content: AgreementContent = {
  company: {
    name: 'קאלפא',
    id: '51-1234567',
    address: 'הרצל 1, תל אביב',
    contactPhone: '03-1234567',
    contactEmail: 'support@kalfa.me',
    privacyUrl: 'https://kalfa.me/privacy',
    termsUrl: '',
    warrantyText: 'השירות ניתן כפי שהוא & "כמות".',
  },
  eventName: 'החתונה של דנה ויוסי',
  pricePerReached: 4,
  maxContacts: 100,
  ceiling: 400,
  channels: ['whatsapp', 'call'],
  windowText: '1.11.2026 – 19.11.2026',
  baseFee: 200,
  includedReached: 150,
};

const VERSIONS = ['draft-2026-07-v3', BASE_FEE_AGREEMENT_VERSION, OPEN_CEILING_AGREEMENT_VERSION];

describe('defaultBodyAsTemplate', () => {
  it.each(VERSIONS)('round-trips to the exact default body (%s)', (version) => {
    const template = defaultBodyAsTemplate(version);
    const asDefault = renderAgreementBody(content, { version, status: 'approved', bodyHtml: null });
    const asCustom = renderAgreementBody(content, { version, status: 'approved', bodyHtml: template });
    expect(asCustom).toBe(asDefault);
  });

  it.each(VERSIONS)('leaves no sentinel and no literal figure behind (%s)', (version) => {
    const template = defaultBodyAsTemplate(version);
    expect(template).not.toContain('ZZ_');
    expect(template).not.toMatch(/1[,.]?111|2[,.]?222|3[,.]?333|5[,.]?555|6[,.]?666/);
    expect(template).toContain('{{company.name}}');
    expect(template).toContain('{{eventName}}');
  });

  it('puts the per-version figures behind tokens', () => {
    expect(defaultBodyAsTemplate(BASE_FEE_AGREEMENT_VERSION)).toContain('{{baseFee}}');
    expect(defaultBodyAsTemplate(BASE_FEE_AGREEMENT_VERSION)).toContain('{{includedReached}}');
    expect(defaultBodyAsTemplate('draft-2026-07-v3')).toContain('{{pricePerReached}}');
  });
});

describe('tokensForModel — what each contract editor offers', () => {
  const config = ['liabilityCap', 'retentionDays'];

  it('the package contract is offered its own figures and never the pay-per-result ones', () => {
    const t = tokensForModel('package', config);
    expect(t).toEqual(expect.arrayContaining(['packagePrice', 'contactQuota', 'company.name', 'liabilityCap']));
    for (const perResult of PER_RESULT_FIGURE_TOKENS) expect(t).not.toContain(perResult);
  });

  it('the pay-per-result contract is offered its figures and never the package ones', () => {
    const t = tokensForModel('per_result', config);
    expect(t).toEqual(expect.arrayContaining(['pricePerReached', 'baseFee', 'company.name', 'retentionDays']));
    expect(t).not.toContain('packagePrice');
    expect(t).not.toContain('contactQuota');
  });

  it('every token it names is one the renderer substitutes (the list cannot drift)', () => {
    for (const model of ['package', 'per_result'] as const) {
      expect(tokensForModel(model).every((t) => AGREEMENT_TOKEN_KEYS.includes(t))).toBe(true);
    }
  });
});

describe('perResultTokensIn', () => {
  it('finds the pay-per-result figures a body quotes, ignoring the rest', () => {
    expect(perResultTokensIn('<p>{{pricePerReached}} {{eventName}} {{ceiling}}</p>')).toEqual(['pricePerReached', 'ceiling']);
    expect(perResultTokensIn('<p>{{packagePrice}}</p>')).toEqual([]);
  });
});
