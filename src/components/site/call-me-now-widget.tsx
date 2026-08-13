'use client';

import { useState } from 'react';
import { DirectionProvider } from '@base-ui/react/direction-provider';
import { Loader2, Phone, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Floating call-center widget — capability A, THIRD design (owner-directed
// pivot, 12.8, follow-on to the widget's OWN pivot): OTP-verified,
// PSTN-out, no browser Voximplant identity at all. Replaces
// call-widget.tsx/call-widget-lazy.tsx (kept in place as dead code pending
// an explicit cleanup decision — see console-calls.ts's
// evaluateWidgetCallCaps header for why that design was accepted as
// blocked). See evaluateCallMeNowCaps's header in console-calls.ts for the
// full research trail (OTP reuse, StartScenarios reuse, consent reasoning).
//
// DELIBERATELY NOT MOUNTED anywhere yet — app_settings.console_call_me_now_enabled
// defaults FALSE, no Voximplant rule/scenario (ConsoleCallMeNow) exists yet
// to route the call, so mounting this today would show every site visitor a
// form that always refuses after they already gave up a phone number and
// received an SMS. Mounting is the LAST step of the single approval gate in
// the report, once the whole chain (rule+scenario created and approved,
// flag flipped) actually works end-to-end — same discipline
// console_softphone_enabled/console_widget_enabled both already follow.
//
// TEXT disclosure BEFORE the phone step, not spoken over the call itself
// (that disclosure is the scenario's own DISCLOSURE_LINE_HE, played on the
// visitor's leg before bridging — see call-me-now-authorize/route.ts's
// header) — matches the project-wide "honest UI" principle: no state may be
// implied before a real signal, and the visitor must know a call is about
// to be recorded BEFORE they hand over a phone number, not only once the
// phone rings.

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

const REFUSAL_MESSAGE: Record<string, string> = {
  flag_disabled: 'שירות ההתקשרות אינו פעיל כרגע.',
  live_calls_disabled: 'ערוץ השיחות אינו פעיל כרגע.',
  balance: 'לא ניתן לבצע שיחה כעת. נסו שוב מאוחר יותר.',
  concurrency: 'המוקד עמוס כרגע. נסו שוב בעוד מספר דקות.',
  per_phone_rate: 'כבר ביקשתם שיחה חוזרת לאחרונה. נסו שוב מאוחר יותר.',
  daily_breaker: 'הגענו למכסת השיחות היומית. נסו שוב מחר.',
  dnc: 'לא ניתן להתקשר למספר זה.',
  opted_out: 'לא ניתן להתקשר למספר זה.',
  // Shabbat/Yom-Tov only — the daily 08:00-19:00/Fri-13:00 window was
  // removed for this flow (compliance ruling, 12.8: availability gates the
  // dial, not the clock — see console-calls.ts's evaluateCallMeNowConsent).
  // This reason can therefore still surface, just far more rarely than
  // before, and only for that one remaining basis.
  quiet_hours: 'לא ניתן לבצע שיחה בשבת ובחג. נסו שוב לאחר צאת החג.',
  otp: 'קוד האימות שגוי או שפג תוקפו.',
};

// Same wording NO_AGENT_LINE_HE uses in ConsoleInbound.voxengine.js — reused
// verbatim, not paraphrased, so the promise reads identically whether it is
// made here (the common case now, checked BEFORE any call is placed — owner
// availability-first decision, 12.8) or by the scenario's own ring-exhausted
// branch for the narrow race case.
const NO_AGENT_MESSAGE = 'אין נציג זמין כרגע. נחזור אליכם בהקדם.';

export function CallMeNowWidget() {
  const [open, setOpen] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('phone');
  const [error, setError] = useState<string | null>(null);

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
      setError(res.error ?? 'שליחת קוד האימות נכשלה.');
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
        (res.reason && REFUSAL_MESSAGE[res.reason]) ?? 'לא ניתן היה להשלים את הבקשה. נסו שוב.',
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
            aria-label="בקשת שיחה ממוקד קלפה"
            onClick={() => setOpen(true)}
          >
            <Phone aria-hidden />
            התקשרו אליי עכשיו
          </Button>
        ) : (
          <div className="w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Phone className="size-4 text-muted-foreground" aria-hidden />
              <p className="min-w-0 flex-1 truncate text-sm font-medium">התקשרו אליי עכשיו</p>
              <button
                type="button"
                aria-label="סגירה"
                onClick={onClose}
                className="rounded p-1 text-muted-foreground hover:bg-muted"
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
                    הבנתי, המשך
                  </Button>
                </>
              ) : null}

              {step === 'phone' && disclosureAccepted ? (
                <>
                  <label className="block space-y-1">
                    <span className="text-muted-foreground">מספר טלפון</span>
                    <Input
                      type="tel"
                      inputMode="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="050-1234567"
                    />
                  </label>
                  {error ? <p className="text-destructive">{error}</p> : null}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={!phone.trim()}
                    onClick={() => void onRequestCode()}
                  >
                    שליחת קוד אימות
                  </Button>
                </>
              ) : null}

              {step === 'code' ? (
                <>
                  <p className="text-muted-foreground">שלחנו קוד אימות בהודעת SMS. הזינו אותו כאן:</p>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="tracking-widest"
                    placeholder="000000"
                    maxLength={6}
                  />
                  {error ? <p className="text-destructive">{error}</p> : null}
                  <Button
                    type="button"
                    className="w-full"
                    disabled={code.trim().length !== 6}
                    onClick={() => void onVerifyAndCall()}
                  >
                    <Phone aria-hidden />
                    אימות והתקשרות
                  </Button>
                </>
              ) : null}

              {busy ? (
                <div className="flex items-center justify-center gap-2 py-2 text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  רק רגע…
                </div>
              ) : null}

              {step === 'done' ? (
                <p className="text-center font-medium text-emerald-600 dark:text-emerald-400">
                  הטלפון שלכם אמור לצלצל בקרוב.
                </p>
              ) : null}

              {step === 'callback_offered' ? (
                <>
                  <p className="text-center font-medium">{NO_AGENT_MESSAGE}</p>
                  <Button type="button" variant="outline" className="w-full" onClick={reset}>
                    סגירה
                  </Button>
                </>
              ) : null}

              {step === 'error' ? (
                <>
                  <p className="text-destructive">{error}</p>
                  <Button type="button" variant="outline" className="w-full" onClick={reset}>
                    ניסיון נוסף
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
