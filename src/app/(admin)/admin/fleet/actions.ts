'use server';

import { revalidatePath } from 'next/cache';
import {
  flattenValidationErrors,
  returnValidationErrors,
  type FlattenedValidationErrors,
  type ValidationErrors,
} from 'next-safe-action';
import { z } from 'zod';
import { zfd } from 'zod-form-data';

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
import { actionClient, returnUserError } from '@/lib/safe-action';

const PATH = '/admin/fleet';

// Every action here checks the permission FIRST and only then validates the
// form: the gate is a use() middleware, which runs before input validation.
// Each form feeds its schema what the old code fed it: a missing field is ''
// (and kind / tier fall back to 'question' / '0').

// Owner -> agent, from the conversation composer (/admin/fleet?role=). Two
// modes share this one action because they share one form:
//
// - new message: role (the open conversation), optional subject, body >= 10.
//   The minimum keeps a one-word "כן" from waking an agent run. The title is
//   the visible subject, else the first line, else "הודעה ל-<role>"
//   (resolveOwnerTitle) — never a hidden value.
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

const continueForm = zfd.formData({
  continueFrom: continueSchema.shape.continueFrom,
  body: continueSchema.shape.body.prefault(''),
});
const composeForm = zfd.formData({
  role: composeSchema.shape.role.prefault(''),
  kind: z.preprocess((v) => v || 'question', composeSchema.shape.kind),
  tier: z.preprocess((v) => v || '0', composeSchema.shape.tier),
  title: composeSchema.shape.title.prefault(''),
  body: composeSchema.shape.body.prefault(''),
});

const DEDUP_NOTICE = 'הודעה זהה כבר נשלחה היום — לא נוצרה כפילות.';

// Returns what the composer needs to focus the resulting message: requestId, deduplicated, role.
export const createFleetRequestAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_settings');
    return next();
  })
  .inputSchema(
    // The mode decides the schema: a non-empty continueFrom is a continuation.
    async (_prev, { clientInput }) => {
      const continueFrom = clientInput instanceof FormData ? clientInput.get('continueFrom') : null;
      return typeof continueFrom === 'string' && continueFrom !== '' ? continueForm : composeForm;
    },
    {
      // Typed with both modes' fields, so the composer can read each one's message.
      handleValidationErrorsShape: async (
        ve,
      ): Promise<FlattenedValidationErrors<ValidationErrors<typeof composeForm> & ValidationErrors<typeof continueForm>>> =>
        flattenValidationErrors(ve),
    },
  )
  .stateAction(async ({ parsedInput }) => {
    if ('continueFrom' in parsedInput) {
      const result = await createOwnerFleetContinuation(parsedInput);
      await logActivity({
        action: 'fleet_request.created_by_owner',
        meta: {
          request_id: result.id,
          role: result.role,
          kind: 'question',
          continues: parsedInput.continueFrom,
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
    }

    const roles = await readFleetRoles();
    if (!roles) returnUserError('לא ניתן לקרוא את רשימת הסוכנים מ-fleet.json');
    if (!roles.some((r) => r.name === parsedInput.role)) {
      returnValidationErrors(composeForm, { role: { _errors: ['הסוכן לא מוגדר ב-fleet.json'] } });
    }
    const result = await createOwnerFleetRequest({
      role: parsedInput.role,
      kind: parsedInput.kind,
      tier: parsedInput.tier,
      title: resolveOwnerTitle(parsedInput.title, parsedInput.body, parsedInput.role),
      body: parsedInput.body,
      threadRoot: null,
    });
    await logActivity({
      action: 'fleet_request.created_by_owner',
      meta: {
        request_id: result.id,
        role: parsedInput.role,
        kind: parsedInput.kind,
        deduplicated: result.deduplicated,
      },
    });

    // 'layout': the conversation list lives in fleet/layout.tsx, which does not
    // re-render on navigation — a page-only revalidation would leave its
    // preview/badges stale.
    revalidatePath(PATH, 'layout');
    return {
      notice: result.deduplicated ? DEDUP_NOTICE : 'ההודעה נשלחה.',
      requestId: result.id,
      deduplicated: result.deduplicated,
      role: parsedInput.role,
    };
  });

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

const answerForm = zfd.formData({
  id: answerSchema.shape.id.prefault(''),
  verdict: z.preprocess((v) => v ?? '', answerSchema.shape.verdict),
  answer: answerSchema.shape.answer.prefault(''),
});

export const answerFleetRequestAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_settings');
    return next();
  })
  .inputSchema(answerForm)
  .stateAction(async ({ parsedInput: { id, verdict, answer } }) => {
    await answerFleetRequest({ id, verdict, answer: answer === '' ? null : answer });
    await logActivity({
      action: 'fleet_request.answered',
      meta: { request_id: id, verdict },
    });

    revalidatePath(PATH, 'layout');
    return { notice: 'המענה נשמר — הסוכן יקלוט אותו בריצה הבאה' };
  });

// ── Fleet goals: owner creates, pauses, resumes, or abandons ────────────────
// Shape only. The real gates: has_platform_permission('manage_settings') inside each SECDEF RPC, the CAS
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

const goalForm = zfd.formData({
  role: goalSchema.shape.role.prefault(''),
  title: goalSchema.shape.title.prefault(''),
  body: goalSchema.shape.body.prefault(''),
});

export const createFleetGoalAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_settings');
    return next();
  })
  .inputSchema(goalForm)
  .stateAction(async ({ parsedInput }) => {
    const { id: goalId } = await createFleetGoal(parsedInput);
    // PII-free: id + role only. Title/body stay in the table, not the log.
    await logActivity({
      action: 'fleet_goal.created',
      meta: { goal_id: goalId, role: parsedInput.role },
    });

    revalidatePath(PATH, 'layout');
    return { notice: 'המטרה נוצרה. הסוכן יקלוט אותה בהרצה הבאה שלו.' };
  });

const goalPauseSchema = z.object({
  id: z.uuid({ message: 'מזהה מטרה לא תקין' }),
  note: z
    .string()
    .trim()
    .max(500, { message: 'ההערה ארוכה מדי (עד 500 תווים)' })
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

const goalPauseForm = zfd.formData({
  id: goalPauseSchema.shape.id.prefault(''),
  note: goalPauseSchema.shape.note.prefault(''),
});

export const pauseFleetGoalAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_settings');
    return next();
  })
  .inputSchema(goalPauseForm)
  .stateAction(async ({ parsedInput: { id, note } }) => {
    const outcome = await pauseFleetGoal(id, note);
    await logActivity({
      action: 'fleet_goal.paused',
      meta: { goal_id: id, outcome },
    });
    revalidatePath(PATH, 'layout');
    // A no-op is reported as such. 'not_active' is not an error — the goal is
    // simply no longer active.
    return outcome === 'paused'
      ? { notice: 'המטרה הושהתה. הסוכן לא יתעורר עבורה עד שתשחרר אותה.' }
      : { notice: 'המטרה אינה פעילה — לא בוצע שינוי.' };
  });

// nextWakeAt uses goalWakeAtSchema (offset:true) — the same rule the CLI's
// goal-progress verb enforces server-side. A naive datetime-local value that
// the client failed to convert is rejected loudly here, not silently shifted.
const goalResumeSchema = z.object({
  id: z.uuid({ message: 'מזהה מטרה לא תקין' }),
  nextWakeAt: goalWakeAtSchema.optional().or(z.literal('').transform(() => undefined)),
});

// The form field is next_wake_at; the schema (and its field error) call it nextWakeAt, so the form is
// mapped first and then validated.
const goalResumeForm = zfd.formData(
  z
    .object({ id: z.unknown().optional(), next_wake_at: z.unknown().optional() })
    .transform((form): { id: unknown; nextWakeAt?: unknown } => ({
      id: form.id ?? '',
      nextWakeAt: form.next_wake_at ?? '',
    }))
    .pipe(goalResumeSchema),
);

export const resumeFleetGoalAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_settings');
    return next();
  })
  .inputSchema(goalResumeForm)
  .stateAction(async ({ parsedInput: { id, nextWakeAt } }) => {
    // undefined => the RPC applies its own default (an hour from now).
    const outcome = await resumeFleetGoal(id, nextWakeAt);
    await logActivity({
      action: 'fleet_goal.resumed',
      // The wake time itself is not PII and helps answer "why did it wake then".
      meta: { goal_id: id, outcome, next_wake_at: nextWakeAt ?? null },
    });
    revalidatePath(PATH, 'layout');
    return outcome === 'resumed'
      ? { notice: 'המטרה שוחררה ומונה הכשלים אופס.' }
      : { notice: 'המטרה אינה מושהית — לא בוצע שינוי.' };
  });

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

const goalAbandonForm = zfd.formData({
  id: goalAbandonSchema.shape.id.prefault(''),
  note: goalAbandonSchema.shape.note.prefault(''),
});

export const abandonFleetGoalAction = actionClient
  .use(async ({ next }) => {
    await requirePlatformPermission('manage_settings');
    return next();
  })
  .inputSchema(goalAbandonForm)
  .stateAction(async ({ parsedInput: { id, note } }) => {
    const outcome = await abandonFleetGoal(id, note);
    await logActivity({
      action: 'fleet_goal.abandoned',
      meta: { goal_id: id, outcome },
    });
    revalidatePath(PATH, 'layout');
    return outcome === 'abandoned'
      ? { notice: 'המטרה נסגרה כ-failed.' }
      : { notice: 'המטרה כבר סגורה — לא בוצע שינוי.' };
  });
