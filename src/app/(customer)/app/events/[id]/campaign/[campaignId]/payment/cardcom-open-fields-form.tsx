'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { useRouter } from 'next/navigation';
import { LoaderCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  OPEN_FIELDS_3DS_SCRIPT,
  OPEN_FIELDS_CAPTCHA_FIELD,
  OPEN_FIELDS_FRAME_ID,
  OPEN_FIELDS_FRAME_SRC,
  buildDoTransactionMessage,
  buildInitMessage,
  buildSetCardOwnerDetailsMessage,
  checkWalletDetails,
  googlePayFrameSrc,
  parseFrameMessage,
  postCardOwnerDetails,
  postToFrame,
  threeDsErrorOf,
  validateCardholder,
  type CardholderField,
  type ThreeDsReason,
  type ThreeDsStep,
  type WalletDetailField,
} from '@/lib/cardcom/open-fields';
import { formatAmount } from '@/lib/format';
import { PURCHASE_ERROR_MESSAGES, type PurchaseErrorCode } from '@/lib/payments/package-purchase-errors';

// The card form of a package purchase paid through CardCom Open Fields (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md,
// 4.9). CardCom's card-number and CVV boxes are iframes INSIDE this form, so the card never touches our page's DOM or our
// servers; the rest (owner ID, name, e-mail, expiry) is ours.
//
// What the buyer is told always comes from the SERVER's answer after it asked CardCom — never from what the iframe says:
//   1. the form opens a session as soon as it is shown → POST …/purchase/cardcom (a LowProfileId, nothing else comes back);
//   2. the frames are initialised with that id; the buyer fills the form and solves CardCom's reCAPTCHA frame (the master frame
//      reports it); "pay" posts doTransaction to the master frame;
//   3. CardCom's frame answers HandleSubmit / HandleEror — only a reason to ask the server, via POST …/purchase/settle;
//   4. the server's state (paid / declined / review / in progress) decides the screen.
// The payment page is reached right after the terms are approved, so the session opens by itself and the buyer sees the card
// fields at once. Opening writes a pending ledger row. Every opening of the form gets a NEW session, as CardCom's guide asks ("each
// time you submit a payment form, create a new LowProfile"): coming back to the page (a reload, a second tab) settles the old one
// first — paid → the page shows it; not paid → it is closed as replaced and a new one opens (resolvePending in cardcom-purchase.ts).
// The button stays for a retry.

type Phase = 'opening' | 'ready' | 'paying' | 'declined' | 'failed' | 'waiting';

type StartAnswer = { status?: string; lowProfileId?: string };
type SettleAnswer = { state?: string; activation?: string };

const START_FAILURE: Record<string, PurchaseErrorCode> = {
  error: 'purchase_failed',
  disabled: 'purchase_disabled',
  not_purchasable: 'bad_state',
  credit_unsupported: 'credit_unsupported',
  event_past: 'event_past',
  event_not_active: 'event_not_active',
  // D15: the benefit expired before the session opened — the terms await re-approval at the list price.
  reapproval_required: 'reapproval_required',
};

const FIELD_MESSAGE: Record<CardholderField, string> = {
  ownerId: 'יש להזין תעודת זהות תקינה בת 9 ספרות, כולל אפסים בתחילת המספר.',
  name: 'יש להזין את שם בעל הכרטיס.',
  email: 'יש להזין כתובת אימייל תקינה.',
  phone: 'יש להזין מספר טלפון נייד תקין, למשל 0501234567.',
  address: 'יש להזין כתובת (רחוב ומספר).',
  city: 'יש להזין עיר.',
  month: 'חודש התוקף אינו תקין (שתי ספרות, 01–12).',
  year: 'שנת התוקף אינה תקינה (שתי ספרות).',
  expiry: 'תוקף הכרטיס עבר.',
};

const CAPTCHA_MESSAGE = 'יש לסמן «אני לא רובוט» לפני התשלום.';

// Google Pay (add-google-pay-cardcom, D4). CardCom needs the buyer's name, email and phone before the buyer taps the wallet, because
// Google Pay does not supply them and 3D Secure requires them. The page keeps CardCom's copy current as the buyer edits (after a short
// pause, so typing is not a message per keystroke) and keeps the wallet unusable until the CURRENT values were sent.
const WALLET_DETAILS_DEBOUNCE_MS = 250;
// CardCom's own article for the Google Pay terminal setting says an iframe that shows the wallet must carry BOTH attributes, the
// current `allow="payment"` and the older `allowpaymentrequest="true"` ("add both, on the site's side"), so browsers of either
// generation let the frame open the wallet. Spread, because the older one is not in React's typings for an iframe.
const WALLET_FRAME_PERMISSIONS = { allow: 'payment', allowpaymentrequest: 'true' } as const;
const WALLET_FIELD_LABEL: Record<WalletDetailField, string> = {
  name: 'שם בעל הכרטיס',
  email: 'אימייל תקין',
  phone: 'טלפון נייד תקין',
};

const DEFAULT_POLL_DELAY_MS = 4_000;
const MAX_POLLS = 6;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await res.json()) as T;
}

export function CardcomOpenFieldsForm({
  eventId,
  campaignId,
  amount,
  defaultName,
  defaultEmail,
  defaultPhone = '',
  pollDelayMs = DEFAULT_POLL_DELAY_MS,
  googlePayTerminal = null,
}: {
  eventId: string;
  campaignId: string;
  amount: number;
  defaultName: string;
  defaultEmail: string;
  /** The phone on the buyer's profile, to save typing; the buyer may change it. */
  defaultPhone?: string;
  /** How long to wait between asking the server whether a submitted payment has been confirmed. */
  pollDelayMs?: number;
  /** The CardCom terminal for the Google Pay frame, or null when the page did not offer Google Pay to this buyer. */
  googlePayTerminal?: number | null;
}) {
  const router = useRouter();
  // The form opens its session as soon as it is shown (below), so it starts in 'opening'.
  const [phase, setPhase] = useState<Phase>('opening');
  const [lowProfileId, setLowProfileId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState('');
  const [ownerIdError, setOwnerIdError] = useState<string | null>(null);
  const ownerIdRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(defaultPhone);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  // CardCom's reCAPTCHA frame tells the page (through the master frame) when the buyer has solved it. Whether CardCom then
  // requires the token is its server's decision; the page only makes sure the buyer has done it before a payment is attempted.
  const [captchaSolved, setCaptchaSolved] = useState(false);

  // Google Pay. The terminal comes from the server's decision; an address that cannot be built means no wallet, never a broken frame.
  const walletSrc = googlePayTerminal === null ? null : googlePayFrameSrc(googlePayTerminal);
  const walletDetails = useMemo(() => checkWalletDetails({ name, email, phone }), [name, email, phone]);
  const walletKey = walletDetails.ok ? JSON.stringify(walletDetails.value) : null;
  // What CardCom's master frame was last told, and for which session: derived from the session id, so a new session or a reloaded
  // master frame starts from "nothing sent" without an effect that resets state.
  const [masterLoadedFor, setMasterLoadedFor] = useState<string | null>(null);
  const [walletSent, setWalletSent] = useState<{ session: string; key: string } | null>(null);
  const masterLoaded = lowProfileId !== null && masterLoadedFor === lowProfileId;
  const walletSentKey = walletSent !== null && walletSent.session === lowProfileId ? walletSent.key : null;

  // Which 3D Secure step CardCom's frames announced (the bank checking the device, or asking the cardholder), so the buyer is told
  // what the wait is. The last error code CardCom reported (a number, never its text), so a 3D Secure failure is not told to the
  // buyer as "the card was declined". Both are the browser's word and only shape the sentence: the server still decides the payment.
  const [threeDs, setThreeDs] = useState<ThreeDsStep | null>(null);
  const lastErrorCode = useRef<number | null>(null);
  // What the frames said about 3D Secure, kept to be told to the server with the payment's settlement, where it lands in the failed
  // row's note as the BROWSER's report (never a decision): the last error's code and which of CardCom's fixed sentences came with it,
  // and the last step the bank was on before it ("fingerprint" = the device check, "challenge" = the cardholder's own check).
  const lastErrorReason = useRef<ThreeDsReason | null>(null);
  const lastThreeDsStep = useRef<'fingerprint' | 'challenge' | null>(null);
  // The session whose settings CardCom's master frame has already reported loaded (see the `settingsLoaded` handling below).
  const settingsSeenFor = useRef<string | null>(null);
  // Which way the buyer is paying. A card is only ever submitted from THIS form (submit() below), so a result that arrives with no card
  // submitted is a wallet's: the wallet's button lives in CardCom's own frame, where this page cannot see the tap. Told to the server with
  // the settlement, so a failed payment says whether it was the card or Google Pay that failed (CardCom reports the channel itself only
  // for a payment that went through).
  const cardSubmitted = useRef(false);

  const masterRef = useRef<HTMLIFrameElement>(null);
  const settling = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const payUrl = `/app/events/${eventId}/campaign/${campaignId}/payment`;
  const fail = useCallback((code: PurchaseErrorCode, next: Phase = 'failed') => {
    setMessage(PURCHASE_ERROR_MESSAGES[code]);
    setPhase(next);
    setThreeDs(null);
  }, []);

  // The buyer returned to a payment that is already recorded. One call, no polling: the ledger decides what the page shows, so a
  // failure here only means the screen is drawn from the ledger without the automatic start (its "start now" button covers that).
  const finishReturnedPayment = useCallback(async () => {
    let answer: SettleAnswer;
    try {
      answer = await postJson<SettleAnswer>(`/api/campaigns/${campaignId}/purchase/settle`);
    } catch {
      answer = { state: 'error' };
    }
    if (!mounted.current) return;
    if (answer.state === 'paid') {
      router.replace(`${payUrl}?paid=1${answer.activation === 'failed' ? '&activate=failed' : ''}`);
    }
    router.refresh();
  }, [campaignId, payUrl, router]);

  const openSession = useCallback(async () => {
    setMessage(null);
    setCaptchaSolved(false);
    setThreeDs(null);
    lastErrorCode.current = null;
    lastErrorReason.current = null;
    lastThreeDsStep.current = null;
    cardSubmitted.current = false;
    setPhase('opening');
    try {
      const answer = await postJson<StartAnswer>(`/api/campaigns/${campaignId}/purchase/cardcom`);
      if (!mounted.current) return;
      if (answer.status === 'ready' && typeof answer.lowProfileId === 'string' && answer.lowProfileId !== '') {
        setLowProfileId(answer.lowProfileId);
        setPhase('ready');
      } else if (answer.status === 'already_paid') {
        // CardCom had already settled this session as paid by the time the form opened: the buyer came back from a redirect (3D Secure,
        // a wallet) and no result message will arrive in this page. Ask the settle route once, which starts the campaign if it is
        // still waiting — as it does for an in-page result — and then show what the ledger says.
        void finishReturnedPayment();
      } else if (answer.status === 'in_progress' || answer.status === 'review') {
        fail(answer.status === 'review' ? 'purchase_review' : 'purchase_in_progress', 'waiting');
        router.refresh();
      } else {
        fail(START_FAILURE[answer.status ?? ''] ?? 'purchase_failed');
      }
    } catch {
      if (mounted.current) fail('purchase_failed');
    }
  }, [campaignId, fail, finishReturnedPayment, router]);

  // Open the session once, when the form is first shown. The ref keeps React's development double-run from opening twice.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current) return;
    autoOpened.current = true;
    void openSession();
  }, [openSession]);

  // Asks the server what CardCom says, and shows ITS answer. Once per submit; a payment that CardCom has not confirmed yet
  // (3D Secure takes a moment) is asked about a few more times before the buyer is told to wait.
  const settle = useCallback(async () => {
    if (settling.current) return;
    settling.current = true;
    try {
      // What the frames said about an error, as labels and numbers only. Sent only when CardCom reported an error: it ends up in the
      // note of a row the server closes as failed, as "what the browser reported", and decides nothing.
      const errored = lastErrorCode.current !== null || lastErrorReason.current !== null;
      const threeDs = {
        ...(lastErrorCode.current === null ? {} : { code: lastErrorCode.current }),
        ...(lastThreeDsStep.current === null ? {} : { step: lastThreeDsStep.current }),
        ...(lastErrorReason.current === null ? {} : { reason: lastErrorReason.current }),
      };
      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        let answer: SettleAnswer;
        try {
          answer = await postJson<SettleAnswer>(`/api/campaigns/${campaignId}/purchase/settle`, {
            submitted: true,
            method: cardSubmitted.current ? 'card' : 'google_pay',
            ...(errored ? { threeDs } : {}),
          });
        } catch {
          answer = { state: 'error' };
        }
        if (!mounted.current) return;
        if (answer.state === 'paid') {
          const reason = answer.activation === 'failed' ? '&activate=failed' : '';
          router.replace(`${payUrl}?paid=1${reason}`);
          router.refresh();
          return;
        }
        if (answer.state === 'declined') {
          setLowProfileId(null);
          // A 3D Secure timeout or refusal is the bank's check not completing, not the issuer declining the card: say which.
          const reason = threeDsErrorOf(lastErrorCode.current);
          lastErrorCode.current = null;
          lastErrorReason.current = null;
          lastThreeDsStep.current = null;
          fail(reason ?? 'purchase_declined', 'declined');
          return;
        }
        if (answer.state === 'review') {
          fail('purchase_review', 'waiting');
          router.refresh();
          return;
        }
        await sleep(pollDelayMs);
        if (!mounted.current) return;
      }
      fail('purchase_in_progress', 'waiting');
      router.refresh();
    } finally {
      settling.current = false;
    }
  }, [campaignId, fail, payUrl, pollDelayMs, router]);

  // CardCom's 3D Secure handling is a script that must be on the page BEFORE the frames exist: the master frame asks this page for
  // the screen's size (`GetScreenValues`) the moment it initialises, and starts and ends every 3D Secure step by posting to it,
  // while the script is what answers. CardCom's own sample loads it in <head> at page load. It used to be added only once the
  // frames showed, which left a window where a slow script lost that first request and the bank got a check without browser details.
  useEffect(() => {
    if (document.querySelector('script[data-cardcom-3ds]')) return;
    const script = document.createElement('script');
    script.src = `${OPEN_FIELDS_3DS_SCRIPT}?v=${Date.now()}`;
    script.async = true;
    script.setAttribute('data-cardcom-3ds', '');
    document.head.appendChild(script);
  }, []);

  // What the frames say. Only CardCom's origin is heard (parseFrameMessage); "submitted" and "error" are reasons to ask the server.
  useEffect(() => {
    if (lowProfileId === null) return;
    const onMessage = (event: MessageEvent) => {
      const frameMessage = parseFrameMessage({ origin: event.origin, data: event.data });
      if (frameMessage?.kind === 'threeDs') {
        // Names of steps only: nothing the bank or CardCom sent along with them is read. `console.info` is for whoever has the
        // browser's console open while a payment is not going through; it carries no card, person or address.
        console.info('[payment] 3D Secure step:', frameMessage.step);
        if (frameMessage.step !== 'closed') lastThreeDsStep.current = frameMessage.step;
        setThreeDs(frameMessage.step === 'closed' ? null : frameMessage.step);
      } else if (frameMessage?.kind === 'submit' || frameMessage?.kind === 'error') {
        if (frameMessage.kind === 'error') {
          lastErrorCode.current = frameMessage.code;
          lastErrorReason.current = frameMessage.reason;
          console.warn('[payment] CardCom reported an error, code:', frameMessage.code, 'reason:', frameMessage.reason);
        }
        setThreeDs(null);
        // A result that arrives while the form still says "ready" is a wallet's (a card is only ever submitted from here, which
        // already moved to "paying"): show the same in-flight state, then ask the server like every other result.
        setPhase((current) => (current === 'ready' ? 'paying' : current));
        void settle();
      } else if (frameMessage?.kind === 'settingsLoaded') {
        // Once per session: CardCom has just put the session's own name and e-mail into its state (and handed the wallet a snapshot of
        // it), so what was sent before is no longer what it holds. Forgetting what was sent makes the details go again, current, and
        // keeps the wallet unusable until they have.
        if (settingsSeenFor.current !== lowProfileId) {
          settingsSeenFor.current = lowProfileId;
          setWalletSent(null);
        }
      } else if (frameMessage?.kind === 'validation' && frameMessage.field === OPEN_FIELDS_CAPTCHA_FIELD) setCaptchaSolved(frameMessage.valid);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [lowProfileId, settle]);

  const initFrames = useCallback(() => {
    const frame = masterRef.current?.contentWindow;
    if (frame && lowProfileId) postToFrame(frame, buildInitMessage({ lowProfileCode: lowProfileId }));
  }, [lowProfileId]);

  // Tell CardCom's master frame who the buyer is, once all three details are valid and again whenever they change. Only valid details
  // are ever sent (buildSetCardOwnerDetailsMessage refuses the rest), exactly as CardCom documents the call (postCardOwnerDetails).
  useEffect(() => {
    if (walletSrc === null || !masterLoaded || lowProfileId === null || !walletDetails.ok || walletKey === null || walletKey === walletSentKey) return;
    const frame = masterRef.current?.contentWindow;
    if (!frame) return;
    const timer = setTimeout(() => {
      postCardOwnerDetails(frame, buildSetCardOwnerDetailsMessage(walletDetails.value));
      setWalletSent({ session: lowProfileId, key: walletKey });
    }, WALLET_DETAILS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [walletSrc, masterLoaded, lowProfileId, walletDetails, walletKey, walletSentKey]);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    if (phase !== 'ready') return;
    setOwnerIdError(null);
    setMessage(null);
    const check = validateCardholder({ ownerId, name, email, phone, address, city, month, year });
    if (!check.ok) {
      if (check.field === 'ownerId') {
        setOwnerIdError(FIELD_MESSAGE.ownerId);
        ownerIdRef.current?.focus();
      } else {
        setMessage(FIELD_MESSAGE[check.field]);
      }
      return;
    }
    if (!captchaSolved) {
      setMessage(CAPTCHA_MESSAGE);
      return;
    }
    const frame = masterRef.current?.contentWindow;
    if (!frame) return;
    setMessage(null);
    setPhase('paying');
    cardSubmitted.current = true;
    postToFrame(frame, buildDoTransactionMessage(check.value));
  };

  const showFrames = lowProfileId !== null && (phase === 'ready' || phase === 'paying');
  // The wallet is usable only while the form is ready, the details are valid, and CardCom has the CURRENT values: an edit makes this
  // false in the same render, so a tap can never beat the update.
  const walletReady = walletSrc !== null && phase === 'ready' && walletDetails.ok && walletKey === walletSentKey;
  const walletHint = walletDetails.ok
    ? 'מעדכנים את פרטי הקונה…'
    : `כדי לשלם עם Google Pay יש להשלים: ${walletDetails.missing.map((field) => WALLET_FIELD_LABEL[field]).join(', ')}.`;

  return (
    <div className="space-y-4">
      {message ? (
        <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          {message}
        </p>
      ) : null}

      {/* Before the frames: a spinner while the session opens, a retry after a decline or a failure, and nothing while a
          payment is in flight or under review (the notice above says so, and paying again must not be offered). */}
      {showFrames ? null : phase === 'waiting' ? null : (
        <Button
          type="button"
          className="h-10 w-full"
          disabled={phase === 'opening'}
          onClick={() => void openSession()}
        >
          {phase === 'opening' ? (
            <>
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              פותחים טופס תשלום…
            </>
          ) : (
            'ניסיון נוסף'
          )}
        </Button>
      )}
      {!showFrames ? null : (
        <form onSubmit={submit} className="space-y-4" noValidate aria-busy={phase === 'paying'}>
          <div className="space-y-1.5">
            <Label htmlFor="cc-owner-name">שם בעל הכרטיס</Label>
            <Input id="cc-owner-name" autoComplete="cc-name" value={name} onChange={(e) => setName(e.target.value)} disabled={phase === 'paying'} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-owner-id">תעודת זהות של בעל הכרטיס</Label>
            <Input
              ref={ownerIdRef}
              id="cc-owner-id"
              type="text"
              dir="ltr"
              inputMode="numeric"
              autoComplete="off"
              maxLength={9}
              required
              value={ownerId}
              aria-invalid={ownerIdError !== null}
              aria-describedby={ownerIdError ? 'cc-owner-id-error' : undefined}
              onChange={(event) => {
                setOwnerId(event.target.value);
                setOwnerIdError(null);
              }}
              disabled={phase === 'paying'}
            />
            {ownerIdError ? (
              <p id="cc-owner-id-error" role="alert" className="text-sm text-destructive">
                {ownerIdError}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-owner-email">אימייל (לקבלה)</Label>
            <Input id="cc-owner-email" type="email" dir="ltr" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={phase === 'paying'} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cc-owner-phone">טלפון נייד</Label>
            <Input id="cc-owner-phone" type="tel" dir="ltr" inputMode="tel" autoComplete="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={phase === 'paying'} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cc-owner-address">כתובת (רחוב ומספר)</Label>
              <Input id="cc-owner-address" autoComplete="street-address" maxLength={50} value={address} onChange={(e) => setAddress(e.target.value)} disabled={phase === 'paying'} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cc-owner-city">עיר</Label>
              <Input id="cc-owner-city" autoComplete="address-level2" maxLength={50} value={city} onChange={(e) => setCity(e.target.value)} disabled={phase === 'paying'} />
            </div>
          </div>

          {walletSrc === null ? null : (
            <div className="space-y-2" data-testid="google-pay-block">
              {/* CardCom's own button, unstyled by us. `inert` (and aria-disabled) is how a cross-origin frame is made unusable: its
                  button cannot be disabled from here. The frame stays in the page so CardCom's scripts find it by name. */}
              <div
                role="group"
                aria-label="תשלום עם Google Pay"
                aria-describedby={walletReady ? undefined : 'google-pay-hint'}
                inert={!walletReady}
                aria-disabled={!walletReady}
                className={walletReady ? undefined : 'opacity-50'}
              >
                <iframe
                  id={OPEN_FIELDS_FRAME_ID.googlePay}
                  name={OPEN_FIELDS_FRAME_ID.googlePay}
                  title="תשלום עם Google Pay"
                  src={walletSrc}
                  {...WALLET_FRAME_PERMISSIONS}
                  className="block h-16 w-full max-w-[277px] border-0"
                  dir="ltr"
                />
              </div>
              {!walletReady && phase === 'ready' ? (
                <p role="status" id="google-pay-hint" className="text-xs text-muted-foreground">
                  {walletHint}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">או בכרטיס אשראי:</p>
            </div>
          )}

          <div className="space-y-1.5">
            <span className="text-sm font-medium">מספר כרטיס אשראי</span>
            <iframe
              id={OPEN_FIELDS_FRAME_ID.cardNumber}
              name={OPEN_FIELDS_FRAME_ID.cardNumber}
              title="מספר כרטיס אשראי"
              src={OPEN_FIELDS_FRAME_SRC.cardNumber}
              className="block h-8 w-full border-0"
              dir="ltr"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {/* The expiry reads like it is printed on the card, MM then YY from left to right, even on a right-to-left page; each
                field keeps its Hebrew label and alignment. The DOM order stays month, year, CVV, so the keyboard goes the same way. */}
            <div dir="ltr" className="col-span-2 grid grid-cols-2 gap-3">
              <div dir="rtl" className="space-y-1.5">
                <Label htmlFor="cc-exp-month">חודש תוקף (MM)</Label>
                <Input id="cc-exp-month" dir="ltr" inputMode="numeric" autoComplete="cc-exp-month" maxLength={2} placeholder="MM" value={month} onChange={(e) => setMonth(e.target.value.replace(/\D/g, ''))} disabled={phase === 'paying'} />
              </div>
              <div dir="rtl" className="space-y-1.5">
                <Label htmlFor="cc-exp-year">שנה (YY)</Label>
                <Input id="cc-exp-year" dir="ltr" inputMode="numeric" autoComplete="cc-exp-year" maxLength={2} placeholder="YY" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, ''))} disabled={phase === 'paying'} />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">CVV</span>
              <iframe
                id={OPEN_FIELDS_FRAME_ID.cvv}
                name={OPEN_FIELDS_FRAME_ID.cvv}
                title="קוד אבטחה (CVV)"
                src={OPEN_FIELDS_FRAME_SRC.cvv}
                className="block h-8 w-full border-0"
                dir="ltr"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-sm font-medium">אימות שאינך רובוט</span>
            <iframe
              id={OPEN_FIELDS_FRAME_ID.captcha}
              name={OPEN_FIELDS_FRAME_ID.captcha}
              title="אימות שאינך רובוט (reCAPTCHA)"
              src={OPEN_FIELDS_FRAME_SRC.captcha}
              className="block h-[78px] w-full max-w-[304px] border-0"
              dir="ltr"
            />
          </div>

          {/* CardCom's own coordinator frame: it collects the two fields above and talks to CardCom. Not visible, not focusable. */}
          <iframe
            ref={masterRef}
            id={OPEN_FIELDS_FRAME_ID.master}
            name={OPEN_FIELDS_FRAME_ID.master}
            title="תיאום תשלום מאובטח"
            src={OPEN_FIELDS_FRAME_SRC.master}
            aria-hidden="true"
            tabIndex={-1}
            className="block size-0 border-0"
            onLoad={() => {
              initFrames();
              // A (re)loaded master frame knows nothing yet: the wallet details must be sent to it again.
              setWalletSent(null);
              setMasterLoadedFor(lowProfileId);
            }}
          />

          {threeDs === null ? null : (
            <p role="status" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {threeDs === 'fingerprint'
                ? 'מאמתים את הכרטיס מול הבנק (3D Secure). זה יכול לקחת עד כ-15 שניות. אל תסגרו את העמוד.'
                : 'הבנק מבקש אימות נוסף. יש להשלים אותו בחלון שנפתח.'}
            </p>
          )}

          <Button type="submit" className="h-10 w-full" disabled={phase === 'paying'}>
            {phase === 'paying' ? (
              <>
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                מעבדים את התשלום…
              </>
            ) : (
              `שלם ${formatAmount(amount)}`
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            פרטי הכרטיס מוזנים בשדות מאובטחים ואינם נשמרים אצלנו. אין לסגור את העמוד עד לאישור התשלום.
          </p>
        </form>
      )}
    </div>
  );
}
