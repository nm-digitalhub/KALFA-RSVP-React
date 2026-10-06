// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({ resolveCancellationRequestAction: vi.fn(async () => null) }));

import { resolveCancellationRequestAction } from '../actions';
import { ResolveForm } from './resolve-form';

// The admin's resolution of a cancellation request. When the fee is kept ("חיוב חלקי") the admin may type an AMOUNT or
// choose a PERCENTAGE of a base the server decides (what was charged, or the campaign's ceiling). The percentage mode
// shows the resulting amount live — computed with the very function the server uses — and submits ONLY the
// percentage, never a computed amount.

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

function setup(over: Partial<React.ComponentProps<typeof ResolveForm>> = {}) {
  render(
    <ResolveForm
      requestId="r1"
      suggestedAmount={5}
      moneyOutcome="credit"
      feeBase={300}
      feeBaseLabel="הסכום שחויב"
      {...over}
    />,
  );
  return userEvent.setup();
}

// The form binds the request id, so the mocked action is called as (requestId, previousState, formData).
const submittedFields = (): FormData => {
  const call = vi.mocked(resolveCancellationRequestAction).mock.calls[0] as unknown as [string, unknown, FormData];
  return call[2];
};

async function choosePartial(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'חיוב חלקי' }));
}

describe('ResolveForm — fee as a percentage', () => {
  it('offers the percentage mode only after "חיוב חלקי", and only when the server found a base', async () => {
    const user = setup();
    expect(screen.queryByRole('radio', { name: /אחוז מתוך/ })).toBeNull();
    await choosePartial(user);
    expect(screen.getByRole('radio', { name: /אחוז מתוך/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'סכום בשקלים' })).toBeTruthy();
  });

  it('with no base (an open-ceiling agreement) there is no percentage mode, only the amount', async () => {
    const user = setup({ feeBase: 0 });
    await choosePartial(user);
    expect(screen.queryByRole('radio', { name: /אחוז מתוך/ })).toBeNull();
    expect(document.getElementById('resolutionAmount')).toBeTruthy();
    expect(document.getElementById('resolutionPercent')).toBeNull();
  });

  it('starts in amount mode, with the suggested amount filled in, exactly as before', async () => {
    const user = setup({ suggestedAmount: 12.5 });
    await choosePartial(user);
    const amount = document.getElementById('resolutionAmount') as HTMLInputElement;
    expect(amount.value).toBe('12.50');
    expect(document.getElementById('resolutionPercent')).toBeNull();
  });

  it('in percentage mode shows the amount it comes to, and the base it is taken of', async () => {
    const user = setup();
    await choosePartial(user);
    await user.click(screen.getByRole('radio', { name: /אחוז מתוך/ }));
    await user.type(document.getElementById('resolutionPercent') as HTMLInputElement, '5');
    const preview = screen.getByText(/דמי ביטול:/);
    expect(preview.textContent).toContain('15.00');
    expect(preview.textContent).toContain('300.00');
    expect(preview.textContent).toContain('5%');
  });

  it('rounds the preview like the server: 12.5% of ₪300 is ₪37.50', async () => {
    const user = setup();
    await choosePartial(user);
    await user.click(screen.getByRole('radio', { name: /אחוז מתוך/ }));
    await user.type(document.getElementById('resolutionPercent') as HTMLInputElement, '12.5');
    expect(screen.getByText(/דמי ביטול:/).textContent).toContain('37.50');
  });

  it('shows no amount for an empty or impossible percentage', async () => {
    const user = setup();
    await choosePartial(user);
    await user.click(screen.getByRole('radio', { name: /אחוז מתוך/ }));
    expect(screen.queryByText(/דמי ביטול:/)).toBeNull();
    await user.type(document.getElementById('resolutionPercent') as HTMLInputElement, '150');
    expect(screen.queryByText(/דמי ביטול:/)).toBeNull();
  });

  it('submits ONLY the percentage — no amount field exists in this mode', async () => {
    const user = setup();
    await choosePartial(user);
    await user.click(screen.getByRole('radio', { name: /אחוז מתוך/ }));
    await user.type(document.getElementById('resolutionPercent') as HTMLInputElement, '5');
    await user.type(screen.getByLabelText('הודעה ללקוח'), 'דמי ביטול של חמישה אחוזים');
    await user.click(screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }));

    const fd = submittedFields();
    expect(fd.get('resolution')).toBe('partial_charge');
    expect(fd.get('resolutionPercent')).toBe('5');
    expect(fd.has('resolutionAmount')).toBe(false);
  });

  it('in amount mode it submits ONLY the amount', async () => {
    const user = setup({ suggestedAmount: 20 });
    await choosePartial(user);
    await user.type(screen.getByLabelText('הודעה ללקוח'), 'דמי ביטול בסכום קבוע');
    await user.click(screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }));

    const fd = submittedFields();
    expect(fd.get('resolutionAmount')).toBe('20.00');
    expect(fd.has('resolutionPercent')).toBe(false);
  });

  it('switching back to the amount drops the percentage field again', async () => {
    const user = setup();
    await choosePartial(user);
    await user.click(screen.getByRole('radio', { name: /אחוז מתוך/ }));
    expect(document.getElementById('resolutionPercent')).toBeTruthy();
    await user.click(screen.getByRole('radio', { name: 'סכום בשקלים' }));
    expect(document.getElementById('resolutionPercent')).toBeNull();
    expect(document.getElementById('resolutionAmount')).toBeTruthy();
  });

  it('the confirmation says what the percentage comes to before anything is done', async () => {
    const user = setup();
    await choosePartial(user);
    await user.click(screen.getByRole('radio', { name: /אחוז מתוך/ }));
    await user.type(document.getElementById('resolutionPercent') as HTMLInputElement, '5');
    await user.type(screen.getByLabelText('הודעה ללקוח'), 'דמי ביטול של חמישה אחוזים');
    await user.click(screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }));

    expect(window.confirm).toHaveBeenCalledTimes(1);
    const text = String(vi.mocked(window.confirm).mock.calls[0][0]);
    expect(text).toContain('15.00');
    expect(text).toContain('5%');
  });

  it('a refused confirmation sends nothing', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    const user = setup();
    await choosePartial(user);
    await user.click(screen.getByRole('radio', { name: /אחוז מתוך/ }));
    fireEvent.change(document.getElementById('resolutionPercent') as HTMLInputElement, { target: { value: '5' } });
    await user.type(screen.getByLabelText('הודעה ללקוח'), 'דמי ביטול של חמישה אחוזים');
    await user.click(screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }));
    expect(resolveCancellationRequestAction).not.toHaveBeenCalled();
  });

  // The amount typed under "חיוב חלקי" means two different things. Before the campaign was charged it is what gets
  // CHARGED; once money was paid (a charged campaign, or a fixed-price package) it is what STAYS with us and the rest
  // goes back. The label says which, so the admin never reads "סכום לחיוב" on a screen that is about to refund.
  it('before anything was charged the amount is "סכום לחיוב"', async () => {
    const user = setup({ moneyOutcome: 'capture' });
    await choosePartial(user);
    expect(document.querySelector('label[for="resolutionAmount"]')?.textContent).toContain('סכום לחיוב');
  });

  it.each(['credit', 'manual', 'none', 'blocked'] as const)('once money was paid (%s) the amount is "סכום שנשאר אצלנו" — the rest goes back', async (moneyOutcome) => {
    const user = setup({ moneyOutcome });
    await choosePartial(user);
    const label = document.querySelector('label[for="resolutionAmount"]')?.textContent ?? '';
    expect(label).toContain('סכום שנשאר אצלנו');
    expect(label).not.toContain('סכום לחיוב');
  });

  it('the percentage option names the base it is taken of: "הסכום ששולם" for a package', async () => {
    const user = setup({ feeBaseLabel: 'הסכום ששולם', feeBase: 120 });
    await choosePartial(user);
    expect(screen.getByRole('radio', { name: /אחוז מתוך הסכום ששולם/ })).toBeTruthy();
  });

  it('the other resolutions are unchanged: "ביטול מלא" has no fee field at all', async () => {
    setup();
    expect(document.getElementById('resolutionPercent')).toBeNull();
    expect(document.getElementById('resolutionAmount')).toBeNull();
  });
});

// A fixed-price package is refunded through the payment ledger, so the confirmation must describe exactly what the server
// will do: refund by itself ('credit'), move no money because nothing was paid ('none'), or refuse because it cannot refund
// ('blocked'). It must never promise a refund it cannot make, nor tell the admin to refund by hand when the server refuses.
describe('ResolveForm — confirmation text for a package', () => {
  async function approve(user: ReturnType<typeof userEvent.setup>, resolution: 'full' | 'partial') {
    if (resolution === 'partial') await choosePartial(user);
    await user.type(screen.getByLabelText('הודעה ללקוח'), 'הודעה ללקוח על הביטול');
    await user.click(screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }));
    return String(vi.mocked(window.confirm).mock.calls[0][0]);
  }

  it('a refund by itself: says so for a full cancellation and for a partial one', async () => {
    const full = await approve(setup({ moneyOutcome: 'credit' }), 'full');
    expect(full).toContain('זיכוי אוטומטי מלא');
    cleanup();
    vi.mocked(window.confirm).mockClear();
    const partial = await approve(setup({ moneyOutcome: 'credit' }), 'partial');
    expect(partial).toContain('זיכוי אוטומטי של ההפרש');
  });

  it('cannot be refunded: says the approval will fail, promises no refund and does not send the admin to refund by hand', async () => {
    for (const resolution of ['full', 'partial'] as const) {
      vi.mocked(window.confirm).mockClear();
      const text = await approve(setup({ moneyOutcome: 'blocked' }), resolution);
      expect(text).toContain('אוטומטית');
      expect(text).toContain('ייכשל');
      expect(text).not.toContain('יבוצע זיכוי');
      expect(text).not.toContain('יש להחזיר ידנית');
      cleanup();
    }
  });

  it('nothing was paid: a full cancellation says no money moves; a partial one says it will fail', async () => {
    const full = await approve(setup({ moneyOutcome: 'none' }), 'full');
    expect(full).toContain('לא שולם דבר');
    expect(full).toContain('לא תהיה תנועה כספית');
    expect(full).not.toContain('יבוצע זיכוי');
    cleanup();
    vi.mocked(window.confirm).mockClear();
    const partial = await approve(setup({ moneyOutcome: 'none' }), 'partial');
    expect(partial).toContain('לא שולם דבר');
    expect(partial).toContain('ייכשל');
  });

  it('a resolve being resumed: says nothing is refunded again and that the customer is told what really went back', async () => {
    for (const resolution of ['full', 'partial'] as const) {
      vi.mocked(window.confirm).mockClear();
      const text = await approve(setup({ moneyOutcome: 'resume' }), resolution);
      expect(text).toContain('כבר הוחזר');
      expect(text).toContain('בלי להחזיר שוב');
      expect(text).toContain('בפועל');
      expect(text).not.toContain('יבוצע זיכוי');
      cleanup();
    }
  });

  it('a resolve being resumed ignores the fee typed now, so the confirmation does not repeat it as if it applied', async () => {
    const user = setup({ moneyOutcome: 'resume' });
    await choosePartial(user);
    await user.click(screen.getByRole('radio', { name: /אחוז מתוך/ }));
    fireEvent.change(document.getElementById('resolutionPercent') as HTMLInputElement, { target: { value: '5' } });
    await user.type(screen.getByLabelText('הודעה ללקוח'), 'הודעה ללקוח על הביטול');
    await user.click(screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }));
    const text = String(vi.mocked(window.confirm).mock.calls[0][0]);
    expect(text).toContain('בלי להחזיר שוב');
    expect(text).not.toContain('דמי הביטול:');
    expect(text).not.toContain('5%');
  });

  it('declining a request says the same thing whatever the money state', async () => {
    const user = setup({ moneyOutcome: 'blocked' });
    await user.click(screen.getByRole('radio', { name: 'דחיית הבקשה' }));
    await user.type(screen.getByLabelText('הודעה ללקוח'), 'הבקשה נדחתה מהסיבה הזו');
    await user.click(screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }));
    expect(String(vi.mocked(window.confirm).mock.calls[0][0])).toBe('לדחות את בקשת הביטול?');
  });
});
