'use client';

import Link from 'next/link';
import SignaturePad from 'signature_pad';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';

import {
  requestSigningOtpAction,
  verifySigningOtpAction,
  signAgreementAction,
} from '../../campaign-actions';
import { FieldError, FormError, FormNotice } from '@/components/forms';

const inputClass =
  'w-full rounded-md border border-border bg-transparent px-3 py-2';
const labelClass = 'mb-1 block text-sm font-medium';

const OTP_COOLDOWN_SECONDS = 60;

// Verify-code button: the step-1.5 gate. Disabled while pending or once the
// current field value has already been confirmed (re-verifying the same code
// would just consume an attempt for nothing).
function VerifyButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="rounded-md border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-60"
    >
      {pending ? 'מאמת…' : 'אימות קוד'}
    </button>
  );
}

function SignButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="w-full rounded-md bg-primary px-4 py-2 font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {pending ? 'רגע…' : 'חתימה והמשך לאמצעי תשלום'}
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
  phoneDisplay,
}: {
  eventId: string;
  campaignId: string;
  signerName: string;
  phoneDisplay: string;
}) {
  const signAction = signAgreementAction.bind(null, eventId, campaignId);
  const [state, formAction] = useActionState(signAction, null);
  const [otpState, otpFormAction] = useActionState(
    requestSigningOtpAction,
    null,
  );

  // Step 1.5 — verify-before-sign gate. verifyState.code pins the result to the
  // EXACT code value that earned it, so otpVerified is a pure derivation —
  // editing the field afterward drops it back to false with no extra wiring
  // or effect needed. The real, consuming re-check still runs server-side in
  // signAgreementAction; this only unlocks the canvas.
  const [verifyState, verifyFormAction] = useActionState(
    verifySigningOtpAction,
    null,
  );
  const [otpCode, setOtpCode] = useState('');
  const otpVerified = verifyState?.verified === true && verifyState.code === otpCode;

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

  // Lock/unlock drawing itself (not just the submit button) until the OTP
  // gate passes — pad.off()/on() removes/reattaches the pointer listeners, so
  // a locked pad can't be signed even if the disabled overlay below is somehow
  // bypassed client-side. Runs after the creation effect above (same commit,
  // declaration order), so padRef.current is already set on first run. This
  // effect only syncs the external pad — it never writes React state (see the
  // render-time reset below for why the pad and `signature` reset separately).
  useEffect(() => {
    const pad = padRef.current;
    if (!pad) return;
    if (otpVerified) {
      pad.on();
    } else {
      pad.off();
      pad.clear();
    }
  }, [otpVerified]);

  // Adjusting state while rendering (React-sanctioned pattern for "reset X
  // when Y changes", see react.dev/learn/you-might-not-need-an-effect) rather
  // than setState-in-effect: otherwise a stale `signature` from before a
  // re-lock would resurrect once otpVerified flips back true, even though the
  // pad itself was cleared above and no stroke was drawn since.
  const [otpVerifiedAtLastRender, setOtpVerifiedAtLastRender] = useState(otpVerified);
  if (otpVerified !== otpVerifiedAtLastRender) {
    setOtpVerifiedAtLastRender(otpVerified);
    if (!otpVerified && signature) setSignature('');
  }

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
        {/* dir goes on the NUMBER, never on the line. With dir="ltr" on the
            <p> the Hebrew label was laid out left-to-right too, so this line
            sat left-aligned directly under a right-aligned one in the same
            box. <bdi> isolates the number without touching the sentence. */}
        <p className="mt-1 text-muted-foreground">
          טלפון לאימות: <bdi dir="ltr">{phoneDisplay}</bdi>
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
          הקוד נשלח למספר הטלפון שבפרופיל. הזינו אותו למטה כדי לפתוח את תיבת החתימה.
        </p>
      </form>

      {/* Step 1.5: verify the code — a non-consuming check (server keeps the
          challenge valid for the real, consuming re-check at final submit
          below) that unlocks the signature canvas only once it passes. */}
      <form
        action={verifyFormAction}
        className="space-y-2 rounded-md border border-border p-3"
      >
        <label htmlFor="otp_code_verify" className={labelClass}>
          קוד אימות (6 ספרות) *
        </label>
        <input
          id="otp_code_verify"
          name="otp_code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          dir="ltr"
          value={otpCode}
          onChange={(e) => setOtpCode(e.target.value)}
          className={`${inputClass} text-start tracking-widest`}
          placeholder="------"
        />
        <FieldError errors={verifyState?.fieldErrors?.otp_code} />
        <div className="flex items-center justify-between">
          <VerifyButton disabled={otpVerified || otpCode.length !== 6} />
          {otpVerified ? (
            <span className="text-sm text-success">✓ אומת</span>
          ) : null}
        </div>
      </form>

      {/* Step 2: the signing form — locked until otpVerified. */}
      <form action={formAction} className="space-y-5">
        <FormError message={state?.error} />

        <div>
          <label className={labelClass}>חתימה *</label>
          <div className="relative">
            <canvas
              ref={canvasRef}
              className="h-40 w-full touch-none rounded-md border border-border bg-white"
            />
            {!otpVerified ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-md bg-muted/80 text-center text-sm text-muted-foreground">
                יש לאמת קוד OTP למעלה לפני החתימה
              </div>
            ) : null}
          </div>
          <div className="mt-1 flex items-center justify-between">
            <button
              type="button"
              onClick={clear}
              disabled={!otpVerified}
              className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              נקה חתימה
            </button>
            {signature ? (
              <span className="text-sm text-success">✓ נחתם</span>
            ) : (
              <span className="text-sm text-muted-foreground">חתמו בתיבה</span>
            )}
          </div>
          <input type="hidden" name="signature" value={signature} />
          <FieldError errors={state?.fieldErrors?.signature} />
        </div>

        {/* Carries the already-verified code to the final, consuming check in
            signAgreementAction — not a user-editable field anymore (that's
            step 1.5 above); if the code was edited since verifying, otpVerified
            is false and this form is unreachable (SignButton stays disabled). */}
        <input type="hidden" name="otp_code" value={otpVerified ? otpCode : ''} />
        <FieldError errors={state?.fieldErrors?.otp_code} />

        <fieldset className="space-y-2 rounded-md border border-border p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="terms_accepted" className="mt-1" />
            {/* Linked, and target="_blank" — the same pattern the signup form
                already uses. A consent to a document the signer cannot open
                from where they are consenting is not much of a consent. */}
            <span>
              קראתי ואני מאשר/ת את{' '}
              <Link
                href="/terms"
                target="_blank"
                className="font-medium text-primary hover:underline"
              >
                תנאי השירות
              </Link>{' '}
              ואת התחייבות התשלום.
            </span>
          </label>
          <FieldError errors={state?.fieldErrors?.terms_accepted} />
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="privacy_accepted" className="mt-1" />
            <span>
              אני מאשר/ת את{' '}
              <Link
                href="/privacy"
                target="_blank"
                className="font-medium text-primary hover:underline"
              >
                מדיניות הפרטיות
              </Link>
              .
            </span>
          </label>
          <FieldError errors={state?.fieldErrors?.privacy_accepted} />
        </fieldset>

        <SignButton disabled={!signature || !otpVerified} />
      </form>
    </div>
  );
}
