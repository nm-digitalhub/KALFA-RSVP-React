// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPEN_FIELDS_FRAME_ID, OPEN_FIELDS_ORIGIN } from '@/lib/cardcom/open-fields';
import { PURCHASE_ERROR_MESSAGES } from '@/lib/payments/package-purchase-errors';

const { replaceMock, refreshMock } = vi.hoisted(() => ({ replaceMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: replaceMock, refresh: refreshMock }) }));

import { CardcomOpenFieldsForm } from './cardcom-open-fields-form';

// The buyer's side of a CardCom purchase. What is defended here: the form opens ONE session by itself when it is shown; the card
// fields are CardCom's frames (our page never holds a card number); we speak to the frames only at CardCom's origin and
// listen only to it; and what the buyer is told comes from the SERVER's answer after it asked CardCom — never from what the
// iframe claims.

// A synthetic ID that passes the checksum; it identifies no one.
const VALID_ID = '123456782';
const props = { eventId: 'e1', campaignId: 'c1', amount: 149, defaultName: 'דנה כהן', defaultEmail: 'dana@example.com', defaultPhone: '050-123-4567' };
const ADDRESS = 'הרצל 10';
const CITY = 'תל אביב';
const START_URL = '/api/campaigns/c1/purchase/cardcom';
const SETTLE_URL = '/api/campaigns/c1/purchase/settle';

type Answer = Record<string, unknown>;
let answers: Record<string, Answer[]>;
const fetchMock = vi.fn();

function answerWith(url: string, ...bodies: Answer[]) {
  answers[url] = bodies;
}

beforeEach(() => {
  vi.clearAllMocks();
  answers = {};
  answerWith(START_URL, { status: 'ready', lowProfileId: 'lp-1' });
  answerWith(SETTLE_URL, { state: 'paid', activation: 'started' });
  fetchMock.mockImplementation(async (url: string) => {
    const queue = answers[url] ?? [];
    const body = queue.length > 1 ? queue.shift() : queue[0];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.querySelectorAll('script[data-cardcom-3ds]').forEach((s) => s.remove());
});

const callsTo = (url: string) => fetchMock.mock.calls.filter((c) => c[0] === url);
const frame = (id: string) => document.getElementById(id) as HTMLIFrameElement | null;

// The form opens its session by itself when it is first shown; wait for CardCom's frames.
async function openSession() {
  await waitFor(() => expect(frame(OPEN_FIELDS_FRAME_ID.master)).not.toBeNull());
  // The frames are in the DOM before the effects that listen for their messages have run; a real frame needs time to load,
  // so a message can never arrive that early. Let the effects run before the test plays CardCom's part.
  await act(async () => {});
}

// jsdom does not run a frame; stand in for the master frame's window so we can see what is posted to it.
function masterWindow() {
  const postMessage = vi.fn();
  Object.defineProperty(frame(OPEN_FIELDS_FRAME_ID.master)!, 'contentWindow', { value: { postMessage }, configurable: true });
  return postMessage;
}

const cardcomMessage = (data: unknown, origin = OPEN_FIELDS_ORIGIN) => act(() => { window.dispatchEvent(new MessageEvent('message', { origin, data })); });
// CardCom's master frame tells the page when the buyer has solved the reCAPTCHA in CardCom's captcha frame.
const solveCaptcha = () => cardcomMessage({ action: 'handleValidations', field: 'reCaptcha', isValid: true });
const fill = (label: RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
// Everything a submit needs besides the expiry: the ID, and the address details CardCom's documentation says must accompany it.
function fillDetails() {
  fill(/תעודת זהות/, VALID_ID);
  fill(/כתובת/, ADDRESS);
  fill(/עיר/, CITY);
}

describe('CardcomOpenFieldsForm', () => {
  it('opens exactly one session by itself when shown, so the buyer lands on the card fields without a click', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    expect(callsTo(START_URL)).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'המשך לתשלום' })).toBeNull();
  });

  it('asks the server for a session with a bare POST — no price, no card — and then shows CardCom\'s frames, hidden master included', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    expect(callsTo(START_URL)).toHaveLength(1);
    const [, init] = callsTo(START_URL)[0];
    expect(init.method).toBe('POST');
    expect(init.body ?? '{}').not.toMatch(/amount|price|card/i);
    expect(frame(OPEN_FIELDS_FRAME_ID.master)!.src).toBe('https://secure.cardcom.solutions/api/openfields/master');
    expect(frame(OPEN_FIELDS_FRAME_ID.cardNumber)!.src).toBe('https://secure.cardcom.solutions/api/openfields/cardNumber');
    expect(frame(OPEN_FIELDS_FRAME_ID.cvv)!.src).toBe('https://secure.cardcom.solutions/api/openfields/CVV');
    expect(frame(OPEN_FIELDS_FRAME_ID.captcha)!.src).toBe('https://secure.cardcom.solutions/api/openfields/reCaptcha');
    expect(frame(OPEN_FIELDS_FRAME_ID.master)!.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('script[data-cardcom-3ds]')?.getAttribute('src')).toContain('https://secure.cardcom.solutions/External/OpenFields/3DS.js');
  });

  it('keeps the card fields to CardCom\'s frames: our page has no card-number or CVV input of its own', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const names = Array.from(document.querySelectorAll('input')).map((i) => `${i.name} ${i.id} ${i.autocomplete}`.toLowerCase()).join(' | ');
    expect(names).not.toMatch(/cc-number|cardnumber|cvv|cvc/);
  });

  it('initialises the frames once the master frame has loaded, posting with \'*\' as CardCom\'s sample does', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    fireEvent.load(frame(OPEN_FIELDS_FRAME_ID.master)!);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatchObject({ action: 'init', lowProfileCode: 'lp-1' });
    expect(post.mock.calls[0][1]).toBe('*');
  });

  it('refuses to submit a card that has expired, and says which field, without posting anything', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    fillDetails();
    fill(/חודש/, '01');
    fill(/שנה/, '20');
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect(post).not.toHaveBeenCalled();
    expect((await screen.findByRole('alert')).textContent).toContain('תוקף');
  });

  it('submits the cardholder\'s details to the master frame, and locks the button while it waits', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    solveCaptcha();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatchObject({ action: 'doTransaction', cardOwnerId: VALID_ID, cardOwnerName: 'דנה כהן', cardOwnerEmail: 'dana@example.com', cardOwnerPhone: '0501234567', address: ADDRESS, city: CITY, document: { AddressLine1: ADDRESS, City: CITY, Mobile: '0501234567' }, expirationMonth: '12', expirationYear: '39', numberOfPayments: '1' });
    expect(post.mock.calls[0][1]).toBe('*');
    expect((screen.getByRole('button', { name: /מעבד/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('asks for the cardholder\'s ID, and refuses a missing or invalid one next to the field, focusing it, without posting anything', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    for (const bad of ['', '000000000', '123456789', '12345678']) {
      fill(/תעודת זהות/, bad);
      fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain('תעודת זהות');
      expect(document.activeElement).toBe(screen.getByLabelText(/תעודת זהות/));
      expect(post).not.toHaveBeenCalled();
    }
  });

  it('clears the ID error as soon as the buyer edits the field', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    masterWindow();
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    await screen.findByRole('alert');
    fill(/תעודת זהות/, '1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the phone from the buyer\'s profile, so it need not be retyped — and lets the buyer change it', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    expect((screen.getByLabelText(/טלפון/) as HTMLInputElement).value).toBe('050-123-4567');
    fill(/טלפון/, '052-765-4321');
    expect((screen.getByLabelText(/טלפון/) as HTMLInputElement).value).toBe('052-765-4321');
  });

  it.each([
    ['phone', /טלפון/, 'abc', 'טלפון'],
    ['address', /כתובת/, '', 'כתובת'],
    ['city', /עיר/, ' ', 'עיר'],
  ])('refuses a missing or invalid %s, says which one, and posts nothing', async (_name, label, bad, word) => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    fill(label, bad);
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect((await screen.findByRole('alert')).textContent).toContain(word);
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps the buyer\'s personal details (ID, phone, address, city) off OUR server: they go to CardCom\'s frame only', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    solveCaptcha();
    fillDetails();
    fill(/טלפון/, '052-765-4321');
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect(post.mock.calls[0][0]).toMatchObject({ cardOwnerPhone: '0527654321' });
    expect(post.mock.calls[0][1]).toBe('*');
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    await waitFor(() => expect(callsTo(SETTLE_URL)).toHaveLength(1));
    const bodies = fetchMock.mock.calls.map((c) => String(c[1]?.body ?? '')).join('|');
    for (const secret of [VALID_ID, ADDRESS, CITY, '0527654321', '052-765-4321']) expect(bodies).not.toContain(secret);
  });

  it('sends the ID to CardCom\'s frame exactly as typed — leading zeros kept — and to nobody else', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    solveCaptcha();
    fill(/תעודת זהות/, '000000018');
    fill(/כתובת/, ADDRESS);
    fill(/עיר/, CITY);
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect(post.mock.calls[0][0]).toMatchObject({ cardOwnerId: '000000018' });
    expect(post.mock.calls[0][1]).toBe('*');
    // ...and it never reaches OUR server: no request body of ours carries it.
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    await waitFor(() => expect(callsTo(SETTLE_URL)).toHaveLength(1));
    const bodies = fetchMock.mock.calls.map((c) => String(c[1]?.body ?? ''));
    expect(bodies.join('|')).not.toContain('000000018');
  });

  it('has CardCom\'s captcha frame, under the id AND name its scripts look it up by, with a title for screen readers', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const captcha = frame(OPEN_FIELDS_FRAME_ID.captcha)!;
    expect(captcha.id).toBe('CardComCaptchaIframe');
    expect(captcha.name).toBe('CardComCaptchaIframe');
    expect(captcha.title).toContain('רובוט');
    // CardCom's captcha script hands the token to the master frame by name, so that one is named too.
    expect(frame(OPEN_FIELDS_FRAME_ID.master)!.name).toBe('CardComMasterFrame');
  });

  it('lays the expiry out the way it is printed on the card, month on the left and year on the right, with the keyboard going month then year', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const month = screen.getByLabelText(/חודש/);
    const year = screen.getByLabelText(/שנה/);
    // The pair sits in a left-to-right container, month first: on a right-to-left page that puts the month on the left.
    const pair = month.closest('[dir="ltr"]:not(input)') as HTMLElement;
    expect(pair.contains(year)).toBe(true);
    expect(month.compareDocumentPosition(year) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // ...while each label keeps the page's right-to-left reading.
    expect(screen.getByText('חודש תוקף (MM)').closest('[dir]')?.getAttribute('dir')).toBe('rtl');
  });

  it('will not attempt a payment until the buyer has solved the captcha: says so, and posts nothing', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect((await screen.findByRole('alert')).textContent).toContain('רובוט');
    expect(post).not.toHaveBeenCalled();
    solveCaptcha();
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('counts a captcha only when it comes from CardCom\'s origin and says it is valid', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    cardcomMessage({ action: 'handleValidations', field: 'reCaptcha', isValid: true }, 'https://evil.example');
    cardcomMessage({ action: 'handleValidations', field: 'reCaptcha', isValid: false });
    cardcomMessage({ action: 'handleValidations', field: 'cvv', isValid: true });
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect(post).not.toHaveBeenCalled();
  });

  it('after a decline the new session starts with the captcha unsolved: the buyer does it again', async () => {
    answerWith(SETTLE_URL, { state: 'declined' });
    answerWith(START_URL, { status: 'ready', lowProfileId: 'lp-1' }, { status: 'ready', lowProfileId: 'lp-2' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    solveCaptcha();
    cardcomMessage({ action: 'HandleEror' });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    await waitFor(() => expect(callsTo(START_URL)).toHaveLength(2));
    await waitFor(() => expect(frame(OPEN_FIELDS_FRAME_ID.master)).not.toBeNull());
    await act(async () => {});
    const post = masterWindow();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect(post).not.toHaveBeenCalled();
  });

  it('ignores a "success" that does not come from CardCom\'s origin, and 3DS traffic with no action', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } }, 'https://evil.example');
    cardcomMessage({ some: 'threeDS' });
    expect(callsTo(SETTLE_URL)).toHaveLength(0);
  });

  it('on CardCom\'s "submitted" asks the SERVER — it never believes the message — and shows the paid result when the server says so', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: false, Description: 'whatever the iframe says' } });
    await waitFor(() => expect(callsTo(SETTLE_URL)).toHaveLength(1));
    expect(JSON.parse(callsTo(SETTLE_URL)[0][1].body)).toEqual({ submitted: true, method: 'google_pay' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/events/e1/campaign/c1/payment?paid=1'));
  });

  it('passes on that the automatic start was refused, so the page can show a notice and the start button', async () => {
    answerWith(SETTLE_URL, { state: 'paid', activation: 'failed' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/events/e1/campaign/c1/payment?paid=1&activate=failed'));
  });

  it('settles only once for one submit, however many messages arrive', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    await waitFor(() => expect(callsTo(SETTLE_URL)).toHaveLength(1));
  });

  it('a decline shows the generic sentence (never CardCom\'s) and a button that opens a NEW session', async () => {
    answerWith(SETTLE_URL, { state: 'declined' });
    answerWith(START_URL, { status: 'ready', lowProfileId: 'lp-1' }, { status: 'ready', lowProfileId: 'lp-2' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: false, Description: 'secret provider text' } });
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_declined);
    expect(document.body.textContent).not.toContain('secret provider text');
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    await waitFor(() => expect(callsTo(START_URL)).toHaveLength(2));
  });

  it('when CardCom has not confirmed yet (3D Secure takes a moment) it asks the server again, and shows the paid result when it comes', async () => {
    answerWith(SETTLE_URL, { state: 'in_progress' }, { state: 'error' }, { state: 'paid', activation: 'started' });
    render(<CardcomOpenFieldsForm {...props} pollDelayMs={1} />);
    await openSession();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/events/e1/campaign/c1/payment?paid=1'));
    expect(callsTo(SETTLE_URL)).toHaveLength(3);
  });

  it('after the last try it tells the buyer to wait and NOT to pay again, and refreshes to the ledger\'s view', async () => {
    answerWith(SETTLE_URL, { state: 'in_progress' });
    render(<CardcomOpenFieldsForm {...props} pollDelayMs={1} />);
    await openSession();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_in_progress);
    expect(callsTo(SETTLE_URL)).toHaveLength(6);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('waits between tries but not after the last one: six asks, five waits', async () => {
    const DELAY = 17;
    const timeouts = vi.spyOn(globalThis, 'setTimeout');
    answerWith(SETTLE_URL, { state: 'in_progress' });
    render(<CardcomOpenFieldsForm {...props} pollDelayMs={DELAY} />);
    await openSession();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_in_progress);
    expect(callsTo(SETTLE_URL)).toHaveLength(6);
    expect(timeouts.mock.calls.filter((c) => c[1] === DELAY)).toHaveLength(5);
    timeouts.mockRestore();
  });

  // CardCom's frame reported an error, but CardCom has no payment and names no failed attempt (the server leaves the row pending): there is
  // nothing to wait for. The buyer is told as before and may start over at once — never "a payment is in progress, do not pay again".
  it('after a frame ERROR, a server that still sees nothing failed lets the buyer start over at once, without asking again', async () => {
    answerWith(SETTLE_URL, { state: 'in_progress' });
    answerWith(START_URL, { status: 'ready', lowProfileId: 'lp-1' }, { status: 'ready', lowProfileId: 'lp-2' });
    render(<CardcomOpenFieldsForm {...props} pollDelayMs={1} />);
    await openSession();
    cardcomMessage({ action: 'HandleEror', ResponseCode: 400, message: ['invalid card'] });
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_declined);
    expect(callsTo(SETTLE_URL)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    await waitFor(() => expect(callsTo(START_URL)).toHaveLength(2));
  });

  it('after a frame ERROR of 3D Secure that the server still sees as pending, the 3D Secure sentence is told, as for a decline', async () => {
    answerWith(SETTLE_URL, { state: 'in_progress' });
    render(<CardcomOpenFieldsForm {...props} pollDelayMs={1} />);
    await openSession();
    cardcomMessage({ action: 'HandleEror', ResponseCode: 408 });
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.three_ds_timeout);
    expect(callsTo(SETTLE_URL)).toHaveLength(1);
  });

  it('a review result tells the buyer NOT to pay again, and refreshes the page to the ledger\'s view', async () => {
    answerWith(SETTLE_URL, { state: 'review' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleError' });
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_review);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    // While a person must look at it, paying again is not offered.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['error', 'purchase_failed'],
    ['disabled', 'purchase_disabled'],
    ['not_purchasable', 'bad_state'],
    ['credit_unsupported', 'credit_unsupported'],
    ['event_past', 'event_past'],
    ['event_not_active', 'event_not_active'],
  ])('when the server will not open a session (%s) it says so in its own words and shows no card fields', async (status, key) => {
    answerWith(START_URL, { status });
    render(<CardcomOpenFieldsForm {...props} />);
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES[key as keyof typeof PURCHASE_ERROR_MESSAGES]);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('an already-paid answer (the buyer came back from a redirect) asks the settle route once, bare, and shows the paid screen', async () => {
    answerWith(START_URL, { status: 'already_paid' });
    render(<CardcomOpenFieldsForm {...props} />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/events/e1/campaign/c1/payment?paid=1'));
    expect(callsTo(SETTLE_URL)).toHaveLength(1);
    // It never says "submitted": a returning buyer must not be able to close a session as failed.
    expect(callsTo(SETTLE_URL)[0][1].body).toBeUndefined();
    expect(refreshMock).toHaveBeenCalled();
    // ...and it opens no card fields: there is nothing left to pay.
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('on a return, passes on that the automatic start was refused, so the page shows the notice and the start button', async () => {
    answerWith(START_URL, { status: 'already_paid' });
    answerWith(SETTLE_URL, { state: 'paid', activation: 'failed' });
    render(<CardcomOpenFieldsForm {...props} />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/events/e1/campaign/c1/payment?paid=1&activate=failed'));
  });

  it('on a return, a paid answer whose start was not needed (the webhook or another tab already started the campaign) shows the paid screen without a notice', async () => {
    answerWith(START_URL, { status: 'already_paid' });
    answerWith(SETTLE_URL, { state: 'paid', activation: 'not_needed' });
    render(<CardcomOpenFieldsForm {...props} />);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/events/e1/campaign/c1/payment?paid=1'));
  });

  it.each([
    ['an error', { state: 'error' }],
    ['no session found', { state: 'none' }],
    ['a payment still in progress', { state: 'in_progress' }],
  ])('on a return, %s from the settle route only refreshes to what the ledger says — one call, no loop, no replace', async (_label, settled) => {
    answerWith(START_URL, { status: 'already_paid' });
    answerWith(SETTLE_URL, settled);
    render(<CardcomOpenFieldsForm {...props} />);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(replaceMock).not.toHaveBeenCalled();
    expect(callsTo(SETTLE_URL)).toHaveLength(1);
  });

  it('on a return, a network failure only refreshes: the ledger still decides the screen', async () => {
    answerWith(START_URL, { status: 'already_paid' });
    fetchMock.mockImplementation(async (url: string) => {
      if (url === SETTLE_URL) throw new Error('offline');
      return new Response(JSON.stringify({ status: 'already_paid' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    render(<CardcomOpenFieldsForm {...props} />);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('a network failure is the generic error, not a crash', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    render(<CardcomOpenFieldsForm {...props} />);
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_failed);
    // ...and the buyer can try again from the same screen.
    expect(screen.getByRole('button', { name: 'ניסיון נוסף' })).toBeTruthy();
  });

  it('stops listening for messages when it goes away', async () => {
    const { unmount } = render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    unmount();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    expect(callsTo(SETTLE_URL)).toHaveLength(0);
  });
});

// Google Pay (add-google-pay-cardcom). The page hands the form a terminal only when the SERVER decided to offer the wallet. What is
// defended: the frame is CardCom's own, in the right place and with the payment permission; CardCom is told the buyer's name, email
// and phone before any tap and again after every edit, only valid and only at its origin and only to the MASTER frame; the wallet
// cannot be used until CardCom has the CURRENT details; its result is only ever a reason to ask the server.

const TERMINAL = 172204;
const WALLET_SRC = `https://secure.cardcom.solutions/api/openfields/GooglePay?terminalNumber=${TERMINAL}`;
const walletBlock = () => document.querySelector('[data-testid="google-pay-block"]') as HTMLElement | null;
const walletUnusable = () => walletBlock()?.querySelector('[inert]') !== null;
const detailsPosts = (post: ReturnType<typeof vi.fn>) => post.mock.calls.filter((c) => (c[0] as { action?: string }).action === 'setCardOwnerDetails');

// The master frame has loaded: CardCom's side is ready for the details.
async function masterLoaded(post: ReturnType<typeof vi.fn>) {
  await act(async () => { fireEvent.load(frame(OPEN_FIELDS_FRAME_ID.master)!); });
  return post;
}
const waitForDetails = (post: ReturnType<typeof vi.fn>, count: number) => waitFor(() => expect(detailsPosts(post)).toHaveLength(count), { timeout: 2000 });

describe('CardcomOpenFieldsForm — Google Pay', () => {
  it('shows no wallet at all when the page offered none, and none for a terminal that cannot be an address', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    expect(frame(OPEN_FIELDS_FRAME_ID.googlePay)).toBeNull();
    expect(walletBlock()).toBeNull();
    cleanup();
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={0} />);
    await openSession();
    expect(frame(OPEN_FIELDS_FRAME_ID.googlePay)).toBeNull();
  });

  it('shows CardCom\'s Google Pay frame above the card fields, under the id AND name its scripts use, with the payment permission', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const wallet = frame(OPEN_FIELDS_FRAME_ID.googlePay)!;
    expect(wallet.id).toBe('CardComGooglePay');
    expect(wallet.name).toBe('CardComGooglePay');
    expect(wallet.src).toBe(WALLET_SRC);
    // Both permission attributes, as CardCom's article for the terminal setting asks.
    expect(wallet.getAttribute('allow')).toBe('payment');
    expect(wallet.getAttribute('allowpaymentrequest')).toBe('true');
    expect(wallet.title).toContain('Google Pay');
    expect(wallet.compareDocumentPosition(frame(OPEN_FIELDS_FRAME_ID.cardNumber)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives the payment permission to the Google Pay frame and to no other frame', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const withPermission = Array.from(document.querySelectorAll('iframe')).filter((f) => f.hasAttribute('allow') || f.hasAttribute('allowpaymentrequest')).map((f) => f.id);
    expect(withPermission).toEqual(['CardComGooglePay']);
  });

  it('is unusable until CardCom has the details, then tells the MASTER frame who the buyer is — valid, at CardCom\'s origin only', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    const walletPost = vi.fn();
    Object.defineProperty(frame(OPEN_FIELDS_FRAME_ID.googlePay)!, 'contentWindow', { value: { postMessage: walletPost }, configurable: true });
    await masterLoaded(post);
    expect(walletUnusable()).toBe(true);
    await waitForDetails(post, 1);
    expect(detailsPosts(post)[0][0]).toEqual({
      action: 'setCardOwnerDetails',
      data: {
        CardOwnerName: 'דנה כהן', CardOwnerEmail: 'dana@example.com', CardOwnerPhone: '0501234567',
        cardOwnerName: 'דנה כהן', cardOwnerEmail: 'dana@example.com', cardOwnerPhone: '0501234567',
      },
    });
    // exactly CardCom's documented call: `postMessage({ action: 'setCardOwnerDetails', data }, '*')`, to the master frame
    expect(detailsPosts(post)[0][1]).toBe('*');
    // never to the Google Pay frame
    expect(walletPost).not.toHaveBeenCalled();
    await waitFor(() => expect(walletUnusable()).toBe(false));
  });

  it('makes the wallet unusable in the same render as an edit, and sends the new value before it is usable again', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    await masterLoaded(post);
    await waitForDetails(post, 1);
    await waitFor(() => expect(walletUnusable()).toBe(false));
    fill(/אימייל/, 'dana.new@example.com');
    expect(walletUnusable()).toBe(true);
    await waitForDetails(post, 2);
    expect(detailsPosts(post)[1][0]).toMatchObject({ data: { CardOwnerEmail: 'dana.new@example.com', cardOwnerEmail: 'dana.new@example.com' } });
    await waitFor(() => expect(walletUnusable()).toBe(false));
  });

  // CardCom's master frame puts the session's own name and e-mail into its state when it loads the session's settings (and then hands
  // the wallet frame a snapshot of that state), which is AFTER the first send if the settings are slow: what the buyer typed must go again.
  it('sends the details again once CardCom says the session\'s settings are loaded — once per session — and keeps the wallet unusable until it has', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    await masterLoaded(post);
    await waitForDetails(post, 1);
    await waitFor(() => expect(walletUnusable()).toBe(false));
    cardcomMessage({ action: 'initialized', lowProfileCode: 'lp-1', isGooglePayAvailable: true });
    expect(walletUnusable()).toBe(true);
    await waitForDetails(post, 2);
    expect(detailsPosts(post)[1][0]).toEqual(detailsPosts(post)[0][0]);
    await waitFor(() => expect(walletUnusable()).toBe(false));
    // CardCom announces it again as each wallet frame reports its status: no third send.
    cardcomMessage({ action: 'initialized', lowProfileCode: 'lp-1', isGooglePayAvailable: true });
    cardcomMessage({ action: 'initialized', lowProfileCode: 'lp-1' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(detailsPosts(post)).toHaveLength(2);
  });

  it('ignores a "settings loaded" signal from another origin', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    await masterLoaded(post);
    await waitForDetails(post, 1);
    cardcomMessage({ action: 'initialized' }, 'https://evil.example');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
    expect(detailsPosts(post)).toHaveLength(1);
  });

  it('sends the phone in its plain local form, as it does for a card', async () => {
    render(<CardcomOpenFieldsForm {...props} defaultPhone="+972 52-765-4321" googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    await masterLoaded(post);
    await waitForDetails(post, 1);
    expect(detailsPosts(post)[0][0]).toMatchObject({ data: { CardOwnerPhone: '0527654321', cardOwnerPhone: '0527654321' } });
  });

  it.each([
    ['name', /שם בעל הכרטיס/, '', 'שם בעל הכרטיס'],
    ['email', /אימייל/, 'not-an-email', 'אימייל תקין'],
    ['phone', /טלפון/, 'abc', 'טלפון נייד תקין'],
  ])('with an invalid %s it says which detail is missing, stays unusable and sends nothing', async (_name, label, bad, sentence) => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    fill(label, bad);
    await masterLoaded(post);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(detailsPosts(post)).toHaveLength(0);
    expect(walletUnusable()).toBe(true);
    expect(document.getElementById('google-pay-hint')?.textContent).toContain(sentence);
  });

  it('names every missing detail at once', async () => {
    render(<CardcomOpenFieldsForm {...props} defaultName="" defaultEmail="" defaultPhone="" googlePayTerminal={TERMINAL} />);
    await openSession();
    const hint = document.getElementById('google-pay-hint')?.textContent ?? '';
    for (const sentence of ['שם בעל הכרטיס', 'אימייל תקין', 'טלפון נייד תקין']) expect(hint).toContain(sentence);
  });

  it('sends the details again when the master frame reloads: a reloaded frame knows nothing', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    await masterLoaded(post);
    await waitForDetails(post, 1);
    await masterLoaded(post);
    await waitForDetails(post, 2);
  });

  it('treats a result from the Google Pay frame like a card\'s: it only asks the SERVER, and shows the payment as in flight', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    masterWindow();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true, Description: 'whatever the wallet says' } });
    await waitFor(() => expect(callsTo(SETTLE_URL)).toHaveLength(1));
    expect(JSON.parse(callsTo(SETTLE_URL)[0][1].body)).toEqual({ submitted: true, method: 'google_pay' });
    expect(screen.getByRole('button', { name: /מעבד/ })).toBeTruthy();
    expect(walletUnusable()).toBe(true);
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/events/e1/campaign/c1/payment?paid=1'));
  });

  it('ignores a wallet "success" from another origin, and 3DS traffic with no action', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } }, 'https://evil.example');
    cardcomMessage({ some: 'threeDS' });
    expect(callsTo(SETTLE_URL)).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /מעבד/ })).toBeNull();
  });

  it('is unusable while a card payment is in flight', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    await masterLoaded(post);
    await waitForDetails(post, 1);
    await waitFor(() => expect(walletUnusable()).toBe(false));
    solveCaptcha();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    expect(walletUnusable()).toBe(true);
  });

  it('leaves the card payment exactly as it was: the same doTransaction, to the master frame, at CardCom\'s origin', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    solveCaptcha();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    const charge = post.mock.calls.filter((c) => (c[0] as { action?: string }).action === 'doTransaction');
    expect(charge).toHaveLength(1);
    expect(charge[0][0]).toMatchObject({ cardOwnerId: VALID_ID, numberOfPayments: '1' });
    expect(charge[0][1]).toBe('*');
  });
});

// 3D Secure (found 18.10.2026 reading CardCom's own scripts). CardCom's `3DS.js` must be on the page BEFORE its frames exist, because the
// master frame asks this page for the screen's size the moment it initialises and starts every 3D Secure step by posting to it. The page
// also tells the buyer what the wait is, and does not call a 3D Secure timeout or refusal "the card was declined".
describe('CardcomOpenFieldsForm — 3D Secure', () => {
  const script = () => document.querySelectorAll('script[data-cardcom-3ds]');
  const BANK_CHECK = 'מאמתים את התשלום מול הבנק. אל תסגרו את העמוד ואל תלחצו שוב.';

  it('puts CardCom\'s 3D Secure script on the page as soon as the form is shown — before the session opens and before any frame exists', () => {
    render(<CardcomOpenFieldsForm {...props} />);
    // Synchronously after the first render: no fetch has answered, so no frame has been drawn yet.
    expect(frame(OPEN_FIELDS_FRAME_ID.master)).toBeNull();
    expect(script()).toHaveLength(1);
    expect(script()[0].getAttribute('src')).toContain('https://secure.cardcom.solutions/External/OpenFields/3DS.js');
  });

  it('adds it once however many times the form is shown, and never twice for a new session', async () => {
    answerWith(START_URL, { status: 'ready', lowProfileId: 'lp-1' }, { status: 'ready', lowProfileId: 'lp-2' });
    answerWith(SETTLE_URL, { state: 'declined' });
    const { unmount } = render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleEror', ResponseCode: 400 });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    await waitFor(() => expect(callsTo(START_URL)).toHaveLength(2));
    expect(script()).toHaveLength(1);
    unmount();
    render(<CardcomOpenFieldsForm {...props} />);
    expect(script()).toHaveLength(1);
  });

  // One sentence for every step (owner, 18.10.2026): CardCom never says when the bank's own window has closed, so the old "complete it in
  // the window that opened" stayed on screen after the buyer had entered the code.
  it('tells the buyer to wait while the bank checks — one sentence for every step, never "complete it in the window" — and stops when it is over', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    expect(screen.queryByText(BANK_CHECK)).toBeNull();
    cardcomMessage({ action: 'StartDeviceFingerPrint', params: { _3ds_trxid: 'abc', _3ds_method: 'https://acs.example/m' } });
    expect((await screen.findByText(BANK_CHECK)).getAttribute('role')).toBe('status');
    cardcomMessage({ action: 'CardHolderChallenge', params: 'https://acs.example/c' });
    expect(screen.getByText(BANK_CHECK)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/בחלון שנפתח|הבנק מבקש אימות/);
    cardcomMessage({ action: 'CloseCardHolderChallenge' });
    await waitFor(() => expect(screen.queryByText(BANK_CHECK)).toBeNull());
    expect(document.body.textContent).not.toMatch(/acs\.example|abc/);
  });

  it('shows no 3D Secure status, and locks nothing, for a step announced from another origin', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'StartDeviceFingerPrint' }, 'https://evil.example');
    cardcomMessage('ThreeDSecureDeviceFingerprintResult_{"ResponseCode":1}');
    expect(screen.queryByText(BANK_CHECK)).toBeNull();
    expect((screen.getByRole('button', { name: /^שלם/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('clears the status when CardCom reports a result or an error', async () => {
    answerWith(SETTLE_URL, { state: 'in_progress' });
    render(<CardcomOpenFieldsForm {...props} pollDelayMs={1} />);
    await openSession();
    cardcomMessage({ action: 'StartDeviceFingerPrint' });
    await screen.findByText(BANK_CHECK);
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    await waitFor(() => expect(screen.queryByText(BANK_CHECK)).toBeNull());
  });

  // The defect of 18.10.2026: a wallet payment's 3D Secure left the form "ready", so Google Pay and "pay" still worked while the bank was
  // checking, and a second tap started another payment over the one in CardCom's single payment state — the bank asked again.
  it('locks the whole form from the first 3D Secure step of a Google Pay payment — the wallet, "pay" and every field — until the server settles a result', async () => {
    render(<CardcomOpenFieldsForm {...props} googlePayTerminal={TERMINAL} />);
    await openSession();
    const post = masterWindow();
    await masterLoaded(post);
    await waitForDetails(post, 1);
    await waitFor(() => expect(walletUnusable()).toBe(false));
    solveCaptcha();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    // the wallet's payment reached the bank: CardCom's master frame announces the device check, then the cardholder's own check
    cardcomMessage({ action: 'StartDeviceFingerPrint' });
    expect(walletUnusable()).toBe(true);
    const busy = screen.getByRole('button', { name: /מעבד/ }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect((screen.getByLabelText(/שם בעל הכרטיס/) as HTMLInputElement).disabled).toBe(true);
    cardcomMessage({ action: 'CardHolderChallenge', params: 'https://acs.example/c' });
    // CardCom never announces that the bank's window closed; even if something did, the payment is still under way
    cardcomMessage({ action: 'CloseCardHolderChallenge' });
    expect(walletUnusable()).toBe(true);
    fireEvent.submit(busy.closest('form')!);
    expect(post.mock.calls.some((c) => (c[0] as { action?: string }).action === 'doTransaction')).toBe(false);
    expect(callsTo(SETTLE_URL)).toHaveLength(0);
    // the result is settled exactly as before
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/events/e1/campaign/c1/payment?paid=1'));
    expect(JSON.parse(callsTo(SETTLE_URL)[0][1].body as string)).toEqual({ submitted: true, method: 'google_pay' });
  });

  it('keeps a card payment that reached 3D Secure in flight, as it was', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    solveCaptcha();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    cardcomMessage({ action: 'CardHolderChallenge', params: 'https://acs.example/c' });
    expect(screen.getByText(BANK_CHECK)).toBeTruthy();
    expect((screen.getByRole('button', { name: /מעבד/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(post.mock.calls.filter((c) => (c[0] as { action?: string }).action === 'doTransaction')).toHaveLength(1);
  });

  it.each([
    [408, 'three_ds_timeout'],
    [333, 'three_ds_failed'],
  ] as const)('a 3D Secure error (code %i) that the server settles as declined is told as its own sentence, not as a declined card', async (code, key) => {
    answerWith(SETTLE_URL, { state: 'declined' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'StartDeviceFingerPrint' });
    cardcomMessage({ action: 'HandleEror', ResponseCode: code, message: 'whatever CardCom says' });
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES[key]);
    expect(document.body.textContent).not.toContain('whatever CardCom says');
    expect(document.body.textContent).not.toContain(PURCHASE_ERROR_MESSAGES.purchase_declined);
    // the buyer can still try again, with a new session
    expect(screen.getByRole('button', { name: 'ניסיון נוסף' })).toBeTruthy();
  });

  it.each([[400], [null], [500]] as const)('any other error code (%j) that the server settles as declined keeps the declined sentence', async (code) => {
    answerWith(SETTLE_URL, { state: 'declined' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleEror', ...(code === null ? {} : { ResponseCode: code }) });
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_declined);
  });

  it('forgets the code once it was used: the next plain decline is told as a decline', async () => {
    answerWith(START_URL, { status: 'ready', lowProfileId: 'lp-1' }, { status: 'ready', lowProfileId: 'lp-2' });
    answerWith(SETTLE_URL, { state: 'declined' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleEror', ResponseCode: 408 });
    expect((await screen.findByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.three_ds_timeout);
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    await waitFor(() => expect(callsTo(START_URL)).toHaveLength(2));
    await waitFor(() => expect(frame(OPEN_FIELDS_FRAME_ID.master)).not.toBeNull());
    await act(async () => {});
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: false } });
    await waitFor(() => expect((screen.getByRole('alert')).textContent).toBe(PURCHASE_ERROR_MESSAGES.purchase_declined));
  });

  it('writes only step names and a numeric code to the browser console: no text from CardCom, no address, no card', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    answerWith(SETTLE_URL, { state: 'declined' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'StartDeviceFingerPrint', params: { _3ds_trxid: 'abc' } });
    cardcomMessage({ action: 'HandleEror', ResponseCode: 408, message: 'secret detail' });
    await screen.findByRole('alert');
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).toContain('fingerprint');
    expect(logged).toContain('408');
    for (const never of ['abc', 'secret detail', 'dana@example.com', VALID_ID]) expect(logged).not.toContain(never);
    info.mockRestore();
    warn.mockRestore();
  });

  // The browser's report of an error, told to the server with the settlement so a failed row says which branch of CardCom's 3D Secure
  // fired: the error's code, the last step and the label of its fixed sentence. Labels and numbers only; it decides nothing.
  it('tells the server what it saw when CardCom reported a 3D Secure error: the code, the last step and the label of the sentence', async () => {
    answerWith(SETTLE_URL, { state: 'declined' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'StartDeviceFingerPrint', params: { _3ds_trxid: 'abc', _3ds_method: 'https://acs.example/m' } });
    cardcomMessage({ action: 'HandleEror', ResponseCode: 333, message: '3DS אימות נכשל' });
    await screen.findByRole('alert');
    const body = callsTo(SETTLE_URL)[0][1].body as string;
    expect(JSON.parse(body)).toEqual({ submitted: true, method: 'google_pay', threeDs: { code: 333, step: 'fingerprint', reason: 'fail_auth' } });
    expect(body).not.toMatch(/abc|acs\.example/);
  });

  it('reports a sentence it does not know as a code alone, and never passes on CardCom\'s text', async () => {
    answerWith(SETTLE_URL, { state: 'declined' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'HandleEror', ResponseCode: 333, message: 'secret detail 4580-1234' });
    await screen.findByRole('alert');
    const body = callsTo(SETTLE_URL)[0][1].body as string;
    expect(JSON.parse(body)).toEqual({ submitted: true, method: 'google_pay', threeDs: { code: 333 } });
    expect(body).not.toContain('secret');
  });

  it('sends no 3D Secure report with a payment that went through, even after the bank checked the device', async () => {
    answerWith(SETTLE_URL, { state: 'paid', activation: 'started' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'StartDeviceFingerPrint' });
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: true } });
    await waitFor(() => expect(callsTo(SETTLE_URL)).toHaveLength(1));
    expect(JSON.parse(callsTo(SETTLE_URL)[0][1].body as string)).toEqual({ submitted: true, method: 'google_pay' });
  });

  // A card is only ever submitted from this form; a result that arrives with none submitted is a wallet's. Told to the server so a failed
  // payment says which way the buyer was paying (CardCom reports the channel itself only for a payment that went through).
  it('tells the server the buyer was paying by CARD when the form submitted the card, and by GOOGLE PAY when a result arrives with none submitted', async () => {
    answerWith(START_URL, { status: 'ready', lowProfileId: 'lp-1' }, { status: 'ready', lowProfileId: 'lp-2' });
    answerWith(SETTLE_URL, { state: 'declined' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    masterWindow();
    fillDetails();
    fill(/חודש/, '12');
    fill(/שנה/, '39');
    cardcomMessage({ action: 'handleValidations', field: 'reCaptcha', isValid: true });
    fireEvent.click(screen.getByRole('button', { name: /^שלם/ }));
    cardcomMessage({ action: 'HandleEror', ResponseCode: 333, message: '3DS אימות נכשל' });
    await screen.findByRole('alert');
    expect(JSON.parse(callsTo(SETTLE_URL)[0][1].body as string)).toMatchObject({ submitted: true, method: 'card', threeDs: { code: 333, reason: 'fail_auth' } });
    // the next session: a result with no card submitted
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    await waitFor(() => expect(callsTo(START_URL)).toHaveLength(2));
    await waitFor(() => expect(frame(OPEN_FIELDS_FRAME_ID.master)).not.toBeNull());
    await act(async () => {});
    cardcomMessage({ action: 'HandleEror', ResponseCode: 333, message: '3DS אימות נכשל' });
    await waitFor(() => expect(callsTo(SETTLE_URL)).toHaveLength(2));
    expect(JSON.parse(callsTo(SETTLE_URL)[1][1].body as string)).toMatchObject({ submitted: true, method: 'google_pay' });
  });

  it('forgets the report once it was used: the next attempt carries only its own', async () => {
    answerWith(START_URL, { status: 'ready', lowProfileId: 'lp-1' }, { status: 'ready', lowProfileId: 'lp-2' });
    answerWith(SETTLE_URL, { state: 'declined' });
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    cardcomMessage({ action: 'StartDeviceFingerPrint' });
    cardcomMessage({ action: 'HandleEror', ResponseCode: 333, message: '3DS שגיאת אימות' });
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'ניסיון נוסף' }));
    await waitFor(() => expect(callsTo(START_URL)).toHaveLength(2));
    await waitFor(() => expect(frame(OPEN_FIELDS_FRAME_ID.master)).not.toBeNull());
    await act(async () => {});
    cardcomMessage({ action: 'HandleSubmit', data: { IsSuccess: false } });
    await waitFor(() => expect(callsTo(SETTLE_URL)).toHaveLength(2));
    expect(JSON.parse(callsTo(SETTLE_URL)[1][1].body as string)).toEqual({ submitted: true, method: 'google_pay' });
  });
});
