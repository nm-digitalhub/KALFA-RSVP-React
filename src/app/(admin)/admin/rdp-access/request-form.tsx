'use client';

import { ClipboardList, Hourglass, Send, Timer } from 'lucide-react';
import { useActionState, useEffect, useState } from 'react';

import { FieldError, FormError, FormNotice, SubmitButton } from '@/components/forms';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { formatIsraelTime } from '@/lib/date';
import { FORM_COPY, minutesLabel } from '@/lib/rdp-access/copy';
import { RDP_MINUTES_DEFAULT, RDP_MINUTES_PRESETS, RDP_REASON_MAX } from '@/lib/rdp-access/policy';
import { cn } from '@/lib/utils';
import type { FormState } from '@/lib/validation/result';

import { requestRdpAccessAction } from './actions';

// The first station of the track: why access is needed and for how long. The duration is a four-stop line, not a
// dropdown, so the choice is visible at a glance. Both fields are controlled: React resets uncontrolled fields when
// a form action finishes, which would throw away what the person typed when the server refuses the request.

const REASON_ID = 'rdp-reason';
const REASON_HELP_ID = 'rdp-reason-help';
const REASON_ERROR_ID = 'rdp-reason-error';

export function RequestForm({ serverNow }: { serverNow: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(requestRdpAccessAction, null);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState<number>(RDP_MINUTES_DEFAULT);
  // The "if approved now, until HH:MM" line moves with the clock. First render uses the server's time so the markup
  // matches; the interval callback (not the effect body) is what sets state.
  const [nowMs, setNowMs] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const reasonErrors = state?.fieldErrors?.reason;
  const minutesErrors = state?.fieldErrors?.minutes;
  const endsAt = formatIsraelTime(new Date(nowMs + minutes * 60_000));

  return (
    <form action={formAction} className="flex flex-col gap-7 rounded-2xl border border-border bg-muted/30 p-5 sm:p-7">
      <div className="flex flex-col gap-2">
        <label htmlFor={REASON_ID} className="flex items-center gap-2 text-[15px] font-bold">
          <ClipboardList className="size-[18px] text-primary" aria-hidden />
          {FORM_COPY.reasonLabel}
        </label>
        <Textarea
          id={REASON_ID}
          name="reason"
          rows={3}
          required
          maxLength={RDP_REASON_MAX}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={FORM_COPY.reasonPlaceholder}
          aria-describedby={reasonErrors ? `${REASON_HELP_ID} ${REASON_ERROR_ID}` : REASON_HELP_ID}
          aria-invalid={reasonErrors ? true : undefined}
          className="bg-background text-[15px] leading-6"
        />
        <p id={REASON_HELP_ID} className="text-[13px] leading-5 text-muted-foreground">
          {FORM_COPY.reasonHelp}
        </p>
        <FieldError errors={reasonErrors} id={REASON_ERROR_ID} />
      </div>

      <fieldset className="flex min-w-0 flex-col gap-3.5">
        <legend className="mb-3.5 flex items-center gap-2 p-0 text-[15px] font-bold">
          <Timer className="size-[18px] text-primary" aria-hidden />
          {FORM_COPY.durationLabel}
        </legend>
        <RadioGroup
          name="minutes"
          value={String(minutes)}
          onValueChange={(value) => setMinutes(Number(value))}
          aria-label={FORM_COPY.durationLabel}
          className="relative grid grid-cols-4 gap-2 px-2"
        >
          <div aria-hidden className="absolute inset-x-[12.5%] top-[17px] h-1 rounded-full bg-border" />
          {RDP_MINUTES_PRESETS.map((preset) => {
            const checked = preset === minutes;
            return (
              <label key={preset} className="relative flex cursor-pointer flex-col items-center gap-2 text-center">
                <RadioGroupItem
                  value={String(preset)}
                  className={cn(
                    'size-[38px] border-[3px] border-border bg-background data-checked:border-[7px] data-checked:border-primary data-checked:bg-background dark:data-checked:bg-background',
                    '[&_[data-slot=radio-group-indicator]]:hidden',
                    checked && 'ring-[6px] ring-primary/15',
                  )}
                />
                <span className={cn('text-[15px] leading-[22px]', checked ? 'font-bold text-primary' : 'font-medium text-foreground/80')}>
                  {minutesLabel(preset)}
                </span>
              </label>
            );
          })}
        </RadioGroup>
        <FieldError errors={minutesErrors} />
      </fieldset>

      <FormError message={state?.error} />
      <FormNotice message={state?.notice} />

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
        <div className="flex flex-col gap-1">
          <p className="flex items-center gap-2 text-sm text-foreground/80">
            <Hourglass className="size-[18px] text-primary" aria-hidden />
            <span>
              אם יאושר עכשיו, עד{' '}
              <b dir="ltr" className="font-mono font-semibold">
                {endsAt}
              </b>
            </span>
          </p>
          <p className="text-[13px] leading-5 text-muted-foreground">{FORM_COPY.approvalWindow}</p>
        </div>
        <SubmitButton size="lg" className="h-12 w-auto gap-2.5 px-7 text-base font-bold md:h-12">
          <Send className="size-5" aria-hidden />
          {FORM_COPY.submit}
        </SubmitButton>
      </div>
    </form>
  );
}
