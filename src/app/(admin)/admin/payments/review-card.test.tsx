// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  probePaymentReviewAction: vi.fn(),
  resolvePaymentReviewAction: vi.fn(),
}));

import { ProbeResultView, ReviewCard } from './review-card';

afterEach(cleanup);

const OP = '11111111-1111-4111-8111-111111111111';
const item = {
  operationId: OP,
  kindLabel: 'רכישת חבילה',
  amount: 120,
  amountLabel: '₪120.00',
  recordedAtLabel: '5.10.2026 13:00',
  eventName: 'החתונה של דנה',
  eventHref: '/admin/events/e1',
  campaignHref: '/app/events/e1/campaign/c1',
  note: 'orphaned: process died mid-flight',
};

describe('ReviewCard', () => {
  it('says what the operation is, how much, for which event, since when, and why it is stuck', () => {
    render(<ReviewCard item={item} />);
    expect(screen.getByRole('heading', { name: /רכישת חבילה/ }).textContent).toContain('₪120.00');
    expect(screen.getByText(/החתונה של דנה/)).toBeTruthy();
    expect(screen.getByText(/5\.10\.2026 13:00/)).toBeTruthy();
    expect(screen.getByText(/orphaned: process died mid-flight/)).toBeTruthy();
  });

  it('both forms carry the operation id as a hidden field, never as something a person types', () => {
    const { container } = render(<ReviewCard item={item} />);
    const hidden = container.querySelectorAll<HTMLInputElement>('input[type="hidden"][name="operationId"]');
    expect(hidden).toHaveLength(2);
    hidden.forEach((h) => expect(h.value).toBe(OP));
  });

  it('offers exactly two decisions, as submit buttons that carry the outcome', () => {
    render(<ReviewCard item={item} />);
    const confirm = screen.getByRole('button', { name: 'אשר גבייה' }) as HTMLButtonElement;
    const failed = screen.getByRole('button', { name: 'סמן ככושלת' }) as HTMLButtonElement;
    expect(confirm.type).toBe('submit');
    expect(confirm.name).toBe('outcome');
    expect(confirm.value).toBe('succeeded');
    expect(failed.type).toBe('submit');
    expect(failed.name).toBe('outcome');
    expect(failed.value).toBe('failed');
  });

  it('asks for the receipt number, the amount actually charged, and a mandatory note', () => {
    render(<ReviewCard item={item} />);
    const doc = screen.getByLabelText(/מספר קבלה/) as HTMLInputElement;
    expect(doc.name).toBe('documentNumber');
    expect(doc.inputMode).toBe('numeric');
    const amount = screen.getByLabelText(/סכום שנגבה בפועל/) as HTMLInputElement;
    expect(amount.name).toBe('amount');
    // The intended amount is shown as a hint, not pre-filled: a blank field means "as intended".
    expect(amount.value).toBe('');
    expect(amount.placeholder).toContain('120');
    const note = screen.getByLabelText(/מה נבדק/) as HTMLTextAreaElement;
    expect(note.name).toBe('note');
    expect(note.required).toBe(true);
    expect(note.minLength).toBe(10);
  });

  it('tells the admin to look at the provider BEFORE confirming', () => {
    render(<ReviewCard item={item} />);
    expect(screen.getByText(/לפני שמאשרים/)).toBeTruthy();
  });

  it('has a lookup button that is a separate form from the decision', () => {
    render(<ReviewCard item={item} />);
    const lookup = screen.getByRole('button', { name: 'בדיקה ב-SUMIT' });
    const decision = screen.getByRole('button', { name: 'אשר גבייה' });
    expect(lookup.closest('form')).not.toBe(decision.closest('form'));
  });

  it('links to the event and the campaign so the admin can see the context', () => {
    render(<ReviewCard item={item} />);
    expect((screen.getByRole('link', { name: /אירוע/ }) as HTMLAnchorElement).getAttribute('href')).toBe('/admin/events/e1');
    expect((screen.getByRole('link', { name: /קמפיין/ }) as HTMLAnchorElement).getAttribute('href')).toBe('/app/events/e1/campaign/c1');
  });
});

describe('ProbeResultView', () => {
  it('a match is a suggestion with the receipt number still to be read off the provider screen', () => {
    render(
      <ProbeResultView
        probe={{ kind: 'found', matches: [{ paymentId: 111, date: '2026-10-05T10:00:07+03:00', amount: 120, authNumber: '0759469', customerId: 5 }] }}
      />,
    );
    const box = screen.getByRole('status');
    expect(within(box).getByText(/נמצא תשלום תואם/)).toBeTruthy();
    expect(within(box).getByText(/0759469/)).toBeTruthy();
    expect(within(box).getByText(/מספר הקבלה אינו מוחזר/)).toBeTruthy();
  });

  it('"not found" still sends the admin to the provider screen before marking a payment as failed', () => {
    render(<ProbeResultView probe={{ kind: 'not_found' }} />);
    expect(screen.getByRole('status').textContent).toMatch(/לא נמצא/);
    expect(screen.getByRole('status').textContent).toMatch(/לאמת/);
  });

  it.each(['credentials', 'provider_error', 'unexpected_response', 'unreachable', 'too_many_pages', 'unsupported'] as const)(
    '"cannot ask" (%s) is never worded as "no payment"',
    (reason) => {
      render(<ProbeResultView probe={{ kind: 'unavailable', reason }} />);
      const text = screen.getByRole('status').textContent ?? '';
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toMatch(/לא נמצא תשלום/);
      cleanup();
    },
  );
});
