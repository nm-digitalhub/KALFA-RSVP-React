// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PackagePaymentScreen } from '@/lib/payments/package-payment-screen';
import { PACKAGE_NO_CONTACTS_ERROR } from '@/lib/data/package-activation-errors';
import { PURCHASE_ERROR_MESSAGES } from '@/lib/payments/package-purchase-errors';

// The card form itself needs payments.js, jQuery and next/script; here it is a marker that records what it was given.
const formProps = vi.fn();
vi.mock('./hold-form', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./hold-form')>()),
  CampaignHoldForm: (props: Record<string, unknown>) => {
    formProps(props);
    return <div data-testid="card-form" />;
  },
}));

const cardcomProps = vi.fn();
vi.mock('./cardcom-open-fields-form', () => ({
  CardcomOpenFieldsForm: (props: Record<string, unknown>) => {
    cardcomProps(props);
    return <div data-testid="cardcom-form" />;
  },
}));

vi.mock('./activate-now-form', () => ({
  ActivateNowForm: () => <div data-testid="activate-form" />,
}));

import { PackagePaymentView } from './package-payment-view';

afterEach(() => {
  cleanup();
  formProps.mockClear();
  cardcomProps.mockClear();
});

const config = { companyId: 12345, apiPublicKey: 'pub-key' };
const base = { eventId: 'e1', campaignId: 'c1', formConfig: config, signerName: 'דנה כהן' };
function view(
  screenState: PackagePaymentScreen,
  errorMessage: string | null = null,
  formConfig: typeof config | null = config,
): ReactElement {
  return <PackagePaymentView {...base} formConfig={formConfig} screen={screenState} errorMessage={errorMessage} />;
}

describe('PackagePaymentView — the card form', () => {
  it('renders the PURCHASE form, posting nowhere but the purchase flow, with the price shown', () => {
    render(view({ kind: 'form', amount: 120 }));
    expect(screen.getByTestId('card-form')).toBeTruthy();
    expect(formProps).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'purchase', campaignId: 'c1', companyId: 12345, apiPublicKey: 'pub-key', amount: 120, signerName: 'דנה כהן' }),
    );
    expect(screen.getByText(/120/)).toBeTruthy();
  });

  it('shows the answer of a previous attempt above the form', () => {
    render(view({ kind: 'form', amount: 120 }, PURCHASE_ERROR_MESSAGES.purchase_declined));
    expect(screen.getByRole('alert').textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_declined);
  });

  it('without the provider\'s public configuration there is a message, never a broken form', () => {
    render(view({ kind: 'form', amount: 120 }, null, null));
    expect(screen.queryByTestId('card-form')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain(PURCHASE_ERROR_MESSAGES.purchase_disabled);
  });

  it('never speaks of a hold ("תפיסה") to a customer who is being charged', () => {
    const { container } = render(view({ kind: 'form', amount: 120 }));
    expect(container.textContent).not.toContain('תפיסה');
    expect(container.textContent).not.toMatch(/sumit/i);
  });
});

describe('PackagePaymentView — a payment that exists, or may exist, never offers the form again', () => {
  it('paid: says so with the recorded amount, and links on', () => {
    const { container } = render(view({ kind: 'paid', amount: 120, activation: 'unavailable' }));
    expect(screen.getByText('התשלום התקבל')).toBeTruthy();
    expect(container.textContent).toContain('120');
    expect(screen.queryByTestId('card-form')).toBeNull();
    expect(screen.getByRole('link', { name: 'מעבר לניהול הקמפיין' }).getAttribute('href')).toBe('/app/events/e1/campaign/c1');
  });

  it.each([
    ['in_progress', PURCHASE_ERROR_MESSAGES.purchase_in_progress],
    ['review', PURCHASE_ERROR_MESSAGES.purchase_review],
  ] as const)('%s: shows the message and no form', (kind, message) => {
    render(view({ kind }));
    expect(screen.getByRole('status').textContent).toContain(message);
    expect(screen.queryByTestId('card-form')).toBeNull();
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
    expect(screen.queryByTestId('card-form')).toBeNull();
  });
});

describe('PackagePaymentView — paid: the way to start, and why the automatic start did not happen', () => {
  const activate = vi.fn();
  const ready: PackagePaymentScreen = { kind: 'paid', amount: 120, activation: 'ready' };

  it('ready: shows the start button, with the reason when the list was empty, and a way to add guests', () => {
    render(<PackagePaymentView {...base} screen={ready} errorMessage={null} activateAction={activate} activateReason="no_contacts" />);
    expect(screen.getByText('התשלום התקבל')).toBeTruthy();
    expect(screen.getByTestId('activate-form')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(PACKAGE_NO_CONTACTS_ERROR);
    expect(screen.getByRole('link', { name: 'הוספת מוזמנים' })).toBeTruthy();
  });

  it('ready, refused for another reason: a neutral sentence and the start button', () => {
    render(<PackagePaymentView {...base} screen={ready} errorMessage={null} activateAction={activate} activateReason="failed" />);
    expect(screen.getByRole('alert').textContent).toContain('עוד לא הופעל אוטומטית');
    expect(screen.getByTestId('activate-form')).toBeTruthy();
  });

  it('ready without a reason (the customer simply came back): the button, and no alert', () => {
    render(<PackagePaymentView {...base} screen={ready} errorMessage={null} activateAction={activate} />);
    expect(screen.getByTestId('activate-form')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('active: says the campaign is running, and offers no start', () => {
    const { container } = render(<PackagePaymentView {...base} screen={{ kind: 'paid', amount: 120, activation: 'active' }} errorMessage={null} activateAction={activate} />);
    expect(screen.queryByTestId('activate-form')).toBeNull();
    expect(container.textContent).toContain('הקמפיין פעיל');
  });

  it('not startable (the event passed): says they paid, offers no button', () => {
    render(<PackagePaymentView {...base} screen={{ kind: 'paid', amount: 120, activation: 'unavailable' }} errorMessage={null} activateAction={activate} />);
    expect(screen.getByText('התשלום התקבל')).toBeTruthy();
    expect(screen.queryByTestId('activate-form')).toBeNull();
  });
});

describe('PackagePaymentView — which form', () => {
  it('shows CardCom\'s form, with the price and the buyer\'s name and e-mail, when CardCom takes the purchase — and not the SUMIT form', () => {
    render(<PackagePaymentView {...base} provider="cardcom" signerEmail="dana@example.com" signerPhone="0501234567" screen={{ kind: 'form', amount: 149 }} errorMessage={null} />);
    expect(screen.getByTestId('cardcom-form')).toBeTruthy();
    expect(screen.queryByTestId('card-form')).toBeNull();
    expect(cardcomProps).toHaveBeenCalledWith({ eventId: 'e1', campaignId: 'c1', amount: 149, defaultName: 'דנה כהן', defaultEmail: 'dana@example.com', defaultPhone: '0501234567' });
  });

  it('needs no SUMIT public configuration for CardCom, but never shows an empty SUMIT form without it', () => {
    render(<PackagePaymentView {...base} provider="cardcom" formConfig={null} screen={{ kind: 'form', amount: 149 }} errorMessage={null} />);
    expect(screen.getByTestId('cardcom-form')).toBeTruthy();
    cleanup();
    render(<PackagePaymentView {...base} provider="sumit" formConfig={null} screen={{ kind: 'form', amount: 149 }} errorMessage={null} />);
    expect(screen.queryByTestId('cardcom-form')).toBeNull();
    expect(screen.queryByTestId('card-form')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_disabled);
  });

  it('keeps the SUMIT form when no provider is given (the default)', () => {
    render(<PackagePaymentView {...base} screen={{ kind: 'form', amount: 149 }} errorMessage={null} />);
    expect(screen.getByTestId('card-form')).toBeTruthy();
    expect(screen.queryByTestId('cardcom-form')).toBeNull();
  });

  it('names no payment provider in what the customer reads', () => {
    render(<PackagePaymentView {...base} provider="cardcom" screen={{ kind: 'form', amount: 149 }} errorMessage={null} />);
    expect(document.body.textContent).not.toMatch(/cardcom|sumit|קארדקום|סאמיט/i);
  });
});
