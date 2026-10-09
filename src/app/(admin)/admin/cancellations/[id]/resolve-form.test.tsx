// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../actions', () => ({ resolveCancellationRequestAction: vi.fn(async () => null) }));

import { resolveCancellationRequestAction } from '../actions';
import { ResolveForm } from './resolve-form';

// The admin's resolution of a cancellation request. When the fee is kept ("חיוב חלקי") the admin may type an AMOUNT or
// choose a PERCENTAGE of a base the server decides (what was charged, or the campaign's ceiling). The percentage mode
// shows the resulting amount live — computed with the very function the server uses — and submits ONLY the
// percentage, never a computed amount. Nothing is sent without a confirmation dialog that says what will happen.

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
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
  await user.click(screen.getByRole('radio', { name: 'ביטול עם דמי ביטול' }));
}

// The main button opens the confirmation dialog; its text is what the admin reads before anything is done.
async function openConfirm(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  await user.click(screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }));
  const dialog = await screen.findByRole('alertdialog');
  return dialog.querySelector('[data-slot="alert-dialog-description"]')?.textContent ?? '';
}

async function submitAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  await openConfirm(user);
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'אישור' }));
  await waitFor(() => expect(resolveCancellationRequestAction).toHaveBeenCalled());
}

describe('ResolveForm — fee as a percentage', () => {
  it('offers the percentage mode only after "ביטול עם דמי ביטול", and only when the server found a base', async () => {
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
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'דמי ביטול של חמישה אחוזים');
    await submitAndConfirm(user);

    const fd = submittedFields();
    expect(fd.get('resolution')).toBe('partial_charge');
    expect(fd.get('resolutionPercent')).toBe('5');
    expect(fd.has('resolutionAmount')).toBe(false);
  });

  it('in amount mode it submits ONLY the amount', async () => {
    const user = setup({ suggestedAmount: 20 });
    await choosePartial(user);
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'דמי ביטול בסכום קבוע');
    await submitAndConfirm(user);

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
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'דמי ביטול של חמישה אחוזים');

    const text = await openConfirm(user);
    expect(resolveCancellationRequestAction).not.toHaveBeenCalled();
    expect(text).toContain('15.00');
    expect(text).toContain('5%');
  });

  it('a refused confirmation sends nothing', async () => {
    const user = setup();
    await choosePartial(user);
    await user.click(screen.getByRole('radio', { name: /אחוז מתוך/ }));
    fireEvent.change(document.getElementById('resolutionPercent') as HTMLInputElement, { target: { value: '5' } });
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'דמי ביטול של חמישה אחוזים');
    await openConfirm(user);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'חזרה לטופס' }));
    expect(resolveCancellationRequestAction).not.toHaveBeenCalled();
  });

  // The dialog replaced the browser's confirm, so the form has no plain submit button any more — but Enter in a number
  // field still submits a form. It must open the confirmation, never reach the server directly.
  it('Enter in the amount field opens the confirmation instead of sending', async () => {
    const user = setup({ suggestedAmount: 20 });
    await choosePartial(user);
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'דמי ביטול בסכום קבוע');
    await user.type(document.getElementById('resolutionAmount') as HTMLInputElement, '{Enter}');
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
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
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'הודעה ללקוח על הביטול');
    return openConfirm(user);
  }

  it('a refund by itself: says so for a full cancellation and for a partial one', async () => {
    const full = await approve(setup({ moneyOutcome: 'credit' }), 'full');
    expect(full).toContain('זיכוי אוטומטי מלא');
    cleanup();
    const partial = await approve(setup({ moneyOutcome: 'credit' }), 'partial');
    expect(partial).toContain('זיכוי אוטומטי של ההפרש');
  });

  it('cannot be refunded: says the approval will fail, promises no refund and does not send the admin to refund by hand', async () => {
    for (const resolution of ['full', 'partial'] as const) {
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
    const partial = await approve(setup({ moneyOutcome: 'none' }), 'partial');
    expect(partial).toContain('לא שולם דבר');
    expect(partial).toContain('ייכשל');
  });

  it('a resolve being resumed: says nothing is refunded again and that the customer is told what really went back', async () => {
    for (const resolution of ['full', 'partial'] as const) {
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
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'הודעה ללקוח על הביטול');
    const text = await openConfirm(user);
    expect(text).toContain('בלי להחזיר שוב');
    expect(text).not.toContain('דמי הביטול:');
    expect(text).not.toContain('5%');
  });

  // An event with no live campaign (it never had one, or every campaign was cancelled): there is nothing to refund and nothing to charge.
  it('no live campaign: a full cancellation says no money moves and the event closes', async () => {
    const text = await approve(setup({ moneyOutcome: 'no_campaign' }), 'full');
    expect(text).toContain('אין קמפיין פעיל');
    expect(text).toContain('לא תהיה תנועה כספית');
    expect(text).not.toContain('יבוצע זיכוי');
    expect(text).not.toContain('יש להחזיר ידנית');
  });

  it('no live campaign: a partial charge says plainly that nothing is charged but the customer is still told of the fee typed', async () => {
    const text = await approve(setup({ moneyOutcome: 'no_campaign' }), 'partial');
    expect(text).toContain('אין קמפיין פעיל');
    expect(text).toContain('לא יחויב דבר');
    expect(text).toContain('הלקוח יקבל הודעה על חיוב');
    expect(text).toContain('ביטול מלא');
    expect(text).not.toContain('יבוצע חיוב אמיתי');
  });

  it('declining a request says the same thing whatever the money state', async () => {
    const user = setup({ moneyOutcome: 'blocked' });
    await user.click(screen.getByRole('radio', { name: 'דחיית הבקשה' }));
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'הבקשה נדחתה מהסיבה הזו');
    expect(await openConfirm(user)).toBe('לדחות את בקשת הביטול?');
  });

  it('no clearing company is named in any confirmation', async () => {
    for (const moneyOutcome of ['capture', 'credit', 'manual', 'none', 'blocked', 'resume', 'no_campaign'] as const) {
      for (const resolution of ['full', 'partial'] as const) {
        expect(await approve(setup({ moneyOutcome }), resolution)).not.toMatch(/SUMIT|CardCom/i);
        cleanup();
      }
    }
  });
});

// Every choice can be taken: a partial refund goes back through either clearing company (CardCom's refund is a token
// transaction with any amount since 9.10.2026), and each choice says what it does.
describe('ResolveForm — the three choices', () => {
  it('each choice can be chosen and is described', async () => {
    const user = setup({ moneyOutcome: 'credit' });
    for (const name of ['ביטול מלא', 'ביטול עם דמי ביטול', 'דחיית הבקשה']) {
      const radio = screen.getByRole('radio', { name });
      expect(radio.getAttribute('aria-disabled')).not.toBe('true');
      expect(document.getElementById(radio.getAttribute('aria-describedby') ?? '')?.textContent?.length).toBeGreaterThan(5);
    }
    await user.click(screen.getByRole('radio', { name: 'ביטול עם דמי ביטול' }));
    expect(document.getElementById('resolutionAmount')).toBeTruthy();
  });
});

// After a failed resolve the screen says whether approving again is safe: "do NOT approve again" (the money may be back)
// must never look like an ordinary "try again".
describe('ResolveForm — what a failure says about trying again', () => {
  async function failWith(result: { error: string; retry?: 'allowed' | 'forbidden' | 'wait' }) {
    vi.mocked(resolveCancellationRequestAction).mockResolvedValue(result as never);
    const user = setup();
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'בוטל');
    await submitAndConfirm(user);
    return screen.findByRole('alert');
  }

  it.each([
    ['allowed', 'לא בוצע — אפשר לנסות שוב'],
    ['forbidden', 'אל תאשרו שוב'],
    ['wait', 'ממתין לסיום ניסיון קודם'],
  ] as const)('%s → "%s", with the message', async (retry, title) => {
    const alert = await failWith({ error: 'הודעת השרת', retry });
    expect(alert.textContent).toContain(title);
    expect(alert.textContent).toContain('הודעת השרת');
  });

  it('a failure with no advice (validation, anything else) is the plain message', async () => {
    const alert = await failWith({ error: 'הודעת השרת' });
    expect(alert.textContent).toBe('הודעת השרת');
  });
});

// While the server works on a resolve, a second click must not send a second one (it would e-mail the customer twice and
// race the refund). useActionState's `pending` locks the button and the dialog's confirm, and the button says so.
describe('ResolveForm — while the server works', () => {
  it('locks the button and shows that it is working, then shows the result above the form', async () => {
    let finish: (value: { error: string }) => void = () => {};
    vi.mocked(resolveCancellationRequestAction).mockImplementation(
      () => new Promise((resolve) => { finish = resolve as typeof finish; }),
    );
    const user = setup();
    await user.type(screen.getByLabelText('הודעה ללקוח (נשלחת במייל)'), 'בוטל');
    await openConfirm(user);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'אישור' }));

    const working = await screen.findByRole('button', { name: /מבצע את הטיפול/ });
    expect((working as HTMLButtonElement).disabled).toBe(true);
    await user.click(working);
    expect(resolveCancellationRequestAction).toHaveBeenCalledTimes(1);

    await act(async () => finish({ error: 'הזיכוי נדחה על ידי חברת הסליקה — לא הוחזר כסף.' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('הזיכוי נדחה');
    // Above the form's fields, where it is seen — not under the button.
    const form = alert.closest('form') as HTMLFormElement;
    expect(form.firstElementChild).toBe(alert);
    expect((screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('ResolveForm — the fee beside the money that goes back', () => {
  it('a refund shows what was paid, the fee and what returns to the card, live', async () => {
    const user = setup({ moneyOutcome: 'credit', feeBase: 120, suggestedAmount: 20, feeBaseLabel: 'הסכום ששולם' });
    await choosePartial(user);
    const cubes = screen.getByRole('status');
    expect(cubes.textContent).toContain('שולם');
    expect(cubes.textContent).toContain('יוחזר לכרטיס');
    expect(cubes.textContent).toMatch(/100/);
    const amount = screen.getByRole('spinbutton');
    await user.clear(amount);
    await user.type(amount, '30');
    expect(screen.getByRole('status').textContent).toMatch(/90/);
  });

  it('a fee that leaves nothing to return cannot be sent, and says why', async () => {
    const user = setup({ moneyOutcome: 'credit', feeBase: 120, suggestedAmount: 20, feeBaseLabel: 'הסכום ששולם' });
    await choosePartial(user);
    const amount = screen.getByRole('spinbutton');
    await user.clear(amount);
    await user.type(amount, '120');
    expect((screen.getByRole('button', { name: 'אישור הטיפול בבקשה' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('דמי הביטול חייבים להיות גדולים מ-0 וקטנים ממה ששולם.')).toBeTruthy();
  });

  it('before anything was charged the amount is a charge: no "returns to the card"', async () => {
    const user = setup({ moneyOutcome: 'capture', feeBase: 300 });
    await choosePartial(user);
    expect(screen.queryByText('יוחזר לכרטיס')).toBeNull();
  });
});
