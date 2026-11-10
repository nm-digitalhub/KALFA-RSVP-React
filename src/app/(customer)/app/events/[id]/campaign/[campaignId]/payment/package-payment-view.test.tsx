// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PackagePaymentScreen } from '@/lib/payments/package-payment-screen';
import { PURCHASE_ERROR_MESSAGES } from '@/lib/payments/package-purchase-errors';
import { framedPanels } from '@/test/framed-panels';

// The card form itself needs CardCom's iframes; here it is a marker that records what it was given.
const cardcomProps = vi.fn();
vi.mock('./cardcom-open-fields-form', () => ({
  CardcomOpenFieldsForm: (props: Record<string, unknown>) => {
    cardcomProps(props);
    return <div data-testid="cardcom-form" />;
  },
}));

import { SERVICE_STARTING } from '@/lib/payments/package-payment-screen';

import { PackagePaymentView } from './package-payment-view';

afterEach(() => {
  cleanup();
  cardcomProps.mockClear();
});

const base = { eventId: 'e1', campaignId: 'c1', signerName: 'דנה כהן' };
function view(screenState: PackagePaymentScreen): ReactElement {
  return <PackagePaymentView {...base} screen={screenState} />;
}

describe('PackagePaymentView — the card form', () => {
  it('renders CardCom\'s form with the price and the buyer\'s name, e-mail and phone', () => {
    render(<PackagePaymentView {...base} signerEmail="dana@example.com" signerPhone="0501234567" screen={{ kind: 'form', amount: 149 }} />);
    expect(screen.getByTestId('cardcom-form')).toBeTruthy();
    expect(cardcomProps).toHaveBeenCalledWith({ eventId: 'e1', campaignId: 'c1', amount: 149, defaultName: 'דנה כהן', defaultEmail: 'dana@example.com', defaultPhone: '0501234567', googlePayTerminal: null });
    expect(screen.getByText(/149/)).toBeTruthy();
  });

  it('hands the form the Google Pay terminal the page decided on, and none by default', () => {
    render(<PackagePaymentView {...base} googlePayTerminal={172204} screen={{ kind: 'form', amount: 149 }} />);
    expect(cardcomProps).toHaveBeenLastCalledWith(expect.objectContaining({ googlePayTerminal: 172204 }));
    cleanup();
    render(view({ kind: 'form', amount: 149 }));
    expect(cardcomProps).toHaveBeenLastCalledWith(expect.objectContaining({ googlePayTerminal: null }));
  });

  it('never speaks of a hold ("תפיסה"), and names no payment provider in what the customer reads', () => {
    const { container } = render(view({ kind: 'form', amount: 120 }));
    expect(container.textContent).not.toContain('תפיסה');
    expect(container.textContent).not.toMatch(/cardcom|sumit|קארדקום|סאמיט/i);
  });
});

describe('PackagePaymentView — a payment that exists, or may exist, never offers the form again', () => {
  it('paid: says so with the recorded amount, and links on', () => {
    const { container } = render(view({ kind: 'paid', amount: 120, activation: 'unavailable' }));
    expect(screen.getByText('התשלום התקבל')).toBeTruthy();
    expect(container.textContent).toContain('120');
    expect(screen.queryByTestId('cardcom-form')).toBeNull();
    expect(screen.getByRole('link', { name: 'הוספת מוזמנים' }).getAttribute('href')).toBe('/app/events/e1/guests');
    // Paid ends setup (design D2): the way on is the event page, not the service's own page.
    expect(container.textContent).not.toContain('מעבר לניהול הקמפיין');
    expect(container.querySelector('a[href="/app/events/e1/campaign/c1"]')).toBeNull();
  });

  it.each([
    ['in_progress', PURCHASE_ERROR_MESSAGES.purchase_in_progress],
    ['review', PURCHASE_ERROR_MESSAGES.purchase_review],
  ] as const)('%s: shows the message and no form', (kind, message) => {
    render(view({ kind }));
    expect(screen.getByRole('status').textContent).toContain(message);
    expect(screen.queryByTestId('cardcom-form')).toBeNull();
  });
});

// Test money is said out loud on the two screens where a person could mistake it for a real payment. (Staff only in practice: a
// customer is never offered the test terminal.)
describe('PackagePaymentView — test money is said out loud', () => {
  it('the form on the test terminal says no real card will be charged, and is still the form', () => {
    render(view({ kind: 'form', amount: 120, testTerminal: true }));
    expect(screen.getByRole('status').textContent).toBe('מסוף בדיקה — לא יחויב כרטיס אמיתי.');
    expect(screen.getByTestId('cardcom-form')).toBeTruthy();
  });

  it('the form on any other terminal says nothing of the kind', () => {
    render(view({ kind: 'form', amount: 120 }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the paid screen of test money says nothing was collected and that it is not counted - and the flow still works as paid', () => {
    const { container } = render(view({ kind: 'paid', amount: 120, activation: 'unavailable', testMoney: true }));
    expect(screen.getByRole('status').textContent).toBe('תשלום בדיקה — לא נגבה כסף ולא נספר בהכנסות.');
    expect(container.textContent).toContain('התשלום התקבל');
    expect(screen.getByRole('link', { name: 'הוספת מוזמנים' })).toBeTruthy();
  });

  it('the paid screen of real money has no such note', () => {
    render(view({ kind: 'paid', amount: 120, activation: 'unavailable' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('PackagePaymentView — unavailable', () => {
  it.each([
    ['ledger', PURCHASE_ERROR_MESSAGES.purchase_failed],
    ['bad_state', PURCHASE_ERROR_MESSAGES.bad_state],
    ['past', PURCHASE_ERROR_MESSAGES.event_past],
    ['not_active', PURCHASE_ERROR_MESSAGES.event_not_active],
    ['disabled', PURCHASE_ERROR_MESSAGES.purchase_disabled],
  ] as const)('%s → its own sentence, no form', (reason, message) => {
    render(view({ kind: 'unavailable', reason }));
    expect(screen.getByRole('status').textContent).toContain(message);
    expect(screen.queryByTestId('cardcom-form')).toBeNull();
  });
});

describe('PackagePaymentView — paid: never a start control (D23)', () => {
  it('paid and approved: says the service is being started, with no button and no "not started" notice', () => {
    render(view({ kind: 'paid', amount: 120, activation: 'starting' }));
    expect(screen.getByText('התשלום התקבל')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe(SERVICE_STARTING);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('link', { name: 'הוספת מוזמנים' })).toBeTruthy();
  });

  it('active: says the campaign is running, and offers no start', () => {
    const { container } = render(view({ kind: 'paid', amount: 120, activation: 'active' }));
    expect(container.textContent).toContain('השירות פעיל');
    expect(container.textContent).not.toContain(SERVICE_STARTING);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('neither (the event passed, or staff paused it): says they paid, nothing about starting, no button', () => {
    const { container } = render(view({ kind: 'paid', amount: 120, activation: 'unavailable' }));
    expect(screen.getByText('התשלום התקבל')).toBeTruthy();
    expect(container.textContent).not.toContain(SERVICE_STARTING);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

// The payment renders inside the setup shell's one content surface (design D3, task 4.3): the payment details and the
// card form are sections with headings, never frames of their own.
describe('PackagePaymentView — flat inside the step surface', () => {
  it('the form screen draws no framed panel', () => {
    const { container } = render(view({ kind: 'form', amount: 120 }));
    expect(framedPanels(container.innerHTML)).toEqual([]);
    expect(Array.from(container.querySelectorAll('section h3')).map((h) => h.textContent)).toEqual(['פרטי התשלום', 'פרטי כרטיס אשראי']);
  });
});
