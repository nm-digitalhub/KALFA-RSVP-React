'use client';

import { useActionState } from 'react';
import {
  CalendarCheck,
  CheckCircle2,
  MessageSquareText,
  Send,
  UserRound,
} from 'lucide-react';

import {
  CallbackTimePreference,
  FIELD_CLS,
  Honeypot,
  PrivacyNote,
  TopicSelect,
} from '@/components/forms/callback-fields';
import {
  FieldError,
  FormError,
  SubmitButton,
} from '@/components/forms';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  submitIntakeAction,
  type IntakeFormState,
} from './actions';

export function IntakeForm({
  token,
  locked,
}: {
  token: string;
  locked: boolean;
}) {
  const action = submitIntakeAction.bind(null, token);

  const [state, formAction] =
    useActionState<IntakeFormState, FormData>(
      action,
      null,
    );

  if (state?.notice) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-[#fff0ec]">
          <CheckCircle2
            aria-hidden
            className="size-8 text-[#ff5a3c] motion-safe:animate-k-pop"
          />
        </div>

        <p className="mt-5 max-w-[320px] text-[17px] font-semibold leading-7 text-[#181818]">
          {state.notice}
        </p>

        <div className="mt-7 text-sm text-[#777]">
          <PrivacyNote />
        </div>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="relative space-y-[22px]"
    >
      <Honeypot />

      <div className="grid gap-2">
        <Label
          htmlFor="cbi-name"
          className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-[#171717]"
        >
          איך לפנות אליך?
        </Label>

        <div className="group relative">
          <Input
            id="cbi-name"
            name="full_name"
            required
            autoComplete="name"
            autoFocus
            placeholder="לדוגמה: שם, טלפון או אימייל"
            className={[
              FIELD_CLS,
              'h-[58px]',
              'rounded-[18px]',
              'border-[#d8dce1]',
              'bg-white',
              'pe-12',
              'ps-4',
              'text-[16px]',
              'font-medium',
              'shadow-none',
              'placeholder:text-[#92969d]',
              'focus-visible:border-[#ff8a75]',
              'focus-visible:ring-4',
              'focus-visible:ring-[#ff5a3c]/10',
            ].join(' ')}
          />

          <UserRound
            aria-hidden
            strokeWidth={1.8}
            className="pointer-events-none absolute end-4 top-1/2 size-[21px] -translate-y-1/2 text-[#868b92] transition-colors group-focus-within:text-[#ff5a3c]"
          />
        </div>

        <FieldError
          errors={state?.fieldErrors?.full_name}
        />
      </div>

      <div
        className="
          grid gap-2

          [&_label]:text-[17px]
          [&_label]:font-bold
          [&_label]:leading-6
          [&_label]:tracking-[-0.02em]
          [&_label]:text-[#171717]

          [&_button]:min-h-[58px]
          [&_button]:rounded-[18px]
          [&_button]:border-[#d8dce1]
          [&_button]:bg-white
          [&_button]:px-4
          [&_button]:text-[16px]
          [&_button]:font-medium
          [&_button]:shadow-none

          [&_select]:min-h-[58px]
          [&_select]:rounded-[18px]
          [&_select]:border-[#d8dce1]
          [&_select]:bg-white
          [&_select]:text-[16px]
          [&_select]:font-medium
          [&_select]:shadow-none
        "
      >
        <TopicSelect id="cbi-topic" />
      </div>

      {locked ? (
        <div className="flex min-h-[76px] items-center gap-3 rounded-[18px] border border-[#ffddd6] bg-[#fff5f2] px-4 py-3 text-[15px] leading-6 text-[#777b82]">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#ffe9e4]">
            <CalendarCheck
              aria-hidden
              strokeWidth={1.8}
              className="size-[18px] text-[#ff5a3c]"
            />
          </div>

          <span>
            כבר נקבע לך מועד לשיחה, והוא לא ישתנה.
          </span>
        </div>
      ) : (
        <div
          className="
            [&_label]:text-[17px]
            [&_label]:font-bold

            [&_button]:min-h-[58px]
            [&_button]:rounded-[18px]

            [&_select]:min-h-[58px]
            [&_select]:rounded-[18px]
          "
        >
          <CallbackTimePreference />
        </div>
      )}

      <div className="grid gap-2">
        <Label
          htmlFor="cbi-note"
          className="text-[17px] font-bold leading-6 tracking-[-0.02em] text-[#171717]"
        >
          על מה רצית לדבר?{' '}
          <span className="font-normal text-[#666b72]">
            (לא חובה)
          </span>
        </Label>

        <div className="group relative">
          <Textarea
            id="cbi-note"
            name="note"
            rows={4}
            maxLength={500}
            placeholder="כתוב כאן את הפרטים..."
            className="
              min-h-[118px]
              resize-none
              rounded-[18px]
              border-[#d8dce1]
              bg-white
              pe-12
              ps-4
              pt-4
              text-[16px]
              font-medium
              leading-7
              shadow-none
              placeholder:text-[#92969d]
              focus-visible:border-[#ff8a75]
              focus-visible:ring-4
              focus-visible:ring-[#ff5a3c]/10
              md:text-[16px]
            "
          />

          <MessageSquareText
            aria-hidden
            strokeWidth={1.8}
            className="pointer-events-none absolute end-4 top-4 size-[21px] text-[#868b92] transition-colors group-focus-within:text-[#ff5a3c]"
          />
        </div>

        <FieldError
          errors={state?.fieldErrors?.note}
        />
      </div>

      <FormError message={state?.error} />

      <SubmitButton
        size="lg"
        className="
          min-h-[60px]
          w-full
          gap-3
          rounded-[18px]
          border-0
          bg-[#ff5a3c]
          text-[18px]
          font-bold
          text-white
          shadow-[0_15px_30px_rgba(255,90,60,0.23)]
          transition-[transform,background-color,box-shadow]
          hover:-translate-y-px
          hover:bg-[#f65337]
          hover:shadow-[0_18px_35px_rgba(255,90,60,0.28)]
          active:translate-y-0
        "
      >
        <Send
          aria-hidden
          strokeWidth={1.8}
          className="size-[20px]"
        />

        שליחה
      </SubmitButton>

      <div className="pt-1 text-center text-[13px] leading-6 text-[#777b82]">
        <PrivacyNote />
      </div>
    </form>
  );
}