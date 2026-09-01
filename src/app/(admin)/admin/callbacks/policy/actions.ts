'use server';

// Server Action for /admin/callbacks/policy — saves the admin-editable
// callback-scheduling policy (business hours per weekday, notice, horizon,
// call duration, daily cap, motzash resume delay) into the
// callback_schedule_policies singleton row.
//
// Same authorization shape as config-actions.ts (agreement config): requireAdmin()
// gates the write, and the write goes through the request-scoped cookie session
// client (createClient) — NOT the service-role client — so
// callback_schedule_policies_admin_all RLS still applies as a second layer.
//
// Time-of-day fields arrive from <input type="time"> as "HH:MM" and are
// converted to minutes-since-midnight here — the DB's own CHECK constraints
// enforce the same 0–1439/1–1440/start<end shape as a second layer, but the
// inline validation below gives a field-level error instead of a raw DB one.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdmin } from '@/lib/auth/dal';
import { createClient } from '@/lib/supabase/server';
import type { FormState } from '@/lib/validation/result';

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type Day = (typeof DAYS)[number];

const policySchema = z.object({
  sunOpen: z.boolean(), sunStart: z.string(), sunEnd: z.string(),
  monOpen: z.boolean(), monStart: z.string(), monEnd: z.string(),
  tueOpen: z.boolean(), tueStart: z.string(), tueEnd: z.string(),
  wedOpen: z.boolean(), wedStart: z.string(), wedEnd: z.string(),
  thuOpen: z.boolean(), thuStart: z.string(), thuEnd: z.string(),
  friOpen: z.boolean(), friStart: z.string(), friEnd: z.string(),
  satOpen: z.boolean(), satStart: z.string(), satEnd: z.string(),
  // The actual-dial window ("חיוג" tab) — separate day-open/start/end triple
  // per day, same shape as above, saved into the dial_*_start_min/end_min
  // columns instead of the scheduling *_start_min/end_min ones.
  dialSunOpen: z.boolean(), dialSunStart: z.string(), dialSunEnd: z.string(),
  dialMonOpen: z.boolean(), dialMonStart: z.string(), dialMonEnd: z.string(),
  dialTueOpen: z.boolean(), dialTueStart: z.string(), dialTueEnd: z.string(),
  dialWedOpen: z.boolean(), dialWedStart: z.string(), dialWedEnd: z.string(),
  dialThuOpen: z.boolean(), dialThuStart: z.string(), dialThuEnd: z.string(),
  dialFriOpen: z.boolean(), dialFriStart: z.string(), dialFriEnd: z.string(),
  dialSatOpen: z.boolean(), dialSatStart: z.string(), dialSatEnd: z.string(),
  minNoticeMinutes: z.coerce.number().int().min(0),
  horizonDays: z.coerce.number().int().min(1).max(90),
  durationMinutes: z.coerce.number().int().min(5).max(120),
  dailyCap: z.coerce.number().int().min(1).max(50),
  motzashResumeMinutes: z.coerce.number().int().min(0),
  maxAttempts: z.coerce.number().int().min(1).max(20),
  attemptWindowDays: z.coerce.number().int().min(1).max(365),
});

type PolicyInput = z.infer<typeof policySchema>;

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

function isNextRedirect(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export async function saveCallbackPolicyAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = policySchema.safeParse({
    sunOpen: formData.get('sunOpen') === 'on',
    sunStart: formData.get('sunStart') ?? '',
    sunEnd: formData.get('sunEnd') ?? '',
    monOpen: formData.get('monOpen') === 'on',
    monStart: formData.get('monStart') ?? '',
    monEnd: formData.get('monEnd') ?? '',
    tueOpen: formData.get('tueOpen') === 'on',
    tueStart: formData.get('tueStart') ?? '',
    tueEnd: formData.get('tueEnd') ?? '',
    wedOpen: formData.get('wedOpen') === 'on',
    wedStart: formData.get('wedStart') ?? '',
    wedEnd: formData.get('wedEnd') ?? '',
    thuOpen: formData.get('thuOpen') === 'on',
    thuStart: formData.get('thuStart') ?? '',
    thuEnd: formData.get('thuEnd') ?? '',
    friOpen: formData.get('friOpen') === 'on',
    friStart: formData.get('friStart') ?? '',
    friEnd: formData.get('friEnd') ?? '',
    satOpen: formData.get('satOpen') === 'on',
    satStart: formData.get('satStart') ?? '',
    satEnd: formData.get('satEnd') ?? '',
    dialSunOpen: formData.get('dialSunOpen') === 'on',
    dialSunStart: formData.get('dialSunStart') ?? '',
    dialSunEnd: formData.get('dialSunEnd') ?? '',
    dialMonOpen: formData.get('dialMonOpen') === 'on',
    dialMonStart: formData.get('dialMonStart') ?? '',
    dialMonEnd: formData.get('dialMonEnd') ?? '',
    dialTueOpen: formData.get('dialTueOpen') === 'on',
    dialTueStart: formData.get('dialTueStart') ?? '',
    dialTueEnd: formData.get('dialTueEnd') ?? '',
    dialWedOpen: formData.get('dialWedOpen') === 'on',
    dialWedStart: formData.get('dialWedStart') ?? '',
    dialWedEnd: formData.get('dialWedEnd') ?? '',
    dialThuOpen: formData.get('dialThuOpen') === 'on',
    dialThuStart: formData.get('dialThuStart') ?? '',
    dialThuEnd: formData.get('dialThuEnd') ?? '',
    dialFriOpen: formData.get('dialFriOpen') === 'on',
    dialFriStart: formData.get('dialFriStart') ?? '',
    dialFriEnd: formData.get('dialFriEnd') ?? '',
    dialSatOpen: formData.get('dialSatOpen') === 'on',
    dialSatStart: formData.get('dialSatStart') ?? '',
    dialSatEnd: formData.get('dialSatEnd') ?? '',
    minNoticeMinutes: (formData.get('minNoticeMinutes') || '0') as string,
    horizonDays: (formData.get('horizonDays') || '0') as string,
    durationMinutes: (formData.get('durationMinutes') || '0') as string,
    dailyCap: (formData.get('dailyCap') || '0') as string,
    motzashResumeMinutes: (formData.get('motzashResumeMinutes') || '0') as string,
    maxAttempts: (formData.get('maxAttempts') || '0') as string,
    attemptWindowDays: (formData.get('attemptWindowDays') || '0') as string,
  });

  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  const dayColumns: Record<string, number | null> = {};
  for (const day of DAYS) {
    if (!dayOpen(parsed.data, day)) {
      dayColumns[`${day}_start_min`] = null;
      dayColumns[`${day}_end_min`] = null;
      continue;
    }
    const start = timeToMinutes(dayStart(parsed.data, day));
    const end = timeToMinutes(dayEnd(parsed.data, day));
    if (start === null || end === null || start >= end) {
      return { fieldErrors: { [`${day}Start`]: ['שעת התחלה/סיום לא תקינה'] } };
    }
    dayColumns[`${day}_start_min`] = start;
    dayColumns[`${day}_end_min`] = end;
  }
  for (const day of DAYS) {
    if (!dayOpen(parsed.data, day, true)) {
      dayColumns[`dial_${day}_start_min`] = null;
      dayColumns[`dial_${day}_end_min`] = null;
      continue;
    }
    const start = timeToMinutes(dayStart(parsed.data, day, true));
    const end = timeToMinutes(dayEnd(parsed.data, day, true));
    if (start === null || end === null || start >= end) {
      return { fieldErrors: { [`dial${cap(day)}Start`]: ['שעת התחלה/סיום לא תקינה'] } };
    }
    dayColumns[`dial_${day}_start_min`] = start;
    dayColumns[`dial_${day}_end_min`] = end;
  }

  try {
    await requireAdmin();
    const supabase = await createClient();
    const { error } = await supabase
      .from('callback_schedule_policies')
      .update({
        ...dayColumns,
        min_notice_minutes: parsed.data.minNoticeMinutes,
        horizon_days: parsed.data.horizonDays,
        duration_minutes: parsed.data.durationMinutes,
        daily_cap: parsed.data.dailyCap,
        motzash_resume_minutes: parsed.data.motzashResumeMinutes,
        max_attempts: parsed.data.maxAttempts,
        attempt_window_days: parsed.data.attemptWindowDays,
        updated_at: new Date().toISOString(),
      })
      .eq('id', true);
    if (error) {
      return { error: 'עדכון מדיניות התזמון נכשל. נסו שוב.' };
    }
  } catch (err) {
    if (isNextRedirect(err)) throw err;
    return { error: 'עדכון מדיניות התזמון נכשל. נסו שוב.' };
  }

  revalidatePath('/admin/callbacks/policy');
  return { notice: 'מדיניות התזמון נשמרה' };
}
