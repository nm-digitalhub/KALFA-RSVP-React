'use client';

import { useActionState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';

import { sendExtraTestSmsAction } from './actions';

// ⚠️ THE ONLY CONTROL IN THE INTEGRATIONS TREE THAT SPENDS MONEY AND REACHES A REAL
// PERSON. Every other "test connection" button here is a read-only API call; this one
// puts a message on someone's phone and bills for it.
//
// So it is deliberately NOT styled as a primary action, it states the cost before it
// is pressed rather than after, and the destination is typed each time instead of
// remembered — a stored default is how a test lands on a number nobody meant to text.
//
// The server is the gate for all of it: the rate limit is keyed on the session's own
// staff id, and the number is validated there. Nothing here is load-bearing.

export function ExtraTestSms() {
  const [state, action] = useActionState(sendExtraTestSmsAction, null);

  return (
    <form action={action} className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="space-y-1">
        <p className="text-sm font-semibold">שליחת הודעת בדיקה</p>
        <p className="text-xs text-muted-foreground">
          שולח SMS אמיתי בתשלום למספר שתקלידו — זו הדרך היחידה לוודא שהשולח מאומת,
          כי ExtrA אינה חושפת את רשימת ה-verified IDs ב-API. עד 3 הודעות בשעה.
          ההודעה אינה כוללת שום פרט על אירוע, אורח או חשבון.
        </p>
      </div>

      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <label htmlFor="test_destination" className="sr-only">
            מספר יעד לבדיקה
          </label>
          <input
            id="test_destination"
            name="test_destination"
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="off"
            placeholder="050-0000000"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          <FieldError errors={state?.fieldErrors?.test_destination} />
        </div>
        <SubmitButton className="w-auto shrink-0">שליחת בדיקה</SubmitButton>
      </div>
    </form>
  );
}
