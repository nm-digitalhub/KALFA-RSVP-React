'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { z } from 'zod';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { logActivity } from '@/lib/data/activity';
import {
  abandonFleetGoal,
  answerFleetRequest,
  createFleetGoal,
  createOwnerFleetContinuation,
  createOwnerFleetRequest,
  pauseFleetGoal,
  readFleetRoles,
  resumeFleetGoal,
} from '@/lib/data/admin/fleet';
import { resolveOwnerTitle } from '@/lib/fleet/conversation';
import { goalWakeAtSchema } from '@/lib/fleet/goal';
import type { FormState } from '@/lib/validation/result';

const PATH = '/admin/fleet';

// Owner -> agent, from the conversation composer (/admin/fleet?role=). Two
// modes share this one action because they share one form:
//
// - new message: role (the open conversation), optional subject, body >= 10.
//   The minimum mirrors the DB-side body rule and keeps a one-word "כן" from
//   waking an agent run. The title is the visible subject, else the first
//   line, else "הודעה ל-<role>" (resolveOwnerTitle) — never a hidden value.
// - continuation ("השב" on a closed message): only the replied-to id travels;
//   role/tier/thread root/title are derived from the DB row server-side
//   (createOwnerFleetContinuation). Body >= 2 — the context comes from the root.
//
// The real gates stay downstream: admin membership inside the SECURITY
// DEFINER function, the UNIQUE request_key for double submits. The role is
// additionally checked against fleet.json here so a tampered hidden field
// cannot file a dead letter for a role that does not exist.
const roleField = z
  .string()
  .trim()
  .min(1, { message: 'יש לבחור סוכן' })
  .regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'שם סוכן לא תקין' });

const composeSchema = z.object({
  role: roleField,
  kind: z.enum(['approval', 'question', 'fyi'], { message: 'סוג פנייה לא תקין' }),
  tier: z.coerce.number().int().min(0).max(2, { message: 'דרגה חייבת להיות 0, 1 או 2' }),
  title: z.string().trim().max(200, { message: 'הנושא ארוך מדי (עד 200 תווים)' }),
  body: z
    .string()
    .trim()
    .min(10, { message: 'ההודעה קצרה מדי (לפחות 10 תווים) — תאר לסוכן מה נדרש' })
    .max(8000, { message: 'ההודעה ארוכה מדי (עד 8000 תווים)' }),
});

const continueSchema = z.object({
  continueFrom: z.uuid({ message: 'מזהה הודעה לא תקין' }),
  body: z
    .string()
    .trim()
    .min(2, { message: 'ההודעה קצרה מדי' })
    .max(8000, { message: 'ההודעה ארוכה מדי (עד 8000 תווים)' }),
});

/** FormState plus what the composer needs to focus the resulting message. */
export type FleetComposeState =
  | (NonNullable<FormState> & { requestId?: string; deduplicated?: boolean; role?: string })
  | null;

const DEDUP_NOTICE = 'הודעה זהה כבר נשלחה היום — לא נוצרה כפילות.';

export async function createFleetRequestAction(
  _prevState: FleetComposeState,
  formData: FormData,
): Promise<FleetComposeState> {
  await requirePlatformPermission('manage_settings');

  const continueFrom = formData.get('continueFrom');
  if (typeof continueFrom === 'string' && continueFrom !== '') {
    const parsed = continueSchema.safeParse({ continueFrom, body: formData.get('body') ?? '' });
    if (!parsed.success) return { fieldErrors: parsed.error.flatten().fieldErrors };
    try {
      const result = await createOwnerFleetContinuation(parsed.data);
      await logActivity({
        action: 'fleet_request.created_by_owner',
        meta: {
          request_id: result.id,
          role: result.role,
          kind: 'question',
          continues: parsed.data.continueFrom,
          deduplicated: result.deduplicated,
        },
      });
      revalidatePath(PATH, 'layout');
      return {
        notice: result.deduplicated ? DEDUP_NOTICE : 'ההודעה נשלחה.',
        requestId: result.id,
        deduplicated: result.deduplicated,
        role: result.role,
      };
    } catch (err) {
      unstable_rethrow(err);
      return { error: err instanceof Error ? err.message : 'פתיחת הפנייה נכשלה' };
    }
  }

  const parsed = composeSchema.safeParse({
    role: formData.get('role') ?? '',
    kind: formData.get('kind') || 'question',
    tier: formData.get('tier') || '0',
    title: formData.get('title') ?? '',
    body: formData.get('body') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  let result: { id: string; deduplicated: boolean };
  try {
    const roles = await readFleetRoles();
    if (!roles) return { error: 'לא ניתן לקרוא את רשימת הסוכנים מ-fleet.json' };
    if (!roles.some((r) => r.name === parsed.data.role)) {
      return { fieldErrors: { role: ['הסוכן לא מוגדר ב-fleet.json'] } };
    }
    result = await createOwnerFleetRequest({
      role: parsed.data.role,
      kind: parsed.data.kind,
      tier: parsed.data.tier,
      title: resolveOwnerTitle(parsed.data.title, parsed.data.body, parsed.data.role),
      body: parsed.data.body,
      threadRoot: null,
    });
    await logActivity({
      action: 'fleet_request.created_by_owner',
      meta: {
        request_id: result.id,
        role: parsed.data.role,
        kind: parsed.data.kind,
        deduplicated: result.deduplicated,
      },
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'פתיחת הפנייה נכשלה' };
  }

  // 'layout': the conversation list lives in fleet/layout.tsx, which does not
  // re-render on navigation — a page-only revalidation would leave its
  // preview/badges stale.
  revalidatePath(PATH, 'layout');
  return {
    notice: result.deduplicated ? DEDUP_NOTICE : 'ההודעה נשלחה.',
    requestId: result.id,
    deduplicated: result.deduplicated,
    role: parsed.data.role,
  };
}

// One action serves all three request kinds; the verdict arrives from the
// pressed submit button (name="verdict"). Kind<->verdict validity, pending-only
// and expiry are enforced by the fleet_answer_request RPC — this layer only
// validates shape and maps failures to safe Hebrew messages.
const answerSchema = z.object({
  id: z.uuid({ message: 'מזהה פנייה לא תקין' }),
  verdict: z.enum(['approved', 'denied', 'answered'], {
    message: 'סוג מענה לא תקין',
  }),
  answer: z
    .string()
    .trim()
    .max(2000, { message: 'התשובה ארוכה מדי (עד 2000 תווים)' }),
});

export async function answerFleetRequestAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformPermission('manage_settings');

  const parsed = answerSchema.safeParse({
    id: formData.get('id') ?? '',
    verdict: formData.get('verdict') ?? '',
    answer: formData.get('answer') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    await answerFleetRequest({
      id: parsed.data.id,
      verdict: parsed.data.verdict,
      answer: parsed.data.answer === '' ? null : parsed.data.answer,
    });
    await logActivity({
      action: 'fleet_request.answered',
      meta: { request_id: parsed.data.id, verdict: parsed.data.verdict },
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'שמירת המענה נכשלה' };
  }

  revalidatePath(PATH, 'layout');
  return { notice: 'המענה נשמר — הסוכן יקלוט אותו בריצה הבאה' };
}

// ── Fleet goals: owner creates, pauses, resumes, or abandons ────────────────
// Shape only. The real gates: has_role inside each SECDEF RPC, the CAS
// (step_count) and range checks inside fleet_goal_progress, and the table's
// own CHECK constraints. Numbers here mirror the DB CHECKs (title 3..200,
// body 10..8000) so the owner gets a field error, not a raised exception.
const goalSchema = z.object({
  role: z
    .string()
    .trim()
    .min(1, { message: 'יש לבחור סוכן' })
    .regex(/^[a-z0-9][a-z0-9-]*$/, { message: 'שם סוכן לא תקין' }),
  title: z
    .string()
    .trim()
    .min(3, { message: 'כותרת קצרה מדי' })
    .max(200, { message: 'כותרת ארוכה מדי (עד 200 תווים)' }),
  body: z
    .string()
    .trim()
    .min(10, { message: 'תאר לסוכן מה המטרה ומה נחשב "הושלם"' })
    .max(8000, { message: 'התוכן ארוך מדי (עד 8000 תווים)' }),
});

export async function createFleetGoalAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformPermission('manage_settings');

  const parsed = goalSchema.safeParse({
    role: formData.get('role') ?? '',
    title: formData.get('title') ?? '',
    body: formData.get('body') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  let goalId: string;
  try {
    ({ id: goalId } = await createFleetGoal(parsed.data));
    // PII-free: id + role only. Title/body stay in the table, not the log.
    await logActivity({
      action: 'fleet_goal.created',
      meta: { goal_id: goalId, role: parsed.data.role },
    });
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'יצירת המטרה נכשלה' };
  }

  revalidatePath(PATH, 'layout');
  return { notice: 'המטרה נוצרה. הסוכן יקלוט אותה בהרצה הבאה שלו.' };
}

const goalPauseSchema = z.object({
  id: z.uuid({ message: 'מזהה מטרה לא תקין' }),
  note: z
    .string()
    .trim()
    .max(500, { message: 'ההערה ארוכה מדי (עד 500 תווים)' })
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export async function pauseFleetGoalAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformPermission('manage_settings');

  const parsed = goalPauseSchema.safeParse({
    id: formData.get('id') ?? '',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const outcome = await pauseFleetGoal(parsed.data.id, parsed.data.note);
    await logActivity({
      action: 'fleet_goal.paused',
      meta: { goal_id: parsed.data.id, outcome },
    });
    revalidatePath(PATH, 'layout');
    // A no-op is reported as such. 'not_active' is not an error — the goal is
    // simply no longer active.
    return outcome === 'paused'
      ? { notice: 'המטרה הושהתה. הסוכן לא יתעורר עבורה עד שתשחרר אותה.' }
      : { notice: 'המטרה אינה פעילה — לא בוצע שינוי.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'השהיית המטרה נכשלה' };
  }
}

// nextWakeAt uses goalWakeAtSchema (offset:true) — the same rule the CLI's
// goal-progress verb enforces server-side. A naive datetime-local value that
// the client failed to convert is rejected loudly here, not silently shifted.
const goalResumeSchema = z.object({
  id: z.uuid({ message: 'מזהה מטרה לא תקין' }),
  nextWakeAt: goalWakeAtSchema.optional().or(z.literal('').transform(() => undefined)),
});

export async function resumeFleetGoalAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformPermission('manage_settings');

  const parsed = goalResumeSchema.safeParse({
    id: formData.get('id') ?? '',
    nextWakeAt: formData.get('next_wake_at') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    // undefined => the RPC applies its own default (an hour from now).
    const outcome = await resumeFleetGoal(parsed.data.id, parsed.data.nextWakeAt);
    await logActivity({
      action: 'fleet_goal.resumed',
      // The wake time itself is not PII and helps answer "why did it wake then".
      meta: { goal_id: parsed.data.id, outcome, next_wake_at: parsed.data.nextWakeAt ?? null },
    });
    revalidatePath(PATH, 'layout');
    return outcome === 'resumed'
      ? { notice: 'המטרה שוחררה ומונה הכשלים אופס.' }
      : { notice: 'המטרה אינה מושהית — לא בוצע שינוי.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'שחרור המטרה נכשל' };
  }
}

// The RPC requires a note, so it is required here too — a goal closed without
// a reason leaves a row nobody can explain a month from now.
const goalAbandonSchema = z.object({
  id: z.uuid({ message: 'מזהה מטרה לא תקין' }),
  note: z
    .string()
    .trim()
    .min(3, { message: 'נדרשת סיבה לסגירה' })
    .max(500, { message: 'ההערה ארוכה מדי (עד 500 תווים)' }),
});

export async function abandonFleetGoalAction(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  await requirePlatformPermission('manage_settings');

  const parsed = goalAbandonSchema.safeParse({
    id: formData.get('id') ?? '',
    note: formData.get('note') ?? '',
  });
  if (!parsed.success) {
    return { fieldErrors: parsed.error.flatten().fieldErrors };
  }

  try {
    const outcome = await abandonFleetGoal(parsed.data.id, parsed.data.note);
    await logActivity({
      action: 'fleet_goal.abandoned',
      meta: { goal_id: parsed.data.id, outcome },
    });
    revalidatePath(PATH, 'layout');
    return outcome === 'abandoned'
      ? { notice: 'המטרה נסגרה כ-failed.' }
      : { notice: 'המטרה כבר סגורה — לא בוצע שינוי.' };
  } catch (err) {
    unstable_rethrow(err);
    return { error: err instanceof Error ? err.message : 'סגירת המטרה נכשלה' };
  }
}
