'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
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
  parseFrameMessage,
  postToFrame,
  validateCardholder,
  type CardholderField,
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
// fields at once. Opening writes a pending ledger row; coming back to the page (a reload, a second tab) hands back the SAME
// young unpaid session instead of opening a new one (resolvePending in cardcom-purchase.ts). The button stays for a retry.

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
  }, []);

  const openSession = useCallback(async () => {
    setMessage(null);
    setCaptchaSolved(false);
    setPhase('opening');
    try {
      const answer = await postJson<StartAnswer>(`/api/campaigns/${campaignId}/purchase/cardcom`);
      if (!mounted.current) return;
      if (answer.status === 'ready' && typeof answer.lowProfileId === 'string' && answer.lowProfileId !== '') {
        setLowProfileId(answer.lowProfileId);
        setPhase('ready');
      } else if (answer.status === 'already_paid') {
        router.refresh();
      } else if (answer.status === 'in_progress' || answer.status === 'review') {
        fail(answer.status === 'review' ? 'purchase_review' : 'purchase_in_progress', 'waiting');
        router.refresh();
      } else {
        fail(START_FAILURE[answer.status ?? ''] ?? 'purchase_failed');
      }
    } catch {
      if (mounted.current) fail('purchase_failed');
    }
  }, [campaignId, fail, router]);

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
      for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
        let answer: SettleAnswer;
        try {
          answer = await postJson<SettleAnswer>(`/api/campaigns/${campaignId}/purchase/settle`, { submitted: true });
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
          fail('purchase_declined', 'declined');
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

  // CardCom's 3D Secure handling is a script that must be on the page while the frames are.
  useEffect(() => {
    if (phase !== 'ready' || document.querySelector('script[data-cardcom-3ds]')) return;
    const script = document.createElement('script');
    script.src = `${OPEN_FIELDS_3DS_SCRIPT}?v=${Date.now()}`;
    script.async = true;
    script.setAttribute('data-cardcom-3ds', '');
    document.head.appendChild(script);
  }, [phase]);

  // What the frames say. Only CardCom's origin is heard (parseFrameMessage); "submitted" and "error" are reasons to ask the server.
  useEffect(() => {
    if (lowProfileId === null) return;
    const onMessage = (event: MessageEvent) => {
      const frameMessage = parseFrameMessage({ origin: event.origin, data: event.data });
      if (frameMessage?.kind === 'submit' || frameMessage?.kind === 'error') void settle();
      else if (frameMessage?.kind === 'validation' && frameMessage.field === OPEN_FIELDS_CAPTCHA_FIELD) setCaptchaSolved(frameMessage.valid);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [lowProfileId, settle]);

  const initFrames = useCallback(() => {
    const frame = masterRef.current?.contentWindow;
    if (frame && lowProfileId) postToFrame(frame, buildInitMessage({ lowProfileCode: lowProfileId }));
  }, [lowProfileId]);

  const submit = (event: FormEvent) => {
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
    postToFrame(frame, buildDoTransactionMessage(check.value));
  };

  const showFrames = lowProfileId !== null && (phase === 'ready' || phase === 'paying');

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

          <div className="space-y-1.5">
            <span className="text-sm font-medium">מספר כרטיס אשראי</span>
            <iframe
              id={OPEN_FIELDS_FRAME_ID.cardNumber}
              name={OPEN_FIELDS_FRAME_ID.cardNumber}
              title="מספר כרטיס אשראי"
              src={OPEN_FIELDS_FRAME_SRC.cardNumber}
              className="block h-10 w-full border-0"
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
                className="block h-10 w-full border-0"
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
            onLoad={initFrames}
          />

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
