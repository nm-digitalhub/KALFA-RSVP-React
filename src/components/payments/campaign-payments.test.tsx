// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { DisplayedOperation, StaffDisplayedOperation } from '@/lib/payments/ledger';

import { CampaignPayments } from './campaign-payments';

afterEach(cleanup);

const purchase: DisplayedOperation = {
  id: 'op-1',
  kindLabel: 'רכישת חבילה',
  effect: 'collect',
  outcome: 'succeeded',
  amount: 105,
  occurredAt: '2026-10-09T10:00:00Z',
  isTest: false,
  cardLast4: '4580',
  document: { number: 6, url: 'https://secure.cardcom.solutions/doc/6' },
};
const refund: DisplayedOperation = {
  ...purchase,
  id: 'op-2',
  kindLabel: 'החזר',
  effect: 'return',
  amount: 1,
  document: { number: 2, url: 'javascript:alert(1)' },
};
const staffFacts: StaffDisplayedOperation['staff'] = {
  provider: 'cardcom',
  terminal: 172204,
  terminalEcho: 172204,
  paymentId: 265709850,
  authRef: '0123456',
  providerStatus: '0',
  providerStatusDescription: null,
  authDescription: null,
  documentType: 'ReceiptRefund',
  dealType: 'Refund',
  paymentType: null,
  acquirer: 'Isracard',
  uniqueId: null,
  rrn: null,
  couponNumber: null,
  cardBrand: null,
  cardIssuer: null,
  cardIsAbroad: false,
  numberOfPayments: 1,
  creditApplied: 0,
  source: 'app',
  note: null,
  recordedAt: '2026-10-09T15:00:00Z',
};

describe('CampaignPayments', () => {
  it('one row per operation: the registry name and the outcome are two separate facts', () => {
    render(<CampaignPayments audience="customer" operations={[purchase, refund]} />);
    expect(screen.getByRole('heading', { name: 'תשלומים' })).toBeTruthy();
    expect(screen.getByText('רכישת חבילה')).toBeTruthy();
    expect(screen.getByText('החזר')).toBeTruthy();
    expect(screen.getAllByText('הצליח')).toHaveLength(2);
    expect(screen.getAllByText('•••• 4580')).toHaveLength(2);
  });

  it('a document link only to an https address; anything else is its number alone', () => {
    render(<CampaignPayments audience="customer" operations={[purchase, refund]} />);
    expect(screen.getByRole('link', { name: 'מסמך 6' }).getAttribute('href')).toBe('https://secure.cardcom.solutions/doc/6');
    expect(screen.queryByRole('link', { name: 'מסמך 2' })).toBeNull();
    expect(screen.getByText('מסמך 2')).toBeTruthy();
  });

  it('a customer never gets the technical section', () => {
    render(<CampaignPayments audience="customer" operations={[purchase]} />);
    expect(screen.queryByText('פרטים טכניים (צוות בלבד)')).toBeNull();
  });

  it('staff get the provider facts that hold a value, and nothing for the empty ones', () => {
    render(<CampaignPayments audience="staff" operations={[{ ...refund, outcome: 'failed', staff: staffFacts }]} />);
    expect(screen.getByText('פרטים טכניים (צוות בלבד)')).toBeTruthy();
    expect(screen.getByText('265709850')).toBeTruthy();
    expect(screen.getByText('ReceiptRefund')).toBeTruthy();
    expect(screen.getByText('נכשל')).toBeTruthy();
    expect(screen.queryByText('RRN')).toBeNull();
  });

  it('an unreadable ledger says so; an empty one shows nothing', () => {
    const { container, rerender } = render(<CampaignPayments audience="customer" operations={null} />);
    expect(screen.getByText(/לא ניתן לטעון כרגע את נתוני התשלומים/)).toBeTruthy();
    rerender(<CampaignPayments audience="customer" operations={[]} />);
    expect(container.textContent).toBe('');
  });
});
