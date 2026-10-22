// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SERVICE_STARTING } from '@/lib/payments/package-payment-screen';

import { ManageClient } from './manage-client';

// The manage page's owner actions for a paid package (design D23): the customer is never offered a start. A paid,
// approved campaign is being started by the package-activation job, and the page says so.

afterEach(cleanup);

const action = vi.fn(async () => ({}));
const actions = {
  pause: action,
  close: action,
  cancel: action,
  sendGift: action,
  sendEventDay: action,
  sendThankyou: action,
  updateThankyouSchedule: action,
  rescheduleEvent: action,
};

function manage(status: 'approved' | 'active' | 'paused', paymentStatus: string | null, isPast = false) {
  return render(
    <ManageClient
      campaign={{ id: 'c1', status, price: 150, contact_quota: 100, payment_status: paymentStatus }}
      summary={null}
      delivery={null}
      canEditThankyou={false}
      actions={actions as never}
      eventId="e1"
      authorizedCount={null}
      uniqueContacts={null}
      isPast={isPast}
      viewerIsAdmin={false}
    />,
  );
}

const START_LABEL = /הפעלת (ה)?קמפיין/;

describe('ManageClient — a paid package is never started by the customer (D23)', () => {
  it('paid and approved: says the service is being started, with no start button', () => {
    const { container } = manage('approved', 'collected');
    expect(screen.getByText(SERVICE_STARTING)).toBeTruthy();
    expect(container.textContent).not.toMatch(START_LABEL);
  });

  it('paused by staff: no start button for the customer, and no "being started" sentence', () => {
    const { container } = manage('paused', 'collected');
    expect(container.textContent).not.toMatch(START_LABEL);
    expect(container.textContent).not.toContain(SERVICE_STARTING);
  });

  it('approved, not paid: the way to the payment, nothing about starting', () => {
    const { container } = manage('approved', null);
    expect(screen.getByRole('link', { name: 'המשך לתשלום החבילה' })).toBeTruthy();
    expect(container.textContent).not.toContain(SERVICE_STARTING);
    expect(container.textContent).not.toMatch(START_LABEL);
  });

  it('a past event: nothing about starting, even when paid and approved', () => {
    const { container } = manage('approved', 'collected', true);
    expect(container.textContent).not.toContain(SERVICE_STARTING);
    expect(container.textContent).not.toMatch(START_LABEL);
  });
});
