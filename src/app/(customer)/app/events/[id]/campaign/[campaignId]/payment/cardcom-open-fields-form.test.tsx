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

  it('initialises the frames once the master frame has loaded, posting only to CardCom\'s origin', async () => {
    render(<CardcomOpenFieldsForm {...props} />);
    await openSession();
    const post = masterWindow();
    fireEvent.load(frame(OPEN_FIELDS_FRAME_ID.master)!);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatchObject({ action: 'init', lowProfileCode: 'lp-1' });
    expect(post.mock.calls[0][1]).toBe(OPEN_FIELDS_ORIGIN);
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
    expect(post.mock.calls[0][0]).toMatchObject({ action: 'doTransaction', cardOwnerId: VALID_ID, cardOwnerName: 'דנה כהן', cardOwnerEmail: 'dana@example.com', cardOwnerPhone: '0501234567', document: { AddressLine1: ADDRESS, City: CITY, Mobile: '0501234567' }, expirationMonth: '12', expirationYear: '39', numberOfPayments: '1' });
    expect(post.mock.calls[0][1]).toBe(OPEN_FIELDS_ORIGIN);
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
    expect(post.mock.calls[0][1]).toBe(OPEN_FIELDS_ORIGIN);
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
    expect(post.mock.calls[0][1]).toBe(OPEN_FIELDS_ORIGIN);
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
    expect(JSON.parse(callsTo(SETTLE_URL)[0][1].body)).toEqual({ submitted: true });
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

  it('an already-paid answer refreshes the page to the paid screen', async () => {
    answerWith(START_URL, { status: 'already_paid' });
    render(<CardcomOpenFieldsForm {...props} />);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
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
