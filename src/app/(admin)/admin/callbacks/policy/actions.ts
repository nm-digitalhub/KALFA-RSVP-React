'use server';

// Server Action for /admin/callbacks/policy — saves the admin-editable
// callback-scheduling policy (business hours per weekday, notice, horizon,
// call duration, daily cap, motzash resume delay, the actual-dial window and
// the dial attempt cap/window) into the callback_schedule_policies singleton
// row.
//
// Same authorization shape as config-actions.ts (agreement config): manage_settings
// gates the write, and the write goes through the request-scoped cookie session
// client (createClient) — NOT the service-role client — so the per-operation RLS
// of callback_schedule_policies (manage_settings, staff-tables-permission-rls)
// still applies as a second layer.
//
// Time-of-day fields arrive from <input type="time"> as "HH:MM" and are
// converted to minutes-since-midnight here — the DB's own CHECK constraints
// enforce the same 0–1439/1–1440/start<end shape as a second layer, but the
// inline validation below gives a field-level error instead of a raw DB one.

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { returnValidationErrors } from 'next-safe-action';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { actionClient, returnUserError } from '@/lib/safe-action';
import { createClient } from '@/lib/supabase/server';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type Day = (typeof DAYS)[number];

// How each field is read from the form: a day is open only when its checkbox sends 'on'; a closed day
// renders no time inputs, so a missing time reads as ''; a blank or missing number reads as 0.
const open = zfd.checkbox();
const time = z.string().default('');
const blankIsZero = (value: unknown) => value || '0';

const policySchema = zfd.formData({
  sunOpen: open, sunStart: time, sunEnd: time,
  monOpen: open, monStart: time, monEnd: time,
  tueOpen: open, tueStart: time, tueEnd: time,
  wedOpen: open, wedStart: time, wedEnd: time,
  thuOpen: open, thuStart: time, thuEnd: time,
  friOpen: open, friStart: time, friEnd: time,
  satOpen: open, satStart: time, satEnd: time,
  // The actual-dial window ("חיוג" tab) — separate day-open/start/end triple
  // per day, same shape as above, saved into the dial_*_start_min/end_min
  // columns instead of the scheduling *_start_min/end_min ones.
  dialSunOpen: open, dialSunStart: time, dialSunEnd: time,
  dialMonOpen: open, dialMonStart: time, dialMonEnd: time,
  dialTueOpen: open, dialTueStart: time, dialTueEnd: time,
  dialWedOpen: open, dialWedStart: time, dialWedEnd: time,
  dialThuOpen: open, dialThuStart: time, dialThuEnd: time,
  dialFriOpen: open, dialFriStart: time, dialFriEnd: time,
  dialSatOpen: open, dialSatStart: time, dialSatEnd: time,
  minNoticeMinutes: z.preprocess(blankIsZero, z.coerce.number().int().min(0)),
  horizonDays: z.preprocess(blankIsZero, z.coerce.number().int().min(1).max(90)),
  durationMinutes: z.preprocess(blankIsZero, z.coerce.number().int().min(5).max(120)),
  dailyCap: z.preprocess(blankIsZero, z.coerce.number().int().min(1).max(50)),
  motzashResumeMinutes: z.preprocess(blankIsZero, z.coerce.number().int().min(0)),
  maxAttempts: z.preprocess(blankIsZero, z.coerce.number().int().min(1).max(20)),
  attemptWindowDays: z.preprocess(blankIsZero, z.coerce.number().int().min(1).max(365)),
});

type PolicyInput = z.output<typeof policySchema>;

function cap(day: Day): string {
  return `${day[0].toUpperCase()}${day.slice(1)}`;
}
function dayOpen(data: PolicyInput, day: Day, dial = false): boolean {
  const key = dial ? `dial${cap(day)}Open` : `${day}Open`;
  return data[key as keyof PolicyInput] as boolean;
}
function dayStart(data: PolicyInput, day: Day, dial = false): string {
  const key = dial ? `dial${cap(day)}Start` : `${day}Start`;
  return data[key as keyof PolicyInput] as string;
}
function dayEnd(data: PolicyInput, day: Day, dial = false): string {
  const key = dial ? `dial${cap(day)}End` : `${day}End`;
  return data[key as keyof PolicyInput] as string;
}

function timeToMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// A day whose hours do not parse, or start at or after their end, is refused on its start field.
function invalidHours(field: keyof PolicyInput): never {
  return returnValidationErrors(policySchema, { [field]: { _errors: ['שעת התחלה/סיום לא תקינה'] } });
}

export const saveCallbackPolicyAction = actionClient
  .inputSchema(policySchema)
  .stateAction(async ({ parsedInput }) => {
    const dayColumns: Record<string, number | null> = {};
    for (const day of DAYS) {
      if (!dayOpen(parsedInput, day)) {
        dayColumns[`${day}_start_min`] = null;
        dayColumns[`${day}_end_min`] = null;
        continue;
      }
      const start = timeToMinutes(dayStart(parsedInput, day));
      const end = timeToMinutes(dayEnd(parsedInput, day));
      if (start === null || end === null || start >= end) {
        invalidHours(`${day}Start`);
      }
      dayColumns[`${day}_start_min`] = start;
      dayColumns[`${day}_end_min`] = end;
    }
    for (const day of DAYS) {
      if (!dayOpen(parsedInput, day, true)) {
        dayColumns[`dial_${day}_start_min`] = null;
        dayColumns[`dial_${day}_end_min`] = null;
        continue;
      }
      const start = timeToMinutes(dayStart(parsedInput, day, true));
      const end = timeToMinutes(dayEnd(parsedInput, day, true));
      if (start === null || end === null || start >= end) {
        invalidHours(`dial${cap(day)}Start` as keyof PolicyInput);
      }
      dayColumns[`dial_${day}_start_min`] = start;
      dayColumns[`dial_${day}_end_min`] = end;
    }

    let saved = false;
    try {
      // `manage_settings`, not the retired coarse `requireAdmin()` flag. Callback policy governs when the
      // system calls people back.
      await requirePlatformPermission('manage_settings');
      const supabase = await createClient();
      const { error } = await supabase
        .from('callback_schedule_policies')
        .update({
          ...dayColumns,
          min_notice_minutes: parsedInput.minNoticeMinutes,
          horizon_days: parsedInput.horizonDays,
          duration_minutes: parsedInput.durationMinutes,
          daily_cap: parsedInput.dailyCap,
          motzash_resume_minutes: parsedInput.motzashResumeMinutes,
          max_attempts: parsedInput.maxAttempts,
          attempt_window_days: parsedInput.attemptWindowDays,
          updated_at: new Date().toISOString(),
        })
        .eq('id', true);
      saved = !error;
    } catch (err) {
      unstable_rethrow(err);
    }
    // A database refusal and a thrown failure answer the same way.
    if (!saved) returnUserError('עדכון מדיניות התזמון נכשל. נסו שוב.');

    revalidatePath('/admin/callbacks/policy');
    return { notice: 'מדיניות התזמון נשמרה' };
  });
