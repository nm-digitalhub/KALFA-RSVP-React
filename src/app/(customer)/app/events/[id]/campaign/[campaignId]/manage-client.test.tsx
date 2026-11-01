// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function manage(
  status: 'approved' | 'active' | 'paused',
  paymentStatus: string | null,
  isPast = false,
  viewerIsAdmin = false,
) {
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
      viewerIsAdmin={viewerIsAdmin}
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

// The stage badge in the viewer's words (design D8): paid but not yet started is "השירות מופעל" to the customer — who
// never sees an activation (D4) — and stays "ממתין להפעלה" for staff, who open the same page.
describe('ManageClient — the stage badge', () => {
  const badge = () => within(screen.getByRole('region', { name: 'מצב השירות' }));

  it('a paid start still pending reads as the service starting, for the customer', () => {
    manage('approved', 'collected');
    expect(badge().getByText('השירות מופעל')).toBeTruthy();
    expect(badge().queryByText('ממתין להפעלה')).toBeNull();
  });

  it('the same stage keeps the staff wording for staff', () => {
    manage('approved', 'collected', false, true);
    expect(badge().getByText('ממתין להפעלה')).toBeTruthy();
  });
});

// The thank-you schedule form shows the schedule's own field messages (it showed only a form-level line before, so a
// date without a time failed with nothing on screen).
describe('ManageClient — the thank-you schedule form shows its field messages', () => {
  it('a date without a time shows the schema message under the date', async () => {
    const message = 'יש למלא גם תאריך וגם שעה, או להשאיר את שניהם ריקים';
    const updateThankyouSchedule = vi.fn(async () => ({
      validationErrors: { formErrors: [], fieldErrors: { send_date: [message] } },
    }));
    render(
      <ManageClient
        campaign={{ id: 'c1', status: 'active', price: 150, contact_quota: 100, payment_status: 'collected' }}
        summary={null}
        delivery={null}
        thankyou={{ autoEnabled: true, sendAt: null, sentAt: null }}
        canEditThankyou
        actions={{ ...actions, updateThankyouSchedule } as never}
        eventId="e1"
        authorizedCount={null}
        uniqueContacts={null}
        viewerIsAdmin={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'עדכון לוח זמנים' }));
    });

    expect(updateThankyouSchedule).toHaveBeenCalledTimes(1);
    expect(screen.getByText(message)).toBeTruthy();
  });
});
