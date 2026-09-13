'use client';

import { useActionState, useMemo, useState } from 'react';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { AlertTriangle, Phone } from 'lucide-react';

import {
  FieldError,
  FormError,
  FormNotice,
  SubmitButton,
  compactSelectClass,
} from '@/components/forms';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { Label } from '@/components/ui/label';
import { PhoneInput } from '@/components/ui/phone-input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ProviderNumber } from '@/lib/data/admin/integrations/provider-numbers';
import { CODE_METHOD_LABELS, CONFIRM_WORD } from '@/lib/validation/whatsapp-numbers';
import type { FormState } from '@/lib/validation/result';

import type { AddNumberState } from './actions';

// The four steps Meta actually requires, in the order it requires them, each its own
// Server Action and its own round-trip.
//
// ⚠️ THE STEPS ARE NOT A WIZARD'S DECORATION — THEY ARE SEPARATE ENDPOINTS.
// A number that has been added still cannot send: it has to prove ownership (a code
// to the handset) and then be registered (a PIN). Collapsing them into one submit
// would mean one failure discards the work of the others, and step 4 cannot be
// retried freely — see below.
//
// ⚠️ STEP 4 SPENDS A BUDGET. Meta allows 10 register/deregister calls per number per
// 72 hours and blocks the number on the eleventh (133016). That is why the step is
// owner-only, asks for the word REGISTER, and states the cost before the button.
//
// The owner check here HIDES the step; it does not gate it. The action is gated by
// requirePlatformOwner in the DAL, because a Server Action is its own endpoint and
// anything the browser can reach it can reach directly.
//
// ⚠️ THERE IS NO WAY BACK OUT OF STEP 1, AND THAT IS META'S RULE, NOT A GAP HERE.
// Verified against the live docs 2026-09-11: "Business phone numbers cannot be deleted
// using the API. Deletion must be performed manually through the WhatsApp Manager
// interface." `deregister` is a different operation — it removes a number from the
// Cloud API and costs from the 72-hour budget, but the number stays on the WABA.
//
// So a "back" on step 1 would promise an undo that does not exist. What the wizard
// owes instead is a way back IN: a number added and then abandoned (the sheet closed,
// the tab lost) still exists at Meta, and without RESUME it could never be verified —
// the wizard always restarted at step 1, and nothing else on the page can request a
// code. That was a trap, and `candidates` + the resume picker below are the way out.

type Step = 'add' | 'code' | 'verify' | 'register';

const STEP_TITLES: Record<Step, string> = {
  add: 'הוספת מספר ל-WABA',
  code: 'אימות בעלות — שליחת קוד',
  verify: 'אימות בעלות — הזנת הקוד',
  register: 'רישום ל-Cloud API',
};

function StepDots({ current }: { current: Step }) {
  const order: Step[] = ['add', 'code', 'verify', 'register'];
  const index = order.indexOf(current);
  return (
    <ol className="flex items-center gap-2" aria-label="שלבי התהליך">
      {order.map((s, i) => (
        <li
          key={s}
          aria-current={i === index ? 'step' : undefined}
          className={
            i === index
              ? 'size-2 rounded-full bg-primary'
              : i < index
                ? 'size-2 rounded-full bg-primary/40'
                : 'size-2 rounded-full bg-border'
          }
        >
          <span className="sr-only">
            {STEP_TITLES[s]}
            {i < index ? ' — הושלם' : ''}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function AddNumberWizard({
  isOwner,
  candidates,
  addAction,
  requestCodeAction,
  verifyCodeAction,
  registerAction,
}: {
  isOwner: boolean;
  /** Meta numbers already on the WABA — the ones a resume can point at. */
  candidates: ProviderNumber[];
  addAction: (prev: AddNumberState | null, fd: FormData) => Promise<AddNumberState>;
  requestCodeAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  verifyCodeAction: (prev: FormState, fd: FormData) => Promise<FormState>;
  registerAction: (prev: FormState, fd: FormData) => Promise<FormState>;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('add');
  const [phoneNumberId, setPhoneNumberId] = useState<string>('');
  const [phone, setPhone] = useState('');
  // Step 1 has two doors: add a new number, or pick up one that was added before.
  const [resuming, setResuming] = useState(false);

  // WHAT META WILL ACTUALLY RECEIVE, derived with the SAME parse the server runs.
  //
  // This exists because the two can diverge and did: a trunk zero that survived a
  // country change made the field read "+330 7 56 98 23 70" while the server would
  // have registered 33756982370. The component bug is fixed, but the class of bug is
  // not — any normalisation between here and Meta can shift a digit — and this is the
  // one screen where "the number I meant" and "the number that got registered" being
  // different is expensive to discover later.
  const preview = useMemo(() => {
    const trimmed = phone.trim();
    if (trimmed === '') return null;
    const parsed = parsePhoneNumberFromString(trimmed, 'IL');
    if (!parsed || !parsed.isValid()) return null;
    return {
      cc: parsed.countryCallingCode,
      // The national number — see whatsapp-numbers.ts: Meta concatenates it onto cc.
      // The preview shows the RECONSTRUCTED result, which is what actually lands.
      phoneNumber: parsed.nationalNumber,
      country: parsed.country
        ? (new Intl.DisplayNames(['he'], { type: 'region' }).of(parsed.country) ??
          parsed.country)
        : null,
    };
  }, [phone]);

  const [addState, runAdd] = useActionState<AddNumberState | null, FormData>(
    async (prev, fd) => {
      const next = await addAction(prev, fd);
      // Advancing on the ID, not on the absence of an error: the id is the thing the
      // next three steps cannot run without.
      if (next.phoneNumberId) {
        setPhoneNumberId(next.phoneNumberId);
        setStep('code');
      }
      return next;
    },
    null,
  );

  const [codeState, runCode] = useActionState<FormState, FormData>(
    async (prev, fd) => {
      const next = await requestCodeAction(prev, fd);
      if (next?.notice) setStep('verify');
      return next;
    },
    null,
  );

  const [verifyState, runVerify] = useActionState<FormState, FormData>(
    async (prev, fd) => {
      const next = await verifyCodeAction(prev, fd);
      if (next?.notice) setStep('register');
      return next;
    },
    null,
  );

  const [registerState, runRegister] = useActionState<FormState, FormData>(
    async (prev, fd) => registerAction(prev, fd),
    null,
  );

  const otpInvalid = Boolean(verifyState?.fieldErrors?.code?.length);

  function reset() {
    setStep('add');
    setPhoneNumberId('');
    setPhone('');
    setResuming(false);
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <Phone className="size-4" aria-hidden />
        הוספת מספר
      </Button>

      <Sheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{STEP_TITLES[step]}</SheetTitle>
            <SheetDescription>
              הוספת מספר ל-WhatsApp מורכבת מארבעה שלבים נפרדים אצל Meta. מספר שנוסף
              ולא נרשם אינו יכול לשלוח דבר.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-4 p-4 pt-0 text-sm">
            <StepDots current={step} />

            {step === 'add' && resuming ? (
              <div className="space-y-4">
                <Alert>
                  <AlertTitle>המשך אימות למספר שכבר נוסף</AlertTitle>
                  <AlertDescription>
                    מספר שנוסף ל-WABA ולא הושלם נשאר שם — Meta אינה מאפשרת להסיר אותו
                    דרך ה-API. כאן ממשיכים אותו מהשלב שנעצר בו.
                  </AlertDescription>
                </Alert>

                {candidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    אין מספרים מסונכרנים. לחצו על סנכרון בעמוד כדי למשוך מ-Meta את מה
                    שכבר קיים ב-WABA.
                  </p>
                ) : (
                  <div>
                    <Label htmlFor="resume-number">המספר להמשך</Label>
                    <select
                      id="resume-number"
                      value={phoneNumberId}
                      onChange={(e) => setPhoneNumberId(e.target.value)}
                      className={`${compactSelectClass} w-full`}
                    >
                      <option value="">— בחרו מספר —</option>
                      {candidates.map((n) => (
                        <option key={n.id} value={n.providerRef ?? ''}>
                          {n.e164 ?? n.providerRef} — {n.displayLabel ?? 'ללא שם'}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <Button
                  type="button"
                  className="w-full"
                  disabled={phoneNumberId === ''}
                  onClick={() => setStep('code')}
                >
                  המשך לאימות
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setResuming(false);
                    setPhoneNumberId('');
                  }}
                >
                  חזרה להוספת מספר חדש
                </Button>
              </div>
            ) : null}

            {step === 'add' && !resuming ? (
              <form action={runAdd} className="space-y-4">
                <Alert>
                  <AlertTitle>לפני שמתחילים</AlertTitle>
                  <AlertDescription>
                    המספר חייב להיות בבעלותכם ולקבל SMS או שיחה. מספר שכבר משויך
                    לחשבון WhatsApp אחר צריך להימחק משם קודם — Meta לא תוסיף אותו
                    פעמיים.
                  </AlertDescription>
                </Alert>

                <div>
                  <Label htmlFor="phone">מספר הטלפון</Label>
                  {/* THE FLAG CONTROL THE GUEST FORM AND THE CONTACT FORMS ALREADY USE.
                      Two boxes stood here first — a country code, and "the full number
                      including the country code but without the +". That made the admin
                      perform the split that libphonenumber-js does for free, into a
                      format that exists for Meta's convenience and nobody else's.

                      One field now. `0501234567` works, `+972 50-123 4567` works, and a
                      number from another country works too — the flag reports which
                      country it was read as, which is the check the two boxes could
                      never make. The split into Meta's `cc` and `phone_number` happens
                      server-side in addNumberSchema, once, at the boundary. */}
                  <PhoneInput
                    id="phone"
                    name="phone"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    aria-describedby="phone-preview"
                    aria-invalid={addState?.fieldErrors?.phone ? true : undefined}
                  />
                  {/* aria-live: the preview appears and changes as the number is
                      typed, and a screen-reader user gets no other signal that the
                      country was read differently from what they intended. */}
                  <p
                    id="phone-preview"
                    aria-live="polite"
                    className="mt-1 text-xs text-muted-foreground"
                  >
                    {preview ? (
                      <>
                        יישלח ל-Meta:{' '}
                        <span dir="ltr" className="font-mono text-foreground">
                          +{preview.cc} {preview.phoneNumber}
                        </span>
                        {preview.country ? ` · ${preview.country}` : null}
                      </>
                    ) : (
                      'המספר יוצג כאן בדיוק כפי שיישלח ל-Meta, אחרי שיהיה תקין.'
                    )}
                  </p>
                  <FieldError errors={addState?.fieldErrors?.phone} />
                </div>

                <div>
                  <Label htmlFor="verifiedName">שם העסק שיוצג</Label>
                  {/* defaultValue from the returned state, not blank: a Server Action
                      re-renders this form, and an uncontrolled input without one comes
                      back EMPTY. The owner's first real failure wiped the name he had
                      just typed while the phone number stayed put — which reads as the
                      form having eaten it, on the screen that is already telling him
                      something went wrong. */}
                  <Input
                    id="verifiedName"
                    name="verifiedName"
                    defaultValue={addState?.verifiedName ?? ''}
                    maxLength={75}
                    required
                    aria-describedby="verifiedName-hint"
                    aria-invalid={addState?.fieldErrors?.verifiedName ? true : undefined}
                  />
                  <p id="verifiedName-hint" className="mt-1 text-xs text-muted-foreground">
                    2–75 תווים. Meta מאשרת את השם בנפרד, והוא מה שהאורחים יראו.
                  </p>
                  <FieldError errors={addState?.fieldErrors?.verifiedName} />
                </div>

                <FormError message={addState?.error} />
                <SubmitButton>הוספה</SubmitButton>

                {/* The way back IN. Meta has no delete-number API, so a number added
                    and abandoned is stranded unless the wizard can be re-entered
                    pointing at it. */}
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setResuming(true)}
                >
                  המספר כבר נוסף? המשך את האימות שלו
                </Button>
              </form>
            ) : null}

            {step === 'code' ? (
              <form action={runCode} className="space-y-4">
                <input type="hidden" name="phoneNumberId" value={phoneNumberId} />
                <Alert>
                  <AlertTitle>הקוד נשלח למכשיר עצמו</AlertTitle>
                  <AlertDescription>
                    זו אינה בדיקת חיבור: Meta שולחת SMS או מתקשרת למספר. צריך גישה
                    למכשיר כדי להמשיך.
                  </AlertDescription>
                </Alert>

                <fieldset className="space-y-2">
                  <legend className="font-medium">איך לקבל את הקוד</legend>
                  {(['SMS', 'VOICE'] as const).map((method, i) => (
                    <label key={method} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="codeMethod"
                        value={method}
                        defaultChecked={i === 0}
                        className="size-4"
                      />
                      {CODE_METHOD_LABELS[method]}
                    </label>
                  ))}
                </fieldset>

                <p className="text-xs text-muted-foreground">
                  הקוד מגיע באנגלית — Meta מקבלת כאן קוד שפה שלא אומת מולה בעברית,
                  ושליחה בשפה לא נתמכת נכשלת בשקט ולא בשגיאה.
                </p>

                <FormError message={codeState?.error} />
                <FormNotice message={codeState?.notice} />
                <SubmitButton>שליחת הקוד</SubmitButton>

                {/* Free to go back and forth here: requesting a code costs nothing
                    against the 72-hour budget, and skipping ahead is what a person
                    needs when the code arrived while they were on the previous step. */}
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStep('verify')}
                >
                  כבר יש לי קוד — לדילוג להזנה
                </Button>
              </form>
            ) : null}

            {step === 'verify' ? (
              <form action={runVerify} className="space-y-4">
                <input type="hidden" name="phoneNumberId" value={phoneNumberId} />
                <div>
                  <Label htmlFor="code">הקוד שהתקבל</Label>
                  {/* THE SAME OTP COMPOSITION THE PROFILE PAGE USES, including the
                      dir="ltr" ON THE GROUP — and that attribute is not cosmetic.
                      input-otp has no direction handling of its own (the settings
                      page's note records that its dist contains no `dir`, `rtl` or
                      `direction`), so under the admin shell's dir="rtl" the slot row
                      reverses and slot 0 renders on the RIGHT: 538395 would read back
                      as 593835. The owner would type the code they were sent and be
                      told it is wrong.

                      A plain <Input dir="ltr"> was here first. It is not broken in the
                      same way, but it made the one screen in the panel that asks for a
                      texted code look unlike the one screen in the app that already
                      does — for no reason other than that this file was written
                      without looking at that one. */}
                  <InputOTP
                    id="code"
                    name="code"
                    maxLength={6}
                    pattern={REGEXP_ONLY_DIGITS}
                    inputMode="numeric"
                    autoFocus
                    aria-invalid={otpInvalid || undefined}
                    containerClassName="justify-start"
                  >
                    <InputOTPGroup dir="ltr">
                      {[0, 1, 2, 3, 4, 5].map((index) => (
                        <InputOTPSlot
                          key={index}
                          index={index}
                          aria-invalid={otpInvalid || undefined}
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                  <FieldError errors={verifyState?.fieldErrors?.code} />
                </div>

                <FormError message={verifyState?.error} />
                <FormNotice message={verifyState?.notice} />
                <SubmitButton>אימות</SubmitButton>

                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStep('code')}
                >
                  לא הגיע קוד — שליחה מחדש
                </Button>
              </form>
            ) : null}

            {step === 'register' ? (
              isOwner ? (
                <form action={runRegister} className="space-y-4">
                  <input type="hidden" name="phoneNumberId" value={phoneNumberId} />

                  <Alert variant="destructive">
                    <AlertTriangle className="size-4" aria-hidden />
                    <AlertTitle>לפעולה הזו יש מכסה שאי אפשר לחדש</AlertTitle>
                    <AlertDescription>
                      Meta מתירה 10 פעולות רישום או הסרת רישום למספר בכל חלון של 72
                      שעות, וחוסמת את המספר ל-72 שעות בפעם ה-11. ניסיון חוזר אחרי
                      חסימה רק מאריך אותה.
                    </AlertDescription>
                  </Alert>

                  <div>
                    <Label htmlFor="pin">קוד PIN בן 6 ספרות</Label>
                    {/* type="password": this is a credential, not a one-time code. It
                        also keeps it out of a screen share and out of the browser's
                        autofill history. */}
                    <Input
                      id="pin"
                      name="pin"
                      type="password"
                      dir="ltr"
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={6}
                      required
                      aria-describedby="pin-hint"
                      aria-invalid={registerState?.fieldErrors?.pin ? true : undefined}
                    />
                    <p id="pin-hint" className="mt-1 text-xs text-muted-foreground">
                      אם למספר כבר יש אימות דו-שלבי — זהו ה-PIN הקיים. אם אין, הקוד
                      שתזינו כאן <strong>יהפוך</strong> ל-PIN של המספר, ו-Meta תדרוש
                      אותו כדי לשנות אותו או למחוק את המספר. המערכת אינה שומרת אותו.
                    </p>
                    <FieldError errors={registerState?.fieldErrors?.pin} />
                  </div>

                  <div>
                    <Label htmlFor="confirm">
                      להקלדת אישור, כתבו <span dir="ltr">{CONFIRM_WORD}</span>
                    </Label>
                    <Input
                      id="confirm"
                      name="confirm"
                      dir="ltr"
                      autoComplete="off"
                      required
                      aria-invalid={registerState?.fieldErrors?.confirm ? true : undefined}
                    />
                    <FieldError errors={registerState?.fieldErrors?.confirm} />
                  </div>

                  <FormError message={registerState?.error} />
                  <FormNotice message={registerState?.notice} />
                  <SubmitButton>רישום המספר</SubmitButton>
                </form>
              ) : (
                <Alert>
                  <AlertTitle>השלב האחרון שמור לבעלים</AlertTitle>
                  <AlertDescription>
                    המספר נוסף ואומת. הרישום ל-Cloud API צורך מכסה מוגבלת אצל Meta
                    ולכן מבוצע ע&quot;י בעלי הפלטפורמה. המזהה של המספר:{' '}
                    <span dir="ltr" className="font-mono">
                      {phoneNumberId}
                    </span>
                  </AlertDescription>
                </Alert>
              )
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
