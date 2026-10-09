// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./actions', () => ({
  probePaymentReviewAction: vi.fn(),
  resolvePaymentReviewAction: vi.fn(),
}));

import { TERMINAL_CONFLICT_NOTICE } from '@/lib/payments/terminal-conflict-copy';

import { ProbeResultView, ReviewCard, type CardcomReviewFacts } from './review-card';

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

// A CardCom payment is checked in CardCom's own panel: there is no lookup to run from the card, it names no SUMIT screen, and a payment
// CardCom places on another terminal than the one it was opened on cannot be approved from here.
describe('ReviewCard - a CardCom payment', () => {
  const facts: CardcomReviewFacts = { isTest: false, terminalOpenedOn: '1001', terminalReported: 'לא דווח', reportedConflicts: false, documentNumber: '77', authRef: '0123456', paymentId: '555' };
  const cardcomItem = (over: Partial<CardcomReviewFacts> = {}) => ({ ...item, cardcom: { ...facts, ...over } });

  it('shows where the payment was opened, where CardCom says it went, and the references to find it by', () => {
    const { container } = render(<ReviewCard item={cardcomItem()} />);
    const text = container.textContent ?? '';
    expect(text).toContain('מסוף שבו נפתח התשלום');
    expect(text).toContain('1001');
    expect(text).toContain('לא דווח');
    expect(text).toContain('555');
    expect(text).toContain('0123456');
    expect(text).toContain('77');
  });

  it('says out loud what it does not have', () => {
    const { container } = render(<ReviewCard item={cardcomItem({ paymentId: null, authRef: null, documentNumber: null, terminalOpenedOn: 'לא נרשם' })} />);
    const text = container.textContent ?? '';
    expect(text).toContain('לא נרשם');
    // Three references, three "not received" - one wording for all of them.
    expect(text.match(/לא התקבל(?!ה)/g)).toHaveLength(3);
  });

  it('calls the card authorisation "מספר אישור" - what the CardCom screen calls it - and never the old name', () => {
    const { container } = render(<ReviewCard item={cardcomItem()} />);
    expect(container.textContent).toContain('מספר אישור');
    expect(container.textContent).not.toContain('אסמכתה');
  });

  it('has no SUMIT lookup and names no SUMIT screen anywhere', () => {
    const { container } = render(<ReviewCard item={cardcomItem()} />);
    expect(screen.queryByRole('button', { name: 'בדיקה ב-SUMIT' })).toBeNull();
    expect(container.textContent).not.toMatch(/SUMIT/);
    expect(container.querySelectorAll('input[type="hidden"][name="operationId"]')).toHaveLength(1);
  });

  it('tells the admin to look in CardCom\'s own panel BEFORE confirming, and asks what was checked there', () => {
    render(<ReviewCard item={cardcomItem()} />);
    expect(screen.getByText(/לפני שמאשרים: לוודא בלוח של CardCom/)).toBeTruthy();
    expect((screen.getByLabelText(/מה נבדק בלוח של CardCom/) as HTMLTextAreaElement).required).toBe(true);
    expect(screen.getByLabelText(/מספר מסמך \(מ-CardCom\)/)).toBeTruthy();
  });

  it('pre-fills the document number CardCom gave, to be confirmed; empty when there is none', () => {
    render(<ReviewCard item={cardcomItem()} />);
    expect((screen.getByLabelText(/מספר מסמך/) as HTMLInputElement).value).toBe('77');
    cleanup();
    render(<ReviewCard item={cardcomItem({ documentNumber: null })} />);
    expect((screen.getByLabelText(/מספר מסמך/) as HTMLInputElement).value).toBe('');
  });

  it('marks a test payment as such (with the shared badge), and a real one not at all', () => {
    render(<ReviewCard item={cardcomItem({ isTest: true })} />);
    const badge = screen.getByText('תשלום בדיקה');
    expect(badge.getAttribute('data-slot')).toBe('badge');
    cleanup();
    render(<ReviewCard item={cardcomItem()} />);
    expect(screen.queryByText('תשלום בדיקה')).toBeNull();
  });

  it('offers both decisions when nothing conflicts', () => {
    render(<ReviewCard item={cardcomItem()} />);
    expect(screen.getByRole('button', { name: 'אשר גבייה' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'סמן ככושלת' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('when CardCom places the payment on ANOTHER terminal the approval is not offered - only "failed" - and the card says why', () => {
    render(<ReviewCard item={cardcomItem({ terminalOpenedOn: '1000', terminalReported: '1001', reportedConflicts: true })} />);
    expect(screen.queryByRole('button', { name: 'אשר גבייה' })).toBeNull();
    expect(screen.getByRole('button', { name: 'סמן ככושלת' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('שונה מהמסוף שבו נפתח התשלום');
  });

  it('on that conflict the alert says what to do with money that really was taken - return it in CardCom BEFORE marking failed', () => {
    render(<ReviewCard item={cardcomItem({ terminalOpenedOn: '1000', terminalReported: '1001', reportedConflicts: true })} />);
    const alert = screen.getByRole('alert').textContent ?? '';
    expect(alert).toContain(TERMINAL_CONFLICT_NOTICE);
    // The order is the point: after "failed" the customer can pay again and the system can no longer refund that row.
    expect(alert.indexOf('להחזיר אותו ידנית בלוח של CardCom')).toBeLessThan(alert.indexOf('סמנו ככושלת'));
  });

  it('on that conflict the sentence above the form speaks of marking failed, not of approving', () => {
    const { container } = render(<ReviewCard item={cardcomItem({ terminalOpenedOn: '1000', terminalReported: '1001', reportedConflicts: true })} />);
    expect(container.textContent).toContain('לפני שמסמנים ככושלת');
    expect(container.textContent).not.toContain('לפני שמאשרים');
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
