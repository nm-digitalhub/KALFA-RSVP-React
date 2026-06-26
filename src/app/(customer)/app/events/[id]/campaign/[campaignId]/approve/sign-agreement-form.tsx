'use client';

import SignaturePad from 'signature_pad';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  requestSigningOtpAction,
  signAgreementAction,
} from '../../campaign-actions';
import { FieldError, FormError, FormNotice } from '@/components/forms';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';
const labelClass = 'mb-1 block text-sm font-medium';

const OTP_COOLDOWN_SECONDS = 60;

function SignButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'רגע…' : 'חתימה ואישור הקמפיין'}
    </button>
  );
}

// Send/resend OTP button: disabled while sending (pending) and during the
// post-send cooldown countdown (anti-flood; the server rate-limit is the hard cap).
// The cooldown start is DEFERRED (setTimeout) so it does not disable this submit
// button within the same click event — disabling it synchronously there cancels
// the form submission, and the Server Action would never run.
function ResendButton({
  cooldown,
  onSent,
}: {
  cooldown: number;
  onSent: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      onClick={() => setTimeout(onSent, 0)}
      disabled={pending || cooldown > 0}
      className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-60"
    >
      {pending
        ? 'שולח…'
        : cooldown > 0
          ? `שליחה חוזרת בעוד ${cooldown} שניות`
          : 'שליחת קוד אימות ל‑SMS'}
    </button>
  );
}

export function SignAgreementForm({
  eventId,
  campaignId,
  signerName,
  phone,
}: {
  eventId: string;
  campaignId: string;
  signerName: string;
  phone: string;
}) {
  const signAction = signAgreementAction.bind(null, eventId, campaignId);
  const [state, formAction] = useActionState(signAction, null);
  const [otpState, otpFormAction] = useActionState(
    requestSigningOtpAction,
    null,
  );

  // Anti-flood cooldown on the OTP send button (the server rate-limit is the
  // hard cap). Started from the button's onClick but DEFERRED (see ResendButton)
  // so it never disables the button during the submit click.
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePad | null>(null);
  const [signature, setSignature] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pad = new SignaturePad(canvas, {
      backgroundColor: 'rgb(255,255,255)',
      penColor: 'rgb(17,17,17)',
    });
    padRef.current = pad;
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = canvas.offsetHeight * ratio;
      canvas.getContext('2d')?.scale(ratio, ratio);
      pad.clear();
      setSignature('');
    };
    resize();
    const onEnd = () =>
      setSignature(pad.isEmpty() ? '' : pad.toDataURL('image/png'));
    pad.addEventListener('endStroke', onEnd);
    window.addEventListener('resize', resize);
    return () => {
      pad.off();
      window.removeEventListener('resize', resize);
    };
  }, []);

  const clear = () => {
    padRef.current?.clear();
    setSignature('');
  };

  return (
    <div className="space-y-5">
      {/* Identity comes from the logged-in profile — read-only. */}
      <div className="rounded-md border border-border p-3 text-sm">
        <p>
          החותם/ת: <strong>{signerName}</strong>
        </p>
        <p className="mt-1 text-muted-foreground" dir="ltr">
          טלפון לאימות: {phone}
        </p>
      </div>

      {/* Step 1: phone OTP — code is sent to the profile phone (server-side). */}
      <form
        action={otpFormAction}
        className="space-y-2 rounded-md border border-border p-3"
      >
        <div className="text-sm font-medium">אימות טלפון (OTP)</div>
        <FormNotice message={otpState?.notice} />
        <FormError message={otpState?.error} />
        <ResendButton
          cooldown={cooldown}
          onSent={() => setCooldown(OTP_COOLDOWN_SECONDS)}
        />
        <p className="text-xs text-muted-foreground">
          הקוד נשלח למספר הטלפון שבפרופיל. הזינו אותו בטופס למטה.
        </p>
      </form>

      {/* Step 2: the signing form. */}
      <form action={formAction} className="space-y-5">
        <FormError message={state?.error} />

        <div>
          <label className={labelClass}>חתימה *</label>
          <canvas
            ref={canvasRef}
            className="h-40 w-full touch-none rounded-md border border-border bg-white"
          />
          <div className="mt-1 flex items-center justify-between">
            <button
              type="button"
              onClick={clear}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              נקה חתימה
            </button>
            {signature ? (
              <span className="text-sm text-green-700">✓ נחתם</span>
            ) : (
              <span className="text-sm text-muted-foreground">חתמו בתיבה</span>
            )}
          </div>
          <input type="hidden" name="signature" value={signature} />
          <FieldError errors={state?.fieldErrors?.signature} />
        </div>

        <div>
          <label htmlFor="otp_code" className={labelClass}>
            קוד אימות (6 ספרות) *
          </label>
          <input
            id="otp_code"
            name="otp_code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            dir="ltr"
            className={`${inputClass} text-start tracking-widest`}
            placeholder="------"
          />
          <FieldError errors={state?.fieldErrors?.otp_code} />
        </div>

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="terms_accepted" className="mt-1" />
            <span>קראתי ואני מאשר/ת את תנאי השירות והתחייבות התשלום.</span>
          </label>
          <FieldError errors={state?.fieldErrors?.terms_accepted} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="privacy_accepted" className="mt-1" />
            <span>אני מאשר/ת את מדיניות הפרטיות.</span>
          </label>
          <FieldError errors={state?.fieldErrors?.privacy_accepted} />
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="authorization_accepted"
              className="mt-1"
            />
            <span>אני מאשר/ת חיוב לפי אנשי הקשר שהושגו בפועל, עד לתקרה שאושרה.</span>
          </label>
          <FieldError errors={state?.fieldErrors?.authorization_accepted} />
        </fieldset>

        <SignButton disabled={!signature} />
      </form>
    </div>
  );
}
