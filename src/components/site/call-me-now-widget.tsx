'use client';

import { useId, useState } from 'react';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { Loader2, Phone, X } from 'lucide-react';
import { useT } from 'next-i18next/client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhoneInput } from '@/components/ui/phone-input';

// Floating call-center widget — capability A, THIRD design: OTP-verified,
// PSTN-out, no browser Voximplant identity at all. Replaced the earlier
// WebRTC browser widget (call-widget.tsx / call-widget-lazy.tsx — since
// deleted; see console-calls.ts's evaluateWidgetCallCaps header for why
// that design was accepted as blocked). See evaluateCallMeNowCaps's header
// in console-calls.ts for the
// full research trail (OTP reuse, StartScenarios reuse, consent reasoning).
//
// Mounted CONFIG-GATED in (public)/(site)/layout.tsx: getCallMeNowWidgetEnabled
// requires BOTH app_settings.console_call_me_now_enabled AND a bound
// ConsoleCallMeNow routing rule id, so a visitor never sees a form that
// always refuses after they already gave up a phone number and received an
// SMS.
//
// TEXT disclosure BEFORE the phone step, not spoken over the call itself
// (that disclosure is the scenario's own DISCLOSURE_LINE_CALL_ME_NOW_HE,
// played on the visitor's leg before bridging — see
// call-me-now-authorize/route.ts's header) — matches the project-wide
// "honest UI" principle: no state may be implied before a real signal, and
// the visitor must know a call is about to be recorded BEFORE they hand over
// a phone number, not only once the phone rings.

type Step = 'phone' | 'code' | 'calling' | 'done' | 'callback_offered' | 'error';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return (await res.json()) as T;
}

export function CallMeNowWidget() {
  const { t } = useT('public');
  const [open, setOpen] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('phone');
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const phoneId = useId();

  const refusalMessage: Record<string, string> = {
    flag_disabled: t('site.callMe.refusal.flagDisabled', 'שירות ההתקשרות אינו פעיל כרגע.'),
    live_calls_disabled: t('site.callMe.refusal.liveCallsDisabled', 'ערוץ השיחות אינו פעיל כרגע.'),
    balance: t('site.callMe.refusal.balance', 'לא ניתן לבצע שיחה כעת. נסו שוב מאוחר יותר.'),
    concurrency: t('site.callMe.refusal.concurrency', 'המוקד עמוס כרגע. נסו שוב בעוד מספר דקות.'),
    per_phone_rate: t('site.callMe.refusal.perPhoneRate', 'כבר ביקשתם שיחה חוזרת לאחרונה. נסו שוב מאוחר יותר.'),
    daily_breaker: t('site.callMe.refusal.dailyBreaker', 'הגענו למכסת השיחות היומית. נסו שוב מחר.'),
    dnc: t('site.callMe.refusal.dnc', 'לא ניתן להתקשר למספר זה.'),
    // Shabbat/Yom-Tov only — this flow skips the daily call window
    // (availability gates the dial, not the clock — see console-calls.ts's
    // evaluateCallMeNowConsent), so this reason surfaces only for that one
    // basis.
    quiet_hours: t('site.callMe.refusal.quietHours', 'לא ניתן לבצע שיחה בשבת ובחג. נסו שוב לאחר צאת החג.'),
    otp: t('site.callMe.refusal.otp', 'קוד האימות שגוי או שפג תוקפו.'),
    // A call-me-now request is exempt from the national Do-Not-Call registry (the visitor asked to be called), so the
    // only registry outcome this flow can meet is a decision record that could not be written.
    registry_pending: t('site.callMe.refusal.registryPending', 'לא ניתן לבצע שיחה כעת. נסו שוב בעוד מספר דקות.'),
  };

  // Same wording NO_AGENT_LINE_HE uses in ConsoleInbound.voxengine.js — reused
  // verbatim, not paraphrased, so the promise reads identically whether it is
  // made here (the common case, checked BEFORE any call is placed) or by the
  // scenario's own ring-exhausted branch for the narrow race case.
  const noAgentMessage = t('site.callMe.noAgent', 'אין נציג זמין כרגע. נחזור אליכם בהקדם.');

  function reset() {
    setStep('phone');
    setPhone('');
    setCode('');
    setError(null);
    setDisclosureAccepted(false);
  }

  function onClose() {
    reset();
    setOpen(false);
  }

  async function onRequestCode() {
    setError(null);
    setStep('calling'); // reused as a generic busy state for this sub-step
    const res = await postJson<{ ok: boolean; error?: string }>(
      '/api/call-me-now/request-code',
      { phone },
    );
    if (!res.ok) {
      setError(res.error ?? t('site.callMe.errors.sendCodeFailed', 'שליחת קוד האימות נכשלה.'));
      setStep('phone');
      return;
    }
    setStep('code');
  }

  async function onVerifyAndCall() {
    setError(null);
    setStep('calling');
    const res = await postJson<{ ok: boolean; reason?: string; callback_offered?: boolean }>(
      '/api/call-me-now/verify',
      { phone, code },
    );
    if (!res.ok) {
      // No agent was routable — NOT an ordinary refusal: the server already
      // wrote a real callback request (offerCallbackForCallMeNow), so this
      // is the honest "we'll call you back" promise, not an error state.
      if (res.reason === 'no_agent' && res.callback_offered) {
        setStep('callback_offered');
        return;
      }
      setError(
        (res.reason && refusalMessage[res.reason]) ?? t('site.callMe.errors.generic', 'לא ניתן היה להשלים את הבקשה. נסו שוב.'),
      );
      setStep('error');
      return;
    }
    setStep('done');
  }

  const busy = step === 'calling';

  return (
    <DirectionProvider direction="rtl">
      <div dir="rtl" className="fixed bottom-4 end-4 z-40">
        {!open ? (
          <Button
            type="button"
            size="lg"
            className="shadow-lg"
            onClick={() => setOpen(true)}
          >
            <Phone aria-hidden />
            {t('site.callMe.title', 'התקשרו אליי עכשיו')}
          </Button>
        ) : (
          // Non-modal dialog: the page behind stays usable, so no aria-modal.
          <div
            role="dialog"
            aria-labelledby={titleId}
            className="w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-lg"
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Phone className="size-4 text-muted-foreground" aria-hidden />
              <p id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium">{t('site.callMe.title', 'התקשרו אליי עכשיו')}</p>
              <button
                type="button"
                aria-label={t('site.callMe.close', 'סגירה')}
                onClick={onClose}
                className="-my-2.5 -me-2.5 grid size-11 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>

            <div className="space-y-3 px-4 py-3 text-sm">
              {step === 'phone' && !disclosureAccepted ? (
                <>
                  <p className="text-muted-foreground">
                    נחייג אליכם תוך דקות ספורות ונחבר אתכם לנציג מוקד קלפה.
                    השיחה מוקלטת לצורך תיעוד ושיפור השירות.
                  </p>
                  <Button type="button" className="w-full" onClick={() => setDisclosureAccepted(true)}>
                    {t('site.callMe.disclosureAccept', 'הבנתי, המשך')}
                  </Button>
                </>
              ) : null}

              {step === 'phone' && disclosureAccepted ? (
                <>
                  {/* id/htmlFor, not a wrapping <label>: PhoneInput's first
                      labelable descendant is its country-picker BUTTON, so a
                      wrapping label named the button, not the number field. */}
                  <div className="space-y-1">
                    <label htmlFor={phoneId} className="block text-muted-foreground">
                      {t('site.callMe.phoneLabel', 'מספר טלפון')}
                    </label>
                    <PhoneInput
                      id={phoneId}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="050-1234567"
                    />
                  </div>
                  {error ? <p role="alert" className="text-destructive">{error}</p> : null}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!phone.trim()}
                    onClick={() => void onRequestCode()}
                  >
                    {t('site.callMe.sendCode', 'שליחת קוד אימות')}
                  </Button>
                </>
              ) : null}

              {step === 'code' ? (
                <>
                  <p className="text-muted-foreground">{t('site.callMe.codePrompt', 'שלחנו קוד אימות בהודעת SMS. הזינו אותו כאן:')}</p>
                  <Input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    aria-label={t('site.callMe.codeAria', 'קוד אימות')}
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                  />
                  {error ? <p role="alert" className="text-destructive">{error}</p> : null}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={code.trim().length !== 6}
                    onClick={() => void onVerifyAndCall()}
                  >
                    <Phone aria-hidden />
                    {t('site.callMe.verifyAndCall', 'אימות והתקשרות')}
                  </Button>
                </>
              ) : null}

              {busy ? (
                <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  {t('site.callMe.busy', 'רק רגע…')}
                </div>
              ) : null}

              {step === 'done' ? (
                <p className="text-center font-medium text-emerald-600 dark:text-emerald-400">
                  {t('site.callMe.ringingSoon', 'הטלפון שלכם אמור לצלצל בקרוב.')}
                </p>
              ) : null}

              {step === 'callback_offered' ? (
                <>
                  <p className="text-center font-medium">{noAgentMessage}</p>
                  <Button type="button" variant="outline" className="w-full" onClick={reset}>
                    {t('site.callMe.close', 'סגירה')}
                  </Button>
                </>
              ) : null}

              {step === 'error' ? (
                <>
                  <p role="alert" className="text-destructive">{error}</p>
                  <Button type="button" variant="outline" className="w-full" onClick={reset}>
                    {t('site.callMe.retry', 'ניסיון נוסף')}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </DirectionProvider>
  );
}
